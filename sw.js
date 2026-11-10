/* NF-e Extractor Pro — service worker
 * Guarda o app e as bibliotecas para funcionar offline depois do 1º acesso.
 * Nenhum PDF passa por aqui: a leitura acontece só na página. */
const VERSION = "nfe-pro-v2.0.0";
const APP_SHELL = [
  "./", "./index.html", "./style.css", "./app.js", "./extractor.js", "./excel-export.js",
  "./manifest.webmanifest", "./icons/mark.svg", "./icons/maskable.svg"
];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
  "https://cdn.jsdelivr.net/npm/lucide@0.453.0/dist/umd/lucide.min.js",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(APP_SHELL);
    await Promise.all(LIBS.map((url) => cache.add(new Request(url, { mode: "cors" })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.(googleapis|gstatic)\.com|tessdata|projectnaptha/.test(url.host + url.pathname);
  if (!sameOrigin && !cdn) return;

  if (sameOrigin) {
    // app: rede primeiro (pega atualizações), cache se offline
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || caches.match("./index.html");
      }
    })());
    return;
  }

  // bibliotecas, fontes e dados de OCR: cache primeiro
  event.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") (await caches.open(VERSION)).put(req, res.clone());
      return res;
    } catch {
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
