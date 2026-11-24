# Zeiterfassung ETH

Zeit per Knopfdruck auf Projekte erfassen — ein Knopf pro Projekt, Stop,
Nachtragen. Die Einträge werden als CSV auf die **ETH-Nextcloud
(wolke.ethz.ch)** synchronisiert. Läuft offline und synchronisiert, sobald
wieder Netz da ist. Dazu eine filterbare Auswertung unter `dashboard/`.

Herkunft: das Modul `zeiterfassung/` aus
[jonashaldemann/buero-app](https://github.com/jonashaldemann/buero-app),
herausgelöst als eigenständige App und auf die ETH-Nextcloud umgestellt.
Siehe [Unterschiede zur Büro-App](#unterschiede-zur-büro-app) — es sind ein
paar mehr als nur die Adresse.

---

## Geht das mit wolke.ethz.ch? — Ja.

Nachgeprüft am 24.11.2026:

| | |
|---|---|
| Was läuft dort | Nextcloud **35.0.3 Enterprise** (`https://wolke.ethz.ch/status.php`) |
| WebDAV | erreichbar unter `/remote.php/dav/files/<kürzel>/…` |
| Anmeldung von aussen | `WWW-Authenticate: Basic realm="Nextcloud"` → **App-Passwort funktioniert** |
| CORS | **keine** `Access-Control-Allow-Origin`-Header; die OPTIONS-Vorabfrage antwortet mit 401 ganz ohne CORS-Header |

Das heisst: speichern ja, aber eine Seite auf `github.io` kann nicht *direkt*
mit `wolke.ethz.ch` sprechen — der Browser blockiert das. Dazwischen braucht
es einen kleinen Proxy (`worker.js`, Schritt 2 unten). Genau dasselbe Problem
hatte die Büro-App mit ihrer Nextcloud; die Lösung ist dieselbe geblieben.

**Zwei Dinge vorher klären** (siehe [Datenschutz](#datenschutz) unten):

1. Beim Proxy-Weg laufen Inhalte und App-Passwort durch einen Cloudflare
   Worker. Ob das für deine Projektdaten in Ordnung ist, entscheidest du —
   Zeiterfassungsdaten sind keine Forschungsdaten, aber es ist eine bewusste
   Entscheidung.
2. Die elegantere Variante ohne Cloudflare: die D-ARCH-IT bitten, für
   `https://jonashaldemann.github.io` CORS-Header freizuschalten. Dann
   `PROXY_URL = ""` setzen und fertig — die App kann beides.

---

## Ersteinrichtung

### 1. Auf GitHub Pages veröffentlichen

Im Repo: **Settings → Pages → Source: Deploy from a branch → `main` / `/`
(root)**. Nach ein bis zwei Minuten liegt die App unter
`https://jonashaldemann.github.io/eth-zeiterfassung/`.

Auf dem Handy über "Zum Startbildschirm hinzufügen" installieren — es ist
eine PWA, danach startet sie wie eine App und läuft auch offline.

Ohne Zugangsdaten startet alles im **Demomodus** (Beispieldaten, siehe
unten) — man kann also sofort schauen, ob es gefällt, bevor irgendetwas
eingerichtet ist.

### 2. CORS-Proxy deployen (Cloudflare Worker, einmalig, ~10 Minuten)

1. Konto auf [dash.cloudflare.com](https://dash.cloudflare.com) (Free Plan
   reicht, keine Kreditkarte).
2. **Workers & Pages → Create → Create Worker**, Name z.B.
   `eth-zeit-proxy` → **Deploy** (legt erst einen Platzhalter an).
3. **Edit Code**, den kompletten Inhalt von `worker.js` einfügen, **Deploy**.
4. Cloudflare zeigt die Adresse, z.B.
   `https://eth-zeit-proxy.haldejonas.workers.dev`.
5. Diese Adresse in `shared/common.js` bei `PROXY_URL` eintragen, committen,
   pushen.

`worker.js` wird **nicht** automatisch mit dem Repo veröffentlicht — nach
Änderungen daran muss der Code im Cloudflare-Dashboard erneut eingefügt und
deployed werden (Copy-Paste, kein CLI nötig).

Der Worker speichert nichts und kennt keine Zugangsdaten: der
`Authorization`-Header kommt bei jedem Request vom Browser und wird nur
durchgereicht. Er lässt ausserdem nur durch, was die App wirklich braucht —
nur die Origins aus `ALLOWED_ORIGINS`, nur Pfade unter `remote.php/dav/`,
nur die Methoden GET/PUT/MKCOL/PROPFIND/DELETE.

### 3. App-Passwort auf wolke.ethz.ch erstellen

[wolke.ethz.ch → Einstellungen → Sicherheit](https://wolke.ethz.ch/settings/user/security)
→ **Neues App-Passwort erstellen**, Name z.B. "Zeiterfassung".

**Nie das ETH-Passwort eintragen.** Ein App-Passwort gilt nur für diese eine
Anwendung und lässt sich dort jederzeit einzeln widerrufen, ohne dass sonst
etwas betroffen ist. Es wird ausschliesslich lokal im Browser gespeichert
(localStorage) und nie ins Repo committet.

Falls die Seite keine App-Passwörter anbietet (kann bei SSO-Anmeldung
vorkommen): bei der D-ARCH-IT nachfragen.

### 4. Projektliste anlegen

Auf wolke.ethz.ch im persönlichen Dateibereich einen Ordner
**`Zeiterfassung`** anlegen und darin eine Datei **`projekte.txt`** —
ein Projekt pro Zeile, optional mit dreistelliger Nummer und Leerschlag
davor:

```
021 Digital Passport Explorer
014 Bauteilkatalog
007 Aufstockung LLHIL
003 Lehre / Betreuung
000 Institut Allgemein
000 Administration
```

Die Nummer ist rein kosmetisch und darf mehrfach vergeben sein (praktisch
für mehrere interne Kategorien, siehe `000` oben). Zugeordnet, gefiltert und
eingefärbt wird über den **Namen** — der muss eindeutig sein. Ein Projekt
umzubenennen trennt bestehende Einträge vom neuen Namen.

Ändern geht jederzeit: Datei in Nextcloud bearbeiten, alle Geräte ziehen
spätestens nach 60 Sekunden nach. Kein Deploy nötig.

### 5. In der App anmelden

Zahnrad-Symbol → **Benutzername** (ETH-Kürzel, z.B. `jonasha`) und
**App-Passwort** aus Schritt 3 → "Verbindung testen" → "Speichern".

Beim ersten Speichern wird der Demomodus verlassen und die Seite neu
geladen; die Beispieldaten sind danach weg.

---

## Ablage auf der ETH-Nextcloud

Alles liegt im persönlichen Dateibereich unter einem Ordner (einstellbar über
`DATA_FOLDER_PATH` in `shared/common.js`, Standard `Zeiterfassung`):

```
Zeiterfassung/
├── projekte.txt              ← von Hand gepflegt (Schritt 4)
├── zeiterfassung_2026.csv    ← legt die App selbst an
└── zeiterfassung_2025.csv
```

Der Ordner wird bei Bedarf automatisch angelegt (`MKCOL`, Ebene für Ebene).

### Datenformat

```
Datum,Projekt,Dauer_Min,Kommentar,Person,ProjektID
2026-11-17,Bauteilkatalog,310.25,Importpfad getestet,Jonasha,Bauteilkatalog
```

- **Eine Zeile pro Tag und Projekt**, nicht pro Start/Stop-Wechsel — mehrere
  Wechsel zum selben Projekt am selben Tag ergeben eine Summe. Beim Sync wird
  die passende Zeile gesucht und aktualisiert; nur wirklich neue
  Tag/Projekt-Kombinationen werden angehängt.
- `Dauer_Min` auf zwei Nachkommastellen.
- `Kommentar` bezieht sich auf die Tagessumme, in der "Heute"-Liste nur für
  den **heutigen** Tag editierbar.
- `Person` wird aus dem Benutzernamen abgeleitet (Teil vor dem `@`, erster
  Buchstabe gross). Die Spalte existiert, weil die Auswertung den ganzen
  Ordner liest — so liessen sich auch CSVs von anderen auswerten, wenn der
  Ordner mal geteilt wird.
- `ProjektID` enthält denselben Wert wie `Projekt`; die Spalte bleibt nur,
  um das CSV-Format nicht zu ändern.
- Klicks unter 5 Sekunden werden ignoriert (Schutz vor Versehen).

Eine CSV mit Komma-Trennung öffnet Excel auf einem deutschsprachigen Windows
nicht automatisch sauber — in Excel über **Daten → Aus Text/CSV** importieren
und als Trennzeichen das Komma wählen, dann stimmen die Spalten.

---

## Bedienung

- Klick auf einen **Projektknopf** beendet den laufenden Zähler (falls einer
  läuft) und startet sofort einen neuen.
- **Stop** beendet den Zähler, ohne einen neuen zu starten.
- **Nachtragen**: Zeit für ein beliebiges (auch vergangenes) Datum manuell
  eintragen.
- In der "Heute"-Liste lässt sich jeder Eintrag über das Stift-Symbol (✎)
  bearbeiten: Dauer und Kommentar anpassen (überschreibt die bisherige
  Summe) oder über "Löschen" ganz entfernen.
- Alles läuft lokal im Browser (localStorage), auch offline. Nicht
  synchronisierte Einträge werden nachgeliefert, sobald Netz da ist (Retry
  alle 30 s, sofort beim `online`-Ereignis).

### Auswertung (`dashboard/`)

Erreichbar über das Balken-Symbol oben rechts. Filter nach Jahr, Zeitraum
(heute / Woche / Monat / frei), Projekt und Person; dazu Summe, Balken pro
Projekt und pro Tag sowie die Einzelliste.

Datenquelle sind die Jahres-CSVs im Ordner: er wird per `PROPFIND`
aufgelistet, alle `.csv` darin werden zusammengeführt.

## Demomodus

Ohne gespeicherte Zugangsdaten läuft alles gegen eine Attrappe
(`demoFetch()` in `shared/common.js`) mit Beispieldaten aus
`demo/seed.json`. Änderungen landen nur im localStorage dieses Browsers.

Der Einstiegspunkt sitzt bewusst ganz unten in der Schicht — dort, wo sonst
die Nextcloud angesprochen wird. App und Auswertung kennen den Demomodus
deshalb gar nicht und brauchen keinen Sonderfall.

Abschaltbar mit `DEMO_ENABLED = false` in `shared/common.js`.

---

## Datenschutz

Die Zeitdaten liegen auf der ETH-Nextcloud, das App-Passwort nur im Browser.
Zwei Stellen verdienen trotzdem einen bewussten Blick:

**Der Cloudflare Worker sieht alles.** Er terminiert die Verbindung, also
liegen Inhalte *und* das App-Passwort im Worker im Klartext vor. Er speichert
zwar nichts (siehe `worker.js` — kein KV, kein Log), aber die Daten laufen
durch eine Infrastruktur ausserhalb der ETH. Für eine persönliche
Zeiterfassung ist das meist unproblematisch; wenn in Projektnamen oder
Kommentaren etwas steht, das die ETH nicht verlassen soll, ist es das nicht.

**Die Alternative ohne Cloudflare:** die D-ARCH-IT bitten, für die eigene
GitHub-Pages-Adresse CORS-Header freizuschalten. Dann in `shared/common.js`
`PROXY_URL = ""` setzen — die App spricht direkt mit `wolke.ethz.ch`, der
Worker entfällt komplett. Der Code kann beides, das ist eine Zeile.

**App-Passwort statt ETH-Passwort.** Das ist nicht nur eine Formalie: Ein
App-Passwort lässt sich auf wolke.ethz.ch einzeln widerrufen, z.B. wenn ein
Gerät wegkommt. Das ETH-Passwort gehört nirgends in einen Browser-Speicher.

**Das Repo ist öffentlich.** Es enthält nur Programmcode — Projektliste und
Zeitdaten liegen ausschliesslich auf der Nextcloud, und `.gitignore` fängt
versehentlich hereinkopierte Arbeitskopien ab. Falls das Repo trotzdem
privat werden soll: GitHub Pages braucht dafür einen bezahlten Plan.

---

## Unterschiede zur Büro-App

Mehr als nur die Nextcloud-Adresse — die beiden Apps liegen auf **demselben
Origin** (`https://jonashaldemann.github.io/`), und Browser trennen
localStorage und Cache-Speicher nach Origin, nicht nach Pfad:

- **Eigener localStorage-Namensraum.** Alle Schlüssel tragen das Präfix
  `ethzeit_` (`LS_PREFIX` in `shared/common.js`). Ohne das hätten sich die
  beiden Apps gegenseitig Zugangsdaten und Zeiteinträge überschrieben, weil
  die Büro-App dieselben Namen (`zeit_settings`, `zeit_entries`, …) benutzt.
- **Kein `localStorage.clear()` mehr.** Beim Verlassen des Demomodus und
  beim Zurücksetzen werden nur die eigenen Schlüssel entfernt
  (`clearAppStorage()`) — `clear()` hätte die Büro-App mitgelöscht.
- **Eigenes Cache-Präfix.** Der Service Worker räumt beim Aktivieren nur
  Caches auf, die mit `eth-zeiterfassung-` beginnen. Die Büro-App-Module
  löschen sich dort gegenseitig die Offline-Kopien weg (jedes Modul entfernt
  beim Aktivieren *alle* fremden Caches des Origins); das ist hier nicht
  nachgebaut.
- **Flache Struktur.** Die App liegt im Wurzelverzeichnis statt in
  `zeiterfassung/`, die Auswertung unter `dashboard/`.
- **Keine `config.json`.** Mitarbeitende, Büro-Adresse, Fahrzeuge und die
  übrigen Felder waren für die anderen Module da; geblieben ist
  `projekte.txt`.
- **`PROXY_URL` darf leer sein** — dann geht es direkt gegen die Nextcloud
  (siehe Datenschutz oben).
- **Nur die zwei gebrauchten Webfonts** (Nudica Light/Medium als woff/woff2)
  statt des ganzen Schriftordners. Ob die Lizenz die Weiterverbreitung in
  einem zweiten öffentlichen Repo deckt, ist nicht geprüft — falls nicht,
  reicht es, die beiden `@font-face`-Blöcke am Anfang von `css/style.css` zu
  löschen; die Schriftfamilien haben bereits einen System-Fallback.

---

## Entwickeln

```sh
# im Repo-Wurzelverzeichnis
python -m http.server 8080
# Browser: http://localhost:8080  (App)  bzw.  /dashboard/  (Auswertung)
```

`http://localhost:8080` steht bereits in `ALLOWED_ORIGINS` von `worker.js`,
lokales Testen gegen die echte Nextcloud funktioniert also auch.

**Vor jedem Deploy:**

```sh
node version.mjs
```

Das zählt die Versionsnummer im `CACHE_NAME` des Service Workers und die
`?v=`-Nummern in den HTML-Dateien gemeinsam hoch. Nötig, weil GitHub Pages
alles mit `Cache-Control: max-age=600` ausliefert: ohne neue Nummer bedient
sich der Browser bis zu zehn Minuten aus seinem eigenen HTTP-Cache und sieht
die neue Fassung nicht — und "Webseite vergessen" im Browser würde die
Zugangsdaten gleich mitlöschen.

### Dateien

| Datei | Zweck |
|---|---|
| `index.html`, `app.js` | die Zeiterfassung selbst |
| `dashboard/` | Auswertung (eigenes HTML/CSS/JS, kein eigener Service Worker) |
| `shared/common.js` | Nextcloud-Schicht: Login, `proxyFetch`, WebDAV-Pfade, Projektliste, Demomodus, Einstellungen-Dialog |
| `worker.js` | CORS-Proxy, läuft bei Cloudflare — **nicht** Teil der veröffentlichten Seite |
| `service-worker.js` | Offline-Cache, netz-zuerst |
| `demo/seed.json` | Beispieldaten für den Demomodus |
| `version.mjs` | Versionsnummern hochzählen |
