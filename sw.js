// ============================================================================
// Offline cache.
//
// This gets used at events, on venue wifi, and the moment it is most needed is
// the moment the connection is worst. Everything the tool needs to run — shell,
// fonts, deck maps and the PDF library — is precached on install so a dropped
// connection mid-mission costs nothing.
//
// Bump CACHE when any precached file changes; the old cache is deleted on
// activate.
// ============================================================================
const CACHE = 'ucn-eng-v2';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/mission.js',
  './js/pdf-report.js',

  // Lazily loaded in the page, but precached: an export attempted offline
  // would otherwise fail at exactly the wrong moment.
  './js/vendor/jspdf.umd.min.js',

  // WOFF2 is what a modern browser fetches. The TTF fallbacks are also the
  // files the PDF exporter embeds, so they are needed offline too.
  './fonts/Exo2-Regular.woff2',
  './fonts/Exo2-Bold.woff2',
  './fonts/Exo2-Italic.woff2',
  './fonts/Orbitron-Bold.woff2',
  './fonts/Orbitron-SemiBold.woff2',
  './fonts/Exo2-Regular.ttf',
  './fonts/Exo2-Bold.ttf',
  './fonts/Exo2-Italic.ttf',
  './fonts/Orbitron-Bold.ttf',

  './assets/ucn-logo-white.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',

  './ship-maps/HAVOCK_SHIP_MAP.pdf',
  './ship-maps/Takanami_Ship_Map.pdf',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing, so one renamed file would leave the whole
      // cache empty. Fetch individually and keep what succeeds.
      .then(cache => Promise.all(
        PRECACHE.map(url =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deployed update is picked up, and fall
  // back to the cached page when there is nothing to reach.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })
          .then(hit => hit || caches.match('./')))
    );
    return;
  }

  // Everything else is a static asset: serve from cache, and refresh the entry
  // in the background so a redeploy lands on the next visit.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) {
        fetch(req)
          .then(res => {
            if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res));
          })
          .catch(() => { /* offline: the cached copy stands */ });
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
