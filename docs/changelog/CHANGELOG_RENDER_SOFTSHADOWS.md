# Render-Grade R1 — weiche, realistische Sonnenschatten

## Analyse / Hebel
Nach dem Perf-Fix muss der nächste Hebel **GPU-neutral** sein. Der größte verbliebene
„CG-Tell" der Beleuchtung sind **messerscharfe Sonnenschatten** — reale Sonne wirft wegen
ihrer Winkelausdehnung eine weiche Penumbra. Weiche Schatten sind der klassische
ArchViz-Schritt von „Render" zu „Foto".

## Implementierung (GPU-neutral)
`directionalLight` (Sonne):
- `shadow-radius={5}` → weiche Penumbra (PCFSoftShadowMap nutzt dieselben Samples → **keine**
  Mehrkosten pro Fragment).
- `shadow-normalBias={0.02}` → sauberer Kontakt ohne Shadow-Acne/Peter-Panning; bereitet
  zugleich kommende abgerundete/bevelte Geometrie vor.

Keine neue Textur, kein neues Material, kein Per-Light-Mehraufwand.

## Performance / Risiko
- **GPU:** neutral (Schatten-Sample-Anzahl unverändert). Bundle konstant (+0,02 kB gz).
- **Risiko:** minimal; `normalBias` zu hoch könnte Schatten leicht ablösen — 0.02 ist konservativ.

## Vorher / Nachher
- Vorher: harte, scharfkantige Schlagschatten (CG-typisch).
- Nachher: weiche, abgestufte Schatten mit sauberem Bodenkontakt → fotografischer.

## Validierung
TS 0 · ESLint 0/0 · Tests 224/224 · Build ✓ · Bundle konstant · Offline-First ✓.

## Nächster Hebel
**Mikro-Detail / korrekte Roughness** (prozedurale Roughness-Maps für Hero-Flächen) —
„keine flachen Oberflächen mehr". Roughness-Map = **ein** Textursample (nicht pro Licht),
also GPU-günstig; mit striktem Speicher-/Bundle-Budget umzusetzen.
