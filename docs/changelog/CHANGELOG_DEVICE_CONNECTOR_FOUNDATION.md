# CHANGELOG — Meilenstein: Device & Connector Foundation (v36)

> Phase 2 (Digital-Twin-Entwicklung) · **P1**. Architekturauftrag des Boards: die
> **letzte tragende Domäne** des Digital Twins. Keine Herstellerintegration —
> kein Matter, kein Home Assistant, kein Tuya, kein SwitchBot. Ausschließlich die
> **renderer-, hersteller- und connector-neutrale Domäne**, auf der alle künftigen
> Integrationen aufsetzen. Damit stehen die vier Säulen: **Materials · Lighting ·
> Environment · Devices**. Leitlinie: **Connector First**, **Quality First**.

---

## Architektur — der neue Core `src/domain/`

Eine in sich geschlossene Domäne aus reinen Daten, reiner Logik und Verträgen.
Keine UI, kein Renderer, kein Hersteller, keine Netzwerktechnologie.

### Phase 1 — Device Domain (`src/domain/device.ts`)
Ein allgemeines Modell für **beliebige** Geräte:
`Device { id, connectorId, roomId?, category, name, capabilities, metadata?,
telemetry?, battery?, health }`. `category` ist eine neutrale Rolle (light, lock,
sensor, climate, camera, cover, energy, appliance, speaker, hub, other) — nie ein
Produkt oder eine Marke. `connectorId` ist ein **opaker** Verweis; der Core
erfährt nie, welches Ökosystem der Connector spricht. Helfer: `deviceHasCapability`,
`deviceCapability` (typisiert), `mergeCapabilities`.

> **Entwurfsentscheidung zu `state`:** Die Capability-Werte **sind** der
> Gerätezustand — es gibt keinen zweiten, parallelen State-Speicher, der
> auseinanderlaufen könnte. `deviceState(device)` liefert bei Bedarf eine *flache
> Projektion* aus den Capabilities (eine Sicht, kein Duplikat). Das hält die SSOT
> ein und vermeidet Drift (Quality First).

### Phase 2 — Capability Model (`src/domain/capabilities.ts`)
Geräte werden über **Fähigkeiten** beschrieben, nie über Hersteller, nie über
Vererbung. 12 neutrale Primitive: `OnOff, Brightness, ColorTemperature, Color,
Lock, Position, Temperature, Humidity, Motion, Energy, Camera, Vacuum` — jeweils
mit `access: 'read' | 'readWrite'`. Neue Gerätetypen entstehen durch
**Kombination** dieser Primitive (z. B. Leuchte = OnOff + Brightness +
ColorTemperature + Color; Heizungsthermostat = Temperature + Position). Typisierte
Helfer `findCapability<K>`, `hasCapability`, `isWritable` + Diskriminierte Union
`Capability` + Mapping `CapabilityByKind`.

### Phase 3 — Connector Domain (`src/domain/connector.ts`)
Ein **abstrakter Vertrag** — nur Interfaces, keine Implementierung, keine
Netzwerkanfrage, kein Hersteller:
`Connector { info, discover(), connect(), disconnect(), synchronize(),
subscribe(onUpdate), publish(command), health() }` plus neutrale Datentypen
`DeviceUpdate`, `DeviceCommand`, `ConnectorHealth`. Der Connector ist die
**einzige** Brücke zwischen Core und einem konkreten Ökosystem; jede Integration
implementiert ihn **außerhalb** des Core.

### Phase 4 — Digital Twin Runtime (`src/domain/runtime.ts`)
`DigitalTwinRuntime` konsumiert ausschließlich `Device`, `Capability`,
`Connector`. Reine Orchestrierung: Geräte-Registry (`setDevices`, `upsertDevice`,
`getDevice`, `listDevices`), neutrale Abfragen (`devicesInRoom`,
`devicesWith(capability)`), Merge eingehender `DeviceUpdate`s, Connector-Lebens­zyklus
(`registerConnector` adoptiert Geräte + streamt Updates, `removeConnector` trennt
+ verwirft), Befehls-Routing (`command` → Connector des besitzenden Geräts via
`connectorId`) und Beobachtung (`subscribe`). Die Runtime lernt **nie**, welches
Ökosystem ein Connector spricht.

