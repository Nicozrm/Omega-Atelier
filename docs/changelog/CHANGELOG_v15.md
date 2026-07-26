# OMEGA Atelier 2.0 — v15 Changelog

Echte PBR-Texturen für Möbel, Geräte, Boden und Wände — komplett prozedural
im Browser via Canvas-API erzeugt. Kein Asset-Hosting, kein Bundle-Bloat,
voll deterministisch (seeded RNG).

## Neue Datei: `src/lib/textures.ts` (~470 Zeilen)

Prozedurale Generatoren für 10 Material-Klassen, jeweils mit Color-Map und
(wo sinnvoll) Normal-Map. Alle Texturen werden beim ersten Öffnen der 3D-
Ansicht einmalig erzeugt und gecacht — versteckt hinter dem Loading-Spinner.

### Generatoren
- **`drawWoodColor(palette, seed)`** — Holz-Maserung mit Sinus-Wellen
  (zwei Frequenzen für realistische Bänder), feiner Grain-Linien-Schicht
  via Bezier-Curves, gelegentlichen Knoten (zwei-stufige Radial-Gradients),
  warmen Highlights. Palette-parametrisiert: Eiche (`#a17246`) und
  Walnuss (`#5e3a22`) werden mit unterschiedlichen Seeds erzeugt.
- **`drawWoodHeight(seed)`** — gleiches Wave-Pattern in Graustufen, dient
  als Height-Map für die Normal-Map-Generation.
- **`drawFabric(color, seed)`** — diagonale Weave-Hashes (cross-hatch
  pattern), zufällige hell/dunkel-Strokes für Stoff-Look. Plus Dust-Speckles.
- **`drawFabricHeight(seed)`** — punktförmiges Bump-Pattern, ergibt nach
  Sobel-Konversion einen feinen Stoff-Normal.
- **`drawLinen(color, seed)`** — sehr feine horizontale + vertikale
  Linien für Bettzeug und Pillow.
- **`drawMarble(seed)`** — wolkige Radial-Gradient-Patches als Base, dann
  6 organische Veins (random walks mit Strichbreite-Variation).
- **`drawBrushedMetal(color, seed)`** — anisotrope vertikale Streifen
  (das klassische gebürstete Metall-Pattern). Color-Map plus passende
  Height-Map → Normal-Map für die anisotrope Reflektion.
- **`drawParquet(seed)`** — 512×512 (höher aufgelöst für Detail), mit
  versetzten Planken. 8 verschiedene Plank-Breiten in zufälliger Folge,
  Row-Offset von 47px für Brick-Pattern. Pro Planke: zufällige Base-Tönung
  (±30 RGB), 60% Wood-Grain-Linien als Bezier, dunkler Border + heller
  Top-Edge-Highlight.
- **`drawParquetHeight()`** — nur die Plank-Borders als dunkle Linien,
  ergibt nach Normal-Konversion klare Furchen zwischen den Brettern.
- **`drawRug(color, seed)`** — Wolle-Look: 1/5 der Pixel mit
  zufälligem dunkel/hell, plus 4× SIZE 2-px-Streifen für Tuft-Andeutung.
- **`drawWallPlaster(seed)`** — Wandputz mit weichen Cloud-Patches und
  feinen Speckles für die Eierschalen-Optik.
- **`drawMattePlastic(color, seed)`** — minimaler Speckle-Noise auf
  einfarbigem Background, für Geräte mit weiß/schwarz matter Oberfläche.

### Helpers
- **`heightToNormal(canvas, strength)`** — Sobel-Light-Gradient. Liest
  Pixel-Daten aus dem Height-Canvas, rechnet pro Pixel die Tangenten
  über benachbarte Höhen-Differenzen, normalisiert zu (nx, ny, nz) und
  encodiert als RGB. Wrap-around-Sampling für nahtlose Texturen.
- **`mulberry32(seed)`** — kompakte seeded RNG. Texturen sind über
  Reloads identisch.
- **`makeTex(canvas, repeat, srgb)`** — public Helper: wrappt ein
  Canvas in eine `THREE.CanvasTexture` mit `RepeatWrapping`,
  korrekter ColorSpace-Markierung (sRGB für Color, Linear für Normal),
  Anisotropy 4.

### Lazy-Init
`getTextures()` baut einen `TextureBundle` (alle Canvases als Felder).
Erster Aufruf ~300-500 ms, danach Cache. Wird beim ersten Zugriff der
Material-Factories ausgelöst.

## ThreeDView: Material-System neu

### Vorher
```ts
const MAT = {
  wood: () => new THREE.MeshStandardMaterial({ color: '#a47b4f', ... }),
  ...
}
```
Jedes `MAT.wood()` erzeugte ein neues Material — bei 30 Möbel × 60 fps
fragwürdig.

### Jetzt
```ts
let _mat: MatCache | null = null
function ensureMat() { if (!_mat) _mat = buildMaterials(); return _mat }

const MAT = {
  wood:       () => ensureMat().woodOak,    // alias for back-compat
  woodOak:    () => ensureMat().woodOak,
  woodWalnut: () => ensureMat().woodWalnut,
  marble:     () => ensureMat().marble,
  ...
}
```
- **Lazy-Init** des gesamten Material-Caches beim ersten Zugriff.
- **Shared instances** — `MAT.fabric()` gibt immer dasselbe Material
  zurück, GPU-Speicher und JS-Heap profitieren.
- **Backward-compat** — alle alten `MAT.wood()` / `MAT.metal()` Aufrufe
  funktionieren weiterhin (Aliase auf `woodOak` / `steel`).
