/**
 * Cloudflare Worker — CORS-Proxy für die ETH-Nextcloud (wolke.ethz.ch).
 *
 * Zweck: Die Zeiterfassungs-PWA läuft auf GitHub Pages und bekäme direkt
 * gegen wolke.ethz.ch CORS-Fehler — Nextcloud schickt dort keine
 * `Access-Control-Allow-Origin`-Header (geprüft am 24.11.2026: auch die
 * OPTIONS-Vorabfrage antwortet mit 401 ohne CORS-Header). Dieser Worker
 * läuft server-seitig (kein Browser, kein CORS beim Weiterleiten), reicht
 * die Anfrage 1:1 weiter und ergänzt in der Antwort nur die fehlenden
 * Header.
 *
 * Der Worker speichert NICHTS und kennt keine Zugangsdaten — der
 * Authorization-Header kommt bei jedem Request vom Browser und wird nur
 * durchgereicht. Die Daten selbst liegen ausschliesslich auf der
 * ETH-Nextcloud.
 *
 * ABER: die Verbindung wird im Worker terminiert, d.h. Cloudflare sieht
 * Inhalte und App-Passwort im Klartext. Siehe README, Abschnitt
 * "Datenschutz". Wer das nicht will, lässt die D-ARCH-IT CORS-Header für
 * die eigene GitHub-Pages-Adresse freischalten und setzt dann in
 * shared/common.js PROXY_URL = "" (Direktweg, ganz ohne Cloudflare).
 *
 * ?path= ist der Pfad relativ zur Nextcloud-Domain, z.B.
 *   "remote.php/dav/files/jonasha/Zeiterfassung/zeiterfassung_2026.csv"
 *
 * Deployen: siehe README, "CORS-Proxy (Cloudflare Worker)".
 */

// Nur diese Seiten dürfen den Worker benutzen. Hier die eigene
// GitHub-Pages-Adresse eintragen; localhost ist fürs lokale Testen drin.
const ALLOWED_ORIGINS = [
  "https://jonashaldemann.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
];

const NEXTCLOUD_ORIGIN = "https://wolke.ethz.ch";

// GET/PUT: CSV und projekte.txt lesen/schreiben. MKCOL: Zielordner anlegen.
// PROPFIND: Ordnerinhalt für die Auswertung auflisten. DELETE ist dabei,
// damit sich eine Jahresdatei bei Bedarf entfernen lässt.
const ALLOWED_METHODS = ["GET", "PUT", "MKCOL", "PROPFIND", "DELETE", "OPTIONS"];

// Der Worker ist öffentlich erreichbar. Ohne diese Schranke wäre er ein
// offener Proxy auf ALLES unter wolke.ethz.ch (Login-Seiten, OCS-API, …).
// Gebraucht wird nur WebDAV.
const ALLOWED_PATH_PREFIX = "remote.php/dav/";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const erlaubt = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": erlaubt,
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth",
    "Access-Control-Max-Age": "3600",
    // Die Antwort hängt vom Origin ab -> sonst könnte ein Cache die
    // Antwort für den falschen Origin ausliefern.
    Vary: "Origin"
  };
}

export default {
  async fetch(request) {
    const headers = corsHeaders(request);

    // Preflight-Anfrage des Browsers
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const origin = request.headers.get("Origin");
    // Ein Request ohne Origin (curl, andere Server) wird durchgelassen —
    // ohne gültiges App-Passwort kommt er bei Nextcloud ohnehin nicht weit.
    // Ein Request MIT fremdem Origin ist dagegen ein Browser, der hier
    // nichts zu suchen hat.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403, headers });
    }

    if (!ALLOWED_METHODS.includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers });
    }

    const url = new URL(request.url);
    const path = url.searchParams.get("path");
    if (!path) {
      return new Response("Missing ?path= parameter", { status: 400, headers });
    }

    // path kommt als Klartext-Pfad an (URLSearchParams hat die
    // Prozent-Codierung schon aufgelöst).
    const sauber = path.replace(/^\/+/, "");
    if (!sauber.startsWith(ALLOWED_PATH_PREFIX) || sauber.includes("..")) {
      return new Response("Path not allowed", { status: 403, headers });
    }
    const targetUrl = `${NEXTCLOUD_ORIGIN}/${sauber}`;

    const forwardHeaders = new Headers();
    const auth = request.headers.get("Authorization");
    if (auth) forwardHeaders.set("Authorization", auth);
    // Content-Type 1:1 vom Browser übernehmen statt fest vorzugeben.
    const contentType = request.headers.get("Content-Type");
    if (contentType) forwardHeaders.set("Content-Type", contentType);
    // Depth-Header für PROPFIND (Ordnerinhalt lesen) durchreichen.
    const depth = request.headers.get("Depth");
    if (depth) forwardHeaders.set("Depth", depth);
    // Ohne einen "normalen" User-Agent stufen manche Firewalls den Request
    // als Bot/Skript ein und blockieren ihn.
    forwardHeaders.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );
    forwardHeaders.set("Accept", "*/*");

    const init = { method: request.method, headers: forwardHeaders };
    if (request.method === "PUT" || request.method === "PROPFIND") {
      init.body = await request.arrayBuffer();
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, init);
    } catch (err) {
      return new Response("Upstream fetch failed: " + err.message, { status: 502, headers });
    }

    const body = await upstream.arrayBuffer();
    const respHeaders = new Headers(headers);
    const responseContentType = upstream.headers.get("Content-Type");
    if (responseContentType) respHeaders.set("Content-Type", responseContentType);

    return new Response(body, { status: upstream.status, headers: respHeaders });
  }
};
