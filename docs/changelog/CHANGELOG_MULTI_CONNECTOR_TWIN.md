# Architekturbericht — Multi-Connector Digital Twin (v40)

> Phase 3 (Integrationsphase) · **P1** · Sprint 4. Ziel: Home Assistant **und** MQTT
> laufen **gleichzeitig in einer Runtime** und speisen **eine** Wohnungsansicht.
> Ein Twin, mehrere Connectoren, keine getrennten Ansichten mehr.

---

## Analyse-Verdikt · der Vertrag reicht, kein Core-Eingriff

Vor der Implementierung die Pflichtfrage: **Reicht der bestehende Vertrag?**

Befund: **Ja, vollständig.** Die `DigitalTwinRuntime` ist seit v36 multi-connector-fähig
und wurde in v38 gehärtet:
- pro-Connector-Maps (`connectors`, `subscriptions`, `statusUnsubs`),
- `adoptConnector` / `removeConnector(id)` arbeiten **pro Connector**,
- `command` routet über `device.connectorId` an den **richtigen** Connector,
- `subscribe` liefert einen **vereinheitlichten** Geräte-Snapshot über alle Connectoren,
- `subscribeStatus` liefert **pro-Connector** Statusereignisse (getaggt mit `connectorId`).

Die **einzige** Lücke war das Auflisten aktiver Connectoren — und das ist
**App-Layer-Sache**: die UI fügt Connectoren hinzu, kennt sie also. Eine
`listConnectors()`-Methode im Core wurde **bewusst verworfen** (siehe unten). Damit
gilt die Regel „Core nur ändern, wenn der Vertrag nachweislich nicht ausreicht":
**er reicht — `src/domain/` bleibt in v40 unverändert** (verifiziert per `grep`).

## Entscheidungen & verworfene Alternativen

### 1 · Wo lebt die geteilte Runtime? → App-Layer-Singleton `TwinManager`

Bisher erzeugte der Connector-Manager **pro Mount** eine frische Runtime (ephemer,
single-connector). Für „ein Twin, mehrere Connectoren" braucht es **eine** geteilte
Runtime.

- **Gewählt:** ein App-Layer-Singleton `twinManager()` mit *einer* `DigitalTwinRuntime`
  + Session-Registry. Persistiert über das Öffnen/Schließen des Overlays hinweg (der
  Twin bleibt live, auch wenn man die Ansicht schließt). Hängt **nur** von der Domäne ab.
- **Verworfen — React-Context-Provider:** schwerer (Provider im Baum), und der Twin
  ist konzeptuell app-global, kein View-Teilbaum. Kein Mehrwert gegenüber dem Singleton.
- **Verworfen — Zustand-Slice:** redundant. Die Runtime hat bereits ein eigenes
  Subscription-Modell (`subscribe`/`subscribeStatus`); es in Zustand zu spiegeln, würde
  zwei Wahrheiten erzeugen (gegen SSOT).

### 2 · Connector-Auflistung → App-Layer-Registry statt Core-Methode

- **Gewählt:** der `TwinManager` führt eine `sessions`-Registry (id, label, kind, health),
  gespeist aus `runtime.subscribeStatus`. Die UI liest sie.
- **Verworfen — `listConnectors()` im Core:** Die Runtime müsste ihre privaten
  Connector-Objekte preisgeben. Das ist **nicht nötig** (der App-Layer fügt sie hinzu)
  und hätte den Core ohne Zwang erweitert. Genau die Art Eingriff, die das Protokoll
  vermeidet.

### 3 · Raum-Quelle → `metadata.room` statt `roomId` oder neues Core-Feld

Die Wohnungsansicht gruppiert nach Raum. Woher kommt der Raum?