- **Neue Materialien**: `woodOak`, `woodWalnut`, `marble`, `steel`,
  `brass`, `fabricGray`, `matteBlack`.

### Material-Spezifikationen
| Material   | Color-Map        | Normal-Map | Roughness | Metalness | Tiling |
|-----------:|:-----------------|:-----------|:----------|:----------|:-------|
| floor      | parquet (512²)   | ✓          | 0.7       | 0.05      | 4×4    |
| wall       | plaster          | —          | 0.92      | 0.0       | 3×3    |
| wallSel    | plaster          | —          | 0.7       | 0.05      | 3×3    |
| woodOak    | oak grain        | ✓          | 0.55      | 0.05      | 2×1    |
| woodWalnut | walnut grain     | ✓          | 0.5       | 0.05      | 2×1    |
| fabric     | beige weave      | ✓          | 0.95      | 0.02      | 3×2    |
| fabricGray | gray weave       | —          | 0.95      | 0.02      | 3×2    |
| bedding    | linen beige      | —          | 0.95      | 0.0       | 3×3    |
| pillow     | linen white      | —          | 0.95      | 0.0       | 2×2    |
| marble     | marble           | —          | 0.25      | 0.05      | 1×1    |
| steel      | brushed steel    | ✓          | 0.4       | 0.85      | 1×1    |
| brass      | brushed brass    | ✓          | 0.4       | 0.8       | 1×1    |
| glass      | (color only)     | —          | 0.05      | 0.85      | —      |
| rug        | wool dots        | —          | 0.95      | 0.0       | 4×4    |
| matteWhite | white speckle    | —          | 0.7       | 0.05      | 1×1    |
| matteBlack | black speckle    | —          | 0.5       | 0.2       | 1×1    |

## Möbel-Material-Update

Möbel sehen jetzt nach Materialklassen aus, nicht nach gleichfarbigen
Würfeln:

| Möbelstück     | Vorher | Jetzt                                |
|---------------:|:-------|:-------------------------------------|
| Sofa           | fabric | **Stoff mit Weave + Normal**         |
| Bett-Frame     | wood   | **Walnuss**                          |
| Bett-Headboard | wood   | **Walnuss**                          |
| Coffee-Table   | wood   | **Walnuss-Top + Stahl-Beine**        |
| Dining-Table   | wood   | **Eiche**                            |
| Wardrobe       | wood   | **Eiche** (Body) + **Messing**-Griffe|
| Kitchen-Body   | matte  | matte weiß                           |
| Kitchen-Counter| metal  | **Marmor**                           |
| Stovetop-Ringe | metal  | gebürsteter Stahl                    |
| TV-Sideboard   | wood   | **Walnuss**                          |
| Nightstand     | wood   | Eiche                                |
| Dresser        | wood   | **Walnuss**                          |
| Shoe-Rack      | wood   | Eiche                                |
| Chair          | wood   | Eiche                                |
| Rug            | flat   | **Wolle-Textur**                     |
| Boden          | flat   | **Parkett (Planken + Normal)**       |
| Wände          | flat   | **Putz (subtil)**                    |

## Geräte-Material-Update

| Gerät           | Vorher  | Jetzt                              |
|----------------:|:--------|:-----------------------------------|
| Lampe — Pol     | metal   | **Messing** (gebürstet)            |
| Lampe — Sockel  | brass   | Messing (jetzt richtig texturiert) |
| Lampe — Schirm  | (basic) | warmes Stoff-Material              |
| Speaker — Body  | dunkel  | matter dunkler Body                |
| Speaker — Ring  | brass   | gebürstetes Messing                |
| Camera — Body   | matte   | matte weiß-Plastic                 |
| Camera — Lens   | glass   | poliertes Glas                     |
| Lock            | brass   | gebürstetes Messing                |
| Hub             | matte   | matte weiß                         |
| TV-Stand        | metal   | gebürsteter Stahl                  |
| Switch/Outlet   | matte   | matte weiß                         |

## Performance

- **First-Open der 3D-Ansicht**: ca. 300-500 ms zusätzliche Wartezeit für
  Texture-Generation. Versteckt hinter Spinner.
- **Subsequent renders**: keine. Materialien sind shared, Texturen sind
  GPU-Speicher.
- **Bundle-Größen**:
  - `index.js`: 154 KB (unverändert — Texturen liegen im Three-Lazy-Chunk)
  - `ThreeDView.js` (lazy): **27 KB** (von 18 KB, +9 KB für Generatoren)
  - `three.js` (lazy): 893 KB (unverändert)
- **Memory**: 18 Texturen × ~256 KB (256² × 4 bytes uncompressed) ≈ 4.5 MB
  GPU. Akzeptabel auf jeder modernen Karte.

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build` → **erfolgreich**

## ⏭️ Next-Up Ideen (v16)

- **Texture-LoD**: bei großen Möbeln eine niedrig aufgelöste Variante,
  bei kleinen die hochaufgelöste — spart Anisotropy-Sampler-Aufwand.
- **PBR-Roughness-Maps**: aktuell ist Roughness uniform. Pro-Pixel-Roughness
  würde z.B. an den Marmor-Veins Glanz-Variation geben.
- **Material-Preset-Picker**: User darf Sofa-Stoff-Farbe ändern, Boden
  zwischen Eiche/Walnuss/Marmor wechseln.
- **Texture-Caching in IndexedDB**: erste-Ladezeit halbieren bei
  zweitem Öffnen.
- **Walk-Mode**: First-Person durch die Wohnung laufen.
- **Snap-to-Wall**: beim Platzieren von Geräten an die nächste Wand snappen.
