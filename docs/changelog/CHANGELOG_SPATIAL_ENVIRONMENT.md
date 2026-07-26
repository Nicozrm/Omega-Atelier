# CHANGELOG — Meilenstein: Spatial Environment Engine

> Phase 2 (Produktreife) · **P1**. Erster Sprint unter der neuen Dauerregel:
> **Kein neuer Code umgeht das renderer-neutrale Material- und Lichtmodell.**
> Keine neuen Switch-Statements, keine renderer-spezifischen Sonderfälle, keine
> Duplikate von Material- oder Lichtdefinitionen — alle neuen Funktionen arbeiten
> ausschließlich über die Single Source of Truth. Gemessen an der Plattform-Vision:
> **Digital Twin First** (der digitale Zwilling wird spürbar realistischer) ·
> **Quality First** · **Connector First**.

---

## Ausgangslage (Analyse)

Die räumliche Darstellung in 3D war **nicht datengetrieben** und unterlief das
frisch etablierte Material-/Licht-Fundament an mehreren Stellen:

- **Beleuchtung hartkodiert:** Hemisphere/Ambient/Directional in der Szene waren
  über einen `daylight`-Bool mit fest verdrahteten Hex-Farben/Intensitäten
  gesetzt — ein renderer-eigenes Lichtbild, getrennt vom Modell.
- **Ad-hoc Lampenlichter:** einzelne Geräte-Glyphen emittierten eigene
  `<pointLight>` mit **hartkodierten Dekorfarben** (`#ff60d8`, `#ffd58a`, …),
  völlig am Lichtmodell vorbei.
- **Wände über Switch:** `wallVariant` → `MAT.wallByType()` (`switch`) im Renderer
  — die letzte verstreute Materialquelle neben dem Katalog.
- **Keine Decke** im Datenmodell.
- **Kein Environment-Modell**, das Tageszeit/Wetter/Sonne aufnehmen könnte.

## Umsetzung

### 1 · 3D-Lichter vollständig aus dem Lichtmodell

**`src/lib/lighting.ts`** — neue Funktion **`deriveLightSources`**: die Single
Source of Truth für *einzelne* Leuchten unter dem aktiven Modus. Pro Lampe ein
`LightSource { deviceId, roomId, position, on, intensity (0…1), kelvin, color }` —
Position aus dem Lampengerät, Farbe aus `kelvinToHex(kelvin)`, Intensität aus
Brightness. **`deriveRoomLighting` wurde darauf umgebaut** (leitet den Raum-Aggregat
aus `deriveLightSources` ab → **Duplizierung entfernt**, Verhalten identisch).

**Renderer (`ThreeDView`):** neue `RoomLights`-Komponente rendert **echte Point
Lights** aus `deriveLightSources` — Position via `M()`, Farbe = `source.color`,
Intensität aus `source.intensity`. Die **zwei ad-hoc Geräte-`pointLight`s wurden
entfernt**; funktionale Raumbeleuchtung kommt nun aus *einer* Quelle. Der Renderer
berechnet **keine** Lichtfarbe/-stärke und **kein** Kelvin mehr selbst.

### 2 · Wandmaterialien vollständig auf den Katalog

- **Entfernt:** Typ `WallVariant`, Funktion `wallMatV`, Eintrag `MAT.wallByType`
  (der `switch`) — restlos.
- `Wall3D` / `CornerPillar` nehmen jetzt ein aufgelöstes **`Material`** und rendern
  über `matFromCatalog(material)` (Auswahl-Highlight `MAT.wallSel()` bleibt — ein
  reiner UI-Zustand, kein Oberflächenmaterial).
- Globale Wandauswahl: State `wallVariant` → **`wallMaterialId`**
  (`DEFAULT_WALL_MATERIAL_ID`); der Picker speist sich aus
  **`materialsForSurface('wall')`**. Die Szene löst einmalig via
  **`resolveSurfaceMaterialId(wallMaterialId,'wall')`** auf — Renderer konsumiert
  einen Resolver, nie den Rohkatalog.
