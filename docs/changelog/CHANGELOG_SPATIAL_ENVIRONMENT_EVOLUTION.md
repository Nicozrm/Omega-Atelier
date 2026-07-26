# CHANGELOG — Meilenstein: Spatial Environment Evolution (v35)

> Phase 2 (Digital-Twin-Entwicklung) · **P1**. Architekturauftrag des Boards:
> `deriveEnvironment()` wird zur **zentralen Environment-Domäne** — physikalisch
> konsistent, renderer-neutral, und Grundlage für reale Sonnenverläufe, Wetter,
> Fensterlicht, Verschattung, Energie-/Solaranalysen und spätere Smart-Home-
> Automationen. Ziel ist **nicht** „schönere Beleuchtung", sondern ein konsistentes
> Weltmodell, das jede spätere Funktion teilt. Unter der Dauerregel: kein neuer
> Code umgeht das SSOT-Material-/Lichtmodell.

---

## Ausgangslage

Das v34-`environment.ts` lieferte ein renderer-neutrales **Tag/Nacht**-Bild über
einen `daylight`-Bool. Sonne, Himmel, Wetter und Jahreszeit existierten als
Vertrags-Platzhalter, aber ohne Physik. Der Renderer wählte die Sonnenposition
noch geometrisch und schaltete Hintergrund/IBL über `daylight`-Ternaries.

## Architektur — zwei reine Module

### `src/lib/solar.ts` (neu) — physikalische Sonnengeometrie
Dependency-frei (kein THREE, kein React). Aus **Uhrzeit + Tag-im-Jahr +
Breitengrad + Orientierung** ein physikalisch sinnvolles Ergebnis:
- `solarDeclination(doy)` — jahreszeitliche Deklination (23,45°·sin-Modell).
- `solarPosition(input)` → **Azimut, Elevation, `aboveHorizon`** und ein
  **Einheits-Richtungsvektor** zur Sonne (`+X` Ost, `+Y` oben, `+Z` Süd,
  plan-ausgerichtet). Standard-NOAA-Vereinfachung (Deklination + Stundenwinkel).
- `dayOfYear(month, day)` Helfer.

Bewusst als **wiederverwendbares Primitiv** angelegt: dieselbe Position speist
heute das Licht und später **Solarertrag, Verschattung, Fensterlicht** —
unverändert. Renderer konsumieren es **nicht** direkt (sie konsumieren
`deriveEnvironment`); es ist Baustein der Domäne.

### `src/lib/environment.ts` (zur Domäne erweitert)
`deriveEnvironment(input)` ist der **einzige Einstiegspunkt**. Er komponiert aus
`solar.ts` + `kelvinToHex` (Kelvin bleibt in `lighting.ts`) den vollständigen
`EnvironmentState`:

```
EnvironmentState {
  time:   { hour, dayOfYear }
  sun:    { azimuth, elevation, aboveHorizon, direction }   // physikalisch, analysefähig
  phase:  'night'|'dawn'|'goldenHour'|'day'|'dusk'
  weather:{ condition, cloudiness }                          // 0…1
  sky:    { zenithColor, horizonColor, intensity }
  lighting: {                                                // abgeleitet, renderbar
    ambient:    { color, intensity }
    hemisphere: { skyColor, groundColor, intensity }
    sun:        { color, intensity, castShadow, shadowIntensity }
  }
}
```

- **Sonnenfarbe** aus Elevation (warm am Horizont ~2100 K → kühl im Zenit
  ~5800 K), via `kelvinToHex`.
- **Sonnenintensität & Schattenstärke** aus Elevation, durch `cloudiness`
  gedämpft/aufgeweicht; unter dem Horizont 0.
- **Himmel** aus Tageslicht-Faktor (Zenit/Horizont-Farben), mit warmem Horizont
  in Golden Hour/Dämmerung und Wetter-Entsättigung.
- **Phase** semantisch aus Elevation + Vormittag/Nachmittag.

Saubere Schichtung: die Domäne besitzt den **physikalischen Weltzustand** und
dessen **Lichterscheinung**; der Renderer nur die **Platzierung**.

## Renderer (Phasen 3 + 4) — reiner Konsument

