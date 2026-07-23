// App-shell service worker: precache everything the diary needs to run offline.
// The oracle fetch is cross-origin and is never intercepted.
const CACHE = 'tom-diary-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/paper.css',
  './js/app-boot.js', './js/app.js', './js/statemachine.js', './js/settings.js',
  './js/ink.js', './js/commit.js', './js/help.js', './js/handwriting.js',
  './js/glyphs.js', './js/layout.js', './js/reveal.js', './js/dissolve.js',
  './js/skeleton.js', './js/oracle.js', './js/memory.js',
  './vendor/opentype.mjs', './fonts/DancingScript.ttf', './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  // Cache each shell asset independently so a single missing/failing entry
  // (e.g. a file not yet added by a later task) can't abort precaching of
  // the rest of the shell.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch((err) => console.warn('sw: precache failed', url, err)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle same-origin GETs; let the oracle (and any cross-origin) pass through.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
