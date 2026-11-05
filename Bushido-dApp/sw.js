// Bushido-dApp service worker. Served from the site root (/sw.js) so it can
// control the whole app; the source lives here in Bushido-dApp/.
//
// What it caches — and what it deliberately never caches:
//   - App shell (the page) : network-first, cached copy only when offline.
//   - /assets/* (hashed JS/CSS) and app icons : cache-first (filenames change on every build).
//   - /api/*, RPCs, wallet, price feeds, any other origin : NEVER cached.
//     Quotes and prices must always be live; a cached quote could mislead a swap.

const VERSION = 'bushido-dapp-v1';
const SHELL = ['/', '/Bushido-dApp/manifest.webmanifest', '/Bushido-dApp/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // RPCs, wallets, aggregators: straight to network
  if (url.pathname.startsWith('/api/')) return;        // live quotes/prices: never cached

  // Page navigations: always try the network for the newest build.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Hashed build assets and icons: immutable, so cache-first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/Bushido-dApp/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
