# v54 — Photorealismus: Offline-first IBL + Anisotropie

Kleinste additive Änderung mit dem größten sichtbaren Photorealismusgewinn,
auf Basis der verifizierten v53. **2 Dateien, +55/−7, keine neue Dependency.**

## Analyse-Verdikt (Ist-Zustand)
Die Pipeline ist bereits reif: renderer-neutrale Material-Registry (`data/materials.ts`)
+ Resolver (`lib/materials.ts`), prozedurale **Color- + Normal-Maps** (`lib/textures.ts`,
IndexedDB-gecacht), `MeshStandardMaterial` mit `map`+`normalMap`, phasengesteuerte
Beleuchtung (`lib/lighting.ts` + Sun/Hemi/Ambient/ContactShadows), ACES-Tonemapping,
Postprocessing (SSAO/Bloom/…). **Kein** Roughness-/AO-/Metalness-Map; SSAO deckt AO
screen-space ab.

**Architektonisch kritisches Finding:** Die Materialien sind explizit für
Environment-Reflexionen gebaut, doch die Env-Map kam via `<Environment preset>` aus
einem **Laufzeit-CDN** (`raw.githack.com/pmndrs/drei-assets/.../hdri/`). `@pmndrs/assets`
ist keine Dependency, und `<Environment>` lag **innerhalb der `<Suspense>`** um die Szene.
In der Offline-First-PWA bedeutete das: offline → HDR-Fetch schlägt fehl → **keine
Reflexionen auf Metall/Glas/Glanz** (dunkel & flach) und Risiko, dass die `<Suspense>`
die **gesamte 3D-Szene** auf dem Lade-State blockiert.

## Änderung (rein additiv, Reuse > Rewrite)
1. **Lokale IBL statt CDN-HDRI** (`ThreeDView.tsx`): neue Komponente `LocalEnvironment`
   nutzt three's eingebautes **`RoomEnvironment`** (prozedurale Studio-Szene, **kein
   externes Asset, kein Netzwerk**) + **`PMREMGenerator`**. Einmal beim Mount vorgefiltert,
   Ergebnis → `scene.environment`. Reflexionen sind damit **überall garantiert, inkl.
   offline**, ohne Suspense/Netzwerk-Abhängigkeit.
   - Tagesphasen-Cue erhalten **ohne** Env-Rebuild: `scene.environmentIntensity` wird je
     `DayPhase` gesetzt (`PHASE_TO_ENV_INTENSITY`); Sky/Sonne/Schatten variieren ohnehin
     weiter über die bestehende Lighting-Rig. Korrekte Disposition beim Unmount.
   - `<Environment>`-Import + `PHASE_TO_PRESET` entfernt (nicht mehr referenziert).
2. **Anisotrope Filterung 4 → 16** (`textures.ts`, `makeTex`): scharfe Texturen an
   streifenden Blickwinkeln (Böden/Wände werden fast immer schräg betrachtet).
   three **clamped** auf `getMaxAnisotropy()` beim Upload → **mobil sicher** (automatisch
   reduziert), keine neue Textur, kein Speicher-Mehrbedarf.

## Verifikation (alle frisch ausgeführt)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 Fehler |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 (26 Dateien) |
| Build | ✅ erfolgreich |
| **Bundle** | ✅ **netto ~−18,8 kB gzip** auf dem Lazy-3D-Pfad: `three` 246,45→**226,73 kB** (HDR/RGBELoader tree-shaked), `ThreeDView` 37,99→38,90 kB (+0,9 kB Glue). **Entry unverändert** (27,78→27,79 kB). |
| **Offline-First** | ✅ **keine** `githack`/`drei-assets`/`.hdr`-Referenz mehr im Build |
| Performance | ✅ PMREM einmal beim Mount (kein Per-Frame-Kosten); Anisotropie ist GPU-günstig; Entfernen des HDR-Fetches verbessert den Start |
| Mobile + Desktop | ✅ `vite preview` 200 (Desktop- & iPhone-UA), Entry-Asset 200; Anisotropie mobil geclamped |
| Dependencies | ✅ **unverändert** (`RoomEnvironment` ist Teil des vorhandenen `three`) |

## Ehrliche Bewertung
Hoher Hebel pro Zeile: Der Sprint behebt die **größte reale Photorealismus-Lücke**
(offline gab es bisher *gar keine* IBL-Reflexionen) **und** macht das Bundle kleiner,
**und** entfernt eine versteckte Laufzeit-CDN-Abhängigkeit + einen Suspense-Hang-Pfad.
Anisotropie ist der klassische „größter sichtbarer Gewinn pro Byte"-Schritt für Böden.

## Risiken
- **Online-Tradeoff:** Die Reflexions-IBL ist jetzt eine neutrale Studio-Umgebung statt
  vier phasenspezifischer HDRIs. Mitigiert durch phasenabhängige
  `environmentIntensity`; Sky/Sonne/Schatten bleiben voll phasengesteuert. Netto-Look
  konsistenter und robuster, minimal weniger „Stimmungsfarbe" in reinen Spiegelungen.
- `scene.environmentIntensity` (three ≥ r163) wird genutzt — vorhanden in three 0.169
  (verifiziert in den three-Quellen + grünem Typecheck).

## Grenzen der Verifikation (transparent)
- **Kein** pixelgenauer 3D-Screenshot: headless-WebGL (Swiftshader) rendert die 3D-Szene
  nicht — projektweit dokumentierte Umgebungsgrenze. Visuelle Wirkung daher begründet aus:
  `scene.environment` ist nun deterministisch lokal gesetzt (statt evtl. leer), Anisotropie
  geklammert, Build/Serving fehlerfrei, keine externen Refs. Kein Browser-Screenshot-Beweis.

## Nicht enthalten (bewusst, kein Scope-Creep)
Roughness-/Metalness-Maps (würden Textur-Speicher + Generierung erhöhen) — sinnvoller
Folgeschritt, nur bei messbarem Nutzen und konstantem Initial-Bundle.
