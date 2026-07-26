# Textur R2 — Roughness-Mikrodetail (keine flachen Oberflächen)

## Analyse / Problem
Trotz Color+Normal hatten die Hero-Flächen (Parkett, Vinyl, Schiefer, Putz, Holz) **uniforme
Roughness** → Specular/Reflexion brechen über die Fläche nicht auf, der „flache" CG-Look. Die
Mission fordert ausdrücklich „korrekte Roughness / Micro Details / keine flachen Oberflächen".

## Warum dieser Hebel
- **Sichtbar überall:** Böden + Wände sind der größte Bildanteil; Roughness-Variation ist der
  Hauptunterschied zwischen „CG" und „Foto".
- **GPU-günstig:** Roughness = **ein** Textursample pro Fragment (nicht pro Lichtquelle) →
  betrifft **nicht** die gerade gefixte Per-Light-Kostenursache.
- **Gratis-Datenquelle:** Die Pipeline erzeugt bereits **Height-Maps** (`parquetH`, `plasterH`,
  `slateH`, `woodOakH`, …) zur Normal-Map-Ableitung. Daraus leite ich die Roughness ab —
  **keine neue Noise-Generierung, kein neues Asset, offline-first**.

## Implementierung (additiv)
- **`heightToRoughness(height, variation)`** (`textures.ts`): Höhe → Roughness-Map. Erhabene
  Bereiche (Maserungsgrate, polierte Höhen) lesen leicht glänziger → Grünkanal sinkt dort. Die
  Map skaliert die Basis-Roughness nur **nach unten** (Werte ≤ 1) → subtiler, sicherer Aufbruch.
- Roughness-Maps für **Parkett, Eiche, Nussbaum, Putz, Schiefer, Vinyl hell/dunkel** aus den
  vorhandenen Height-Feldern erzeugt; in `TextureBundle` + IndexedDB-Cache-Keys aufgenommen,
  **`CACHE_VERSION` 18→19** (invalidiert Alt-Cache sauber).
- `buildMaterials`: `roughnessMap` an den Hero-Materialien — **tier-gegated** über Helper
  `rough()` (nur `'high'` lädt die Map auf die GPU; schwache Geräte bleiben lean).

## Performance / Risiko
- **GPU:** +1 Textursample/Fragment auf Hero-Flächen (günstig); Upload nur auf `'high'`.
  Speicher: 7 Graustufen-Maps (256–512px) nur auf `'high'`. **Per-Light-Kosten unverändert.**
- **Bundle:** JS ~konstant (+0,26 kB gz, reiner Code); Roughness-Maps sind prozedural/Runtime.
- **Risiko:** gering — nur Roughness-Skalierung nach unten (keine Mirror-Artefakte); Alt-Cache
  via Version-Bump invalidiert.

## Vorher / Nachher
- Vorher: Böden/Wände mit uniformem Glanz (flach).
- Nachher: feiner, ortsabhängiger Roughness-Aufbruch — Reflexe/Highlights „leben" über die
  Fläche, deutlich materialechter.

## Validierung
TS 0 · ESLint 0/0 · Tests 224/224 · Build ✓ · Bundle ~konstant · Desktop/Mobile 200 ·
Offline-First ✓ (keine externen Refs).

## Nächster Hebel
**Specular/Fresnel-Korrektheit:** physikalisch sinnvolle `ior` auf Dielektrika (Glas 1.5,
Keramik/Marmor ~1.45) + dezente `envMapIntensity`-Abstimmung → korrekte Reflexionsstärke an
Kanten. GPU-neutral.
