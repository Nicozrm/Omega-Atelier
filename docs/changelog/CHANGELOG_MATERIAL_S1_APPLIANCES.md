# Material-Qualität S1 — Haushaltsgeräte & Displays (Edelstahl + Panel)

Erster Sprint der AAA-Materialmission. **1 Datei, +41/−12, keine neue Dependency,
Bundle konstant, prozedural (Reuse vorhandener Texturen).**

## Begründung (größter Nutzen pro Zeile)
Die Ist-Analyse (`MATERIAL_QUALITY_ROADMAP.md`) zeigte: Haushaltsgeräte rendern als
**matte weiße/graue Kisten** (`matteWhite`-Korpus + Glas-Front) statt als Produkte.
Zusätzlich hatte v56 einen **Nebeneffekt**: opake „Dunkelglas-Panels" (Geräte-Fronten,
TV-Screen, Sink-Becken) nutzten `MAT.glass()` nur als Glanz-Hack — seit v56 ist Glas
transparent, also waren diese Flächen **durchsichtig** (Blick in den Kühlschrank, gläserner
TV). S1 trifft damit den größten sichtbaren Produkt-Effekt **und** behebt diese Regression.

## Änderung (additiv, prozedural)
**Zwei neue Materialien** (`MeshPhysicalMaterial`, three-intern, kein neues Asset):
- **`brushedSteel`** — gebürsteter Edelstahl: `metalness 1.0`, `roughness 0.32`,
  `anisotropy 0.5` (vertikale Maserung), **reuse** der vorhandenen `steelN`-Normal-Map für
  Mikrostruktur, `envMapIntensity 1.0` → reflektiert die v54-IBL produkthaft.
- **`darkPanel`** — opakes Hochglanz-Display/-Front: near-black, `roughness 0.18`,
  `clearcoat 1.0/0.08`. Ausdrücklich **nicht** das transparente Fensterglas.

**Verdrahtung (nur betroffene Geräte/Displays):**
| Objekt | vorher | nachher |
|---|---|---|
| Küchenkorpus | matteWhite | **brushedSteel** |
| Küchen-Spülbecken | glass (transparent!) | **brushedSteel** |
| Kochfeld-Ringe | steel | **brushedSteel** (konsistent) |
| Kühlschrank/Geschirrspüler/**Waschmaschine**-Korpus | matteWhite | **brushedSteel** |
| Geräte-Front | glass (transparent!) | **darkPanel** (opak) |
| TV-Screen | glass (transparent!) | **darkPanel** (opak) |
| Bad-Waschbecken-Einsatz | glass (transparent!) | matteWhite (opak; finale Keramik in S2) |

**Bonus-Fix:** Die Regex erfasste `^washing-machine`, aber die Katalog-id ist `washer` →
Waschmaschine fiel auf den generischen Default-Mesh. Regex um `^washer` ergänzt → rendert
jetzt korrekt als Gerät mit den neuen Materialien.

## Vorher / Nachher
- **Vorher:** Geräte = matte weiße Boxen; mehrere Fronten/Screens seit v56 durchsichtig.
- **Nachher:** Küche & Großgeräte in gebürstetem Edelstahl mit IBL-Reflex; Fronten/Screens
  als opake, hochglänzende dunkle Panels → klar als hochwertige Produkte lesbar.

## Verifikation (alle frisch)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 |
| ESLint `--max-warnings 0` | ✅ 0/0 |
| Tests | ✅ 224/224 |
| Build | ✅ |
| **Bundle** | ✅ konstant: Entry **unverändert** (27,78 kB gz); `ThreeDView` 38,95→39,05 kB (+0,10, zwei Materialien); `three` unverändert |
| Desktop + Mobile | ✅ preview 200 (beide UAs) |
| Offline-First | ✅ keine externen Refs (Reuse `steelC/steelN`, prozedural) |
| Dependencies | ✅ unverändert |

## Performance
Zwei zusätzliche geteilte Materialinstanzen (einmal gebaut). `brushedSteel` reuse vorhandener
Texturen → **kein** zusätzlicher Texturspeicher. `darkPanel` ist texturlos. Anisotropy/Clearcoat
sind günstige Shader-Features, gebunden auf Geräte-Meshes. Kein Per-Frame-/Re-Render-Mehraufwand.

## Risiken / Grenzen
- Geräte sind nun **Edelstahl** als Standard-Optik (Mission-Vorgabe „gebürsteter Edelstahl").
  Eine spätere Material-Wahl (weiß/schwarz/Stahl) wäre ein optionaler Folgeschritt.
- **Verifikationsgrenze:** headless-WebGL rendert die 3D-Szene nicht in Screenshots —
  Wirkung aus Material-Config + grünem Build/Serving begründet, kein Pixel-Beweis.

## Nächster Sprint
**S2 — `matteWhite`/`matteBlack` entflechten:** glasierte Sanitärkeramik (Toilette/Sink/
Bidet/Wanne) vs. mattem Kunststoff; restliche Display-Schwarzflächen auf `darkPanel`.
(Siehe `MATERIAL_QUALITY_ROADMAP.md`.)
