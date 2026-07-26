# CHANGELOG — Meilenstein: Material- & Beleuchtungs-Fundament

> Phase 2 (Produktreife) · **P1 — Fundament**. An der Plattform-Vision
> ausgerichtet: ein belastbares, **renderer-neutrales Datenmodell als Single
> Source of Truth**, auf dem alle künftigen Material-, Licht- und
> Digital-Twin-Funktionen aufbauen — ausdrücklich kein kosmetischer Patch.
> Erfüllt die Doppel-Regel: technisches Fundament **und** sichtbarer
> Produktfortschritt parallel.

---

## Ausgangslage (Analyse)

Material- und Lichtdarstellung waren **verstreut und nicht datengetrieben**:
- Räume trugen ein hartkodiertes `floorVariant`-Union (4 Werte) / `wallVariant`.
- Die Boden-Optik lebte ausschließlich in der 3D-`ensureMat()`-Funktion.
- Auswahl-Swatches waren in PropertyPanel **und** ThreeDView dupliziert.
- **Das 2D-Canvas visualisierte Materialien überhaupt nicht.**
- Es gab **keine** gemeinsame Quelle — jede Ebene definierte ihr eigenes Bild.

## Fundament — das Datenmodell (Kern des Meilensteins)

### Renderer-neutraler Material-Katalog (SSOT)
**`src/data/materials.ts`** — die einzige Quelle dafür, *welche* Oberflächen­
materialien existieren und *was sie physikalisch sind*, in renderer-agnostischen
Deskriptoren (`color`, `roughness`, `metalness`, `pattern`, `category`,
`surfaces`). Jeder Konsument liest von hier:
- 2D-Canvas → `color` + `pattern`
- 3D-View → `color` + `roughness` + `metalness` (+ Textur-Bridge für Altbestand)
- Inspector → `color` (Swatch) + `name`
- künftige Connectoren/Textur-Packs → erweitern den Deskriptor, nicht die Renderer

11 Materialien (Böden: Eiche/Nussbaum-Parkett, Vinyl hell/dunkel, Schiefer,
Feinsteinzeug, Teppich, Sichtestrich; Wände: Putz, Sichtbeton, Tapete).
Dependency-frei (kein three/React) → im Hauptbundle nutzbar.

### Vision-Regel: Flächen referenzieren Materialien **per id**
Räume betten keine visuellen Eigenschaften mehr ein, sondern zeigen auf einen
Katalog-Eintrag: neue Felder `Room.floorMaterialId` / `Room.wallMaterialId`.
Die alten `floorVariant`/`wallVariant` bleiben als `@deprecated` erhalten und
werden vom Resolver **verlustfrei** übersetzt — keine Daten-Migration nötig.

### Reiner Zugriffs-Layer
**`src/lib/materials.ts`** — `resolveFloorMaterial` / `resolveWallMaterial`
(Präzedenz: explizite id → Legacy-Variante → Default), `getMaterial`,
`materialsForSurface`. Die Auflösungsregeln leben an **genau einer** Stelle.

### Licht-Modell
**`src/lib/lighting.ts`** — `deriveRoomLighting` berechnet aus *wo Lichter
platziert sind* + *aktivem Modus* einen effektiven Raum-Lichtzustand
(`on`, `intensity`, `kelvin`, `color`, `lightCount`). Baut auf den vorhandenen
Pro-Modus-Licht-Defaults (`modeStateFor('light')`) auf — keine Duplizierung —
und übersetzt Farbtemperatur via `kelvinToHex` in eine sRGB-Farbe. Damit ist
das Modell renderer-neutral und später gegen reale Leuchten abgleichbar
(Digital-Twin-Vorbereitung).

## Sichtbares Ergebnis — „fühlt sich nach Zuhause an"

- **2D-Canvas:** Innenräume rendern jetzt ihr **Bodenmaterial** (Plankenmuster
  für Holz/Vinyl, Fliesenraster, Teppich-Webung, Sprenkel für Stein/Beton) statt
  einer flachen Tönung — plus einen **warmen/kühlen Lichtschein** je nach den
  Leuchten des Raums und dem aktiven Modus. Aus dem Blueprint werden bewohnte
  Räume. (`drawRoomFloor` in `canvasGlyphs.ts`; Außenzonen behalten das Deck.)
- **Inspector:** katalog-getriebener Material-Picker (8 Bodenmaterialien, aktiver
  Eintrag namentlich aufgelöst) ersetzt die hartkodierten Optionen.
- **3D:** Raumböden laufen über den Katalog (`matFromCatalog` + Resolver).
  Bekannte ids renutzen die bestehenden texturierten Materialien (keine
  Regression), neue Katalog-Materialien werden aus ihren Deskriptoren gebaut —
  **echte SSOT-Vereinheitlichung**.

## Tests

- `src/lib/materials.test.ts` — **10 Tests**: Katalog-Integrität (eindeutige ids,
  valide Hex/Bereiche), `getMaterial`/`materialsForSurface`, vollständige
  Resolver-Präzedenz (explizit → Legacy → Default, inkl. ungültiger ids).
- `src/lib/lighting.test.ts` — **8 Tests**: `kelvinToHex` (warm/kühl-Verhältnis,
  Clamping), `deriveRoomLighting` (unbeleuchtet, Pro-Modus-Defaults, Aus-Modus,
  Mittelung über mehrere Lichter, Geräte-/Raum-Filter).
- Gesamt-Testsuite **137** (vorher 119; +18).

## Validierung (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build erfolgreich | ✅ |
| TypeScript fehlerfrei | ✅ |
| ESLint 0/0 | ✅ |
| Tests erfolgreich | ✅ 137 (+18) |
| Dokumentation aktualisiert | ✅ |
| Architektur geprüft | ✅ (SSOT, renderer-neutral, three-frei) |
| Keine Regressionen | ✅ (3D-Texturen erhalten; 2D/Inspector Playwright-verifiziert) |
| Performance ≥ vorher | ✅ (Initial-Bundle 97 KB, unverändert) |
| Erweiterbarkeit | ✅✅ (Connector-/Textur-/Licht-Erweiterung an je einer Stelle) |

## Leitlinien-Abgleich

**Digital Twin First ✓✓** (Materialien + Licht verwandeln den Grundriss in „mein
Zuhause") · **Connector First ✓✓** (herstellerneutrales Modell, Materialien per
id referenziert — bereit für Produkt-/Textur-Connectoren) · **Quality First ✓**
(keine undokumentierte Schuld; Auflösungs-/Lichtlogik unter Test) · **Plugin
First ✓** (Katalog datengetrieben erweiterbar) · **Fundament vor Kosmetik ✓✓**
(das Datenmodell ist der Kern; die Optik ist dessen sichtbare Frucht).

## Bewusste Folge-Schritte (dokumentiert)

- 3D-**Wand**-Materialien über den Katalog vereinheitlichen (analog zu Böden).
- 3D-**Licht** aus `deriveRoomLighting` speisen (aktuell nur 2D-Schein).
- Optionale eager-Migration in `coercePlan` (Legacy-Variante → id) — derzeit
  bewusst lazy über den Resolver gelöst, kein Schema-Risiko.
