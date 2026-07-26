/* NobleFrame – Service Worker
   Strategie:
   • Navigationen (HTML): network-first → Besucher sehen immer den neuesten
     Stand; der Cache dient nur als Offline-Fallback.
   • Statische Assets (JS/CSS/Bilder, same-origin): stale-while-revalidate →
     sofortige Antwort aus dem Cache, Aktualisierung im Hintergrund.
   • /api/ und der OMEGA-OS-Showcase (eigener SW) werden nie abgefangen. */
const CACHE = "nobleframe-v6";

/* Kern-Seiten für den Offline-Fallback. Einzelne Fehlschläge brechen die
   Installation NICHT ab (allSettled). */
const CORE = [
  "/",
  "/index.html",
  "/cinematic-engine.js",
  "/nf-interactions.js",
  "/manifest.json",
  "/leistungen.html",
  "/referenzen.html",
  "/showcase.html",
  "/tools.html",
  "/about.html",
  "/kontakt.html",
  "/faq.html",
  "/karriere.html",
  "/impressum.html",
  "/datenschutz.html",
  "/agb.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Externe Anfragen (Fonts, Google APIs, etc.) nicht abfangen
  if (url.origin !== self.location.origin) return;
  // KI-Endpunkt ist dynamisch, niemals cachen
  if (url.pathname.startsWith("/api/")) return;
  // OMEGA OS bringt einen eigenen Service Worker mit – Subpfad nicht anfassen
  if (url.pathname.startsWith("/showcase/omega-os/")) return;

  const isNavigation = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    // Network-first: frisches HTML, Cache nur offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // Assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
