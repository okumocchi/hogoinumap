// Service Worker for Push Notifications and PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch (err) {
      // JSONでない場合はテキストとして扱う(デバッグ・DevToolsテスト対策)
      console.warn('Push data is not JSON, falling back to text', err);
      const text = event.data.text();
      data = { title: '保護犬マップ', body: text };
    }
  }

  const title = data.title || '保護犬マップ';
  const options = {
    body: data.body || '新しい通知があります',
    icon: data.icon || '/icon.png',
    badge: '/icon.png',
    data: data.url || '/',
  };

  const results = await Promise.allSettled([
    self.registration.showNotification(title, options),
    ...(('setAppBadge' in self.navigator) ? [(() => {
      const badgeVal = data.badgeCount ?? data.unreadCount ?? data.badge;
      if (typeof badgeVal === 'number') {
        return badgeVal > 0
          ? self.navigator.setAppBadge(badgeVal)
          : self.navigator.clearAppBadge();
      }
      return Promise.resolve();
    })()] : []),
  ]);

  // 失敗したものがあればログに残す(握りつぶさない)
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Push handling task ${i} failed:`, r.reason);
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data || '/';

  const promiseChain = (async () => {
    if ('clearAppBadge' in self.navigator) {
      try {
        await self.navigator.clearAppBadge();
      } catch (e) {
        console.error('Failed to clear app badge on click', e);
      }
    }

    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url === targetUrl && 'focus' in client) {
        return client.focus();
      }
    }
    if (clients.openWindow) {
      return clients.openWindow(targetUrl);
    }
  })();

  event.waitUntil(promiseChain);
});

