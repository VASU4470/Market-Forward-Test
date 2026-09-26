const CACHE = 'market-forward-test-v2-11';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=2.8',
  './theme.css?v=2.8',
  './brand.css?v=2.8',
  './auth-v3.css?v=2.10',
  './accessibility.css?v=1',
  './text-size.js?v=1',
  './pizero-logo.png',
  './app.js?v=2.3',
  './auth-v3.js?v=2',
  './auth-v4.js?v=4',
  './auto-score.css?v=2.8',
  './auto-score.js?v=1',
  './manifest.webmanifest?v=2.8',
  './icon.svg?v=2.8'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const isAppAsset = ['style', 'script'].includes(event.request.destination);
  if (isAppAsset) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
