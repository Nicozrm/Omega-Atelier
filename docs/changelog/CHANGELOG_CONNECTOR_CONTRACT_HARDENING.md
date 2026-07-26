# Migrationsbericht — Connector Contract Hardening (v38)

> Phase 3 (Integrationsphase) · **P1**. Dies ist eine **bewusste, begründete
> Core-Änderung** — genau der Pfad, den das Board in v37 vorgesehen hat
> („Änderungen am Core zuerst dokumentieren und begründen"). Die zwei Schwächen
> wurden in der v37-Referenzimplementierung entdeckt und dort als Empfehlungen
> festgehalten; sie werden **jetzt zentral behoben, bevor weitere Connectoren
> entstehen** (saubere Architektur vor Connector-Nachschub).

---

## Motivation

Die HA-Referenz (v37) trug **ohne** Core-Änderung — der Beweis, dass die
Architektur funktioniert. Dabei traten zwei konkrete Schwächen zutage:

1. **Kein Connector-Status-Stream.** Verbindungsabbruch/Reconnect war nur per
   **Polling** von `health()` beobachtbar — ein echtes Socket bricht aber jederzeit
   asynchron ab.
2. **`connectorId`-Stempelung war Connector-Pflicht.** Vergaß ein Connector,
   `Device.connectorId = info.id` zu setzen, brach das Befehls-Routing **still**.

Beide sind generisch (kein Hersteller-, kein Netzwerkthema) und betreffen **jeden**
künftigen Connector → die richtige Ebene ist der Core, einmalig.

## Änderung 1 · Optionaler Connector-Status-Kanal (`onStatus`)

**Vertrag** (`src/domain/connector.ts`): das `Connector`-Interface erhält eine
**optionale** Methode

```ts
onStatus?(listener: (health: ConnectorHealth) => void): Unsubscribe
```

Connectoren, die Verbindungswechsel erkennen können, **pushen** sie hier statt
Polling zu erzwingen. **Optional**, daher vollständig rückwärtskompatibel:
bestehende Connectoren ohne `onStatus` erfüllen das Interface unverändert; die
Runtime fällt auf `health()`-Snapshots zurück.

**Runtime** (`src/domain/runtime.ts`): neue Beobachtung für Konsumenten

```ts
subscribeStatus(listener: (event: ConnectorStatusEvent) => void): Unsubscribe
//   ConnectorStatusEvent = { connectorId, health }
```

Die Runtime abonniert beim Adoptieren den `onStatus`-Kanal jedes Connectors (sofern
vorhanden) und leitet die Ereignisse — **getaggt mit `connectorId`** — an UI/AI/
Automationen weiter. `removeConnector` sendet ein abschließendes `disconnected`-
Ereignis und stoppt die Weiterleitung.

**Referenz-Connector** (`homeAssistantConnector.ts`): implementiert `onStatus` und
leitet **alle** Übergänge (connecting → connected → disconnected → error) über ein
push-fähiges `setStatus`. (Verhalten von `health()`/discover/publish unverändert.)

## Änderung 2 · Auto-Stempel `connectorId` in der Runtime

`registerConnector`/`adoptConnector` stempeln jedes adoptierte Gerät mit der ID des
besitzenden Connectors:

```ts
private stamp(device, connectorId) {
  return device.connectorId === connectorId ? device : { ...device, connectorId }
}
```

Die Runtime **kennt** beim Adoptieren den Ursprungs-Connector — sie korrigiert die
ID, sodass ein Connector-Autor das Routing nicht mehr still brechen kann. Kein
Churn, wenn die ID bereits korrekt ist (wie beim HA-Connector). Lokale Geräte
(`setDevices`/`upsertDevice`, z. B. `local-plan`) bleiben unangetastet — gestempelt
wird **nur** beim Connector-Adoptieren.

## Begleitende Refaktorierung · `adoptConnector`

`registerConnector` baut nun auf einer neuen, niedrigeren Methode auf:

```ts
async registerConnector(c)  // connect → discover → adoptConnector
adoptConnector(c, devices)  // store + stamp + wire updates + wire status (kein reconnect)
```

`adoptConnector` adoptiert einen **bereits verbundenen** Connector ohne erneutes
`connect()`/`discover()` — nötig für UI-Assistenten (verbinden → entdecken →
übernehmen), die ein Live-Transport nicht doppelt öffnen dürfen. `registerConnector`
bleibt der bequeme Bund; beide stempeln + leiten Status weiter. **Keine API
entfernt** — rein additiv.

## Rückwärtskompatibilität

| Aspekt | Bewertung |
|---|---|
| `onStatus` optional | ✅ Bestehende Connectoren ohne ihn erfüllen das Interface; Runtime nutzt `health()`-Fallback |
| Auto-Stempel | ✅ Additiv; korrekt gestempelte Geräte (HA) unverändert; lokale Geräte unberührt |
| `registerConnector`-Signatur | ✅ Unverändert; intern auf `adoptConnector` umgestellt |
| v37-Tests | ✅ Alle grün ohne Anpassung (kein Regress durch das Refactoring) |
| HA-Connector-Verhalten | ✅ `health()`/discover/publish identisch; nur `onStatus`-Push ergänzt |

## Bewährt sich der Vertrag weiterhin für Matter / MQTT / zukünftige Systeme?

Ja — beide Verbesserungen sind **generisch** und nützen jedem Connector:
- Matter: Subscription-Verlust / Reconnect → `onStatus`. Nodes → Geräte werden
  automatisch korrekt gestempelt.
- MQTT: Broker-Disconnect (LWT) → `onStatus`. Topics → Geräte gestempelt.
- Cloud (SwitchBot/Tuya/Govee): Token-Ablauf / Webhook-Verlust → `onStatus`.

Die universellen Primitive `discover/connect/subscribe/publish/health` bleiben; der
optionale `onStatus`-Kanal ergänzt sie sauber, ohne Pflicht.

## Qualitäts-Gates (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **196** (vorher 191; +5) |
| Keine Regressionen | ✅ v37-Tests unverändert grün; UI mountet **0 Fehler** |
| **Core-Änderung dokumentiert & begründet** | ✅ (dieses Dokument) |
| Core bleibt herstellerneutral · Netzwerk nur im Connector · Runtime kennt nur den Vertrag | ✅ (die Ergänzungen sind herstellerneutrale Primitive) |
| Performance ≥ vorher | ✅ Initial-Bundle byte-identisch (99,37 KB); Connector-Logik im Lazy-Chunk |
| Sichtbarer Produktfortschritt | ✅ **gepushtes Statusereignis-Log** im Connector-Manager (Playwright-verifiziert: `connecting`→`connected` *via Connector*, danach *via Runtime*; Adoption über `adoptConnector`; `LIVE_CHANGED=true`) |

## Erweiterte Validierung — die Pflichtfragen

- **Musste der Core verändert werden?** **Ja** — die zwei oben begründeten,
  rückwärtskompatiblen Erweiterungen. Bewusst und zentral, *bevor* sich Connectoren
  vervielfachen.
- **Warum?** Beide Schwächen sind generisch (Verbindungsgesundheit, Routing-Sicherheit)
  und betreffen jeden Connector — eine Lösung pro Connector wäre Duplizierung und
  Schuld (gegen Quality First).
- **Vertrag weiterhin allgemein?** Ja (siehe oben) — die Primitive bleiben, der
  Status-Kanal ist optional und herstellerneutral.

## Bewusst aufgeschoben (mit Begründung)

Aus dem v37-Bericht **nicht** in diesem Sprint adressiert, da geringfügig/kontextabhängig
und nicht blockierend für weitere Connectoren:
- **Ein Subscriber pro Connector** — funktioniert über die Schichtung (Runtime =
  alleiniger Konsument, UI liest über die Runtime). Bei echtem Mehrbedarf später
  Multi-Subscriber.
- **`publish` ohne direkten Ack** — Folgezustand kommt über `subscribe` zurück.
- **`DeviceCommand.payload` lose typisiert** — bei wachsender Befehlsfläche später
  eine Pro-Capability-Command-Union.

## Leitlinien-Abgleich

**Connector First ✓✓** (der Vertrag wird gehärtet, ohne herstellerspezifisch zu
werden) · **Quality First ✓✓** (Schwächen zentral behoben statt pro Connector
dupliziert; rückwärtskompatibel; dokumentiert) · **Digital Twin First ✓✓**
(ereignisbasierte Verbindungsgesundheit für die Runtime) · **Plugin First ✓✓**
(jeder künftige Connector erbt die Verbesserungen ohne Mehraufwand).

## Fazit

Der Vertrag ist nun **gehärtet**: ereignisbasierte Verbindungsgesundheit und eine
narrensichere Routing-Stempelung — beide herstellerneutral, rückwärtskompatibel und
zentral. Die Plattform ist bereit für den **zweiten** Connector (Matter oder MQTT),
der jetzt auf einem belastbareren Vertrag aufsetzt.
