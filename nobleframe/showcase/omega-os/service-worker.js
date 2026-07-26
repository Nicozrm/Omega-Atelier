// OMEGA OS — Service Worker. App-Shell cache-first, externe Origins (eingebettete Apps,
// Anthropic-API) bleiben unberührt. Cache-Version bei jedem Shell-Release erhöhen.
const CACHE = "omega-os-v4-2-0";
const SHELL = [
  "./index.html",
  "./bundle.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  // Fremde Origins (eingebettete Web-Apps, api.anthropic.com) niemals abfangen.
  if (url.origin !== self.location.origin) return;

  // Navigationen: Netz zuerst, bei Offline die gecachte Shell.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }

  // Statische Same-Origin-Assets: Cache zuerst, dann Netz (und nachcachen).
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
