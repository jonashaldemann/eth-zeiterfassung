# Hinweise für Claude Code

Deutschsprachiges Projekt: **Kommentare, Commit-Messages, README und
UI-Texte auf Deutsch**, Schweizer Rechtschreibung (kein ß). Code-Bezeichner
sind gemischt — bestehende Benennung im jeweiligen Umfeld fortsetzen, nicht
vereinheitlichen.

## Was das ist

Eine PWA ohne Build-Schritt: reines HTML/CSS/JS, direkt von GitHub Pages
ausgeliefert. Keine Abhängigkeiten, kein npm, kein Bundler. `node` wird nur
für `version.mjs` gebraucht.

Daten liegen auf der ETH-Nextcloud (`wolke.ethz.ch`) und werden per WebDAV
gelesen/geschrieben — über einen Cloudflare Worker als CORS-Proxy, siehe
README. `shared/common.js` ist die einzige Stelle, die mit der Nextcloud
spricht (`proxyFetch()`); App und Auswertung gehen immer darüber.

Herkunft: herausgelöst aus
[jonashaldemann/buero-app](https://github.com/jonashaldemann/buero-app),
Modul `zeiterfassung/`.

## Fallen, die hier schon zugeschnappt sind

**Derselbe Origin wie die Büro-App.** Beide liegen unter
`https://jonashaldemann.github.io/`, und localStorage wie Cache-Speicher
gelten pro Origin, nicht pro Pfad. Deshalb:

- Jeder localStorage-Schlüssel trägt `LS_PREFIX` (`ethzeit_`). Nie einen
  Schlüssel ohne Präfix einführen.
- Nie `localStorage.clear()` — es gibt `clearAppStorage()`, das nur die
  eigenen Schlüssel entfernt.
- Der Service Worker löscht beim Aktivieren nur Caches mit `CACHE_PREFIX`.

**GitHub Pages cacht zehn Minuten.** Vor jedem Deploy `node version.mjs`
laufen lassen, sonst sieht der Browser die neue Fassung nicht. Der Service
Worker ist netz-zuerst mit Cache als Rückfall — bitte so lassen, cache-first
hat hier für genau diese Probleme gesorgt.

**Der Demomodus hängt ganz unten.** `demoFetch()` sitzt auf Höhe von
`proxyFetch()`. Kein Modul darüber darf den Demomodus kennen oder abfragen;
neue Funktionen funktionieren dadurch automatisch auch ohne Login.

**Zuordnung läuft über den Projektnamen, nicht die Nummer.** Die Nummer in
`projekte.txt` ist kosmetisch und darf mehrfach vergeben sein (`000` für
mehrere interne Kategorien). Farben kommen aus `stringHash(name)`.

## Konventionen

- Kommentare erklären **warum**, nicht was — besonders dort, wo eine
  naheliegende Lösung aus einem konkreten Grund verworfen wurde. Der
  bestehende Bestand ist in dem Ton geschrieben; bitte fortsetzen.
- Keine neuen Abhängigkeiten ohne Rückfrage.
- Echte Daten (Projektlisten, CSVs) gehören nie ins Repo — siehe
  `.gitignore`.
- Änderungen an `worker.js` wirken erst, wenn der Code von Hand im
  Cloudflare-Dashboard neu deployed wird. Im Commit erwähnen.
