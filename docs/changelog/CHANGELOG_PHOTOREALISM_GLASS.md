# v56 — Photorealismus: echtes transparentes Glas

Größter verbleibender Hebel pro Zeile nach v55 (Roughness-Maps datenbasiert verworfen,
s. Analyse unten). **1 Datei, +10/−2, ein Material, keine neue Dependency, Bundle konstant.**

## Analyse-Verdikt (warum nicht Roughness-Maps)
Roughness-Maps wirken nur auf glänzigen Flächen. Nach v55 gewinnen die **dominanten
Flächen nichts**: Böden sind via Clearcoat abgedeckt, Wände (roughness 0.85–0.92) sind zu
matt. Vorhandene Normal-Maps brechen Specular bereits auf. Verbleibende Nutznießer
(Marmor/Leder/Metalle) sind furniture-/device-scale = kleiner Bildanteil bei +GPU-Speicher.
→ niedriger Nutzen/Zeile.

Demgegenüber war `MAT.glass` ein **opaker, fast schwarzer Spiegel**
(`#16161a`, metalness 0.85), der die **prominenteste Innenraumfläche** treibt:
**Fensterscheiben** (große Plane je Öffnung in `Wall3D`) plus TV/Displays, Tischplatten,
Dusch-/Vitrinenglas, Balustraden (15+ Stellen). Fenster wirkten wie schwarze Paneele.

## Änderung (1 Material, additiv)
`MAT.glass`: opaker Spiegel → **echtes dielektrisches Glas**.

| Eigenschaft | vorher | nachher | Begründung |
|---|---|---|---|
| color | `#16161a` (schwarz) | `#aebfca` (kühle Glas-Tönung) | tönt das Durchgesehene |
| metalness | 0.85 (Mirror-Hack) | 0.0 | Glas ist Dielektrikum |
| roughness | 0.05 | 0.05 | klare, glatte Scheibe |
| transparent / opacity | — | true / 0.25 | **durchsichtig** |
| depthWrite | — | false | blendet sauber über opake Geometrie dahinter |
| envMapIntensity | — | 1.2 | scharfe IBL/Himmel-Reflexion (Fresnel) |

Ergebnis: Fenster werden **durchsichtig** und reflektieren zugleich die v54-IBL über
Fresnel → lesen als Glas statt als Loch. Ein Material propagiert szenenweit.

## Vorher / Nachher
- **Vorher:** Fenster & Glasflächen = schwarze Spiegel-Paneele (starker „CG-Tell").
- **Nachher:** klare, leicht kühl getönte, durchsichtige Scheiben mit Himmel-/IBL-Reflex;
  deutlich realistischerer Innenraum, szenenweit über alle Glasteile.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,79 kB gz); `ThreeDView` 38,94→38,95 kB; `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs |
| Dependencies | ✅ unverändert |

## Performance-Auswirkungen
Transparente Draws sind günstig (eine Alpha-Blend-Lobe). Kein Extra-Render-Pass (im
Gegensatz zu `transmission`). Material einmal gebaut + geteilt. Kein Mobile-Risiko durch
Render-Pass/Speicher.

## Risiken / Grenzen (transparent)
- **Alpha-Sorting:** bei direkt überlappenden Glasscheiben theoretisch minimale
  Sortier-Artefakte; bei dünnen, meist parallelen Fensterscheiben praktisch unkritisch.
- **Schatten:** wenige Glasteile mit `castShadow` (z. B. ein Geräte-Glas) werfen nun einen
  harten statt keinen Schatten — klein, bewusst nicht angefasst (Material-only, kein
  Mesh-Refactoring/Scope-Creep).
- **Verifikationsgrenze:** headless-WebGL rendert die 3D-Szene nicht in Screenshots
  (projektweite Umgebungsgrenze) — Wirkung aus Material-Config + grünem Build/Serving
  begründet, kein Pixel-Beweis.
