// Alle Caches dieser App tragen dieses Präfix. WICHTIG: der Cache-Speicher
// gilt pro ORIGIN -- unter https://jonashaldemann.github.io/ liegen auch die
// Büro-Apps mit ihren eigenen Service Workern. Beim Aufräumen (activate)
// dürfen deshalb nur die EIGENEN Caches gelöscht werden, sonst nimmt diese
// App den anderen bei jedem Update die Offline-Kopie weg.
const CACHE_PREFIX = "eth-zeiterfassung-";
const CACHE_NAME = CACHE_PREFIX + "v3";

const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./shared/common.js",
  "./css/style.css",
  "./demo/seed.json",
  "./icons/zeiterfassung-192.png",
  "./icons/zeiterfassung-512.png",
  "./fonts/nudica-light-webfont.woff2",
  "./fonts/nudica-medium-webfont.woff2",
  "./dashboard/",
  "./dashboard/index.html",
  "./dashboard/css/style.css",
  "./dashboard/js/dashboard.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" ist hier entscheidend: ohne das holt addAll() die
    // Dateien durch den HTTP-Cache, und GitHub Pages liefert alles mit
    // "Cache-Control: max-age=600" -- ein frisch deployter Worker legte dann
    // bis zu zehn Minuten alte Dateien in seinen neuen Cache.
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((pfad) => new Request(pfad, { cache: "reload" }))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// NETZ ZUERST, Cache als Rückfall: online immer die aktuelle Fassung, der
// Cache ist nur fürs Offline-Arbeiten da und wird bei jeder Antwort
// nachgeführt. Umgekehrt (cache-first) sah man eine frisch deployte Fassung
// erst, nachdem im Hintergrund ein neuer Worker installiert, aktiviert und
// die Seite neu geladen worden war -- ging dabei etwas schief, half nur noch
// "Webseite vergessen" im Browser, und das nimmt die Zugangsdaten mit.
//
// `cache: "no-cache"` erzwingt eine Rückfrage beim Server: GitHub Pages
// liefert alles mit "Cache-Control: max-age=600", sonst käme bis zu zehn
// Minuten lang die alte Datei aus dem HTTP-Cache des Browsers. Es ist kein
// voller Download -- unverändert antwortet der Server mit 304.
self.addEventListener("fetch", (event) => {
  const anfrage = event.request;
  if (anfrage.method !== "GET") return;
  // Fremde Adressen (Nextcloud über den Worker-Proxy) gehen den gewöhnlichen
  // Weg -- sie stehen nie im Cache.
  if (new URL(anfrage.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(anfrage, { cache: "no-cache" })
      .then((antwort) => {
        if (antwort && antwort.ok) {
          const kopie = antwort.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(anfrage, kopie));
        }
        return antwort;
      })
      // ignoreSearch: die Seiten verweisen mit "?v=<nummer>" auf ihre
      // Dateien (siehe version.mjs), im Cache stehen sie ohne.
      .catch(() =>
        caches.match(anfrage, { ignoreSearch: true }).then((cached) => cached || Response.error())
      )
  );
});

// Ein wartender Worker übernimmt auf Zuruf (siehe
// registerServiceWorkerWithAutoUpdate() in shared/common.js).
self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});
