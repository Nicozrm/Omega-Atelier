# Material-Qualität S2 — Sanitärkeramik entflechtet (+ Klavierlack)

Zweiter Sprint der AAA-Materialmission. **1 Datei, +22/−8, keine neue Dependency,
Bundle konstant, prozedural (texturlos).**

## Begründung
`matteWhite` war 32× überladen — u. a. für **Sanitärobjekte** (Toilette, Waschbecken,
Badewanne), die in echt **glasierte Keramik** sind, nicht mattes Plastik. Das Entflechten
hebt die gesamte Bad-Ausstattung auf „neue Sanitärkeramik". Zusätzlich nutzten Badewannen-
Innenbecken `MAT.glass()` (seit v56 transparent) — wird mit korrigiert.

## Änderung (additiv, prozedural)
**Neues Material `glazedCeramic`** (`MeshPhysicalMaterial`, texturlos): Porzellan-Weiß
`#f4f2ec`, `roughness 0.25`, `metalness 0`, `clearcoat 0.85/0.08` → glasierter Glanz, der
die IBL weich reflektiert.

**Verdrahtung (nur Sanitärobjekte):**
| Objekt | vorher | nachher |
|---|---|---|
| Badewanne Korpus | matteWhite | **glazedCeramic** |
| Badewanne Innenbecken | glass (transparent!) | **glazedCeramic** (Korrektur) |
| Toilette (Becken + Spülkasten) | matteWhite | **glazedCeramic** |
| Bad-Waschbecken (Unterbau + Becken) | matteWhite | **glazedCeramic** |

**Bonus:** Klavierkorpus `matteBlack` → **`darkPanel`** (Hochglanz-Schwarzlack) — ein
Konzertflügel ist lackiert, nicht matt.

**Bewusst unverändert:** alle übrigen `matteWhite`/`matteBlack`-Flächen (Lampenschirme,
Sensor-/Schalter-/Geräte-Gehäuse, Bilderrahmen) — das sind korrekt matte Kunststoff-/
Lackteile. Kein Scope-Creep.

## Vorher / Nachher
- **Vorher:** Bad-Objekte matt-weiß wie Plastik; Wanneninneres seit v56 durchsichtig; Klavier matt.
- **Nachher:** Toilette/Waschbecken/Wanne mit glasiertem Keramik-Glanz; Klavier hochglänzend
  schwarz — wirken wie hochwertige, neue Produkte.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,78 kB gz); `ThreeDView` 39,05→39,10 kB (+0,05); `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs (texturlos, prozedural) |
| Dependencies | ✅ unverändert |

## Performance
Ein zusätzliches geteiltes, **texturloses** Material (kein Texturspeicher). Clearcoat-Kosten
gebunden auf Sanitär-/Klavier-Meshes. Kein Per-Frame-/Re-Render-Mehraufwand.

## Grenzen
- `bidet` und `oven` fallen weiterhin auf generische Default-Meshes (Geometrie-Lücke, nicht
  Material) — außerhalb dieses Material-Sprints; in der Roadmap vermerkt.
- Verifikationsgrenze: headless-WebGL rendert die 3D-Szene nicht in Screenshots.

## Nächster Sprint
**S3 — Textilien: Sheen** (`sheen`/`sheenRoughness` auf fabric/bedding/pillow) für
authentischen Stoff-Glanz an Streiflicht auf den großen Sofa-/Bettflächen.
