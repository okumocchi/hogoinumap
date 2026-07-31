import { getCurrentUser } from 'aws-amplify/auth';
import { dataClient } from '../lib/dataClient';

const NOTIFICATION_ENABLED_KEY = 'web_notification_enabled';

// デフォルトのVAPID公開鍵（環境変数 VITE_VAPID_PUBLIC_KEY が設定されている場合は優先）
const DEFAULT_VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY ||
  'BEl62iUYgUivxIkv69yViEuiBIa-m9GYv540Nc14m9GYv540Nc14m9GYv540Nc14m9GYv540Nc14';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) {
    return 'unsupported';
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setWebNotificationEnabled(true);
    }
    return permission;
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return Notification.permission;
  }
}

export function isWebNotificationEnabled(): boolean {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;
  const saved = localStorage.getItem(NOTIFICATION_ENABLED_KEY);
  // デフォルトはtrue（許可されている場合は通知を有効にする）
  return saved === null ? true : saved === 'true';
}

export function setWebNotificationEnabled(enabled: boolean): void {
  localStorage.setItem(NOTIFICATION_ENABLED_KEY, enabled ? 'true' : 'false');
}

export interface ShowNotificationOptions {
  body?: string;
  icon?: string;
  tag?: string;
  onClick?: () => void;
}

export function sendWebNotification(title: string, options?: ShowNotificationOptions): Notification | null {
  if (!isWebNotificationEnabled()) {
    return null;
  }

  try {
    const notification = new Notification(title, {
      body: options?.body,
      icon: options?.icon ?? '/favicon.ico',
      tag: options?.tag,
    });

    notification.onclick = () => {
      window.focus();
      if (options?.onClick) {
        options.onClick();
      }
      notification.close();
    };

    return notification;
  } catch (error) {
    console.error('Failed to send web notification:', error);
    return null;
  }
}

/**
 * ホーム画面アイコンの未読件数バッジ (App Badge API) を更新します。
 * @param count 未読件数 (0 の場合はバッジを消去)
 */
export async function updateAppBadge(count: number): Promise<void> {
  if (typeof navigator === 'undefined') return;

  try {
    if ('setAppBadge' in navigator && 'clearAppBadge' in navigator) {
      if (count > 0) {
        await (navigator as any).setAppBadge(count);
      } else {
        await (navigator as any).clearAppBadge();
      }
    }
  } catch (error) {
    console.error('Failed to update App Badge:', error);
  }
}

/**
 * Service Worker を登録・更新します。
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    // 最新のService Workerがあるかバックグラウンドでチェック
    void registration.update().catch(() => {});
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}

/**
 * Web Push 購読 (Push Subscription) を登録・端末鍵をDynamoDBに保存します。
 */
export async function subscribeUserToPush(userSub?: string): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY) as unknown as BufferSource;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    let targetUserSub = userSub;
    if (!targetUserSub) {
      try {
        const currentUser = await getCurrentUser();
        targetUserSub = currentUser.userId;
      } catch (authErr) {
        console.log('User is not logged in, skipping DynamoDB PushSubscription save.');
      }
    }

    // ユーザーSubがある場合はDynamoDBへ保存・同期
    if (targetUserSub && subscription) {
      const subJson = subscription.toJSON();
      const endpoint = subscription.endpoint;
      const p256dh = subJson.keys?.p256dh ?? '';
      const auth = subJson.keys?.auth ?? '';

      if (endpoint && p256dh && auth) {
        // 重複保存の頻度を抑えるためのローカルストレージチェック
        const syncKey = `push_sub_synced:${targetUserSub}:${endpoint}`;
        const lastSynced = localStorage.getItem(syncKey);
        const now = Date.now();

        // 24時間に1回は強制同期（未同期または24時間経過時）
        if (!lastSynced || now - parseInt(lastSynced, 10) > 86400000) {
          try {
            await (dataClient.models.PushSubscription.create as any)(
              {
                userSub: targetUserSub,
                endpoint,
                p256dh,
                auth,
              },
              { authMode: 'userPool' }
            );
            localStorage.setItem(syncKey, now.toString());
            console.log('Successfully saved PushSubscription to DynamoDB for user:', targetUserSub);
          } catch (dbErr) {
            // 重複キー等ですでに作成済みの場合は成功とみなして同期タイムスタンプを保存
            localStorage.setItem(syncKey, now.toString());
            console.warn('PushSubscription creation in DynamoDB:', dbErr);
          }
        }
      }
    }

    return subscription;
  } catch (error) {
    console.error('Failed to subscribe user to push notifications:', error);
    return null;
  }
}

/**
 * Web Push 購読を解除します。
 */
export async function unsubscribeUserFromPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      return await subscription.unsubscribe();
    }
    return true;
  } catch (error) {
    console.error('Failed to unsubscribe from push notifications:', error);
    return false;
  }
}
