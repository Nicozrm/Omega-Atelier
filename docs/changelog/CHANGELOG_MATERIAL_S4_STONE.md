# Material-Qualität S4 — Stein poliert + materialabhängige Katalog-Oberflächen

Vierter Sprint der AAA-Materialmission. **1 Datei, +30/−7, keine neue Dependency,
Bundle konstant, prozedural (keine neue Textur).**

## Begründung
Marmor (Arbeitsplatten, Duschboden) war ein flaches `MeshStandardMaterial` (roughness 0.25)
ohne Versiegelungs-Glanz — realer polierter Marmor ist gehont **und versiegelt**. Zudem baute
`matFromCatalog` alle nicht-Legacy-Katalogmaterialien mit **pauschalen** Werten ohne
oberflächenspezifische Reflexion. Beides macht Stein/Fliesen „CG-flach". Behebung über
Clearcoat ist prozedural, ohne neue Textur, materialabhängig.

## Änderung (additiv)
1. **Marmor** → `MeshPhysicalMaterial` mit `clearcoat 0.6 / 0.12`: geäderte Basis unter klarer
   Versiegelung, reflektiert die IBL wie polierter Stein.
2. **`matFromCatalog` materialabhängig:** der generische Katalog-Pfad erhält eine
   **kategorie-gesteuerte** Veredelung statt Pauschalwerten:
   | Kategorie | clearcoat / clearcoatRoughness | Beispiel |
   |---|---|---|
   | tile | 0.7 / 0.15 | glasiertes Feinsteinzeug |
   | stone | 0.5 / 0.25 | polierter Naturstein |
   | wood | 0.3 / 0.35 | versiegeltes Holz (z. B. Nussbaumparkett) |
   | carpet / concrete / plaster / wallpaper | — (matt) | unverändert matt |

   Materialien mit Clearcoat werden als `MeshPhysicalMaterial` gebaut, matte Kategorien
   bleiben `MeshStandardMaterial` (kein unnötiger Shader-Overhead).

## Vorher / Nachher
- **Vorher:** Marmor & Katalog-Stein/Fliesen flach-matt, einheitliche Pauschal-Reflexion.
- **Nachher:** polierter Marmor mit Versiegelungsglanz; glasierte Fliesen / polierter Stein /
  versiegeltes Holz reflektieren **materialabhängig** die IBL; matte Beläge bleiben matt.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,78 kB gz); `ThreeDView` 39,15→39,21 kB (+0,06); `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs (keine neue Textur) |
| Dependencies | ✅ unverändert |

## Performance
Kein zusätzlicher Texturspeicher. Clearcoat nur auf glänzigen Kategorien (tile/stone/wood);
matte Kategorien bleiben `MeshStandardMaterial`. Katalogmaterialien werden **gecacht** (einmal
gebaut je id). Kein Per-Frame-/Re-Render-Mehraufwand.

## Grenzen
- **Veining-Normal** für Marmor bewusst weggelassen (würde eine neue Textur + Speicher
  kosten für geringen Zusatznutzen — die Äderung liegt bereits in `marbleC`). Optionaler
  Folgeschritt, falls gewünscht (prozedural).
- Verifikationsgrenze: headless-WebGL rendert die 3D-Szene nicht in Screenshots.

## Nächster Sprint
**S5 — Holz veredeln + Metalle differenzieren:** geöltes/lackiertes Holz (dezenter
Clearcoat auf oak/walnut) und Metall-Differenzierung (gebürstetes Messing vs. Chrom für
Armaturen vs. mattes Schwarzmetall).
