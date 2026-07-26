# OMEGA Atelier 2.0 — v14 Changelog

Visueller Premium-Aufbau. Der gesamte 2D-Editor und die 3D-Ansicht wurden
auf ein sichtbar professionelleres Niveau gehoben — ohne dass irgendeine
Funktion verändert wurde. Reine Optik + Politur.

## Phase 1 — Design-System

`src/styles/index.css` erweitert:

- **Schatten-Stufen** (`--shadow-1` bis `--shadow-4`, plus `--shadow-inset`):
  einheitliche Tiefen-Hierarchie, die jetzt von Buttons, Karten, Surfaces und
  vom Canvas selbst genutzt wird.
- **Easings** mit Charakter: `--ease-out-expo`, `--ease-out-quart`, `--ease-spring`.
- **Canvas-Tokens** (`--canvas-paper`, `--canvas-wall-fill`, `--canvas-grid-major`
  etc.): zentralisiert, dark-mode-fähig, vom 2D-Renderer per `readTheme()`
  einmalig pro Frame eingelesen.
- **Typografie-Skala**: `h1`–`h3` und `.label-xs` mit konsistenten Tracking-
  und Line-Height-Werten.
- **Neue Animationen**: `animate-pulse-soft`, `animate-scale-in`,
  `animate-bounce-in` für später (Dialoge, Toasts).
- **Buttons** mit echter Tiefe: `--shadow-inset` + `--shadow-2`/`-3`,
  Hover translatY-1px, Filter-Brightness statt einfacher Opazität.
- **`.surface-elevated`** für Modals/Popups (höhere Schatten-Stufe).

## Phase 2 — 2D Canvas-Overhaul

Komplett neuer Renderer für alle platzierten Objekte. Code in neue Datei
ausgelagert: `src/lib/canvasGlyphs.ts` (~700 Zeilen).

### Hintergrund / Paper / Grid
- **Paper** mit weichem Drop-Shadow (`shadowBlur 24, offsetY 6`) und
  diagonalem Linen-Gradient — fühlt sich wie ein Blatt an, nicht wie eine
  CSS-Fläche.
- **Zwei-Layer-Grid**: Major-Linien (Grid-Size, immer sichtbar) plus
  Minor-Linien (Grid-Size/5, nur bei `zoom > 0.30`). Beide aus CSS-Vars,
  dark-mode-fähig.
- **Paper-Edge** als feine goldene Linie statt grobe schwarze.

### Räume
- **Raum-Polygone** werden jetzt mit subtiler Beige-Tönung gefüllt (war
  vorher einfach nichts). Räume werden visuell vom Außenbereich getrennt.

### Wände
- **Drei-Schicht-Rendering**:
  1. Drop-Shadow (`wallShadow`, blur ≤ thickness)
  2. Solider dunkler Body (`wallFill`)
  3. Bei dicken Wänden: feine goldene Mittellinie (`wallEdge`) für 3D-Optik
- **Selection-Halo**: zusätzlicher gold-transparenter Ring um die Wand.
- **Maß-Callout**: bei Single-Selection einer Wand erscheint ein hübsches
  Pill mit der Länge (`450 cm`), positioniert auf der Wand-Normalen.

### Möbel
- **Top-down realistische Glyphen** statt grauer Rechtecke. Pro `furnitureId`:
  - `sofa`: Backrest-Bar + 3 Cushion-Kästchen (orientiert nach langer Seite)
  - `bed`: Pillow-Strip + Duvet-Linie + Mittel-Trennung
  - `table-coffee`: Surface-Ring innen
  - `table` (dining etc.): Vier Punkt-Marker an den Ecken (Beine)
  - `wardrobe`: Tür-Sektionen mit goldenen Griff-Punkten
  - `kitchen`: Kabinett-Sektionen + Kochfeld-Ring + Spüle
  - `tv-sideboard`: Drei-Sektionen-Gliederung
  - `rug`: gestrichelte Outline + Inner-Border (transparent)
  - `nightstand`: Schublade + Griff-Punkt
  - `dresser`: Drei Schubladen-Linien
  - `shoe-rack`: 3 horizontale Slots
  - `chair`: Backrest-Bar oben
- **Drop-Shadow** auf jedem Möbelstück (`shadowBlur 10, offsetY 2`).
- **Selection** mit goldener Outline statt einfachem Stroke.
- **Label** zentriert nur wenn Möbel ≥ 32px UND Zoom > 0.35 — keine
  Mini-Labels mehr in winzigen Möbeln.

