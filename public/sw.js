// Walk Tracker service worker: cache-first for heavy static assets so
// repeat opens skip ~2MB+ of network. Bump CACHE version to invalidate
// (e.g. after regenerating nta-boundaries.geojson).
const CACHE = "wt-static-v1";
const STATIC_URLS = [
  "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js",
  "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css",
  "/data/nta-boundaries.geojson",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(STATIC_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  const isStatic = STATIC_URLS.some(
    (s) => url === s || new URL(url, self.location.origin).pathname === s
  );
  if (!isStatic) return; // everything else: network as usual

  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
    )
  );
});
