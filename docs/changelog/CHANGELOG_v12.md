# OMEGA Atelier 2.0 — v12 Changelog

Patch auf v11. Fokus: die drei Sachen die in v11 noch offen waren — plus
Mode-Preview im Canvas und Resume-Session auf dem Start Screen.

## 🟢 Live Cursors

- `Canvas` nimmt jetzt die `cursors` und `publishCursor` Props vom Editor.
- `onPointerMove` ruft `publishCursor` auf jedem Move (intern auf 50 ms
  throttled vom Hook).
- DOM-Overlay rendert Remote-Cursor als kleines SVG-Pfeil-Icon plus
  farbiges Name-Pill. Off-screen-Cursor werden weggekullt.
- Cursors älter als 10 s werden ausgefiltert (peer disconnected).
- Pro Floor isoliert: Cursor von anderer Etage taucht nicht auf der
  aktuellen auf.

## 🟢 Measure Tool

UI-Hinweise gab's, aber das Tool war tot. Jetzt:

- Erster Klick: Startpunkt.
- Zweiter Klick: Endpunkt.
- Dritter Klick: neue Messung.
- Esc: bricht ab.

Visuell: gestrichelte goldene Linie mit Endkappen, Distanz-Label mit
dunkler Hintergrundpille, plus dx/dy in Klammern (`450 cm (320 × 316)`).
Tool-Wechsel räumt automatisch auf (`useEffect` auf `tool`).

## 🟢 Bundle Splitting

`vite.config.ts`: zusätzlicher `'three'` chunk.
`Editor.tsx`: `ExportDialog`, `ShareDialog`, `ThreeDView` per
`React.lazy()`. Resultat:

| Chunk           | Vorher (v11) | Nachher (v12) |
|-----------------|-------------:|--------------:|
| index.js        |     1.07 MB |  **107 KB**  |
| three.js        |     (in main) |     952 KB (lazy) |
| ExportDialog.js |     (in main) |       5 KB (lazy) |
| ShareDialog.js  |     (in main) |       6 KB (lazy) |
| ThreeDView.js   |     (in main) |     3.7 KB (lazy) |

Der initiale Page-Load lädt jetzt **107 KB** statt 1.07 MB. Three.js
und alle Dialoge werden erst geholt wenn man sie öffnet.

`ui-vendor` (lucide-react) ist bei 737 KB stehen geblieben — alle Icons
in einer Datei. Das wäre der nächste Schritt: pro Icon Tree-Shaking.

## 🟢 Mode Preview im Canvas

Wenn ein Modus außer „Automatik" aktiv ist, werden Geräte ausgegraut
(`globalAlpha = 0.28`), die diesen Modus nicht in ihren `modeTags`
haben. Das macht visuell sofort klar, was der Modus eigentlich
aktivieren würde.

## 🟢 „Fortsetzen"-Karte auf StartScreen

`loadLocalPlan()` aus dem Store wird beim Mount geprüft. Wenn ein
gespeicherter Plan existiert, erscheint links eine vierte Karte
„Fortsetzen" mit Titel und Geräteanzahl der letzten Session.
Layout reagiert (3 oder 4 Spalten je nach Karten-Anzahl).

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build`                    → **erfolgreich**
- Initial-Bundle von 302 KB gz → **30.9 KB gz** (Index allein)

## ⏭️ Was als nächstes drankommen kann

- **lucide-react auf einzelne Icons umstellen** für nochmal ~600 KB
  Bundle-Einsparung. Tree-shaking von Sub-Imports
  (`import Foo from 'lucide-react/dist/esm/icons/foo'`).
- **Cursor-Tool-Anzeige**: das Cursor-Tool-Feld kommt mit, aber wir
  zeigen es nicht — kleines Tool-Icon neben dem Namen wäre hübsch.
- **Mode-spezifische Aktionen**: sich eine `applyMode()`-Funktion
  überlegen, die `modeState`-Werte auf alle Geräte anwendet.
- **Realtime-Konfliktlösung**: aktuell „last write wins" auf
  `doc.updatedAt`. Bei zwei gleichzeitigen Editoren kann der schnellere
  den langsameren überschreiben.
