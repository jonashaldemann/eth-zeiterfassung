/* ============================================================
   Version hochzählen (vor jedem Deploy ausführen).

   Hintergrund: GitHub Pages liefert ALLES mit "Cache-Control: max-age=600".
   Der Browser bedient sich dadurch bis zu zehn Minuten aus seinem eigenen
   HTTP-Cache -- und zwar OHNE den Service Worker zu fragen. Nach einem
   Deploy half deshalb nur noch "Webseite vergessen" im Browser, was die
   Zugangsdaten gleich mit löscht.

   Lösung: die Seiten verweisen auf ihre Dateien mit "?v=<nummer>". Eine
   neue Nummer ist eine neue Adresse, die in keinem Cache liegen kann. Die
   Nummer ist dieselbe wie im CACHE_NAME des Service Workers -- dieses
   Skript zählt beide gemeinsam hoch, damit sie nie auseinanderlaufen.

   Aufruf:
     node version.mjs
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

const WURZEL = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const swPfad = path.join(WURZEL, "service-worker.js");
const sw = fs.readFileSync(swPfad, "utf8");
const treffer = sw.match(/const CACHE_NAME = CACHE_PREFIX \+ "v(\d+)";/);
if (!treffer) throw new Error("kein CACHE_NAME gefunden");
const neu = Number(treffer[1]) + 1;
fs.writeFileSync(swPfad, sw.replace(treffer[0], `const CACHE_NAME = CACHE_PREFIX + "v${neu}";`));

// Alle HTML-Dateien der App (Wurzel + dashboard/).
function htmlDateien(ordner) {
  const treffer = [];
  const suche = (d) => {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if ([".git", "node_modules", "fonts", "icons"].includes(e.name)) return;
        suche(p);
      } else if (e.name.endsWith(".html")) treffer.push(p);
    });
  };
  suche(ordner);
  return treffer;
}

let seiten = 0;
htmlDateien(WURZEL).forEach((p) => {
  const alt = fs.readFileSync(p, "utf8");
  // Nur EIGENE Dateien versionieren -- externe Adressen bleiben unberührt.
  const text = alt.replace(
    /((?:src|href)=")((?!https?:)[^"]+\.(?:js|css))(?:\?v=\d+)?(")/g,
    (_, vor, datei, nach) => `${vor}${datei}?v=${neu}${nach}`
  );
  if (text !== alt) {
    fs.writeFileSync(p, text);
    seiten++;
  }
});

console.log(`v${neu}   (${seiten} Seite${seiten === 1 ? "" : "n"})`);