- `matFromCatalog` um **Wand-Legacy-Bridges** erweitert (bestehende texturierte
  Wandmaterialien werden renutzt → keine Regression) und um eine **`doubleSide`**-
  Option (für die Decke).

### 3 · Deckenmaterial vorbereitet (Datenmodell jetzt, Renderer einfach)

- **Katalog:** `SurfaceKind` um `'ceiling'` erweitert; zwei Decken-Materialien
  (`ceiling-white` [Default], `ceiling-plaster`); `DEFAULT_CEILING_MATERIAL_ID`.
- **Typ:** `Room.ceilingMaterialId?`.
- **Resolver:** `resolveCeilingMaterial(room)` (explizite id → Default).
- **Renderer (bewusst einfach):** Decke wird **nur im Walk-Mode** gerendert (eine
  opake Decke darf die Dollhouse-Ansicht nicht verdecken), Material über
  `matFromCatalog(resolveCeilingMaterial(r), { doubleSide:true })`.

### 4 · Environment-Lighting vorbereitet

**`src/lib/environment.ts`** (neu) — `deriveEnvironment(input)` liefert
renderer-neutral **Ambient + Hemisphere** (+ ein Basis-Sonnen-Schlüssellicht).
Kelvin bleibt zentralisiert: das Modul **importiert `kelvinToHex`** aus
`lighting.ts`, statt eigene Temperatur-Mathematik zu führen. Die Szene konsumiert
ausschließlich diese Werte (`<hemisphereLight>` / `<ambientLight>` /
`<directionalLight>`) — **alle `daylight`-Ternaries sind aus dem Renderer
verschwunden**. Saubere Schichtung: das Modell besitzt die **Licht-Erscheinung**
(Farben/Intensitäten), der Renderer nur die **Platzierung**.

### 5 · Architektur für die nächste Stufe vorbereitet

`EnvironmentInput` trägt bereits `timeOfDay`, `weather`, `orientationDeg`;
`EnvironmentLighting` ein optionales `SunLight { azimuth, elevation, color,
intensity, castShadow }`. Damit lassen sich **Sonnenstand, Tageszeit-Grading,
Wetter, Fensterlicht und Schatten** später nachrüsten, **ohne den Renderer
anzufassen** — er konsumiert bereits, was das Modell zurückgibt. Die Sonnen-
*Position* aus azimuth/elevation ist der dokumentierte nächste Hebel (bis dahin
positioniert der Renderer geometrisch).

## Architekturregeln — eingehalten

| Regel | Status |
|---|---|
| Keine THREE.js-Typen außerhalb der Renderer | ✅ (Modelle liefern Hex + Zahlen) |
| Keine Materialdefinition außerhalb des Katalogs | ✅ (Decken-/Wandmaterialien im Katalog) |
| Keine Kelvin-Berechnung außerhalb von `lighting.ts` | ✅ (`environment.ts` importiert `kelvinToHex`) |
| Kein Renderer kennt Materialdetails direkt | ✅ (nur über `matFromCatalog` + Resolver) |
| Renderer konsumieren ausschließlich Resolver | ✅ (Boden/Wand/Decke + Licht + Environment) |

## Tests

- `src/lib/lighting.test.ts` — **+4** (`deriveLightSources`: Filterung,
  Position/roomId/Farbe aus Kelvin, Brightness→Intensität, On/Off pro Modus,
  Pro-Gerät-Override) → 12.
- `src/lib/environment.test.ts` (neu) — **4** (valide Ambient/Hemisphere-Hex,
  Nacht dunkler als Tag, Basis-Sonne mit gültigen Feldern, vorausschauende Inputs
  brechen nicht).
- `src/lib/materials.test.ts` — **+3** (Decken-Resolver, Decken-Oberfläche,
  generischer `resolveSurfaceMaterialId`) → 13.
- Gesamt-Testsuite **149** (vorher 137; +12).

