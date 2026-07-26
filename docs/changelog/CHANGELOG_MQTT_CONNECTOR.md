# Migrationsbericht — MQTT/Homie als zweiter Connector (v39)

> Phase 3 (Integrationsphase) · **P1** · Sprint 3. Der **zweite** Connector —
> bewusst auf der **anderen Transportachse** als Home Assistant. Zweck: den in v38
> gehärteten Vertrag an einem fundamental anderen System validieren und beweisen,
> dass das Capability-Modell auch ohne eingebautes Geräteschema trägt. **Ohne jede
> Core-Änderung** — das ist der zentrale Beweis.

---

## Kandidatenwahl · warum MQTT (nicht Matter)

| Achse | Home Assistant (v37) | **MQTT (v39)** |
|---|---|---|
| Transport | Strukturierter Hub, JSON-WebSocket | **Schemaloses Pub/Sub** |
| Geräteschema | Eingebaut (Entitäten) | **Keins — muss abgeleitet werden** |
| Verbindung | Auth-Handshake | Broker-CONNACK |
| Härtetest fürs Modell | Neutralität ggü. Hub-Entitäten | **Neutralität ggü. reinen Topics** |

MQTT ist die maximale Gegenprobe: ein Transport, der **nichts** über Geräte weiß,
nur Topics und Payloads. Wenn das herstellerneutrale Capability-Modell auch hier
saubere, einheitliche Geräte erzeugt (ununterscheidbar von HA-Geräten in der UI),
ist die Architektur belastbar bewiesen. Matter (ebenfalls Capability-nah, aber
strukturiert) bleibt ein starker dritter Kandidat — MQTT testet aber die **härtere**
Achse zuerst und ist browser-real demonstrierbar.

## Konventionswahl · Homie (nicht HA-MQTT-Discovery)

Bewusst **Homie** statt HA-MQTT-Discovery: eine **offene, herstellerneutrale**
Konvention, die Geräte über *retained* Descriptor-Topics self-describing macht
(`$datatype`, `$settable`, `$unit`). Hätte ich HA-MQTT-Discovery genommen, wäre es
„HA über MQTT" gewesen — kein echter zweiter Konventionstyp. Homie zwingt eine
**eigene** Ableitungsschicht und beweist damit die Generalisierung.

## Zentrale Erkenntnis · Datentyp-Disambiguierung

Ein schemaloser Transport verlagert die Strukturarbeit in die Konventionsschicht.
Property-Namen allein genügen nicht — dieselbe `power`-Property ist je nach Datentyp
etwas völlig anderes:

| Topic | `$datatype` | `$unit` | → Capability |
|---|---|---|---|
| `…/switch/power` | `boolean` | – | **OnOff** |
| `…/switch/watts` | `float` | `W` | **Energy** |
| `…/light/brightness` | `integer` | `%` | **Brightness** |
| `…/sensor/temperature` | `float` | `°C` | **Temperature** |

Die Ableitung erfolgt über `(node, property, datatype, unit, settable)` — eine
Heuristik, kein Schema. Das ist der **Preis** der MQTT-Flexibilität und eine
ehrliche Erkenntnis: bei HA liefert der Hub die Semantik, bei MQTT muss die
Konvention sie tragen. Test: ein Gerät mit boolean `power` **und** float `watts`
ergibt korrekt OnOff **und** Energy — verifiziert.

## Validierung der v38-Härtung · gratis geerbt

Der zweite Connector bestätigt, dass sich die v38-Erweiterungen auszahlen:
- **`onStatus`** — der MQTT-Connector pusht `connecting → connected → disconnected`
  über denselben Kanal; die Runtime leitet ihn unverändert weiter (Playwright:
  „via Connector" → „via Runtime", identisch zu HA).
- **Auto-Stempel `connectorId`** — die Runtime stempelt MQTT-Geräte automatisch;
  das Befehls-Routing (`steckdose-tv` OnOff) funktioniert ohne Zutun des Connectors.

Beide wurden von HA übernommen, **ohne** sie im MQTT-Connector neu zu bauen —
genau der Zweck zentraler Vertragshärtung.

## Der zentrale Beweis · Vertrag hielt ohne Core-Änderung

```
$ grep -rE "mqtt|homie" src/domain/   →   (keine Treffer)
```

Der Core (`src/domain/`) enthält **null** MQTT/Homie-Referenzen. Der gehärtete
`Connector`-Vertrag bedient jetzt **zwei fundamental verschiedene Systeme** —
strukturierter Hub *und* schemaloses Pub/Sub — **unverändert**. Die universellen
Primitive `discover/connect/subscribe/publish/health` plus der optionale
`onStatus`-Kanal genügten beiden. Stärker lässt sich „Connector First" nicht belegen.

