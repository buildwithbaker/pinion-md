/* Pinion.md - sw.js
 *
 * Cache-first service worker for local app shell assets.
 * All third-party dependencies are vendored locally for true offline support.
 * Bump CACHE_NAME (v1 -> v2 etc.) any time ASSETS change so old caches drop.
 */

const CACHE_NAME = 'pinion-md-v12';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './vendor/marked.min.js',
  './vendor/highlight.min.js',
  './vendor/purify.min.js',
  './vendor/mermaid.min.js',
  './vendor/highlight-theme.css',
];

// Install: cache all local assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first for same-origin assets, network fallback then cache for new ones.
// Cross-origin (Google Fonts) is left to the browser's normal cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
