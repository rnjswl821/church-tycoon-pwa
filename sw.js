const CACHE_NAME = 'church-tycoon-v13';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './scene.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `./assets/sanctuary_${i}.png`),
  ...[0, 1, 2, 3, 4].map((i) => `./assets/education_${i}.png`),
  ...[0, 1, 2, 3, 4].map((i) => `./assets/fellowship_${i}.png`),
  ...[0, 1, 2, 3].map((i) => `./assets/parking_${i}.png`),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `./assets/person_${i}.png`),
  ...[0, 1, 2].map((i) => `./assets/visiting_car_${i}.png`),
  './assets/icon_fund.png', './assets/icon_members.png', './assets/icon_faith.png',
  './assets/icon_reputation.png', './assets/icon_volunteers.png',
  './assets/grass_0.png', './assets/grass_1.png', './assets/path_0.png',
  './assets/tree_0.png', './assets/tree_1.png', './assets/bush_0.png',
  './assets/fence_0.png', './assets/flower_bed_0.png',
  './assets/micon_b_education.png', './assets/micon_b_fellowship.png', './assets/micon_b_parking.png',
  './assets/micon_b_sanctuary.png', './assets/micon_boost_large.png', './assets/micon_boost_medium.png',
  './assets/micon_boost_small.png', './assets/micon_c_flame.png', './assets/micon_c_tent.png',
  './assets/micon_c_tentflag.png', './assets/micon_d_mens.png', './assets/micon_d_mic.png',
  './assets/micon_d_school.png', './assets/micon_d_womens.png', './assets/micon_ev_backpack.png',
  './assets/micon_ev_bolt.png', './assets/micon_ev_camera.png', './assets/micon_ev_candle.png',
  './assets/micon_ev_chartdown.png', './assets/micon_ev_chartup.png', './assets/micon_ev_chat.png',
  './assets/micon_ev_door.png', './assets/micon_ev_dove.png', './assets/micon_ev_globe.png',
  './assets/micon_ev_handshake.png', './assets/micon_ev_hospital.png', './assets/micon_ev_letter.png',
  './assets/micon_ev_newspaper.png', './assets/micon_ev_plane.png', './assets/micon_ev_rain.png',
  './assets/micon_ev_ribbon.png', './assets/micon_ev_siren.png', './assets/micon_ev_teddy.png',
  './assets/micon_ev_tired.png', './assets/micon_ev_wedding.png', './assets/micon_ev_wrench.png',
  './assets/micon_m_basket.png', './assets/micon_m_bible.png', './assets/micon_m_dawn.png',
  './assets/micon_m_elementary.png', './assets/micon_m_house.png', './assets/micon_m_infant.png',
  './assets/micon_m_notebook.png', './assets/micon_m_notepad.png', './assets/micon_m_sfc.png',
  './assets/micon_m_water.png', './assets/micon_m_youth.png', './assets/micon_o_deacon.png',
  './assets/micon_o_elder.png', './assets/micon_o_exhorter.png', './assets/micon_s_evangelist_f.png',
  './assets/micon_s_pastor.png', './assets/micon_s_scroll.png', './assets/micon_s_teacher.png',
  './assets/micon_ui_check.png', './assets/micon_ui_clipboard.png', './assets/micon_ui_floppy.png',
  './assets/micon_ui_folder.png', './assets/micon_ui_gift.png', './assets/micon_ui_hourglass.png',
  './assets/micon_ui_lock.png', './assets/micon_ui_party.png', './assets/micon_ui_people.png',
  './assets/micon_ui_refresh.png', './assets/micon_ui_sleep.png', './assets/micon_ui_sparkle.png',
  './assets/micon_ui_warning.png', './assets/micon_ui_sun.png', './assets/micon_ui_moon.png',
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
