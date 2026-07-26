# Architekturbericht — Bindung an den Grundriss (v41)

> Phase 3 (Integrationsphase) · **P1** · Sprint 5. Ziel: Live-Geräte direkt in der
> Wohnung anzeigen, echten Räumen zuordnen, Zustände im Grundriss visualisieren —
> eine Wohnung, ein Twin, mehrere Connectoren.

---

## Analyse-Verdikt · der Vertrag reicht, kein Core-Eingriff

Pflichtfrage zuerst: **Reicht der bestehende Vertrag für die Grundriss-Bindung?**

Befund: **Ja.** Das Domänen-Modell trägt die Bindung bereits:
- `Device.roomId?` ist laut Vertrag „refs the plan's room id" — das Feld für genau diese
  Bindung existiert.
- `Device.metadata` (`Record<string,string>`, vom Core nie interpretiert) trägt seit v40
  ein Raum-Label aus dem Connector.
- Die Runtime liefert Geräte + Updates; das Plan-Modell liefert Raum-Polygone + Namen.

Die **Zuordnung** (welches Live-Gerät → welcher Plan-Raum) und die **Visualisierung** sind
reine **App-/Render-Logik**. Kein Domänen-Konzept fehlte. **`src/domain/` bleibt in v41
unverändert** (per `grep` verifiziert).

## Architekturvarianten der Bindung (verglichen, bevor implementiert)

Auch ohne erzwungenen Core-Eingriff habe ich die Varianten gegeneinander abgewogen:

- **(A) App-Layer-Bindung — gewählt.** Eine reine Resolver-Funktion
  `resolveRoomBinding(devices, rooms, overrides)` ordnet jedes Gerät einem Plan-Raum zu:
  **Auto-Match per Raumname** (exakt, dann Token-enthält: „Flur" ↔ „Flur / Bad"), mit
  **manuellen Overrides**. Die Overrides liegen im `TwinManager` als **opake** `roomId`-
  Strings (der Manager interpretiert sie nie → bleibt planagnostisch).
  - *Pro:* kein Core-Eingriff; Connectoren müssen Plan-Räume nicht kennen; die Zuordnung
    ist überlagerbar und jederzeit änderbar; deterministisches Auto-Match überlebt
    Reconnects ohne Persistenz.
- **(B) `device.roomId` über eine neue Runtime-Methode `assignRoom()` mutieren —
  verworfen.** Hätte den Core erweitert, obwohl der App-Layer die Zuordnung sauber leisten
  kann. Die Connectoren kennen keine Plan-Räume; eine Mutation des Geräte-Zustands für
  einen reinen View-Belang verletzt die Trennung.
- **(C) Bindung im Plan-Dokument persistieren — aufgeschoben.** Würde ein Schema-Update
  erfordern; da Live-Verbindungen ohnehin keinen Reload überleben und das Auto-Match
  deterministisch neu greift, ist Persistenz vorerst unnötig (als Zukunft notiert).

## Visualisierung · 2D-Live-Grundriss (SVG), renderer-neutrale Aggregation

Bewusste Scope-Entscheidung nach Prüfung der Render-Nahtstellen:
- Das **2D-Editor-Canvas** ist imperativ (`<canvas>`) und interaktiv (Zeichnen/Editieren)
  — Live-Zustände dort einzuhängen wäre invasiv und riskant.
- Das **3D-View** ist R3F; WebGL-Screenshots flaken bei der vorgeschriebenen Playwright-
  Verifikation.

Daher: ein **dedizierter, read-only Live-Grundriss als SVG**, der **dieselbe Plan-Geometrie**
(Raum-Polygone, Wände, `extent`) nutzt — er *ist* die Wohnung, nur live und nicht editierbar.
Robust verifizierbar (DOM/SVG, kein WebGL).

