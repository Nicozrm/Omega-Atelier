# Material-Qualität S5 — Holz veredelt + Metalle differenziert

Fünfter Sprint der AAA-Materialmission. **1 Datei, +27/−7, keine neue Dependency,
Bundle konstant, prozedural (keine neue Textur).**

## Begründung
Holz (Möbel, Türen, Sideboards, Holzböden) war unversiegelt-matt; Metalle waren pauschal
(ein „steel", ein „brass", roughness 0.4) — reale Premium-Räume differenzieren **gebürstetes
Messing**, **poliertes Chrom** (Armaturen) und gebürsteten Edelstahl. Materialabhängige
Reflexion = höherer Realismus.

## Änderung (additiv)
1. **Holz** `oak`/`walnut` → `MeshPhysicalMaterial` + dezenter **Clearcoat** (0.25–0.3) →
   geöltes/lackiertes, gepflegtes Holz; Maserung (map+normal) unverändert.
2. **Messing** → **gebürstetes Messing**: `MeshPhysicalMaterial`, `metalness 1.0`,
   `roughness 0.35`, `anisotropy 0.4` (reuse brass-Normal) → satinierter Premium-Akzent
   (Griffe, Kappen).
3. **Neu `chrome`** (texturlos): poliertes Chrom, `metalness 1.0`, `roughness 0.08`,
   `envMapIntensity 1.2` → helle Spiegelreflexion aus der IBL.
4. **Bad-Armatur** brass → **chrome** (Armaturen sind typischerweise verchromt).

## Vorher / Nachher
- **Vorher:** Holz matt-roh; Metalle einheitlich; Armatur messingfarben pauschal.
- **Nachher:** Holz mit feinem Versiegelungsglanz; differenzierte Metalle (gebürstetes
  Messing vs. poliertes Chrom vs. gebürsteter Edelstahl aus S1) — materialabhängige
  Lichtreaktion.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,78 kB gz); `ThreeDView` 39,21→39,25 kB (+0,04); `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs (chrome texturlos; Reuse vorhandener Maps) |
| Dependencies | ✅ unverändert |

## Performance
Ein zusätzliches texturloses Material (`chrome`). Clearcoat/Anisotropy gebunden auf
Holz-/Metall-Meshes. Materialien einmal gebaut + geteilt. Kein Per-Frame-/Re-Render-Mehraufwand.

## Grenzen
- Verifikationsgrenze: headless-WebGL rendert die 3D-Szene nicht in Screenshots.

## Nächster Sprint
**S6 — restliche Katalog-Materialien:** kategorie-korrekte Mikrostruktur/Reflexion für
verbleibende `matFromCatalog`-Flächen (Teppich, Beton, Tapete) statt Pauschalwerten.
