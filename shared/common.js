/* ============================================================
   Gemeinsame Schicht für Zeiterfassung + Auswertung.

   Herkunft: abgeleitet von shared/common.js aus
   github.com/jonashaldemann/buero-app (dort für zehn Module
   gemeinsam). Hier auf das eine Modul eingedampft und auf die
   ETH-Nextcloud (wolke.ethz.ch) umgestellt.

   Wird per <script src="shared/common.js"> VOR app.js bzw.
   dashboard.js eingebunden.

   Jede index.html, die dieses Skript einbindet, muss folgende
   Element-IDs für den Einstellungen-Dialog bereitstellen:
   settingsBtn, settingsOverlay, closeSettings, inputUser, inputPass,
   saveSettingsBtn, testConnBtn, testResult.
   ============================================================ */

// ---------- Konfiguration (hier anpassen) ----------

// Die ETH-Nextcloud. Geprüft am 24.11.2026: Nextcloud 35.0.3 Enterprise,
// WebDAV unter /remote.php/dav/ erreichbar, Basic-Auth akzeptiert
// (App-Passwort).
const NEXTCLOUD_ORIGIN = "https://wolke.ethz.ch";

// wolke.ethz.ch schickt KEINE Access-Control-Allow-Origin-Header (geprüft:
// auch die OPTIONS-Vorabfrage antwortet mit 401 ohne CORS-Header). Eine
// Seite auf github.io kann deshalb nicht direkt mit der Nextcloud sprechen
// -- der Browser blockiert. Dazwischen steht ein kleiner Cloudflare Worker
// (worker.js im Repo-Wurzelverzeichnis), der server-seitig weiterleitet und
// die fehlenden Header ergänzt. Siehe README, "CORS-Proxy".
//
// Ohne Schrägstrich am Ende -- proxyFetch() hängt "?path=..." direkt an.
//
// LEER LASSEN ("") heisst: direkt gegen die Nextcloud. Das funktioniert nur,
// falls die D-ARCH-IT für diese Seite CORS-Header aktiviert -- dann wird der
// Worker (und damit Cloudflare als Zwischenstation) gar nicht mehr gebraucht.
const PROXY_URL = "https://eth-zeit-proxy.haldejonas.workers.dev";

// Ordner im persönlichen Dateibereich auf wolke.ethz.ch, mit "/" getrennt.
// Darin liegen die Projektliste und die Jahres-CSVs
// (zeiterfassung_2026.csv). Fehlende Ebenen legt die App selbst an.
const DATA_FOLDER_PATH = "LLHIL_Jonas/Zeiterfassung";

// Die Projektliste. WebDAV unterscheidet Gross-/Kleinschreibung -- dieser
// Name muss exakt so auf der Nextcloud stehen, sonst kommt beim Laden ein
// 404 und die App bleibt bei der zuletzt bekannten Liste.
const PROJEKTE_DATEINAME = "Projekte.txt";

// ---------- localStorage-Namensraum ----------
//
// WICHTIG: localStorage gilt pro ORIGIN, nicht pro Pfad. Diese App und die
// Büro-Apps liegen beide unter https://jonashaldemann.github.io/ -- ohne
// eigenes Präfix würden sich die beiden Zugangsdaten, Zeiteinträge und
// Caches gegenseitig überschreiben. Deshalb trägt hier JEDER Schlüssel das
// Präfix "ethzeit_", und geleert wird nie der ganze localStorage, sondern
// nur die eigenen Schlüssel (siehe clearAppStorage()).
const LS_PREFIX = "ethzeit_";

const SETTINGS_KEY = LS_PREFIX + "settings";
const LS_PROJEKTE_CACHE = LS_PREFIX + "projekte_cache";
const LS_DEMO_OVERLAY = LS_PREFIX + "demo_overlay";

const DEFAULT_SETTINGS = {
  username: "",
  appPassword: "",
  displayName: ""
};