Die Live-Aggregation pro Raum (`deriveRoomLiveState`) ist **renderer-neutral**: sie verdichtet
die Geräte eines Raums zu Licht (an/aus, Helligkeit, Glühfarbe), Temperatur, Feuchte,
Bewegung, Energie und Schloss — eine reine Datenform. Der SVG-Grundriss malt sie heute; ein
3D-View konsumiert **dieselbe** Funktion morgen ohne Duplizierung.

## Was die UI jetzt zeigt

- **Connector-Leiste** (aus v40): HA + MQTT gleichzeitig zu-/abschaltbar.
- **Umschalter Grundriss ⇄ Geräte.**
- **Grundriss:** die echten Raum-Polygone, je Raum eingefärbt vom Live-Lichtzustand
  (Wohnzimmer **leuchtet warm**, wenn Lichter an sind), mit Live-Zusammenfassung
  (z. B. „Licht 3/3 · 59% · 21.4 °C · 48% · 84 W" — aggregiert über **beide** Connectoren),
  Bewegungs-Puls und tippbaren Geräte-Markern (Befehl an den besitzenden Connector).
- **Geräte:** dieselbe Bindung als nach Plan-Raum gruppierte Karten, jede mit Raum-Auswahl
  (manuelles Zuordnen) und Schalt-Button.
- **„Noch nicht zugeordnet":** Geräte ohne Namens-Match (hier die „Eingang"-Geräte, die im
  Plan keinen Raum „Eingang" haben) lassen sich per Auswahl einem Raum zuweisen — die
  Bindung als sichtbare Nutzeraktion.

## Der Beweis

- **Bindungs-Resolver** (`binding.test.ts`): Auto-Match exakt + Token-enthält, Overrides,
  Unassigned-Sammlung, ungültige Overrides ignoriert.
- **Aggregation** (`binding.test.ts`): Lichter (nur *an* zählen für Helligkeit/Glühen),
  Temperatur/Feuchte/Bewegung/Energie/Schloss korrekt verdichtet; kein Glühen, wenn alles aus.
- **Manager** (`twinManager.test.ts`): manuelle Overrides erscheinen in der View.
- **Playwright:** der SVG-Grundriss rendert alle vier Plan-Räume, beide Quellen, korrekt
  „3 offen" (die nicht-gematchten Eingang-Geräte), Wohnzimmer live eingefärbt, **0 Fehler**.

## Qualitäts-Gates (erweiterte Definition of Done)

| Kriterium | Ergebnis |
|---|---|
| Build · TypeScript · ESLint 0/0 | ✅ |
| Alle Tests grün | ✅ **209** (vorher 203; +6) |
| **Kein Core-Eingriff** | ✅ `src/domain/` unverändert (per `grep`) |
| Keine Regressionen | ✅ alle bestehenden Tests grün; UI 0 Fehler |
| Herstellerneutralität · Netzwerk nur im Connector · Runtime kennt nur den Vertrag | ✅ Bindung im App-Layer, planagnostischer Manager |
| **Initial-Bundle praktisch unverändert** | ✅ **byte-identisch 99,37 KB**; Grundriss + Bindung im Lazy-`ConnectorManager`-Chunk |
| Erweiterbarkeit | ✅ Aggregation renderer-neutral → 3D übernimmt sie ohne Duplizierung |
| Sichtbarer Mehrwert | ✅ der Twin *ist* jetzt die Wohnung: Live-Zustände im Grundriss |

## Phasen (jeweils mit Gate)

1. **Analyse** — Vertrag reicht; Varianten verglichen; SVG-Scope begründet.
2. **Bindungs-Bibliothek** (`binding.ts`) — Resolver + renderer-neutrale Aggregation. Gate: Typecheck + 5 Tests.
3. **`TwinManager`** — manuelle Overrides (opak). Gate: Typecheck + 7 Twin-Tests.
4. **UI** — Live-Grundriss + Umschalter + Bindungssteuerung. Gate: Lint 0/0 · 209 Tests · Build · Bundle byte-identisch · Playwright (0 Fehler).
5. **Bericht** (dieses Dokument).

## Dateien

```
src/twin/binding.ts                 Resolver (Auto-Match + Overrides) + Raum-Live-Aggregation
src/twin/binding.test.ts            Tests (+5)
src/twin/twinManager.ts             + setBinding/clearBinding (opake Overrides) im View
src/components/connectors/LiveFloorplan.tsx   SVG-Live-Grundriss aus Plan-Geometrie
src/components/connectors/ConnectorManager.tsx  Umschalter Grundriss/Geräte + Bindung
src/connectors/*                    (unverändert seit v40; metadata.room bereits vorhanden)
```

## Bewusst aufgeschoben (mit Begründung)

- **3D-Live-Reflexion** — der nächste, klar abgegrenzte Schritt: dieselbe
  `deriveRoomLiveState` in den bestehenden 3D-Raum einspeisen (Raum-Ambiente/Boden vom
  Live-Lichtzustand tönen). Bewusst nicht in v41, weil WebGL-Screenshots die vorgeschriebene
  Verifikation unzuverlässig machen — die **renderer-neutrale Aggregation ist bereits gebaut**,
  3D wird dadurch eine kleine Folgeaufgabe.
- **Bindungs-Persistenz** über Reload (Plan-Schema) — Auto-Match greift deterministisch neu;
  Verbindungen werden ohnehin nicht serialisiert.
- **Punkt-genaue Marker** — Live-Geräte sind raumgebunden (kein x/y), daher raum-aggregierte
  Darstellung + verteilte Marker statt Plan-Koordinaten. Eine Zuordnung Live-Gerät ↔
  platziertes Plan-Gerät (mit echten Koordinaten) wäre eine eigene, größere Bindung.

## Leitlinien-Abgleich

**Digital Twin First ✓✓✓** (der größte sichtbare Sprung: Live-Zustände auf der echten
Wohnung) · **Connector First ✓✓** (zwei Connectoren speisen denselben Grundriss; der Core
unverändert) · **Quality First ✓✓** (kein erzwungener Core-Eingriff; Varianten begründet
verworfen; Aggregation renderer-neutral für 3D) · **Plugin First ✓✓** (jeder Connector mit
Raum-Label erscheint automatisch im Grundriss) · **Offline First ✓** (Simulation lokal).

## Fazit

Der Twin ist von einer Geräteliste zur **Digital-Twin-Wohnung** geworden: Live-Zustände aus
mehreren Connectoren, gebunden an die echten Plan-Räume, direkt im Grundriss sichtbar — das
Wohnzimmer leuchtet warm, wenn seine Lichter an sind, mit aggregierten Werten über HA *und*
MQTT. Und das **ohne eine Zeile im Core**: die Bindung lebt im App-Layer, die Visualisierung
im Render-Layer, die Aggregation ist renderer-neutral für den nächsten Schritt.

## Roadmap

1. **3D-Live-Reflexion** — `deriveRoomLiveState` in den bestehenden 3D-Raum einspeisen; der
   Twin live auch in 3D. Kleiner Schritt dank fertiger Aggregation.
2. **Szenen über Connectoren hinweg** — eine Aktion schaltet HA- *und* MQTT-Geräte eines
   Raums/Modus gemeinsam (Runtime routet bereits); verwertet `Energy` + v35-Sonnenstand für
   energie-/tageslichtbewusste Szenen.
3. **Live-Gerät ↔ platziertes Plan-Gerät** — punkt-genaue Marker durch Zuordnung zu den
   bereits platzierten Plan-Geräten (echte Koordinaten), inkl. Persistenz im Plan.

Empfehlung: **3D-Live-Reflexion als v42** — sie schließt das „2D *und* 3D"-Versprechen ab und
ist durch die renderer-neutrale Aggregation klein und risikoarm. Alternativ die connector-
übergreifenden Szenen (mehr Smart-Logik). Entscheidung bei Nico.
