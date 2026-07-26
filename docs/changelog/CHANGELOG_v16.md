# OMEGA Atelier 2.0 — v16 Changelog

Großer 2026-Premium-Push: neue Ökosysteme, deutlich bessere Texturen,
behobenes Teppich-Flackern, neue Boden-Optionen, aufgewertete Startseite,
funktionierende Drehung von Möbeln und Geräten.

## 1. Neue Ökosysteme — 39 neue Geräte über 7 neue Brands

`src/types/index.ts` — Ecosystem-Union erweitert:
`switchbot`, `lockin`, `govee`, `smart-life`, `tuya`, `osaio`, `arenti`.
`src/lib/constants.ts` — DEVICE_ECOSYSTEM_LABELS dazu.

### SwitchBot (12 Geräte)
- Bot, Curtain 3, Lock Pro, Keypad Touch, Meter Plus
- Motion Sensor, Contact Sensor, Hub 2, Hub Mini
- Plug Mini, LED Strip 5m, Blind Tilt

### Lockin (2)
- Lockin G30 Smart Lock — mit eigenem Premium-3D-Modell (Aluminium-Body, schwarzes Glas-Fingerabdruck-Panel, LED-Statusanzeige, Türgriff)
- Lockin G30 WiFi Bridge — sleek matter weißer Cylinder

### Govee (8)
- RGBIC Pro 5m, Glide Hexa Pro, Floor Lamp Pro, Table Lamp 2
- Smart Bulb E27 RGBWW, Permanent Outdoor 30m, Curtain Lights, String Lights

### Smart Life (5)
- WLAN-Steckdose 16A, 4-fach-Steckerleiste
- Wandschalter 1-fach + 2-fach, Dimmer-Schalter

### Tuya / Smart+ (4)
- PIR Bewegungssensor (WLAN)
- Smart+ mmWave Präsenzsensor
- Smart+ Zigbee Bewegungssensor
- Tür-/Fenstersensor

### Osaio (3) und Arenti (3)
- Indoor 2K, Outdoor 4MP PTZ, Video-Türklingel
- GO1 (4G/Akku), IN1Q Indoor 4MP, OUT6Q PTZ

## 2. PBR-Texturen-Bibliothek massiv erweitert

`src/lib/textures.ts` — neue Generatoren:

### Böden (modern 2026)
- **Vinyl hell** — wide-plank vinyl mit warmen Beige-Tönen, dezenten Plank-Kanten, vertikalem Plank-Gradient für Tiefe (kein hartes Schwarz mehr an den Stößen)
- **Vinyl dunkel** — Espresso-Variante mit denselben Pattern-Eigenschaften
- **Schiefer-Fliesen** — 4×4 Grid mit echten Grout-Linien, Mineral-Flecken, weichen Veins
- **Parkett** (bestehend, weiterhin verfügbar)

Alle Böden mit `polygonOffset` ausgestattet → kein Z-Fighting mit aufgesetzten Objekten mehr.

### Wände (mehrere Varianten)
- **Putz** mit feiner Bumpy-Normal-Map (kein flacher CSS-Color-Block mehr)
- **Beton** — moderner Mikrozement-Look mit Aggregat-Specks und Hairline-Cracks
- **Tapete** — moderne vertikale Streifen mit Linen-Cross-Weave

### Premium-Teppich
- Ersetzt das alte 256×256 Pixel-Dotting durch 512×512 mit:
  - Direktionalen Wollfasern (kurze orientierte Striche)
  - Cloud-Variation darunter
  - Heavy Normal-Map (`normalScale 1.2`) für Pile-Look
  - Sparse Accent-Sparkles
- Wird als **echte 3D-Box** (1.2 cm dick) gerendert statt flacher Plane → **kein Flackern mehr**
- `polygonOffset: -1` zusätzlich → 100 % Z-Fight-frei

## 3. ThreeDView — UI-Selektor + Material-Cache

### Floor + Wall Picker im Header
Im 3D-View-Header sitzen jetzt zwei Swatch-Reihen:
- **Boden:** Vinyl hell · Vinyl dunkel · Parkett · Schiefer
- **Wand:** Putz · Beton · Tapete

Live-Switch ohne Reload, Materialien sind Singletons (kein GPU-Re-Upload).
Auf Mobile werden die Boden-Swatches als Pill oben mittig eingeblendet.

### Material-System überarbeitet
- `MatCache` mit getrennten Floor-/Wall-Varianten plus Furniture-Materialien
- `MAT.floorByType(variant)` und `MAT.wallByType(variant)` — neue API
- Backward-compat über `MAT.floor()`, `MAT.wall()`, `MAT.wood()` etc.

### Z-Fighting-Fixes
- Floor-Materialien: `polygonOffset: 1, polygonOffsetFactor: 1`
- Rug-Material: `polygonOffset: -1` und echte Box-Geometrie
- ContactShadows von y=0.005 auf y=0.012 verschoben (sitzt jetzt knapp unter Möbeln, nicht mehr koplanar zum Boden)
- Goldring auf Floor-Edge entfernt (war flackernde 0.001-Offset-Plane)

## 4. Premium-Geräte-Modelle

