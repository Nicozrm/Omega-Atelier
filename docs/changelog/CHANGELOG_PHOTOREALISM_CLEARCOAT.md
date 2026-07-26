# v55 — Photorealismus: Clearcoat-Versiegelung auf Böden

Größter verbleibender Hebel pro Codezeile, additiv. **1 Datei, +16/−4, keine neue
Dependency, Bundle praktisch konstant.**

## Ist-Analyse (Ausgangspunkt v54)
Pipeline reif: lokale IBL (`scene.environment`), Color+Normal-Maps, SSAO/Bloom, ACES,
Soft-Shadows. Texturen liefern pro Material nur **C + N** (256/512px), **keine**
Roughness-/AO-/Metalness-Maps, `envMapIntensity` Default. Größter „CG-Tell": **uniformer
Glanz**, am sichtbarsten auf der **dominantesten Fläche — dem Boden**. Erst v54 schuf mit
der IBL überhaupt etwas zum Spiegeln, dadurch lohnt sich geschichteter Glanz jetzt.

## Architektur-Entscheidung (vor Umsetzung gestoppt, freigegeben)
Drei legitime Wege bewertet — Clearcoat vs. prozedurale Roughness-Maps vs. reiner
`envMapIntensity`-Feinschliff. Gewählt (Freigabe Nico): **Clearcoat**, weil höchster
sichtbarer Nutzen pro Zeile bei minimalem Risiko und ohne neue Assets/Deps.

## Änderung (additiv, nur betroffene Datei)
`ThreeDView.tsx > buildMaterials()`: die vier **texturierten** Böden (Parkett, Vinyl hell/
dunkel, Schiefer) von `MeshStandardMaterial` auf `MeshPhysicalMaterial` gehoben und eine
dünne **Clearcoat-Schicht** ergänzt. Die matte Maserungs-/Steinbasis (`map` + `normalMap`
+ `roughness` + `metalness`) bleibt **unverändert**; obenauf sitzt eine glasklare,
lackierte Versiegelung, die die v54-IBL scharf reflektiert — genau wie versiegeltes Holz /
glasierte Fliese in echt.

| Boden | clearcoat | clearcoatRoughness | Begründung |
|---|---|---|---|
| Parkett | 0.7 | 0.25 | lackiertes Holz |
| Vinyl hell/dunkel | 0.6 | 0.35 | satinierter Topcoat |
| Schiefer | 0.7 | 0.20 | glasierter/polierter Stein |

Teppich- und Sichtestrich-Böden (über `matFromCatalog`) bleiben bewusst **matt** (kein
Clearcoat) — physikalisch korrekt.

## Vorher / Nachher
- **Vorher:** Böden mit uniformem, mattem Glanz; die neue IBL spiegelte sich kaum sichtbar.
- **Nachher:** Böden bekommen einen realistischen, blickwinkelabhängigen Versiegelungs-
  Glanz; IBL-Reflexe und Lichter laufen scharf über die größte Bildfläche → deutlich
  „echterer" Raumeindruck. Maserung/Struktur darunter unverändert (keine Überstrahlung).

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 Fehler |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ praktisch konstant: Entry **unverändert** (27,79 kB gz); `ThreeDView` 38,90→38,94 kB; `three` 226,73→226,74 kB (MeshPhysicalMaterial-Shader war bereits im three-Chunk) |
| Desktop + Mobile | ✅ preview 200 (Desktop- & iPhone-UA), Entry-Asset 200 |
| Offline-First | ✅ keine externen HDRI-Refs im Build |
| Dependencies | ✅ unverändert |

## Performance-Auswirkungen
Clearcoat fügt eine zweite Specular-Lobe pro Fragment hinzu — **nur auf den Boden-Meshes**
(wenige große Flächen), nicht szenenweit. Gegenüber dem bereits aktiven SSAO/Bloom ist der
Mehraufwand klein. Anisotropie bleibt mobil geclamped. Kein Per-Frame-, kein
Re-Render-Mehraufwand (Materialien werden einmal gebaut + geteilt). Falls auf sehr
schwacher Hardware nötig, ließe sich Clearcoat künftig an `readTier()` koppeln — aktuell
nicht erforderlich.

## Risiken / Grenzen
- **Perf:** minimal höhere Boden-Fill-Kosten (s. o.) — als gering und gebunden bewertet.
- **Verifikationsgrenze (transparent):** headless-WebGL (Swiftshader) rendert die 3D-Szene
  nicht in Screenshots — projektweite Umgebungsgrenze. Wirkung begründet aus korrekter
  Material-Konfiguration (Clearcoat über vorhandener IBL), grünem Build/Serving, konstantem
  Bundle. **Kein** Pixel-Screenshot-Beweis.

## Bewusst nicht enthalten (kein Scope-Creep)
Roughness-/Metalness-Maps und Wand-Clearcoat — sinnvolle Folgeschritte nur bei messbarem
Nutzen und konstantem Initial-Bundle.
