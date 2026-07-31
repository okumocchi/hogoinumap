// Service Worker for Push Notifications and PWA
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || '保護犬マップ';
    const options = {
      body: data.body || '新しい通知があります',
      icon: data.icon || '/icon.png',
      badge: '/icon.png',
      data: data.url || '/',
    };

    const promises = [self.registration.showNotification(title, options)];

    // App Badge API (setAppBadge / clearAppBadge)
    if ('setAppBadge' in self.navigator) {
      const badgeVal = data.badgeCount ?? data.unreadCount ?? data.badge;
      if (typeof badgeVal === 'number') {
        if (badgeVal > 0) {
          promises.push(self.navigator.setAppBadge(badgeVal));
        } else {
          promises.push(self.navigator.clearAppBadge());
        }
      }
    }

    event.waitUntil(Promise.allSettled(promises));
  } catch (err) {
    console.error('Error handling push event', err);
  }
});

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

