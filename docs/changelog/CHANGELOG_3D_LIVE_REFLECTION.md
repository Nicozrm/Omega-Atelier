# Architekturbericht — 3D-Live-Reflexion (v42)

> Phase 3 (Integrationsphase) · **P1** · Sprint 6. Ziel: die renderer-neutrale
> `deriveRoomLiveState` unverändert auch im 3D nutzen; Räume reagieren live auf
> Licht/Temperatur/Bewegung; keine doppelte Logik zwischen 2D und 3D; dieselbe
> Runtime und dieselbe Raumaggregation wie der SVG-Grundriss.

---

## Analyse-Verdikt · die Architektur reicht, kein Core-Eingriff

Pflichtfrage: **Reicht die vorhandene Architektur, um 3D einzuklinken?**

Befund: **Ja, vollständig.** Die Bausteine existieren seit v40/v41:
- die geteilte `twinManager()`-Singleton-Runtime (eine Wahrheit, mehrere Connectoren),
- `resolveRoomBinding(devices, rooms, overrides)` (Live-Gerät → Plan-Raum),
- `deriveRoomLiveState(devices)` (renderer-neutrale Raum-Aggregation).

Der 3D-View muss **nichts Neues berechnen** — er konsumiert dieselben Funktionen wie der
SVG-Grundriss und tönt damit seine Szene. **`src/domain/` bleibt unverändert** (per `grep`).

## Die Nahtstelle

Die `Scene`-Komponente (innerhalb des `<Canvas>`) rendert bereits Umgebungslicht, die
funktionalen `RoomLights` (aus *platzierten* Geräten), Böden und Decken. Genau dort — additiv
neben `RoomLights` — sitzt die neue Schicht:

```tsx
<RoomLights devices={floor.devices} mode={doc?.activeModeKey} />
<LiveTwinReflection rooms={floor.rooms} />   // ← live aus dem Twin
```

`LiveTwinReflection` abonniert den `twinManager` **selbst** — so re-rendert bei Live-Ticks nur
diese Schicht, nicht die ganze Szene.

## Keine doppelte Logik

`LiveTwinReflection` importiert **wörtlich** dieselben Funktionen wie der 2D-Grundriss:

```ts
import { resolveRoomBinding, deriveRoomLiveState } from '@/twin/binding'
```

Pro Plan-Raum: `deriveRoomLiveState(devices)` → und die identische Datenform wird in 3D gemalt:
- **Licht:** eine Boden-Glühfläche (Polygon-Shape, Farbe = `glow`, Deckkraft ∝ Helligkeit) +
  ein **echtes Point-Light** im Raumzentrum (Farbe = `glow`, Intensität ∝ Helligkeit) — der
  Raum wird live hell, wenn seine Lichter an sind.
- **Temperatur:** eine kleine **Klima-Kugel** (Farbe kühl→neutral→warm via `climateColor`).
- **Bewegung:** ein pulsierender Marker (`useFrame`).

Neu sind nur **reine 3D-Mapping-Helfer** (`reflection.ts`: `climateColor`, `lightIntensity`,
`glowOpacity`) — frei von three.js/React, daher unit-getestet. Die eigentliche Aggregation
bleibt geteilt und unverändert.

## Verifikation · und eine ehrliche Einordnung der Grenze

| Beweis | Status |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **216** (vorher 209; +7 Reflexions-Tests) |
| **Kein Core-Eingriff** | ✅ `src/domain/` unverändert (per `grep`) |
| **Keine doppelte Logik** | ✅ 3D importiert dieselben `resolveRoomBinding` + `deriveRoomLiveState` |
| **Dieselbe Runtime** | ✅ Connectoren in der Overlay verbunden → im 3D ohne Neuverbindung live (`twinManager()`-Singleton) |
| **Initial-Bundle praktisch unverändert** | ✅ **byte-identisch 99,37 KB**; die Schicht liegt im Lazy-`ThreeDView`-Chunk |
| 3D-Laufzeit fehlerfrei | ✅ Overlay + Canvas + `useFrame` über ~13 s aktiv, **0 Konsolenfehler** |

