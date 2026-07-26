# Abschlussbericht — Connector Reference Implementation (v37)

> Phase 3 (Integrationsphase), Sprint 1 · **P1**. Ziel war **nicht**, viele
> Systeme anzubinden, sondern die Device-/Connector-Architektur durch **eine**
> vollständige Referenzimplementierung zu **validieren**. Dieser Bericht ist
> bewusst keine Featureliste, sondern eine kritische Architekturbewertung.

---

## 1 · Kandidatenanalyse & Entscheidung

Bewertet wurden alle acht Kandidaten nach Architekturpassung, Doku, Stabilität,
Erweiterbarkeit, Referenz-Eignung und Langfristnutzen (Skala 1–5):

| Kandidat | Arch | Doku | Stab | Erw | Ref | Langfr | Σ |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **Home Assistant** | 5 | 5 | 5 | 5 | **5** | 4 | **29** |
| Matter | 5 | 4 | 4 | 5 | 3 | 5 | 26 |
| MQTT | 3 | 4 | 4 | 4 | 3 | 4 | 22 |
| SwitchBot | 3 | 4 | 3 | 3 | 3 | 3 | 19 |
| Alexa | 2 | 3 | 4 | 3 | 2 | 3 | 17 |
| Tuya / Smart Life | 2 | 3 | 3 | 3 | 2 | 3 | 16 |
| Govee | 2 | 3 | 3 | 2 | 2 | 2 | 14 |
| Lockin | 1 | 1 | 2 | 1 | 1 | 2 | 8 |

**Entscheidung: Home Assistant** — nicht nach Popularität, sondern weil seine
WebSocket-API die sauberste reale Verkörperung **unseres** Vertrags ist
(`get_states`→`discover`, `subscribe_events`/`state_changed`→`subscribe`-Stream,
`call_service`→`publish`), weil HA selbst herstelleragnostisch ist und damit die
**Neutralität maximal stresstestet**, und weil das Protokoll für eine **autarke,
testbare Demo** simulierbar ist. Matter ist langfristig am wertvollsten, aber als
*erste* Referenz schwach (Commissioning braucht BLE/Thread/mDNS + nativen
Controller, im Browser nicht demonstrierbar). Das hier etablierte Muster
(connect → auth → discover → live-stream → Mapping) ist identisch zu dem, was
Matter/MQTT/Cloud später brauchen.

## 2 · Architektur der Umsetzung

Neuer Namespace `src/connectors/homeAssistant/` — **vollständig außerhalb des
Core**:

- **`transport.ts`** — `HaTransport`-Interface + `WebSocketHaTransport` (echter
  Browser-WebSocket). **Die einzige Stelle mit Netzwerklogik**, im Connector-Modul.
- **`simulatedTransport.ts`** — In-Memory-HA-Backend, spricht die **echten**
  HA-Nachrichtenformen (auth_required → auth_ok, get_states, subscribe_events +
  state_changed, call_service) und treibt autonome Live-Events. Macht Referenz +
  Tests **ohne** reale HA-Instanz lauffähig; derselbe Connector-Code läuft mit
  `WebSocketHaTransport` gegen echtes HA.
- **`mapping.ts`** — das **gesamte** herstellerspezifische Wissen: HA-Entitäten +
  Attribute → neutrale Capabilities; neutrale Commands → `call_service`.
- **`homeAssistantConnector.ts`** — implementiert **ausschließlich** das
  bestehende `Connector`-Interface (Auth-Handshake, ID-Korrelation der Results,
  Event-Routing). Transport injiziert.

**Sichtbares Feature** `src/components/connectors/ConnectorManager.tsx`: Connector
hinzufügen (Simulation oder Live mit URL+Token) → Verbindungsstatus → Geräte
entdecken → in den Digital Twin übernehmen → **Capability-Zustände live**. Fokus
auf Discovery/Synchronisation/Runtime, nicht auf komplexe Steuerung.

## 3 · Erweiterte Validierung — die Pflichtfragen

**Musste der Core verändert werden?** **Nein.** Kein einziger Edit in `src/domain/`.
Der Connector implementiert nur das vorhandene Interface; die Runtime adoptierte
ihn über `registerConnector` und routete Befehle über `connectorId` — ohne
jegliches Herstellerwissen. Das ist der zentrale Beweis dieses Sprints.

**Wenn ja, warum?** Entfällt. (Vorschläge zur *künftigen* Härtung siehe §5 — diese
sind dokumentiert, nicht umgesetzt.)

**Kann derselbe Vertrag unverändert auch Matter, Home Assistant, MQTT und
zukünftige Systeme bedienen?** Ja. Die Verben bilden 1:1 ab:
- **Matter:** discover = kommissionierte Nodes · connect = Controller-Session ·
  subscribe = Attribut-Subscriptions · publish = Cluster-Commands · Cluster →
  Capabilities.
- **MQTT:** discover = Discovery-/Retained-Topics · subscribe = Topic-Subscriptions ·
  publish = Command-Topics.
- **Cloud (SwitchBot/Tuya/Govee):** discover = Geräte-Endpoint · subscribe =
  Webhook/Polling · publish = Command-Endpoint.
`discover/connect/subscribe/publish/health` sind die universellen
Integrationsprimitive — bestätigt.

