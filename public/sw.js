// ── App-shell cache (cache-first för assets, network-first för HTML) ───────────

const CACHE_NAME = 'luftgbg-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(['/', '/manifest.json', '/icon-192.png', '/icon-512.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Låt externa API-anrop (SMHI, Göteborg, GitHub) gå direkt
  if (url.origin !== self.location.origin) return;

  // Cache-first för hashed assets (JS/CSS/bilder med versionshash i filnamnet)
  const isHashedAsset = /\.(js|css|png|svg|woff2?)$/.test(url.pathname);

  if (isHashedAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
  } else {
    // Network-first med cache som fallback för HTML och manifest
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});

// ── Push-notiser ───────────────────────────────────────────────────────────────

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