// ---------- Utilities ----------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Nur die eigenen Schlüssel entfernen -- localStorage.clear() würde die
// Büro-Apps auf demselben Origin mitlöschen (siehe LS_PREFIX oben).
function clearAppStorage() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(LS_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Nextcloud / WebDAV ----------

let settings = loadJSON(SETTINGS_KEY, DEFAULT_SETTINGS);

function personName() {
  if (istDemo()) return "Demo";
  return (settings.displayName && settings.displayName.trim()) || settings.username || "";
}

// "Eingerichtet" heisst: die App darf laden und speichern. Im Demomodus
// trifft das zu -- die Daten landen dann bei demoFetch() statt auf der
// Nextcloud.
function isConfigured() {
  return istDemo() || !!(settings.username && settings.appPassword);
}

function authHeader() {
  const token = btoa(`${settings.username}:${settings.appPassword}`);
  return { Authorization: `Basic ${token}` };
}

// ---------- Demomodus ----------
//
// Ohne gespeicherte Zugangsdaten läuft die App im DEMOMODUS: statt der
// Nextcloud antwortet eine kleine Attrappe (demoFetch) mit Beispieldaten aus
// demo/seed.json, Änderungen landen nur im localStorage dieses Browsers.
//
// Der Einstiegspunkt sitzt bewusst GANZ UNTEN in der Schicht -- auf Höhe von
// proxyFetch(), dort wo sonst die Nextcloud angesprochen wird. App und
// Auswertung kennen den Demomodus deshalb gar nicht.
//
// Sobald Zugangsdaten gespeichert sind, ist der Demomodus aus und die
// Beispieldaten sind nicht mehr erreichbar: sie liegen unter einem eigenen
// localStorage-Schlüssel und unter einem eigenen Benutzer "demo", und beim
// Anmelden werden die eigenen Schlüssel ohnehin geleert (siehe saveSettings()).
const DEMO_ENABLED = true; // falls der Demomodus je stören sollte: auf false
const DEMO_USER = "demo";
// Relativ zu common.js selbst aufgelöst (shared/common.js -> demo/seed.json),
// damit es aus der Wurzel UND aus dashboard/ gleich landet.
const DEMO_SEED_URL = new URL("../demo/seed.json", document.currentScript.src).href;

function istDemo() {
  return DEMO_ENABLED && !(settings.username && settings.appPassword);
}

let demoSeedPromise = null;
function ladeDemoSeed() {
  if (!demoSeedPromise) {
    demoSeedPromise = fetch(DEMO_SEED_URL, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : {}))
      .catch((err) => {
        console.warn("Demodaten konnten nicht geladen werden:", err);
        return {};
      });
  }
  return demoSeedPromise;
}

// Aus "remote.php/dav/files/demo/LLHIL_Jonas/Zeiterfassung/..." wird der Schlüssel
// "LLHIL_Jonas/Zeiterfassung/..." -- so sind die Pfade in demo/seed.json lesbar.
const DEMO_PREFIX = `remote.php/dav/files/${DEMO_USER}/`;
function demoSchluessel(path) {
  const clean = String(path).replace(/^\/+/, "");
  return clean.startsWith(DEMO_PREFIX) ? clean.slice(DEMO_PREFIX.length) : clean;
}

function demoOverlay() {
  return loadJSON(LS_DEMO_OVERLAY, {});
}

// Seed, überschrieben durch die lokalen Änderungen. null im Overlay ist ein
// Grabstein: eine Datei, die im Demomodus gelöscht wurde und deshalb auch
// nicht mehr aus dem Seed auftauchen darf.
async function demoDateien() {
  const dateien = { ...(await ladeDemoSeed()), ...demoOverlay() };
  Object.keys(dateien).forEach((k) => {
    if (dateien[k] === null) delete dateien[k];
  });
  return dateien;
}

function demoAntwort(body, status, contentType) {
  return new Response(body, { status, headers: contentType ? { "Content-Type": contentType } : {} });
}

