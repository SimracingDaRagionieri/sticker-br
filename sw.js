// Service worker cache-first. Incrementa CACHE_VERSION a ogni modifica ai file.
const CACHE_VERSION = 'v16';
const CACHE_NAME = 'sbr-' + CACHE_VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/export.js',
  './js/db.js',
  './js/search.js',
  './js/actionfiles.js',
  './js/stickerinput.js',
  './js/fonts.js',
  './js/templateedit.js',
  './js/matchlog.js',
  './js/logsticker.js',
  './js/logsource.js',
  './js/testdata.js',
  './js/ui.js',
  './js/crop.js',
  './js/render.js',
  './js/cardscan.js',
  './js/pdfread.js',
  './js/pdfteam.js',
  './vendor/dexie.min.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
  './js/screens/crea.js',
  './js/screens/azioni.js',
  './js/screens/libreria.js',
  './js/screens/anteprima.js',
  './js/screens/carta.js',
  './js/screens/pdfimport.js',
  './js/screens/template.js',
  './js/screens/log.js',
  './js/screens/logmatch.js',
  './js/screens/coda.js',
  './js/screens/altro.js',
  './fonts/BebasNeue.woff2',
  './fonts/Oswald.woff2',
  './fonts/RobotoCondensed.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  // Niente skipWaiting automatico: l'utente aggiorna dalla barra "Aggiorna".
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sbr-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
