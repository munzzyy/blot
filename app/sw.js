// Blot service worker: offline shell only. Documents never touch a cache.

const VERSION = "blot-v0.1.0";

const PRECACHE = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/main.js",
  "/js/pdfdoc.js",
  "/js/pdfwrite.js",
  "/js/editor.js",
  "/js/canvasview.js",
  "/js/render.js",
  "/js/i18n.js",
  "/js/strings-es.js",
  "/vendor/pdfjs/pdf.mjs",
  "/vendor/pdfjs/pdf.worker.mjs",
  "/icons/blot.svg",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/privacy.html",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(PRECACHE);
    })()
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    const shell =
      url.pathname === "/" || url.pathname === "/index.html"
        ? "/index.html"
        : url.pathname === "/privacy.html" || url.pathname === "/privacy"
          ? "/privacy.html"
          : null;
    if (shell) {
      event.respondWith(
        (async () => {
          const cached = await caches.match(shell, { cacheName: VERSION });
          return cached || fetch(event.request);
        })()
      );
    }
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request, { cacheName: VERSION });
      if (cached) return cached;
      const res = await fetch(event.request);
      if (res && res.ok && PRECACHE.includes(url.pathname)) {
        const cache = await caches.open(VERSION);
        cache.put(event.request, res.clone());
      }
      return res;
    })()
  );
});
