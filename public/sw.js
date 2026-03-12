self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  // Stöd både standard {title, body} och Declarative Web Push {web_push:8030, notification:{...}}
  const notif = data.notification || data;
  const title = notif.title || 'Luftkvalitet Femman';
  const options = {
    body: notif.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'luftkvalitet',
    renotify: true,
    data: { url: notif.navigate || data.url || 'https://luftfemman.olacarlsson.com' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
