const NOTIFICATION_ENABLED_KEY = 'web_notification_enabled';

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
 * Service Worker を登録します。
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    return registration;
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    return null;
  }
}