## Validierung (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build erfolgreich | ✅ |
| TypeScript fehlerfrei | ✅ |
| ESLint 0/0 | ✅ |
| Tests erfolgreich | ✅ **149** (+12) |
| Performance ≥ vorher | ✅ Feature-Code vollständig in Lazy-Chunks (per Import-Graph verifiziert: kein index-erreichbarer Importeur); Initial-Transfer praktisch unverändert (gzip-Delta ~0,3 KB), Render-Pfad memoisiert & beschränkt (wenige Point Lights) |
| Keine Regressionen | ✅ 3D-Texturen renutzt; 3D-View mountet **fehlerfrei** (0 Konsolen-/Page-Fehler); Wand-Picker katalog-getrieben (Playwright-DOM-verifiziert) |
| Renderer-neutral | ✅ |
| Single Source of Truth eingehalten | ✅ (keine neuen Switches/Sonderfälle/Duplikate; ad-hoc Lichter & Wand-Switch **entfernt**) |
| Architektur dokumentiert | ✅ (dieses Dokument) |
| Sichtbarer Mehrwert im Produkt | ✅ siehe unten |

## Sichtbarer Mehrwert

- **3D-Räume werden von echten Punktlichtern beleuchtet**, die Wärme (Kelvin) und
  Helligkeit **jeder Leuchte je Modus** abbilden — Filmlicht warm/gedämpft,
  Tag-Office hell/kühl. Der Moduswechsel wird im Raum erlebbar.
- **Wände katalog-getrieben** (konsistent mit Böden, im Picker sichtbar).
- **Decke im Walk-Mode** → geschlossene, glaubwürdige Innenräume.
- **Modellgetriebenes Tag/Nacht-Environment** (Ambient + Hemisphere + Sonne).

## Vor dem Merge — kritische Prüfung

- **Technische Schuld erzeugt?** Nein — im Gegenteil **abgebaut**: zwei ad-hoc
  Lichtquellen und der Wand-`switch` sind weg; `deriveRoomLighting` dedupliziert.
- **Neue Duplikate?** Nein — Kelvin nur in `lighting.ts`, Material nur im Katalog,
  Aggregat aus `deriveLightSources` abgeleitet.
- **In zwei Jahren tragfähig?** Ja — Environment/Licht/Material sind reine,
  getestete Modelle mit dokumentierten Erweiterungspunkten (Sonne/Zeit/Wetter).
- **Mit 50 Materialtypen, 100 Lampen, späteren Connectoren tragfähig?** Ja — der
  Katalog skaliert als Daten; `deriveLightSources` skaliert pro Gerät; ein
  Connector speist künftig Geräte-Modus-Zustände bzw. Material-ids und fließt
  durch dasselbe Modell, ohne Renderer-Änderung.

## Leitlinien-Abgleich

**Digital Twin First ✓✓** (Licht/Räume werden physisch glaubwürdig) ·
**Connector First ✓✓** (herstellerneutral; Lichter aus Geräte-Zuständen, Materialien
per id) · **Quality First ✓✓** (Sonderfälle entfernt, alles unter Test, keine
undokumentierte Schuld) · **Plugin First ✓** (Katalog + Environment datengetrieben
erweiterbar) · **Offline First ✓** (alles rein lokal, keine Netzabhängigkeit) ·
**technisches Fundament + sichtbarer Produktfortschritt parallel ✓✓**.

## Bewusste Folge-Schritte (dokumentiert)

- **Sonnenstand**: azimuth/elevation aus `EnvironmentInput.timeOfDay` +
  `orientationDeg` → Sonnenposition (Datenmodell steht bereits).
- **Fensterlicht & Schatten** der Sonne als nächste Environment-Ausbaustufe.
- **Per-Wand-/Per-Raum-Wandmaterial** (Katalog trägt es bereits; aktuell global).
- Optionale eager-Migration `coercePlan` (Legacy-Variante → id) — weiter bewusst
  lazy über die Resolver.