**Welche Teile des Vertrags haben sich bewährt?**
- Das **Capability-Modell als neutrale Zwischensprache** — HAs heterogene
  Entitäten kollabierten sauber in die 12 Primitive, kein Pro-Hersteller-Sonderfall.
- **`DeviceUpdate` + `mergeCapabilities`** (gleiche Art ersetzt) — ideal für
  state_changed-Streams.
- **`subscribe(onUpdate): Unsubscribe`** — direkte Entsprechung zu
  Event-Subscriptions, sauberes Teardown.
- **`connectorId`-Routing** — Befehle landen ohne Herstellerwissen beim richtigen
  Connector.
- **Transport-Injektion** (Designentscheidung, nicht Teil des Vertrags) — belegt,
  dass Connector-Logik transportagnostisch + isoliert testbar ist. Empfehlung als
  Muster für alle künftigen Connectoren.

**Welche Schwächen wurden entdeckt?** (ehrlich, beim realen Bau aufgefallen)
1. **Kein Connector-Status-Stream.** Geräte-Health wird per `DeviceUpdate.health`
   gepusht, aber ein **Connector**-Ereignis (gesamte Verbindung abgerissen /
   reconnectet) ist nur per **Polling** von `health()` beobachtbar. Ein echtes
   Socket kann jederzeit abbrechen — Runtime/UI sollten das **gepusht** bekommen.
2. **Ein Subscriber pro Connector.** `subscribe` setzt einen einzelnen
   `onUpdate`; ein zweiter Aufruf überschreibt ihn. Für „Runtime = alleiniger
   Konsument" ok, aber eine scharfe Kante.
3. **`connectorId`-Stempelung ist Connector-Pflicht.** Jeder Connector muss
   `Device.connectorId = info.id` setzen, sonst bricht das Befehls-Routing **still**.
   Die Runtime kennt beim Adoptieren den Ursprungs-Connector und könnte den Stempel
   **automatisch** setzen.
4. **`publish` liefert `void`** (kein Command-Ack). Vertretbar, da der Folgezustand
   über `subscribe` zurückkommt (Round-Trip schließt über den Event-Stream, wie die
   Demo zeigt), aber kein direkter Ack für optimistische UIs.
5. **`DeviceCommand.payload` lose typisiert** (`Record<string, …>`) — flexibel, aber
   eine Pro-Capability-Command-Union wäre sicherer.
6. **Keine Capability-granulare Verfügbarkeit** (nur ganzes Gerät online/offline) —
   für „1 HA-Entität ≈ 1 Gerät" unkritisch, relevant erst bei aggregierenden Geräten.

## 4 · Qualitäts-Gates (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **191** (vorher 181; +10) |
| Keine Regressionen | ✅ Manager mountet **0 Fehler**, Bestandsfeatures unberührt |
| **Core unverändert** | ✅ **0 Edits** in `src/domain/` |
| Hersteller nur im Connector · Netzwerk nur im Connector · Runtime kennt nur den Vertrag | ✅ |
| Performance ≥ vorher | ✅ Initial-Bundle praktisch unverändert (99,37 KB); Connector + Simulator vollständig im eigenen Lazy-Chunk (21,9 KB) |
| Sichtbarer Produktfortschritt | ✅ Connector-Manager, Playwright-verifiziert (Verbinden → Discovery → Adoption → **Live-Updates**, `LIVE_CHANGED=true`) |

## 5 · Empfehlungen vor weiteren Connectoren (priorisiert)

Saubere Architektur hat Vorrang vor schnellem Connector-Nachschub. **Vor** Matter/MQTT
empfehle ich einen fokussierten „Contract-Hardening"-Schritt:

1. **Connector-Status-Ereignis** (`onStatus(cb)` bzw. Status-Kanal) — ereignis­basierte
   Verbindungsgesundheit + Reconnect. *Höchster Wert; für robuste Netz-Connectoren nötig.*
2. **`connectorId` automatisch in `registerConnector` stempeln** — entfernt die stille
   Routing-Falle (kleine, sichere Core-Erweiterung).

Beide sind **Core-berührend** und daher hier bewusst **nur dokumentiert, nicht
umgesetzt** (der Sprint sollte über die vorhandenen Verträge gelingen — das tat er).
Punkte 4–6 aus §3 sind geringfügig/kontextabhängig und können bei Bedarf später
adressiert werden.

## 6 · Leitlinien-Abgleich

**Connector First ✓✓** (Hersteller ausschließlich im Connector, Core neutral,
durch reale Implementierung bewiesen) · **Digital Twin First ✓✓** (echte Geräte
fließen live in die Runtime) · **Plugin First ✓✓** (HA ist ein Plugin am
Connector-Vertrag; weitere folgen identisch) · **Offline First ✓** (Simulation
vollständig lokal; reale Verbindung optional) · **Quality First ✓✓** (kritische
Bewertung statt Featureliste; Schwächen offen benannt; Core unangetastet).

## 7 · Fazit

Die Architektur ist eine **langfristig tragfähige Integrationsplattform**: Der
Vertrag trug eine vollständige, reale Referenzintegration **ohne eine einzige
Core-Änderung**. Die einzige substanzielle Lücke (ereignisbasierter
Connector-Status) ist klein, gut verstanden und sollte **einmal, zentral** behoben
werden, bevor weitere Connectoren entstehen — genau die Art Erkenntnis, für die
dieser Referenz-Sprint gedacht war.
