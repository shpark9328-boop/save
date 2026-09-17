/* KTX 좌석 알림 서비스 워커 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: '🚄 KTX 좌석 알림', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '🚄 KTX 좌석이 생겼습니다!';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'ktx-seat-alert',
    renotify: true,
    requireInteraction: true,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: payload.url || '/', ...(payload.data || {}) },
    actions: [{ action: 'open', title: '예매 페이지 열기' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
