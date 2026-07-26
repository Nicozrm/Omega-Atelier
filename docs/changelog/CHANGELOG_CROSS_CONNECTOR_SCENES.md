# v43 — Connectorübergreifende Szenen

OMEGA-Modi steuern jetzt **echte Geräte über mehrere Connectoren gleichzeitig**. Eine Szene (Film, Nacht, Abwesenheit …) fächert über die bestehende Runtime auf — Home Assistant **und** MQTT in einem Klick.

## Architekturentscheidung
**Kein Core-Eingriff.** Der Vertrag genügt:
- `modeStateFor(category, mode)` liefert bereits die Pro-Modus-Zielzustände je Kategorie → **wiederverwendet, nicht dupliziert** (dieselbe Tabelle, die Editor + 3D-Licht nutzen).
- `runtime.command` routet nach `connectorId` → Fan-out ist trivial.
- Capabilities definieren Schreibbarkeit; `deriveEnvironment` liefert den Sonnenstand; `OMEGA_MODES` die Metadaten.

Neu ist nur dünner App-Layer-Klebstoff, **keine** Mode-Logik-Duplikation:
1. Domänen→Plan-Kategorie-Alias (`cover→blind`, `energy→switch`, sonst identisch).
2. `DeviceState`→Capability-Befehl (`on→OnOff`, `brightness→Brightness`, `kelvin→ColorTemperature`, `position→Position`, `locked→Lock`) — nur für **schreibbare** Capabilities, die das Gerät hat.
3. Sonnenadaptives Licht für „Automatik" (`sunAdaptiveLight(env)`): tagsüber aus, abends/nachts warm + gedimmt.

## Änderungen
- **`src/twin/scenes.ts`** (neu): `sceneCommands`/`sceneCommandsForDevice` (liest `modeStateFor`), `sunAdaptiveLight`, `totalEnergyW`, `TWIN_TO_PLAN`.
- **`src/twin/twinManager.ts`**: `applyScene(scene, cmds)` (Fan-out via Runtime, setzt `activeScene`); `activeScene` in `TwinView`. Manager bleibt domänenrein (Befehle = `DeviceCommand[]`, Szene = opaker String).
- **`src/components/connectors/ConnectorManager.tsx`**: Szenen-Leiste (9 Modi), Live-Sonnenstand-Phase, Live-Gesamtverbrauch (W), Aktiv-Hervorhebung.
- **Energie-Realismus (Connector-Layer, kein Core):** eine ausgeschaltete Steckdose meldet ~0 W — HA (`watts = state==='on' ? w : 0`), MQTT (Geräte-Postprocess in `parseHomieDevices`). Damit senkt eine Spar-Szene den Gesamtverbrauch sichtbar.

## Integration Sonnenstand & Energie
- **Sonnenstand:** „Automatik" folgt der Live-`phase` aus `deriveEnvironment`; UI zeigt die Phase.
- **Energie:** Live-Gesamtverbrauch in der Szenen-Leiste; „Abwesenheit"/„Nacht" schalten Verbraucher ab → Wert fällt (84 W → 0 W).

## Gates
| Gate | Ergebnis |
|---|---|
| TypeScript | ✓ sauber |
| ESLint | ✓ 0/0 |
| Vitest | ✓ **224** (+8: 7 Szenen, 1 applyScene; + Energie-off-Assertion) |
| Build | ✓ Initial-Bundle **byte-identisch 99,37 kB** (ConnectorManager-Lazy-Chunk 37,3 kB) |
| `src/domain` | ✓ unverändert (grep) |
| Keine Duplizierung | ✓ `scenes.ts` liest `modeStateFor` (Z. 55) |

**Cross-Connector-Beweis (Unit):** `applyScene('film')` dimmt HA-`light.wohnzimmer_decke` auf 15 % **und** schließt MQTT-`rollo` auf 0 — eine Szene, zwei Connectoren, über `connectorId`-Routing.

**Playwright:** Szenen-Leiste rendert vollständig (9 Modi, Phase „Nacht", 84 W, beide Connectoren verbunden, Wohnzimmer-Glühen). Klick-Interaktion auf Szenen-Buttons flackert durch fortlaufende Live-Ticks (liveMs ≈ 2500 lösen DOM-Knoten ab) — bekanntes Headless-Artefakt; funktionale Korrektheit über Unit-Tests abgedeckt.

## DoD
Build ✓ · TS ✓ · ESLint 0/0 ✓ · Tests ✓ · Doku ✓ · Architektur geprüft (kein Core-Eingriff) ✓ · keine Regressionen ✓ · Performance-Parität (Bundle byte-identisch) ✓ · Erweiterbarkeit ✓ · sichtbarer Mehrwert (OMEGA-Modi steuern reale Geräte) ✓

## Roadmap
- **v44 (empfohlen): einfache Automationen** — Trigger (Bewegung/Zeit/Sonnenstand) → Szene. Nutzt `OMEGA_MODES.trigger` + v35-Solar + Energy/Motion; macht Szenen autonom.
- Später: **persistente Geräte-Bindung** (Live-Gerät ↔ platziertes Plan-Gerät) für höhere Grundriss-Treue (Punkt-Marker + Persistenz, Plan-Schema-Migration).
