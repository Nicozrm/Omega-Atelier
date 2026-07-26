# OMEGA Atelier 2.0 — v17 Changelog

Vier neue Features auf einmal: saubere Wandverschmelzung, Möbel-Resize per
Maus, IndexedDB-Texture-Cache und Material-Slots für Stoff/Holz-Farben.

## 1. Wandverschmelzung — Saubere Eckverbindungen

`ThreeDView.tsx` hatte bisher das klassische Problem rotierter Wand-Boxes:
in der Ecke entweder Lücken (wenn die Wände sich nicht ganz berührten) oder
hervorstehende Pfosten (wenn sie überlappten).

Jetzt:
- **`cornerExtensionsFor(wall, allWalls)`** — prüft pro Endpunkt, ob ein
  anderer Wandendpunkt innerhalb von `CORNER_SNAP_CM` (6 cm) liegt. Wenn ja,
  wird die Wand an der Seite um die halbe Stärke der angrenzenden Wand
  verlängert. Das sorgt für sauberen Überlapp.
- **`findCorners(walls)`** — clustert alle Endpunkte nach Nähe und liefert
  pro Cluster den Mittelpunkt + maximale Stärke.
- **`<CornerPillar>`** — ein quadratischer Pfeiler an jedem Cluster mit ≥ 2
  Endpunkten. Material gleich wie die Wände, sodass die Säule visuell
  verschwindet und nur die Lücke zwischen den überlappenden Wänden füllt.

Der Effekt: 3D-Räume sehen aus wie echte gemauerte Räume mit klaren
quadratischen Ecken statt rotierter Boxes-mit-Lücken-und-Vorsprüngen.

## 2. Möbel-Resize-Handles im 2D-Canvas

Bei Single-Selection eines Möbels erscheinen nun **8 Resize-Handles** (4
Ecken + 4 Kanten) als kleine weiße Quadrate mit goldenem Border, plus
gestricheltem Bounding-Box-Outline.

### Pattern wie bei Drag/Rotation
- `resizeLiveRef` (useRef) hält in-progress Größe + Center-Offset
- Während Drag: **kein** React-Re-Render, Renderer liest direkt aus dem Ref
- `pointerup` committed **einmal** über `resizeFurniture()` Store-Action
  → eine History-Eintragung, ein Persist

### Mathematik
- World-Delta wird ins lokale Frame des Möbels rotiert (Account für rotation)
- Anchor-spezifisch: 'e' / 'w' / 's' / 'n' und Diagonalen
- Center-Offset wird so berechnet, dass die gegenüberliegende Kante fix bleibt
- Min-Size 10cm, Max-Size 1000cm (clamp)
- **Shift+Drag auf Eck-Handle** = uniform aspect-ratio scale
- Live-Größen-Pill in cm direkt unter dem 's'-Handle

### Store-Action
```ts
resizeFurniture(id, w, h, dx, dy)
```
Setzt `item.size = [w, h]` und shifted `item.position` um `(dx, dy)`.

### Cursor
Während Resize: `cursor-nwse-resize`.

## 3. IndexedDB Texture-Cache

Erstes Öffnen der 3D-Ansicht generiert weiterhin alle 30+ Texturen
(Holz, Stoff, Marmor, Vinyl, Schiefer, etc.) in 300-500 ms. **Zweites
Öffnen ist jetzt deutlich schneller** weil die Canvases als PNG-Blobs in
IndexedDB liegen.

### Architektur
`src/lib/textures.ts`:
- **`openDB()`** — öffnet `omega-textures` DB, legt object store `tex` an
- **`tryLoadFromCache()`** — lädt alle Schlüssel aus der DB, decoded Blobs
  via `createImageBitmap()` zurück in Canvases. Bei Versionsmismatch
  (`__meta__.version !== CACHE_VERSION`) → false → Fresh-Generation
- **`saveToCache(bundle)`** — schreibt jede Canvas als PNG-Blob ein
  (best-effort, fire-and-forget)
- **`getTexturesAsync()`** — neuer async Entry-Point. Tries cache first,
  falls back to `getTextures()` (sync), startet im Hintergrund den Save

`CACHE_VERSION = 18` — wird bei jedem Generator-Change inkrementiert; alte
Caches werden ignoriert und neu erzeugt.

`ThreeDView.tsx`:
- `texturesReady` State Flag, gated den Three.js-Canvas
- `useEffect` triggert `getTexturesAsync()` beim Mount
- Loading-Fallback bleibt sichtbar, bis Cache warm

### Fallback
Wenn `indexedDB` nicht verfügbar (z.B. Privacy-Mode, alter Browser): einfach
sync regenerieren wie bisher.

## 4. Material-Slots für Möbel

User kann jetzt im PropertyPanel die Materialfarbe von Sofas und Holzmöbeln
direkt ändern. Visualisierung ändert sich live im 3D-View.

### Slot-Katalog
`src/lib/materialSlots.ts` (~30 Zeilen, dependency-free, kein three.js
Import → kein Bundle-Bloat im Hauptbundle):

**Stoff (Sofas)**:
- Stoff Beige (Default)
- Stoff Grau
- Stoff Blau
- Leder Schwarz

**Holz (Bett, Tisch, Schrank, Sideboard, Nightstand, Dresser, Stuhl, …)**:
- Eiche
- Walnuss (Default für Walnuss-Möbel wie Bett/Coffee-Table/TV-Sideboard/Dresser)

### Neue Texturen
- `fabricBlueC` — Blau-Stoff-Variante
- `leatherBlackC` — Leder mit denselben Weave-Hashes aber dunklerer Palette

### Material-Resolver in 3D
- `upholsteryFor(item)` — Sofa-Material aus `item.materialKey` oder Default
- `woodFor(item, defaultKey)` — Holz-Material analog

Beide sind in `ThreeDView.tsx` lokal definiert (haben Zugriff auf die
THREE-Materialien). Die Slot-Daten kommen aus `materialSlots.ts` und werden
sowohl im PropertyPanel als auch in ThreeDView gelesen — Keys sind die
gemeinsame Sprache.

### PropertyPanel-UI
Bei Single-Selection eines Möbels erscheint unter den Größen/Rotation-Chips
eine neue Sektion "Stoff" oder "Holz" mit klickbaren Farb-Swatches (28×28 px
Squares mit goldenem Border bei Auswahl + sanftem Glow).

### Persist
`item.materialKey` wandert ins `PlacedFurniture` Type. Wird in der History
mitgespeichert und über localStorage / Supabase übertragen.

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build` → **erfolgreich**
- Bundle:
  - `index.js`: 180 KB (von 175 KB; +5 KB für Resize-Handle-Logik + Material-Slot-Picker + neue Store-Action)
  - `ThreeDView.js` (lazy): **50 KB** (von 45 KB; +5 KB für Corner-Joins, IndexedDB-Cache, neue Materialien, Material-Resolver)
  - `three.js` (lazy): 893 KB unverändert
  - `index.css`: 48 KB unverändert

## ⏭️ Mögliche v18-Kandidaten

- **Walk-Mode** — First-Person durch die Wohnung
- **Material-Slots erweitern** — Boden/Wand auch pro Raum unterschiedlich
- **Tür- + Fenster-Geometrie** — als eigene Wand-Subtypen
- **Snap-to-Wall** — Geräte beim Platzieren an die nächste Wand snappen
- **Möbel-Bibliothek-Erweiterung** — Esstische, Bürotische, Spielesachen
