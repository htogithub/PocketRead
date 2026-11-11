/* PocketRead — service worker: app shell offline + cache of the CDN libraries */
const SHELL = 'pocketread-shell-v1';
const CDN = 'pocketread-cdn-v1';
const KEEP = [SHELL, CDN, 'pocketread-voices-v1'];
const FILES = ['./', './index.html', './styles.css', './app.js', './piper-worker.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const CDN_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pocketread-') && !KEEP.includes(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: network first (always fresh after an update), cache when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
    return;
  }

  // Versioned libraries and fonts: cache first. OCR language data is cached by Tesseract itself.
  if (CDN_HOSTS.includes(url.hostname) && !/tesseract\.js-data|traineddata/.test(url.pathname)) {
    e.respondWith(caches.open(CDN).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
  }
});