### Geräte
- **Kategorie-spezifische Glyphen** (~20 Vektor-Glyphen, von Hand mit
  `ctx.beginPath()` gezeichnet, kein SVG):
  - `light`: Glühbirnen-Silhouette mit Base-Lines
  - `switch`: Toggle-Frame mit verschiebbarem Knopf (links/rechts je nach `on`)
  - `outlet`: Zwei Pin-Holes
  - `blind`: Vier horizontale Slats
  - `climate`: Thermometer mit Tick-Marks
  - `lock`: Padlock mit Bügel + Schlüsselloch
  - `speaker`: Box mit konzentrischen Kreisen
  - `camera`: Body + Lens + Top-Notch
  - `alarm`: Glocke mit Klöppel
  - `tv`: Screen mit Stand-Striche
  - `appliance`: Box mit Knopf + Tür
  - `irrigation`: Tropfen
  - `sensor`: Radar-Wellen
  - `hub`: Drei konzentrische Quadrate
- **Glow-Halo** wenn `on === true` — Radial-Gradient in Geräte-Farbe.
- **Drop-Shadow** auf jedem Pin.
- **Hover-Ring** zusätzlich zum Selection-Halo.
- **Off-Cross**, **Helligkeits-Arc**, **Lock/Alarm-Pip** wie bisher, aber
  jetzt sauber in `drawDevicePin()` gekapselt.

### Beschriftungen
- **Room-Labels** mit Backdrop-Plate: weißes Pill mit Drop-Shadow, dünner
  goldener Outline und kleinen Diamond-Akzenten links/rechts. Schrift in
  Playfair Display, zentriert.

### Alignment-Guides
- Beim **Drag** eines einzelnen Geräts/Möbels werden andere Objekte mit
  passender X- oder Y-Koordinate (≤ 4 cm Abstand) durch eine **dünne
  pink-gestrichelte Linie** über die ganze Canvas-Höhe/-Breite hervorgehoben.

### Maß-Anzeige
- Selektierte Wand zeigt Länge in cm in einem Surface-Pill auf der Außen-
  Normalen.

## Phase 3 — 3D-View komplette Neufassung

`src/components/3d/ThreeDView.tsx` von Grund auf neu (war 178 Zeilen, ist
jetzt ~640).

### Rendering
- **ACES Filmic Tone Mapping** + `outputColorSpace: SRGB`.
- **Soft Shadows** (`shadows="soft"`).
- **Antialiasing** via `gl: { antialias: true }`.

### Lichtstimmung
- **HemisphereLight** (Himmel/Boden) als Basis-Lichtbett.
- **Ambient** für Restbeleuchtung.
- **Directional Sun** mit eigener Shadow-Camera (2048×2048, sauber auf den
  Floor-Extent zugeschnitten).
- **Fill Directional** von der Gegenseite für weichere Schatten.
- **`<Environment preset="apartment">`** für realistische Reflexionen auf
  Metall/Glas (Glanz auf Soundbars, Türgriffen, etc.).