### Phase 5 — Sichtbares Feature: Geräte-Inspektor
`src/components/devices/DeviceInspector.tsx` — ein Overlay (Toolbar-Button
„Geräte"), das **vollständig aus der Domäne** erzeugt wird:
- Zugriff ausschließlich über die **Runtime** (Zusammenfassung + Raum-Gruppierung
  via `listDevices`/`devicesInRoom`).
- Capabilities werden **dynamisch** gerendert — `CapabilityRow` schaltet allein
  auf die Capability-`kind`, **kein** Gerätetyp-Sonderfall: Helligkeit-Slider,
  Farbtemperatur-Slider + Kelvin-Swatch, Schloss-Toggle, Position-Ventil,
  Temperatur/Energie/Bewegung-Readouts.
- **Keine Herstellernamen**: neutrale Labels (Leuchte, Türschloss,
  Bewegungssensor, Steckdose, Heizungsthermostat, Hub …), Gesundheit
  (online/Signal/Batterie), Connector-Herkunft `local-plan`.
- Ein Hub ohne Endfunktion erscheint korrekt als „Infrastruktur · keine
  Fähigkeiten".

> **Adapter (App-Schicht, nicht Core):** `src/lib/deviceTwin.ts` mappt die
> platzierten Geräte des Plans → neutrale Domänen-Geräte, indem es **nur** die
> Kategorie + den Mode-State liest. `brand` / `ecosystem` / `protocol` werden
> **nie** übernommen — im Twin sind zwei Lampen verschiedener Hersteller
> ununterscheidbar. Konzeptuell ist das die Arbeit eines künftigen „lokalen"
> Connectors.

## Architekturregeln — eingehalten

| Regel | Status |
|---|---|
| Keine Herstellernamen im Core | ✅ (Core kennt nur Kategorien + Capabilities) |
| Keine Netzwerktechnologien im Core | ✅ |
| Keine Matter-/MQTT-/Alexa-/HA-Typen außerhalb künftiger Connectoren | ✅ (Core enthält keine) |
| Devices kennen keine Renderer | ✅ |
| Connectoren kennen keine UI | ✅ (nur Verträge) |
| Capability Model ist die einzige Beschreibung der Gerätefunktionen | ✅ |

## Tests

- `src/domain/capabilities.test.ts` — **4** (typisierter Lookup, Präsenz, read vs
  readWrite, Vollständigkeit der 12 Kinds).
- `src/domain/device.test.ts` — **3** (Capability-Zugriff, State-Projektion ohne
  zweiten Speicher, `mergeCapabilities` ersetzt gleiche Art / hängt neue an).
- `src/domain/runtime.test.ts` — **6** (Registry/Abfragen, Listener-Benachrichtigung,
  Update-Merge; **Fake-Connector** belegt: neues Ökosystem rein über den Vertrag,
  Update-Streaming, Befehls-Routing, sauberes Entfernen + Unsubscribe).
- `src/lib/deviceTwin.test.ts` — **6** (Licht-/Schloss-/Sensor-Ableitung, **keine**
  Marken-/Ökosystem-Felder, Mode-State-Anwendung, Fallback „other", neutrale
  Nummerierung).
- Gesamt-Testsuite **181** (vorher 162; +19).

## Validierung (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build erfolgreich | ✅ |
| TypeScript fehlerfrei | ✅ |
| ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **181** (+19) |
| Keine Regressionen | ✅ Inspektor mountet **0 Fehler**; Bestandssystem unangetastet |
| Renderer-neutral · Hersteller-neutral · Connector-neutral | ✅ |
| Performance ≥ vorher | ✅ **Initial-Bundle byte-identisch** (99,33 KB / gzip 26,74); Domäne + Inspektor vollständig im Lazy-Chunk |
| Architektur dokumentiert | ✅ (dieses Dokument) |
| Sichtbarer Produktfortschritt | ✅ Geräte-Inspektor (Playwright-verifiziert) |

## Vor dem Merge — die vier Fragen des Boards

**1. Würde dieselbe Architektur auch mit 500 Gerätetypen funktionieren?**
Ja. Geräte sind reine Daten, komponiert aus 12 Capability-Primitiven — es gibt
**keine** Klasse und **keine** Vererbung pro Gerätetyp. 500 Gerätetypen sind 500
Capability-Kombinationen und erfordern **null** zusätzlichen Code. Die Runtime
hält sie in einer Map (O(1)-Zugriff) und fragt über Capability/Raum ab; keine
Typ-Explosion.

**2. Kann ein neuer Hersteller ausschließlich durch einen Connector ergänzt werden, ohne den Core anzupassen?**
Ja — im Test belegt: der `FakeConnector` klinkt ein neues Ökosystem **allein**
durch Implementieren des `Connector`-Vertrags ein. Die Runtime adoptiert dessen
Geräte, streamt Updates und routet Befehle über `connectorId`, ohne das Ökosystem
zu kennen. Der Core wird nie berührt; die Architekturregeln verbieten
Hersteller-Typen im Core.

**3. Sind Capabilities vollständig von Herstellern entkoppelt?**
Ja. Capabilities sind ein festes, neutrales Vokabular ohne jeden Hersteller­bezug.
Der Adapter beweist es: eine Hue-Lampe, eine IKEA-Lampe und jede andere werden
zum identischen `[OnOff, Brightness, ColorTemperature, Color]`-Gerät —
ununterscheidbar. Der Inspektor zeigt ausschließlich Fähigkeiten, nie Marken.

**4. Könnte dieselbe Device-Domäne später auch von KI, Automationen, Energie­analysen und der Digital-Twin-Runtime genutzt werden?**
Ja. Die Runtime ist die **eine** Zugriffsschicht mit neutralen Abfragen
(`devicesWith(capability)`, `devicesInRoom`, `deviceState`-Projektion, `subscribe`).
Der Inspektor konsumiert sie bereits; eine Energieanalyse summiert `Energy.watts`
(im Inspektor bereits als „7 W" sichtbar), eine Automation fragt
`devicesWith('Motion')`, eine KI liest `deviceState` — alles ohne Hersteller­bezug.

Keine der vier Fragen „Nein" → Sprint vollständig.

## Zukunft — diese Architektur ermöglicht ohne Änderung

Matter · Home Assistant · MQTT · Alexa · Apple Home · Google Home · SwitchBot ·
Govee · Lockin · Tuya / Smart Life · Arenti · Osaio · zukünftige Systeme — jeweils
als **Connector**, der den vorhandenen Vertrag implementiert und neutrale
`Device`/`Capability`-Daten liefert.

## Leitlinien-Abgleich

**Connector First ✓✓** (die Säule selbst — Hersteller nur über Connectoren, Core
herstellerfrei) · **Digital Twin First ✓✓** (OmegaAtelier modelliert nun echte
Geräte, nicht nur Räume) · **Quality First ✓✓** (reine, getestete Domäne, kein
Parallel-State, keine Schuld) · **Plugin First ✓✓** (jedes Ökosystem ist ein
Plugin am Connector-Vertrag) · **Offline First ✓** (Domäne rein lokal) ·
**Fundament + sichtbares Feature parallel ✓✓**.

## Nächster Schritt

Mit dieser Domäne sind alle vier Säulen des Digital Twins gelegt. **Erst jetzt**
beginnen die eigentlichen Herstellerintegrationen — jeweils als Connector
(z. B. ein erster lokaler/`Matter`-Connector), der diesen Vertrag implementiert,
ohne den Core zu verändern.
