const CACHE_NAME = 'church-tycoon-v5';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './scene.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  ...[0, 1, 2, 3, 4, 5].map((i) => `./assets/sanctuary_${i}.png`),
  ...[0, 1, 2, 3, 4].map((i) => `./assets/education_${i}.png`),
  ...[0, 1, 2, 3, 4].map((i) => `./assets/fellowship_${i}.png`),
  ...[0, 1, 2, 3].map((i) => `./assets/parking_${i}.png`),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `./assets/person_${i}.png`),
  ...[0, 1, 2].map((i) => `./assets/visiting_car_${i}.png`),
  './assets/icon_fund.png', './assets/icon_members.png', './assets/icon_faith.png',
  './assets/icon_reputation.png', './assets/icon_volunteers.png',
  './assets/grass_0.png', './assets/grass_1.png', './assets/path_0.png',
  './assets/tree_0.png', './assets/tree_1.png', './assets/bush_0.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
