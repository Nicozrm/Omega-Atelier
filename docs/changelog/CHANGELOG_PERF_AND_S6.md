# Perf-Fix (3D-Ruckeln) + Material S6 (Katalog-Restmaterialien)

## Problem (gemeldet): 3D-View „sehr, sehr ruckelig"
**Analyse:** `detectTier()` stuft jedes normale Desktop-Gerät (≥8 Cores/≥8 GB) als
`'high'` ein → volle Postprocessing-Kette (SSAO + Bloom) **bei voller
`devicePixelRatio`** (Retina/HiDPI = 2–4× Pixel). Gleichzeitig wurden in v54–v56/S1–S6
~19 Materialien auf `MeshPhysicalMaterial` mit **Clearcoat/Sheen/Anisotropie/Transparenz**
gehoben — deren Lobes werden **pro Lichtquelle pro Fragment** ausgewertet, und die Szene
hat **ein Point-Light pro „an"-Lampe**. Produkt aus (Lichter × teure Lobes × Fragmente bei
hoher DPR) = Einbruch. Die Canvas hatte **kein DPR-Cap**.

## Fix (additiv, Materialqualität bleibt erhalten)
1. **DPR-Cap** `dpr={[1, 1.5]}` auf der Canvas — HiDPI rendert nicht mehr 2–4×; größter
   Einzelhebel, da SSAO **und** PBR-Shader fragmentgebunden sind.
2. **Adaptive Auflösung:** `<PerformanceMonitor onDecline=() => dprMax=1>` senkt die DPR
   weiter, **und** die schwere Postprocessing-Kette wird zusätzlich an `dprMax > 1`
   gekoppelt → bei anhaltendem Frame-Miss fallen DPR **und** SSAO/Bloom weg.
3. **Lean-Materialien auf schwachen Geräten:** auf Nicht-`'high'`-Tier werden
   Clearcoat/Sheen/Anisotropie aus den gebauten Materialien entfernt (`leanizeForPerf`) und
   `matFromCatalog` baut dort günstige `MeshStandardMaterial`. BaseColor/Maps/Roughness/
   Metalness/Transparenz bleiben — der Look degradiert sauber statt zu brechen.

**Wirkung:** Auf `'high'` volle Qualität, aber bei gekappter/abgesenkter Auflösung →
deutlich ruhigere Frames. Auf schwächeren Geräten zusätzlich günstige Shader. **Keine**
Rücknahme der Photorealismus-Arbeit.

## Material S6 (im selben Commit)
`matFromCatalog` materialabhängig vervollständigt: **Teppich → Sheen** (Textil-Glow wie S3),
**Sichtestrich/Beton → milder Clearcoat**; Putz/Tapete bleiben matt. (Auf `'high'` aktiv,
sonst lean — s. o.)

## Validierung
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| Bundle | ✅ ~konstant: Entry 27,79→27,80 kB gz; `ThreeDView` 39,29→39,42 kB (PerformanceMonitor) |
| Desktop + Mobile | ✅ preview 200 |
| Offline-First | ✅ keine externen HDRI/CDN-Refs |

## Risiko
- DPR-Cap 1.5: minimal weichere Kanten auf HiDPI — durch AA/SSAO unkritisch, Perf-Gewinn groß.
- `leanizeForPerf` nur auf Nicht-`'high'` — high-Tier unverändert in Optik.
- Verifikationsgrenze: headless-WebGL misst keine FPS; Fix ist analytisch begründet
  (fragmentgebundene Kosten ∝ DPR; Lobes ∝ Lichter).

## Supabase
Live-Build erhält `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anon-Key public-by-design,
RLS-geschützt) über die Deploy-Workflow-Env (bevorzugt Repo-Secrets/Vars, mit Fallback).