### Tag/Nacht-Toggle (UI-Button im Header)
- **Tag**: warme Sonne (#fff1d4), helle Hemi, Apartment-HDRI, hellgelber Sky-Gradient.
- **Nacht**: kühle blaue Sonne (#a6b3ff), gedämpfte Hemi, Night-HDRI, dunkler Gradient.

### Materialien
- Alle Materialien als Singletons in `MAT.{floor,wall,wallSel,fabric,wood,metal,glass,matteWhite,brass,bedding,pillow,rug}` —
  Metalness/Roughness/Color individuell getunt.
- **Brass** für Akzente: Wand-Caps oben, Lampensockel, Schrank-Griffe.
- **Glass** mit hoher Metalness und kleiner Roughness für TV-Screens und
  Kamera-Linsen — sieht poliert aus.

### Geräte als wiedererkennbare 3D-Modelle
Pro Kategorie eigene Mesh-Hierarchie:
- **Light**: schlanker Pol + Konus-Schirm + Brass-Sockel; bei `on === true`
  zusätzlich ein **echter `pointLight`** mit warmem Ton, der die Szene
  beeinflusst (Lampen-Effekt).
- **Speaker**: Box mit Front-Grille + Brass-Ring.
- **Camera**: Cylinder-Body + Glas-Linse + Stand-Sockel.
- **Lock**: Brass-Body + Metall-Knob.
- **Climate**: Slab mit Glas-Display.
- **Sensor**: kleiner Halbkugel-Dome.
- **Hub**: Box mit grünem Status-Pip (emissive).
- **TV**: Stand + Glas-Screen.
- **Blind**: Hängender Block mit vertikalen Schnüren.
- **Switch/Outlet**: Wandplatte mit Mittel-Element.
- **Alarm**: Roter Konus auf Metall-Sockel.
- **Appliance**: Beigefarbener Würfel.

### Möbel als 3D-Modelle
- **Sofa**: Base + Backrest + 3 Cushions (lange Seite erkannt).
- **Bett**: Frame + Mattratze + Kissen + Kopfteil.
- **Coffee Table**: Holz-Surface + 4 dünne Metall-Beine.
- **Dining Table**: höhere Holz-Beine.
- **Wardrobe**: 2.20 m hoch, Tür-Trennlinie, Brass-Griffe.
- **Kitchen Row**: Body + Edelstahl-Counter + Spüle + Stovetop-Ringe.
- **TV-Sideboard**: niedriger Holzkasten.
- **Rug**: flacher Plane mit Rug-Material (sandfarben).
- **Nightstand**: kleiner Holzkasten.
- **Dresser**: 3 Schubladen-Linien.
- **Chair**: Sitzfläche + Backrest + 4 Beine.

### Interaktion
- **Hover-Lift**: Geräte heben sich 4 cm an, Möbel 1.5 cm. Animation per
  `useFrame` mit linearer Interpolation, Damping-Faktor abhängig von dt.
- **Click-to-Select**: Klick auf Gerät/Möbel propagiert in den Plan-Store
  (`setSelection`) — Selection synchronisiert mit dem 2D-View!
- **Selection-Ring** auf dem Boden: goldener Ring (`ringGeometry`) um
  Geräte und Möbel.
- **Cursor**: wechselt auf `pointer` bei Hover.

### Kamera
- **OrbitControls** mit `enableDamping` (dampingFactor 0.08) für sanfte
  Bewegungen.
- `rotateSpeed 0.6`, `zoomSpeed 0.8`, `panSpeed 0.8` — alles weicher.
- Target initial auf Floor-Center, leicht über dem Boden.

### Boden
- **`<ContactShadows>`** für realistische Bodenkontakte unter allen
  Objekten — viel besser als die bisherigen harten Würfel-Shadows.
- Subtiler goldener Ring im Floor-Mesh als Stil-Element.

## Phase 4 — UI-Komponenten Politur

- **Topbar** sitzt jetzt auf `--surface` mit feinem Schatten unten — wirkt
  wie eine echte Toolbar, nicht wie ein gleichfarbiger Streifen.
- **Mode-Buttons** (`ModesPanel`): smooth Hover-Lift (`-translate-y-0.5`),
  bei Active-State leichte Skalierung 1.02 + zwei-Schicht-Glow.
- **3D-View-Header**: schöneres Layout mit Untertitel "Premium Render",
  Tag/Nacht-Toggle, Apple-Style-Hint-Pill unten links + oben rechts.

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build` → **erfolgreich**
- Initial-Bundle-Index: 154 KB (von 142 KB) — die ~12 KB sind die neuen
  Glyph-Routinen, das ist es absolut wert.
- `ThreeDView` lazy-chunk: 18 KB (von 3.7 KB) — wird nur geladen wenn
  3D geöffnet wird, also kein Initial-Load-Effekt.
- Three.js Vendor-Chunk: 893 KB (war 952 KB) — leicht geschrumpft durch
  bessere Imports.

## ⏭️ Was noch denkbar wäre (v15)

- **Wall-Endstücke**: aktuell stoßen Wände an den Enden mit Round-Cap aufeinander.
  Sauberer wäre eine echte Polygon-Verschmelzung an Eckpunkten.
- **Möbel-Texturen**: PBR-Texturen statt einfarbiger Materialien (Holz-Maserung,
  Stoff-Fasern). Verlangt Texture-Atlas und ist Mehraufwand.
- **Camera-Presets**: "Vogel-Perspektive", "Augenhöhe", "Iso" als Buttons.
- **Walk-Mode**: First-Person durch die Wohnung laufen.
- **Snap zu Wand**: beim Platzieren von Geräten an die nächste Wand snappen.
