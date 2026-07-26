# Material-Qualität S3 — Textilien mit Sheen

Dritter Sprint der AAA-Materialmission. **1 Datei, +26/−8, keine neue Dependency,
Bundle konstant, prozedural (Reuse vorhandener Stoff-Texturen).**

## Begründung
Stoffe (Sofa, Bett, Kissen) waren flache `MeshStandardMaterial` mit roughness 0.95 ohne
**Sheen** — der weiche, retroreflektierende Streiflicht-Glanz, der gewebten Stoff
ausmacht. Ohne Sheen wirkt Textil wie mattes Plastik. Sofas/Betten/Kissen sind ein
**großer Flächenanteil** → hoher sichtbarer Gewinn pro Zeile. `MeshPhysicalMaterial.sheen`
ist in three 0.169 vorhanden → rein prozedural, keine neue Textur.

## Änderung (additiv)
Fünf Polster-/Bett-Textilien von `MeshStandardMaterial` → `MeshPhysicalMaterial` mit Sheen
gehoben; Gewebe-Farbe/Normal **unverändert**, `metalness` korrekt auf 0 (Dielektrikum):

| Material | sheen / sheenRoughness | sheenColor |
|---|---|---|
| fabric (Beige) | 1.0 / 0.9 | `#d8d0bf` |
| fabricGray | 1.0 / 0.9 | `#cfd0cf` |
| fabricBlue | 1.0 / 0.9 | `#bfccdc` |
| bedding | 1.0 / 0.85 | `#eae6dd` |
| pillow (Leinen) | 1.0 / 0.85 | `#ece8df` |

`sheenColor` ist je Material ein heller Ton der Basisfarbe → realistischer Faser-Glanz.

**Bewusst unverändert:** `leatherBlack` (Leder hat satinigen Specular, **kein** Stoff-Sheen)
und `rug` (Wollflor, roughness 0.97 — Sheen-Nutzen gering; ggf. später).

## Vorher / Nachher
- **Vorher:** Polster/Bettwäsche matt-flach, wie Kunststoff.
- **Nachher:** weicher Streiflicht-Schimmer auf Sofa/Bett/Kissen → liest als echtes,
  hochwertiges Textil.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,78 kB gz); `ThreeDView` 39,10→39,15 kB (+0,05); `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs (Reuse vorhandener Texturen) |
| Dependencies | ✅ unverändert |

## Performance
Kein zusätzlicher Texturspeicher (gleiche Maps). Sheen ist eine zusätzliche, günstige
BRDF-Lobe, gebunden auf Textil-Meshes. Materialien einmal gebaut + geteilt — kein
Per-Frame-/Re-Render-Mehraufwand.

## Grenzen
- Wollteppich (`rug`) bewusst ohne Sheen (geringer Nutzen bei roughness 0.97).
- Verifikationsgrenze: headless-WebGL rendert die 3D-Szene nicht in Screenshots.

## Nächster Sprint
**S4 — Stein poliert:** Marmor mit Clearcoat (+ dezentes prozedurales Veining-Normal) und
kategorie-korrekte Rauheit/Reflexion der Katalog-Stein/Fliesen-Böden via `matFromCatalog`.