- **Gewählt:** `Device.metadata.room` — ein Feld, das der Core ausdrücklich **nie
  interpretiert** (`Record<string,string>`, „never interpreted by the core"). Connectoren
  füllen es: HA aus dem realen `area`-Konzept, MQTT aus einer Homie-`$room`-Erweiterung.
- **Verworfen — `roomId` zweckentfremden:** `roomId` referenziert laut Vertrag eine
  **Plan-Raum-ID**. Ein freies Raum-Label dort hineinzuschreiben, hätte die Semantik
  verwässert.
- **Verworfen — neues Core-Feld `room`:** unnötige Core-Änderung; `metadata` ist genau
  für solche connector-gelieferten Hinweise gedacht.

### 4 · Geräte-ID-Eindeutigkeit → disjunkte Namensräume (dokumentierte Invariante)

In **einer** Runtime werden Geräte global per `device.id` indiziert. Bei mehreren
Connectoren muss die ID **global eindeutig** sein.

- **Status quo:** HA-IDs sind domain-präfigiert (`light.*`, `lock.*`, `sensor.*` …),
  MQTT-IDs sind bare Homie-Slugs (`wohnzimmer-decke` …) — **kollisionsfrei**. Der Test
  prüft das explizit (`new Set(ids).size === ids.length`).
- **Verworfen (vorerst) — ID-Präfixierung pro Connector** (`<connectorId>:<localId>`):
  würde die Eindeutigkeit *erzwingen*, aber das Befehls-Routing berühren (der Connector
  müsste das Präfix beim `publish` wieder abstreifen, und seine internen Topic-/Entity-
  Maps anpassen). Da die beiden Referenz-Connectoren disjunkte Namensräume nutzen, ist
  es **nicht nötig**. **Dokumentiert als Invariante + künftige Härtung** für den Fall
  zweier gleichartiger Connectoren (z. B. zwei MQTT-Broker).

### 5 · UI → eine Wohnungsansicht statt getrennter Grids

- **Gewählt:** der Connector-Manager wurde zur **einen** Twin-Ansicht umgebaut: eine
  Connector-Leiste (HA + MQTT gleichzeitig zu-/abschaltbar, je eigener gepushter Status)
  über *einer* nach Räumen gruppierten Geräteansicht. Jedes Gerät trägt ein **Quellen-
  Badge** (HA/MQTT). Der `TwinManager` ist der **einzige** Abonnementpunkt der UI
  (Geräte + Sessions in einem `subscribe`).
- Die alten pro-Connector-Grids (HA-Grid bzw. MQTT-Grid getrennt) entfallen — „keine
  getrennten Ansichten mehr".

## Der Beweis

Test (`twinManager.test.ts`) und Playwright belegen dasselbe:
- **Beide Connectoren in einer Runtime:** 9 HA- + 6 MQTT-Geräte = **15 Geräte**, eindeutige
  IDs, **2 Quellen**.
- **Nach Raum gruppiert:** Wohnzimmer enthält Geräte **beider** Quellen nebeneinander
  (HA-Deckenlicht *und* MQTT-Deckenlicht), 4 Räume.
- **Isoliertes Routing:** ein Befehl an ein MQTT-Gerät erreicht den MQTT-Connector, einer
  an ein HA-Gerät den HA-Connector — unabhängig (Playwright: HA-Deckenlicht per Klick aus).
- **Isoliertes Entfernen:** MQTT trennen → **9 Geräte · 1 Quelle**, HA bleibt vollständig live.
- **Live aus beiden Quellen** gleichzeitig (`LIVE_CHANGED=true`), **0 Konsolenfehler**.

## Qualitäts-Gates (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **203** (vorher 202; +1 Integrationstest) |
| **Kein Core-Eingriff** | ✅ `src/domain/` unverändert (per `grep` verifiziert) |
| Keine Regressionen | ✅ alle bestehenden Tests grün; UI 0 Fehler |
| Herstellerneutralität · Netzwerk nur im Connector · Runtime kennt nur den Vertrag | ✅ `TwinManager` hängt nur von der Domäne ab |
| **Initial-Bundle praktisch unverändert** | ✅ **byte-identisch 99,37 KB**; HA+MQTT+Manager im Lazy-`ConnectorManager`-Chunk |
| Erweiterbarkeit | ✅ weiterer Connector = eine Katalog-Zeile; Manager bleibt unberührt |
| Sichtbarer Mehrwert | ✅ eine Wohnungsansicht über zwei Connectoren, live, mit Befehls-Routing |

## Phasen (jeweils mit Gate)

1. **Analyse** — Vertrag reicht, kein Core-Eingriff (Begründung oben).
2. **Connectoren liefern Raum** — HA `area`, MQTT `$room` → `metadata.room`. Gate: Typecheck + 17 Connector-Tests grün.
3. **`TwinManager`** — geteilte Runtime + Session-Registry. Gate: Typecheck + Integrationstest grün.
4. **UI** — eine Wohnungsansicht. Gate: Lint 0/0 · 203 Tests · Build · Bundle byte-identisch · Playwright (0 Fehler).
5. **Bericht** (dieses Dokument).

## Dateien

```
src/twin/twinManager.ts        geteilte Runtime + Session-Registry (nur Domäne)
src/twin/twinManager.test.ts   Integrationstest HA+MQTT in einer Runtime (+1)
src/components/connectors/ConnectorManager.tsx   vereinheitlichte Wohnungsansicht
src/connectors/homeAssistant/{simulatedTransport,mapping}.ts   area → metadata.room
src/connectors/mqtt/{simulatedBroker,mapping}.ts              $room → metadata.room
```

## Bewusst aufgeschoben (mit Begründung)

- **Geräte-ID-Namensräume** — Präfixierung pro Connector erst nötig bei zwei gleichartigen
  Connectoren; heute disjunkt. Als Invariante dokumentiert.
- **Bindung an den 2D/3D-Grundriss** — Live-Gerätezustände auf die *gezeichnete* Wohnung
  (Canvas-Räume) legen ist ein eigenständiges, größeres Feature (Geräte-zu-Raum-Zuordnung
  + Persistenz + Canvas-Rendering). Die jetzige Wohnungsansicht gruppiert nach connector-
  geliefertem Raum-Label — der natürliche Zwischenschritt.
- **Persistenz über Reload** — der Singleton hält den Twin über das Overlay hinweg, aber
  nicht über einen Seiten-Reload (Live-Verbindungen werden nicht serialisiert).

## Leitlinien-Abgleich

**Connector First ✓✓✓** (zwei gegensätzliche Systeme, eine Runtime, unveränderter Core) ·
**Digital Twin First ✓✓✓** (genau das Versprechen: ein einheitliches Geräte-Modell aus
heterogenen Quellen, live) · **Plugin First ✓✓** (neuer Connector = Katalog-Zeile; der
Manager ist connector-agnostisch) · **Quality First ✓✓** (kein erzwungener Core-Eingriff;
Alternativen begründet verworfen; SSOT gewahrt) · **Offline First ✓** (Simulation
vollständig lokal).

## Fazit

Das zentrale Versprechen der Plattform ist eingelöst: **ein Digital Twin, gespeist von
mehreren Connectoren gleichzeitig, in einer Wohnungsansicht** — und das **ohne eine Zeile
im Core**. Der in v36–v38 gebaute und gehärtete Vertrag trug die Vereinheitlichung
unverändert; der gesamte Multi-Connector-Code lebt im App-Layer und in den Connectoren.
Die getrennten Ansichten sind verschwunden: Wohnzimmer zeigt HA- und MQTT-Geräte
nebeneinander, jeweils quellenmarkiert, live und schaltbar.

## Roadmap

Die Plattform steht jetzt als echter Multi-Connector-Twin. Naheliegende nächste Schritte:

1. **Bindung an den Grundriss** — entdeckte Geräte den gezeichneten Räumen zuordnen und
   Live-Zustände direkt auf der 2D/3D-Wohnung darstellen. Das hebt den Twin von der
   Listen-/Kachelansicht zur räumlichen Visualisierung (verwertet v34/v35-Raumgeometrie).
2. **Szenen & Automationen über Connectoren hinweg** — eine Aktion, die HA- *und*
   MQTT-Geräte gemeinsam schaltet (die Runtime routet bereits korrekt). Verwertet die
   `Energy`-Capability + v35-Sonnenstand für energie-/tageslichtbewusste Szenen.
3. **Matter als dritter Connector** — den jetzt dreifach (Runtime, HA, MQTT) bewährten
   Vertrag gegen einen Industriestandard absichern; ID-Namensraum-Härtung würde hier
   relevant.

Empfehlung: **Bindung an den Grundriss** als v41 — sie macht aus dem vereinheitlichten
Twin die eigentliche *Digital-Twin-Wohnung* (sichtbarer Sprung) und nutzt die bereits
vorhandene Raumgeometrie. Alternativ die connector-übergreifenden Szenen (mehr „Smart"-
Logik) oder Matter (mehr Breite). Entscheidung bei Nico.