**Grenze der Verifikation (transparent):** die headless WebGL-Umgebung (Swiftshader) rendert
die 3D-Szene nicht in einen Screenshot (schwarzes Bild bzw. Timeout) — das betrifft die
**gesamte bestehende Szene**, nicht diese Schicht. Der visuelle Beweis kommt daher aus der
**2D-Parität**: der SVG-Grundriss (v41) zeigt das Wohnzimmer warm leuchtend aus **derselben**
`deriveRoomLiveState`; da 3D exakt dieselben Daten konsumiert, ist die das 3D speisende
Information dieselbe — verifiziert. Dazu: alle neuen Mappings unit-getestet, Laufzeit
fehlerfrei, dieselbe Runtime nachweislich geteilt.

## Phasen (jeweils mit Gate)

1. **Analyse** — Nahtstelle `Scene` identifiziert; Architektur reicht; kein Core-Eingriff.
2. **Reine Mapping-Helfer** (`reflection.ts`) — Gate: Typecheck + 7 Tests.
3. **R3F-Schicht + Einklinken** (`LiveTwinReflection.tsx`) — Gate: Lint 0/0 · 216 Tests · Build · Bundle byte-identisch · 3D fehlerfrei.
4. **Bericht** (dieses Dokument).

## Dateien

```
src/twin/reflection.ts                       reine 3D-Mappings (climateColor/lightIntensity/glowOpacity)
src/twin/reflection.test.ts                  Tests (+7)
src/components/3d/LiveTwinReflection.tsx      R3F-Schicht (dieselbe Runtime + dieselbe Aggregation)
src/components/3d/ThreeDView.tsx             + <LiveTwinReflection rooms={floor.rooms}/> in Scene
src/twin/binding.ts                          unverändert (geteilt mit dem 2D-Grundriss)
```

## Leitlinien-Abgleich

**Digital Twin First ✓✓✓** (der Twin live in 2D *und* 3D, aus einer Quelle) · **Quality First
✓✓✓** (null Duplizierung — eine Aggregation für beide Renderer; reine Mappings getestet; kein
Core-Eingriff) · **Connector First ✓✓** (HA+MQTT speisen denselben 3D-Raum) · **Plugin First
✓✓** (jeder Connector mit Raum-Label erscheint automatisch auch in 3D).

---

# Strategische Bewertung · nächster Fokus

Auftrag: technischer Vergleich von **(A) persistenter Gerätebindung** (Live-Gerät ↔
platziertes Plan-Gerät) gegen **(B) connectorübergreifenden Szenen & Automationen** — welcher
Schritt bringt dem Digital Twin den größeren Mehrwert.

## (A) Persistente Gerätebindung (Live-Gerät ↔ platziertes Plan-Gerät)

**Was:** statt Live-Gerät → *Raum* eine feinere Bindung Live-Gerät → *konkretes platziertes
Plan-Gerät* (mit echten x/y-Koordinaten), persistent im Plan-Dokument. Ergebnis: punkt-genaue
Live-Marker an der exakten Geräteposition in 2D/3D.

**Technisch:**
- Neue Bindungsdimension `liveDeviceId ↔ placedDeviceId`. Das Auto-Matching ist **schwieriger**
  als der Raumname-Match: mehrere gleichartige Geräte je Raum (zwei Deckenlichter) lassen sich
  nicht eindeutig per Name zuordnen → braucht meist **manuelle** Zuordnung pro Gerät.
- **Persistenz** erfordert eine Schema-Erweiterung im Plan-Dokument (`planSchema`) inkl.
  Versionierung/Migration — App-Layer, aber es berührt die Speicher-Schicht.
- Für *echte* Punkt-Marker im 2D müsste das **imperative Editor-Canvas** angefasst werden —
  genau der invasive Teil, den v41 bewusst gemieden hat (SVG-Grundriss als read-only Schicht).