`ThreeDView`/`Scene` konsumiert ausschließlich `deriveEnvironment()`:
- **Ambient / Hemisphere** direkt aus `env.lighting.*`.
- **Directional Sun**: Position = `env.sun.direction × SUN_DISTANCE` — **reines
  Skalieren eines Vektors, keine Trigonometrie**; Farbe/Intensität/`castShadow`
  aus `env.lighting.sun`; nur gerendert, wenn `env.sun.aboveHorizon`.
- **Shadow Intensity**: `<ContactShadows opacity={env.lighting.sun.shadowIntensity}>`
  — die Schattenstärke kommt direkt aus dem Modell.
- **Himmel-Hintergrund**: CSS-Gradient aus `env.sky.zenithColor/horizonColor`.
- **IBL-Preset**: `env.phase` → drei-Preset (reine Asset-Bindung wie der
  Material-Bridge, keine Berechnung).

Der Renderer berechnet **kein** Kelvin, **keine** Lichtfarbe/-stärke, **keine**
Sonnenposition mehr. Alle `daylight`-Ternaries sind entfernt.

## Sichtbares Produktfeature (Phase 5) — Tageszeit-Regler

Der Tag/Nacht-Schalter ist durch einen **Tageszeit-Regler (00–24 h)** ersetzt:
Sonnen-/Mond-Icon je `aboveHorizon`, Live-Readout `HH:MM · Phase`
(„12:00 · Tag", „22:00 · Nacht", „Golden Hour" …). Der Regler treibt **eine**
`deriveEnvironment`-Ableitung; Sonne, Licht, Himmel, Schatten und Hintergrund
ändern sich gemeinsam — **ohne Tricks**, allein über das geteilte Modell.

## Architekturregeln — eingehalten

| Regel | Status |
|---|---|
| Keine THREE.js-Typen außerhalb der Renderer | ✅ (`solar.ts`/`environment.ts` rein) |
| Keine Renderer-Berechnungen im Modell / keine Modell-Berechnung im Renderer | ✅ (Vektor wird nur skaliert) |
| Keine Kelvin-Berechnung außerhalb `lighting.ts` | ✅ (`environment.ts` importiert `kelvinToHex`) |
| Renderer konsumieren ausschließlich `deriveEnvironment()` | ✅ (keine Hilfsfunktionen, keine Sonderfälle) |
| Single Source of Truth eingehalten | ✅ (keine neuen Switches/Duplikate; `daylight`-Logik entfernt) |

## Tests

- `src/lib/solar.test.ts` (neu) — **8**: Deklination (Äquinoktium/Solstitien),
  Mittagssonne hoch im Süden (Elevation ≈ 90−Breite), Mitternacht unter Horizont,
  Ost-Aufgang/West-Untergang, Einheits-Richtungsvektor, Sommer höher als Winter,
  Orientierungs-Rotation des Azimuts.
- `src/lib/environment.test.ts` (neu geschrieben) — **10**: Domänen-Struktur
  (physikalische Felder über das Licht hinaus), valide Hex-Farben, Einheitsvektor,
  Tag/Nacht-Klassifikation, Golden-Hour-Phase, Nacht dunkler + Sonne aus, tiefe
  Sonne wärmer als Mittag, Overcast dämpft Sonne + weicht Schatten auf,
  Jahreszeiten (Sommer höher), Default-Aufruf.
- Gesamt-Testsuite **162** (vorher 149; +13).

## Validierung (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build erfolgreich | ✅ |
| TypeScript fehlerfrei | ✅ |
| ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **162** (+13) |
| Performance ≥ vorher | ✅ **Initial-Bundle byte-identisch** (99,33 KB / gzip 26,73), Editor-Chunk minimal kleiner — Domäne liegt im Lazy-Chunk, Render-Pfad memoisiert |
| Keine Regressionen | ✅ 3D mountet **0 Konsolen-/Page-Fehler**; Wand-/Boden-Katalog erhalten; Regler-Readout verifiziert |
| Renderer-neutral | ✅ |
| Single Source of Truth eingehalten | ✅ |
| Architektur dokumentiert | ✅ (dieses Dokument) |
| Sichtbarer Produktfortschritt | ✅ Tageszeit-Regler verwandelt die Szene sichtbar (Tag/Golden/Nacht; Playwright-verifiziert) |

## Vor dem Merge — die vier Fragen des Boards

**1. Wurde neue technische Schuld erzeugt?**
Nein — sie wurde **abgebaut**. Der `daylight`-Bool, die hartkodierten Tag/Nacht-
Hex-Werte und alle Ternaries sind aus dem Renderer verschwunden; die Sonnen-
Trigonometrie liegt zentral in `solar.ts` statt im Renderer. Reine, getestete
Module (18 neue Tests), keine THREE-Typen außerhalb der Renderer, kein Kelvin
außerhalb `lighting.ts`, keine undokumentierte Schuld.

**2. Kann dieselbe Architektur auch Wetter, Jahreszeiten und Fensterlicht aufnehmen?**
Ja — teils bereits umgesetzt. **Wetter**: `condition` + `cloudiness` sind im
Modell und modulieren schon Sonnenintensität, Schatten und Himmel; weitere
Parameter (Regen/Nebel) = zusätzliche Felder, kein Renderer-Eingriff.
**Jahreszeiten**: `date → solarDeclination → Sonnenstand` ist implementiert und
getestet (Sommersonne höher als Winter) — Jahreszeit ist also physikalisch
bereits abgebildet. **Fensterlicht**: benötigt die Sonnen-*Richtung* relativ zur
Fenstergeometrie — genau diese liefert `sun.direction` (+ azimuth/elevation) jetzt;
die Fenster-Projektion ist ein reiner Consumer der vorhandenen Domäne.

**3. Würde das Datenmodell auch mit Matter-, Home-Assistant- oder zukünftigen Connectoren funktionieren?**
Ja. Die Environment-Domäne ist **vollständig geräte- und connector-unabhängig**:
Input sind reine Weltdaten (Uhrzeit, Datum, Breitengrad, Orientierung, Wetter) —
Werte, die jeder Connector liefern kann (HA-Wetterintegration → `weather`,
Standort-Connector → `latitudeDeg`). Sie kennt keine THREE-Typen, kein React,
keine Geräte. Ein Connector **speist Inputs ein** und/oder **konsumiert den
`EnvironmentState`** (z. B. Automation „wenn `phase === 'goldenHour'` → Lichtszene") —
beides ohne Änderung an der Domäne.

**4. Ist das Environment-Modell allgemeiner geworden als der aktuelle Renderer?**
Ja, deutlich. Der `EnvironmentState` trägt physikalische Felder, die der 3D-
Renderer **nicht** nutzt: die volle Sonnen-Position (azimuth/elevation/
`aboveHorizon`) als analysefähige Größe, den `cloudiness`-Skalar, `time.dayOfYear`,
die Himmel-Intensität. Der Renderer konsumiert nur eine **Teilmenge**
(`lighting.*` + Himmel-Farben + `phase`). Künftige Solar-/Energie-/Verschattungs-
Analysen lesen denselben Zustand — das Modell ist die allgemeine Wahrheit, der
Renderer eine von mehreren Sichten.

## Leitlinien-Abgleich

**Digital Twin First ✓✓** (erstmals ein realer Tagesablauf; physikalischer
Sonnenstand statt Effekt) · **Connector First ✓✓** (geräte-/connector-unabhängige
Domäne, Input = reine Weltdaten) · **Quality First ✓✓** (Sonderfälle entfernt,
18 neue Tests, keine Schuld) · **Plugin First ✓** (Wetter/Jahreszeit/Fensterlicht
als Erweiterungen der Domäne, nicht der Renderer) · **Offline First ✓** (rein
lokal, keine Netzabhängigkeit) · **Fundament + sichtbares Feature parallel ✓✓**.

## Bewusste Folge-Schritte (dokumentiert)

- **Fensterlicht & Verschattung**: Sonnen-`direction` auf Fenster-/Wandgeometrie
  projizieren (Lichtflecken, Schlagschatten von Öffnungen).
- **Energie- & Solarpotenzial**: `solarPosition` über Tag/Jahr integrieren →
  Einstrahlung pro Fläche/Dach.
- **Wetter-Ausbau**: Regen/Nebel/Bewölkungsgrad als Atmosphärenparameter.
- **Echtzeit-/Standortbindung**: `timeOfDay`/`date`/`latitudeDeg` aus einem
  Connector statt Regler.