async function demoFetch(relativePath, options) {
  const method = (options.method || "GET").toUpperCase();
  const key = demoSchluessel(relativePath);

  if (method === "MKCOL") return demoAntwort("", 201);

  if (method === "PROPFIND") {
    const dateien = await demoDateien();
    const ordner = key.replace(/\/+$/, "");
    const praefix = ordner + "/";
    // Erster Eintrag ist immer der abgefragte Ordner selbst -- so hält es
    // auch Nextcloud.
    const eintraege = [{ pfad: ordner + "/", istOrdner: true, groesse: 0 }];
    Object.keys(dateien).forEach((k) => {
      if (!k.startsWith(praefix)) return;
      const rest = k.slice(praefix.length);
      if (rest.includes("/")) return; // Unterordner gibt es hier nicht
      const inhalt = dateien[k];
      const text = typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt, null, 2);
      eintraege.push({ pfad: k, istOrdner: false, groesse: new Blob([text]).size });
    });

    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${eintraege
      .map((e) => {
        const href = "/" + (DEMO_PREFIX + e.pfad).split("/").map(encodeURIComponent).join("/");
        const typ = e.istOrdner ? "<d:collection/>" : "";
        const laenge = e.istOrdner ? "" : `<d:getcontentlength>${e.groesse}</d:getcontentlength>`;
        return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${typ}</d:resourcetype>${laenge}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
      })
      .join("")}</d:multistatus>`;
    return demoAntwort(xml, 207, "application/xml");
  }

  if (method === "PUT") {
    const overlay = demoOverlay();
    overlay[key] = typeof options.body === "string" ? options.body : "(Demo: Datei nicht gespeichert)";
    saveJSON(LS_DEMO_OVERLAY, overlay);
    return demoAntwort("", 201);
  }

  if (method === "DELETE") {
    const overlay = demoOverlay();
    overlay[key] = null;
    saveJSON(LS_DEMO_OVERLAY, overlay);
    return demoAntwort("", 204);
  }

  const dateien = await demoDateien();
  if (!(key in dateien)) return demoAntwort("", 404);
  const inhalt = dateien[key];
  // In seed.json dürfen JSON-Dateien als echte Objekte stehen (lesbar),
  // Textdateien wie projekte.txt als String.
  const text = typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt, null, 2);
  return demoAntwort(text, 200, "application/json");
}

// Einziger Ausgang zur Nextcloud. relativePath ist komplett relativ zur
// Nextcloud-Domain, z.B.
// "remote.php/dav/files/jonasha/LLHIL_Jonas/Zeiterfassung/zeiterfassung_2026.csv".
function proxyFetch(relativePath, options = {}) {
  if (istDemo()) return demoFetch(relativePath, options);
  const clean = String(relativePath).replace(/^\/+/, "");
  if (!PROXY_URL) {
    // Direktweg -- nur sinnvoll, wenn die Nextcloud CORS-Header schickt.
    return fetch(`${NEXTCLOUD_ORIGIN}/${clean}`, options);
  }
  return fetch(`${PROXY_URL}?path=${encodeURIComponent(clean)}`, options);
}

// Baut den vollen DAV-Pfad für die persönlichen Dateien.
function davPath(relativeToUser) {
  return `remote.php/dav/files/${relativeToUser}`;
}

// Segmente relativ zum persönlichen Nextcloud-Dateibereich, z.B.
// ncSegments("LLHIL_Jonas/Zeiterfassung") -> [username, "LLHIL_Jonas", "Zeiterfassung"].
function ncSegments(folderPath) {
  return [istDemo() ? DEMO_USER : settings.username, ...folderPath.split("/").filter(Boolean)];
}

// ---------- Projektliste (projekte.txt) ----------
//
// Die Projektliste steht als einfache Textdatei auf der Nextcloud, ein
// Projekt pro Zeile. Bewusst Text und nicht JSON: die Liste wird von Hand
// gepflegt, und eine Textdatei hat kein Syntaxrisiko durch
// Kommas/Anführungszeichen. Ändern = Datei in Nextcloud bearbeiten, alle
// Geräte ziehen spätestens nach 60s nach, kein Deploy nötig.
let projekte = loadJSON(LS_PROJEKTE_CACHE, []);
// Grund, warum das letzte Laden scheiterte (null = hat geklappt). Wird in der
// App angezeigt, wenn gar keine Projekte da sind -- sonst stünde man vor
// einer leeren Knopfreihe und wüsste nicht, ob es an der Datei, am Pfad oder
// an der Gross-/Kleinschreibung liegt.
let projekteFehler = null;
// Ob überhaupt schon einmal erfolgreich geladen wurde. Ohne das liessen sich
// "wird noch geladen" und "Datei ist da, aber leer" nicht auseinanderhalten:
// in beiden Fällen ist die Liste leer und projekteFehler null.
let projekteGeladen = false;

// Der Ort, an dem die App die Projektliste erwartet -- für Fehlermeldungen,
// damit man den erwarteten Pfad sieht, statt ihn im Code suchen zu müssen.
function projekteQuellePfad() {
  return `${DATA_FOLDER_PATH}/${PROJEKTE_DATEINAME}`;
}

function projekteDavPath() {
  return davPath([...ncSegments(DATA_FOLDER_PATH), PROJEKTE_DATEINAME].join("/"));
}

// Eine Zeile = ein Projekt, die ganze Zeile ist der Name. Die Büro-App
// parste hier zusätzlich eine führende dreistellige Projektnummer heraus
// ("021 Neubau Werkhof"); hier gibt es keine Nummern, und das Herausparsen
// würde einen Namen, der zufällig mit drei Ziffern beginnt, stillschweigend
// verstümmeln. id ist nur noch die Position (für die Sortierung der
// "Heute"-Liste in Dateireihenfolge).
function parseProjectList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((name, i) => ({ id: `P${i + 1}`, name }));
}

// Schlägt das Laden fehl (offline, Datei noch nicht angelegt), bleibt der
// letzte bekannte Stand erhalten statt die Liste zu leeren.
async function refreshProjekte() {
  if (!isConfigured()) return projekte;
  try {
    const res = await proxyFetch(projekteDavPath(), { method: "GET", headers: authHeader() });
    // 404 ist der häufigste Fall und verdient eine eigene Sprache: die Datei
    // heisst anders, liegt woanders, oder die Gross-/Kleinschreibung weicht
    // ab (WebDAV unterscheidet sie).
    if (res.status === 404) throw new Error(`Datei nicht gefunden (404)`);
    if (res.status === 401) throw new Error(`Zugangsdaten abgelehnt (401)`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    projekte = parseProjectList(await res.text());
    projekteFehler = null;
    projekteGeladen = true;
    saveJSON(LS_PROJEKTE_CACHE, projekte);
  } catch (err) {
    projekteFehler = err.message;
    console.warn(`${projekteQuellePfad()} konnte nicht geladen werden:`, err);
  }
  return projekte;
}

// MKCOL legt jeweils nur eine Ebene an -> Pfad Stück für Stück aufbauen.
async function ensureFolderPath(segments) {
  let pathSoFar = segments[0]; // persönlicher Wurzelordner existiert immer schon
  for (let i = 1; i < segments.length; i++) {
    pathSoFar += `/${segments[i]}`;
    const res = await proxyFetch(davPath(pathSoFar), { method: "MKCOL", headers: authHeader() });
    // 201 = angelegt, 405 = existiert schon -> beides ok, sonst Fehler
    if (!res.ok && res.status !== 405) {
      throw new Error(`Ordner anlegen fehlgeschlagen bei "${segments[i]}" (${res.status})`);
    }
  }
}

// ---------- Service Worker ----------

// Der Service Worker hier ruft bereits self.skipWaiting()/self.clients.claim()
// auf -- es fehlt nur die Client-Seite: ohne Reload merkt ein bereits offener
// Tab nichts davon. controllerchange feuert genau dann, wenn der neue Worker
// die Kontrolle übernimmt -> einmalig neu laden.
function registerServiceWorkerWithAutoUpdate() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register("service-worker.js")
    .then((reg) => {
      const anstossen = () => {
        if (reg.waiting) reg.waiting.postMessage("skipWaiting");
      };
      anstossen();
      reg.addEventListener("updatefound", () => {
        const neu = reg.installing;
        if (neu) neu.addEventListener("statechange", anstossen);
      });
      // Nach einem Deploy soll die Offline-Kopie auch dann nachziehen, wenn
      // die Seite tagelang offen bleibt: beim Zurückkehren in den Tab nachsehen.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

// ---------- Einstellungen UI (Nextcloud-Login) ----------

const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z" fill="currentColor"/></svg>';
const EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z" fill="currentColor" opacity="0.5"/><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" stroke-width="2"/></svg>';

// Blendet das App-Passwort im Klartext ein/aus -- beim Öffnen des Dialogs und
// nach dem Speichern jedes Mal zurück auf "verborgen".
function resetPasswordVisibility() {
  const input = document.getElementById("inputPass");
  const btn = document.getElementById("togglePassBtn");
  if (!input || !btn) return;
  input.type = "password";
  btn.innerHTML = EYE_SVG;
  btn.setAttribute("aria-label", "Passwort anzeigen");
  btn.setAttribute("title", "Passwort anzeigen");
}
function togglePasswordVisibility() {
  const input = document.getElementById("inputPass");
  const btn = document.getElementById("togglePassBtn");
  const currentlyHidden = input.type === "password";
  input.type = currentlyHidden ? "text" : "password";
  btn.innerHTML = currentlyHidden ? EYE_OFF_SVG : EYE_SVG;
  const label = currentlyHidden ? "Passwort verbergen" : "Passwort anzeigen";
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
}

function openSettings() {
  document.getElementById("inputUser").value = settings.username;
  document.getElementById("inputPass").value = settings.appPassword;
  resetPasswordVisibility();
  document.getElementById("testResult").textContent = "";
  document.getElementById("settingsOverlay").classList.remove("hidden");
}
function closeSettingsFn() {
  document.getElementById("settingsOverlay").classList.add("hidden");
}
// Kein eigenes Anzeigename-Feld -- der Name (CSV-Spalte "Person") wird aus
// dem Benutzernamen abgeleitet: bei einer E-Mail-Adresse der Teil vor dem
// "@", sonst der ganze Benutzername, erster Buchstabe gross
// ("jonasha" -> "Jonasha", "jonasha@ethz.ch" -> "Jonasha").
function deriveDisplayName(username) {
  const namePart = (username || "").split("@")[0].trim();
  return namePart ? namePart.charAt(0).toUpperCase() + namePart.slice(1) : "";
}
function saveSettings(onSaved) {
  const warDemo = istDemo();
  const username = document.getElementById("inputUser").value.trim();
  const appPassword = document.getElementById("inputPass").value.trim();
  // Beim Wechsel vom Demomodus zum echten Konto werden die eigenen
  // localStorage-Schlüssel geleert -- dort liegen sonst die Demo-Änderungen
  // UND der Projekt-Cache mit Demodaten. Danach wird die Seite neu geladen:
  // die bereits gerenderte Demo-Liste steckt ja noch im Arbeitsspeicher und
  // würde sonst weiter angezeigt, als wären es die eigenen Daten.
  if (warDemo && username && appPassword) {
    clearAppStorage();
    settings.username = username;
    settings.appPassword = appPassword;
    settings.displayName = deriveDisplayName(username);
    saveJSON(SETTINGS_KEY, settings);
    location.reload();
    return;
  }
  settings.username = username;
  settings.appPassword = appPassword;
  settings.displayName = deriveDisplayName(settings.username);
  saveJSON(SETTINGS_KEY, settings);
  closeSettingsFn();
  entferneDemoBanner();
  if (typeof onSaved === "function") onSaved();
}

// ---------- Demo-Banner ----------

function zeigeDemoBanner() {
  if (!istDemo() || document.getElementById("demoBanner")) return;
  const bar = document.createElement("div");
  bar.id = "demoBanner";
  bar.innerHTML =
    '<span><strong>Demomodus</strong> — Beispieldaten. ' +
    "Änderungen bleiben nur in diesem Browser und werden nirgends gespeichert.</span>" +
    '<button type="button" id="demoResetBtn">Beispieldaten zurücksetzen</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.getElementById("demoResetBtn").addEventListener("click", () => {
    if (!confirm("Alle im Demomodus gemachten Änderungen verwerfen?")) return;
    clearAppStorage();
    location.reload();
  });
}

function entferneDemoBanner() {
  const bar = document.getElementById("demoBanner");
  if (bar) bar.remove();
}

// checkRelPath: () => DAV-Pfad, der per GET geprüft wird (200 oder 404 = ok,
// die Datei muss nicht existieren, nur erreichbar sein).
// ensureFolderFn: () => Promise, baut vorher den Zielordner.
async function testConnection(checkRelPath, ensureFolderFn) {
  const el = document.getElementById("testResult");
  // Geprüft werden die GESPEICHERTEN Zugangsdaten, nicht die gerade
  // eingetippten. Ohne gespeicherte Daten liefe der Test gegen die
  // Demo-Attrappe und meldete fälschlich Erfolg.
  if (istDemo()) {
    el.textContent = "Noch keine Zugangsdaten gespeichert (Demomodus) – zuerst speichern.";
    el.className = "test-result err";
    return;
  }
  el.textContent = "Teste Verbindung…";
  el.className = "test-result";
  try {
    await ensureFolderFn();
    const res = await proxyFetch(checkRelPath(), { method: "GET", headers: authHeader() });
    if (res.status === 200 || res.status === 404) {
      el.textContent = "Verbindung erfolgreich.";
      el.className = "test-result ok";
    } else if (res.status === 401) {
      el.textContent = "Zugangsdaten falsch (401) – Benutzername oder App-Passwort stimmt nicht.";
      el.className = "test-result err";
    } else {
      el.textContent = `Unerwartete Antwort: ${res.status}`;
      el.className = "test-result err";
    }
  } catch (err) {
    el.textContent = "Fehler: " + err.message + " (vermutlich CORS – ist PROXY_URL gesetzt? Siehe README)";
    el.className = "test-result err";
  }
}

// Verdrahtet den kompletten Einstellungen-Dialog (Zahnrad, Speichern,
// Verbindung testen). onSaved wird nach dem Speichern aufgerufen.
function initSettingsUI({ checkRelPath, ensureFolderFn, onSaved } = {}) {
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("closeSettings").addEventListener("click", closeSettingsFn);
  document.getElementById("saveSettingsBtn").addEventListener("click", () => saveSettings(onSaved));
  const toggleBtn = document.getElementById("togglePassBtn");
  if (toggleBtn) toggleBtn.addEventListener("click", togglePasswordVisibility);
  if (checkRelPath && ensureFolderFn) {
    document.getElementById("testConnBtn").addEventListener("click", () => testConnection(checkRelPath, ensureFolderFn));
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", zeigeDemoBanner);
} else {
  zeigeDemoBanner();
}