- **Risiko:** mittel-hoch (Persistenz-Migration + Zuordnungs-UX + Eingriff ins Editor-Canvas).
- **Mehrwert:** höhere räumliche Treue („genau diese Lampe ist an"), aber **keine neue
  Fähigkeit** — der Twin zeigt bereits Live-Zustände je Raum. Zudem setzt eine 1:1-Zuordnung
  voraus, dass der Plan exakt das reale Zuhause abbildet, was selten zutrifft.

## (B) Connectorübergreifende Szenen & Automationen

**Was:** eine benannte Szene = Zielzustände über Geräte **mehrerer** Connectoren, mit *einer*
Aktion angewandt (z. B. „Film": Wohnzimmer-Licht dimmen [HA] + Rollo schließen [MQTT]).
Automationen = Auslöser (Bewegung/Zeit/Sonnenstand) → Szene.

**Technisch:**
- Die Runtime **routet Befehle bereits** korrekt nach `connectorId`. Eine Szene anzuwenden ist
  also ein **trivialer Fan-out**: `for (target of scene.targets) manager.command(target)` —
  HA- und MQTT-Ziele landen automatisch beim richtigen Connector. **Kein Core-Eingriff.**
- „Aktuellen Zustand als Szene sichern" liest einfach die Capabilities der Twin-View → Ziele.
- **Starker Anschluss an Vorhandenes:** die App hat bereits **OMEGA-Modi** (`film`, `night`,
  `relax`, `party` …) mit `modeState` je platziertem Gerät — heute beeinflussen sie nur die
  3D-Visualisierung. Szenen würden diese **schlafenden Modi an echte Geräte** koppeln. Dazu
  `Energy`-Capability + v35-Sonnenstand für tageslicht-/energiebewusste Automationen.
- **Risiko:** niedrig-mittel (Befehls-Fan-out trivial; Umfang = Szenen-Modell + UI +
  einfache Auslöser; Szenen-Persistenz klein, ggf. über die bestehenden Modi).
- **Mehrwert:** eine **neue Fähigkeit** — der Twin wird von *beobachtbar* zu *steuerbar* über
  Connectoren hinweg. Eine Aktion orchestriert HA + MQTT gemeinsam.

## Empfehlung · (B) Szenen & Automationen bringt den größeren Mehrwert

Begründung:
1. **Neue Fähigkeit statt Verfeinerung.** (B) macht den Twin *handlungsfähig* (Observability →
   Controllability über Connectoren). (A) verbessert nur die Darstellungstreue.
2. **Geringeres Risiko, mehr Hebel auf Vorhandenem.** (B) nutzt das bereits gelöste
   Befehls-Routing, reaktiviert die toten OMEGA-Modi und verwertet v35-Sonnenstand/`Energy`.
   (A) bringt Persistenz-Migration und einen Eingriff ins gemiedene Editor-Canvas.
3. **Es beweist die Plattform-These am stärksten:** *eine Aktion, mehrere Connectoren,
   orchestriert* — der Kern von „Connector First" + „Digital Twin First".

Die persistente Gerätebindung bleibt ein sinnvoller **späterer Verfeinerungsschritt**
(punkt-genaue Marker), sobald die Wohnung handlungsfähig ist.

## Roadmap

1. **v43 — Connectorübergreifende Szenen** (Empfehlung): Szenen-Modell + Fan-out über die
   Runtime; bestehende OMEGA-Modi an echte Geräte koppeln; „Zustand als Szene sichern".
2. **v44 — Einfache Automationen:** Auslöser Bewegung/Zeit/Sonnenstand (v35) → Szene;
   energie-/tageslichtbewusst über die `Energy`-Capability.
3. **später — Persistente Gerätebindung:** Live-Gerät ↔ platziertes Plan-Gerät + Persistenz im
   Plan, für punkt-genaue Marker in 2D/3D.

Entscheidung bei Nico.