## Transport-Naht · eine ehrliche Beobachtung

HA und MQTT unterscheiden sich stark in der Transport-Komplexität:
- **HA**: einfache JSON-Nachrichten über WebSocket → der echte `WebSocketHaTransport`
  ist von Hand implementierbar (in v37 geschehen).
- **MQTT**: binäres Paket-Framing → gehört in einen **Standard-Client** (mqtt.js),
  nicht in eine Referenz. Daher: `MqttTransport`-Interface + voll funktionsfähiger
  In-Memory-Broker (`SimulatedMqttBroker`, echte Broker-Semantik: retained Store,
  Wildcard-Subscriptions, `…/set`-Round-Trip) für die self-contained Demo; der
  Live-Betrieb steckt einen mqtt.js-Transport in dieselbe Naht.

Die **Transport-Naht absorbiert diesen Unterschied** — der Connector und die Runtime
merken nichts davon. Das ist selbst ein Architektur-Beleg: die Abstraktionsebene sitzt
richtig.

## Sichtbarer Produktfortschritt · UI ist connector-agnostisch

Der Connector-Manager wurde **multi-connector-fähig**: ein kleiner Connector-Katalog
und eine Typ-Auswahl (Home Assistant | MQTT · Homie). Der **gesamte** restliche Ablauf
(Status, Discovery, Adoption, Live-Updates, Befehls-UI) ist **identisch** — weil beide
denselben Vertrag erfüllen. Genau das beweist die Agnostik: die UI kennt keinen
Hersteller, nur Capabilities. Playwright: MQTT entdeckt 6 neutrale Geräte (Deckenlicht,
Haustür, Bewegung Flur, Klima Wohnzimmer, Rollo Schlafzimmer, Steckdose TV), live,
`LIVE_CHANGED=true`, 0 Fehler — ununterscheidbar von der HA-Ansicht.

## Qualitäts-Gates (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **202** (vorher 196; +6) |
| **Keine Core-Änderung** | ✅ `src/domain/` enthält keine MQTT/Homie-Referenz |
| Keine Regressionen | ✅ alle bestehenden Tests grün; UI mountet 0 Fehler |
| Herstellerneutralität · Netzwerk nur im Connector · Runtime kennt nur den Vertrag | ✅ |
| Performance ≥ vorher | ✅ Initial-Bundle byte-identisch (99,37 KB); MQTT im Lazy-Chunk |
| Erweiterbarkeit | ✅ Connector-Katalog macht weitere Connectoren zur Katalog-Zeile |
| Sichtbarer Mehrwert | ✅ zweiter realer Connector, wählbar in der UI, live verifiziert |

## Dateien

```
src/connectors/mqtt/
  transport.ts          MqttTransport-Interface + Topic-Wildcard-Matcher (+/#)
  simulatedBroker.ts    In-Memory-Broker: retained, Wildcards, Live, /set-Round-Trip
  mapping.ts            Homie → Capabilities (datentyp-getrieben) + Command-Topics
  mqttConnector.ts      Connector-Implementierung über Pub/Sub
  index.ts              Barrel
  mqttConnector.test.ts End-to-End + Runtime-Adoption (+6 Tests)
src/components/connectors/ConnectorManager.tsx   multi-connector (Katalog + Typ-Auswahl)
```

## Leitlinien-Abgleich

**Connector First ✓✓✓** (zwei gegensätzliche Transports, ein unveränderter Core) ·
**Digital Twin First ✓✓** (ein einheitliches Geräte-Modell aus heterogenen Quellen) ·
**Plugin First ✓✓✓** (neuer Connector ohne Core-Berührung; UI per Katalog-Zeile
erweiterbar) · **Quality First ✓✓** (v38-Härtung wird genutzt statt dupliziert;
Transport-Naht ehrlich gezogen; Erkenntnis dokumentiert) · **Offline First ✓** (die
Simulation läuft vollständig lokal).

## Fazit

Der gehärtete Vertrag trägt jetzt **zwei fundamental verschiedene Welten** — einen
strukturierten Hub und ein schemaloses Pub/Sub-Protokoll — **ohne eine Zeile im Core**.
Das Capability-Modell hat seinen härtesten Test bestanden: aus rohen Homie-Topics
entstehen Geräte, die in der UI nicht von HA-Geräten zu unterscheiden sind. Die
Plattform ist damit als echte, vendor-neutrale Digital-Twin-Basis belegt.