`DeviceMesh()` hat jetzt einen `deviceId`-Parameter und matched 17 spezielle 3D-Modelle:
- Lockin G30 + Bridge
- SwitchBot Lock Pro, Bot, Curtain 3, Hub 2, Meter Plus, Keypad
- Govee Glide Hexa Pro, Floor Lamp Pro, RGBIC Strip
- Govee String Lights + Curtain Lights — emittieren echtes Licht im Tag/Nacht-Toggle
- Osaio + Arenti Outdoor (Bullet-Form), Doorbell, Indoor (Cube)
- Smart Life Plug, Tuya mmWave/PIR (Dome)

Alle übrigen Devices fallen weiterhin auf den Kategorie-Default zurück.

## 5. Drehen von Möbeln und Geräten

### 2D-Canvas — Drei Wege
1. **Maus-Handle**: bei Single-Selection erscheint ein goldenes Disc-Handle 36 px über dem Objekt mit gestrichelter Verbindungslinie. Klick + Drag dreht live, Pill zeigt Winkel in Echtzeit. Shift = 15°-Snap.
2. **Tastatur**: `R` = +15°, `Shift+R` = -15°
3. **PropertyPanel**: 4 Buttons (`-90 / -15 / +15 / +90`) plus Rotation-Chip mit aktuellem Winkel

### 3D-View
- `Device3D` rendert jetzt mit `rotation={[0, ((d.rotation ?? 0) * Math.PI) / 180, 0]}`
- `Furniture3D` hatte das schon — beide synchronisieren zum 2D-Canvas

## 6. Live-Drag-Performance — Komplett-Fix

Vorher: jedes `pointermove` während Drag löste `updateDoc()` aus → `cloneDoc()` (Deep-Clone), History-Push, debounced localStorage-Write — bei 60 Hz pro Sekunde **60 Deep-Clones**. Bei 50+ Möbeln spürbar laggig.

Jetzt:
- **Drag-Offset-Ref** im Canvas (`dragOffsetRef`) akkumuliert lokal
- Der Render-Loop liest dieses Ref direkt und zeichnet das gedraggte Objekt an `position + offset`
- React rendert während des Drags **nicht** neu
- `pointerup` macht **einen einzigen** `moveSelection(dx, dy)` Aufruf → eine History-Eintragung, ein Persist
- Bei `settings.snap` wird der Final-Offset auf `snapStep` gesnapt
- Identische Logik für Rotation: `rotationOffsetRef` lokal, einmal `rotateSelection()` am Ende

### Tastatur-Shortcuts
- `Esc` — Tool zurück auf "select"
- `R` / `Shift+R` — drehen um ±15°
- `Delete` / `Backspace` — Selection löschen
- `←/→/↑/↓` — 1cm verschieben (mit Shift: 10cm)
- Skipt automatisch wenn der Fokus in einem Input/Textarea liegt

## 7. Premium Startseite

`StartScreen.tsx` komplett neu geschrieben:

### Animierter Hintergrund
- Drei radial-gradient Blobs (Gold, Blau, Lime), jeweils mit eigener Keyframe-Animation (16-20s loops, ease-in-out)
- Subtile dotted-grid mit 24px Spacing, opacity 0.04
- Sieben floating Lucide-Icons (Lightbulb, Camera, Lock, Speaker, Box, Boxes, Layers) mit individuellen Float-Animationen

### Hero
- 64×64 Logo-Tile mit Inset-Highlight + 24px Drop-Shadow + 48px Ambient-Shadow
- Animiertes Halo-Pulse (3s loop) um das Logo
- Display-Typografie 5xl auf Desktop, 4xl auf Mobile, mit Tracking -0.02em

### Feature-Pills
Sechs farbcodierte Pills mit Inset-Border-Schatten:
- Photoreal 3D · PBR Texturen · Vinyl/Schiefer/Parkett
- Live-Drag · Drehen · Multi-Floor · Omega-Modi

### Action-Cards
- White/85 backdrop-blur Surface
- Top-Sheen-Border (gradient white-to-transparent)
- Corner-accent Glow (radial gradient, opacity transitions)
- Icon-Tile mit Scale + Tilt on Hover (`-rotate-3`)
- "Starten →" Reveal beim Hover

### Brand-Strip
23 unterstützte Ökosysteme als horizontaler Text-Strip mit Edge-Fade-Mask.
Hover hebt einzelne Brands hervor.

### Resume-Card (preserved)
Wenn `loadLocalPlan()` einen Plan findet, wird automatisch eine vierte Card mit Plan-Title + Geräte-Anzahl eingeblendet.

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build` → **erfolgreich**
- Bundle:
  - `index.js`: 175 KB (von 154 KB; +21 KB für StartScreen-Animationen + 39 neue Devices + Konstanten)
  - `ThreeDView.js` (lazy): **45 KB** (von 27 KB; +18 KB für 14 neue Texture-Generatoren + 17 Premium-Mesh-Komponenten)
  - `three.js` (lazy): 893 KB unverändert
  - `index.css`: 48 KB (+3 KB für StartScreen-Stile)

## ⏭️ Mögliche v17-Kandidaten

- **Material-Slots pro Möbel**: User wählt Sofa-Stoff-Farbe aus (beige/grau/blau)
- **Echte Wandverläufe an Ecken**: Polygon-Verschmelzung statt Round-Cap-Joins
- **Texture-Cache in IndexedDB**: zweites Öffnen sofort statt 300-500ms Generation
- **Walk-Mode**: First-Person durch die Wohnung
- **Möbel-Resize-Handles** im 2D-Canvas (analog zu Rotation)
