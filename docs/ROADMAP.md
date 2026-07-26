# OMEGA Atelier 2.0 — Roadmap

> Ehrliche Planungsgrundlage, geordnet nach Horizonten statt nach erfundenen
> Terminen. Jeder Punkt baut auf dem *tatsächlichen* Stand des Codes auf
> (siehe `ARCHITECTURE.md`). Reihenfolge innerhalb eines Horizonts =
> Priorität. Erledigtes wandert in die Basis-Tabelle, damit die Roadmap
> gleichzeitig Inventar ist.

---

## Basis — was heute steht

| Bereich | Stand |
| --- | --- |
| 2D-Editor | Grundriss mit Wänden/Türen/Fenstern, Räumen, Geräten, Möbeln, Labels, Ebenen, Snapping, Undo |
| 3D-Renderer | Photorealistisches Archviz-Rendering: PBR-Materialien, IBL, Soft Shadows, Glas/Clearcoat, Tag/Nacht-Umgebungsmodell mit echtem Sonnenstand, Golden Hour, Wetter |
| Cinematic | CinematicDirector mit Kamerafahrten im 3D-Modus |
| Digital Twin | Herstellerneutraler Kern (Capabilities · Device · Connector-Vertrag · Runtime), Multi-Connector-Betrieb, Szenen über Connector-Grenzen |
| Connectors | Home Assistant **live** (WebSocket + Token), Home Assistant Demo, MQTT (Homie), **30 Ökosysteme** (Hue, IKEA, Aqara, Tuya, Matter, Alexa, …) als voll funktionale simulierte Quellen |
| Saugroboter | `/robot`: LiDAR-Karte aus dem echten Grundriss, Serpentinen-Planung, Alles/Raum/Zone, Saugstufen, Akku/Fläche/Dauer live, Dock mit Auto-Entleerung — gesteuert über echte `Vacuum`-Connector-Kommandos (Tuya S8) |
| SaaS-Gerüst | Supabase Auth (optional, local-first), Cloud-Sync für Pläne mit Optimistic Locking, Plan-Galerie, Dashboard |
| Qualität | 289 Vitest-Tests (Domain, Connectors, Stores), Typecheck strict, PWA mit Chunk-Recovery, A11y-Pass, Hell/Dunkel-Theme durchgängig |

---

## Horizont 0 — Politur auf „Apple-Niveau“ (vom Nutzer vorgegeben)

Keine neuen Features — die obsessive Perfektionierung des Bestehenden, in
fünf Vektoren. Reihenfolge = schnellste Realisierbarkeit ohne
WebGL-Performance-Risiko.

1. **Fluid Interfaces & Spring Physics.** Keine linearen/ease-in-out-
   Transitions mehr: massenbasierte Feder-Modelle mit Gewicht, Trägheit und
   subtilem Rebound. Umsetzung ohne Animations-Bibliothek: ein
   Damped-Oscillator-Solver rendert Federn einmalig in native CSS-`linear()`-
   Kurven (`src/lib/motion.ts`) — Compositor-only, null Kosten pro Frame.
   *Status: Fundament + Buttons/Chips/Tabs/Switch/Toasts umgesetzt; offen:
   Panel-/Sheet-Übergänge im Editor, 2D↔3D-Wechsel.*
2. **Predictive State & Graceful Degradation.** Latenz maskieren: kein roher
   Ladebalken, kein hartes Fehler-Popup. Pending-Kommandos glühen im sanften
   bernsteinfarbenen Puls („Suche/Verbinde“), endgültige Fehler morphen
   geschmeidig in den Error-State (+ Haptik auf Mobile).
   *Status: umgesetzt — `TwinManager.command()` trackt jedes Kommando
   (Bestätigung über Capability-Echo, Timeout, Transport-Reject), DeviceCards
   und Robot-Steuerung rendern Puls/„Keine Antwort“-Morph, Vibration bei
   endgültigem Fehlschlag; offen: Puls auf den Grundriss-Icons im Editor.*
3. **Micro-Auditory Feedback.** Extrem subtile, asynchrone Sound-Architektur
   (WebAudio, synthetisiert, keine Assets): satter „Thud“ beim Snap-to-Grid,
   warmes analoges Klicken beim OMEGA-Modus-Wechsel, kaum hörbares Swell beim
   volumetrischen Licht. Erst nach User-Geste aktiv (Autoplay-Policy),
   abschaltbar in den Einstellungen.
   *Status: umgesetzt — `src/lib/sound.ts` (drei synthetisierte Voices,
   Gesture-Unlock, Master −13 dB), Thud beim Snap-Commit im Canvas, Click/
   Swell auf Modus-Chips (Dashboard + Editor) und Theme-Wechsel, „Töne an/
   Stumm“-Toggle in den Einstellungen; offen: Feintuning der Pegel am realen
   Gerät.*
4. **Kamera-Choreografie & Contextual Awareness.** Kein harter Cut bei
   Etagen-/Raumwechsel: interpolierte Kamerapfade mit De-zeleration, Dach als
   Alpha-Fade, Depth-of-Field zieht auf das gewählte Objekt. Baut auf dem
   CinematicDirector auf; als einziger Vektor mit echtem WebGL-Budget (DOF).
   *Status: umgesetzt — kontextuelles DOF im High-Tier-Composer (Fokusebene
   folgt dem Orbit-Target, Raumflüge ziehen den Fokus mit Sinus-Profil,
   Kino-Tour hält moderaten Steadicam-Fokus, Walk-Mode atmet auf 0),
   Decken-Alpha-Fade statt hartem Mount beim Walk-Wechsel, dt-Clamp gegen
   Jank-Teleports in Flügen; offen: Wand-Fade beim Durchflug.*
5. **Typografische & Sub-Pixel-Strenge + volle Individualisierung.** Optische
   statt maschineller Zentrierung von Icon-Text-Paaren, plus die vom Nutzer
   geforderte komplette Gestaltbarkeit: **jedes Möbel** in mehr Farben/
   Materialien, **jeder Raum** in Boden, Wand *und* Decke — einzeln.
   *Status: umgesetzt — Möbel-Oberflächen erweitert (Stoff Salbei/Terrakotta/
   Anthrazit, Leder Cognac; Holz Esche/Dunkel/Weiß-lasiert, via getönten,
   gecachten Material-Klonen), mehr Möbeltypen bekommen Slots; Räume sind im
   3D-Material-Panel (FÜR-Selektor: Alle Räume / einzelner Raum → Boden/Wand/
   Decke) und im 2D-Property-Panel je Fläche einzeln stylbar, persistent im
   Dokument (undoable, 2D↔3D-Sync); Per-Raum-Wandbemalung im Renderer über
   Kanten-Nähe; `.icon-optical` für optische Zentrierung; offen: variable
   Font-Weights gegen Halation, freie Farbwahl per Picker.*

## Horizont 1 — „Wirklich in echt“

Das erklärte Ziel: aus simulierten Quellen werden reale.

1. **Tuya Cloud Connector (real).** ✅ *Umgesetzt.* Vollständige, signierte
   OpenAPI-v2-Anbindung: HMAC-SHA256-Signierung (`signing.ts`, gegen
   RFC-4231-/SHA-256-Vektoren getestet), Token-Grant + Refresh, Device-Liste,
   Status-Polling, Command-POST. Tuya-Datenmodell ⇄ neutrale Capabilities
   (`mapping.ts`: Licht/Steckdose/Sensor/Schloss/Rollo/Kamera/Sauger).
   Transport injiziert (`HttpTuyaTransport` real, `SimulatedTuyaTransport` für
   Demo/Tests) — dieselbe Connector-Logik ohne Credentials testbar. Setup-
   Wizard im ConnectorManager (Rechenzentrum EU/US/CN/IN, Access ID/Secret,
   optionale UID). Implementiert *ausschließlich* den bestehenden Connector-
   Vertrag — Roboter-Seite und Twin unverändert. 28 Tests. Offen: Pulsar/MQTT-
   Push statt Polling, Roboter-Kartendaten dekodieren (→ Punkt 2).
2. **Echte Roboterkarte.** ✅ *Umgesetzt.* Neutraler `RobotMap`-Decoder
   (`src/twin/robotMap.ts`): parst die binäre Tuya-Laser-Karte (Header +
   RLE-Occupancy-Grid unbekannt/Wand/Boden + gefahrener Pfad), `encodeTuyaMap`
   als getestete Inverse, Helfer für Pixel↔cm, Weltgrenzen, Fläche und RGBA-
   Rasterung. Die Robot-Seite liest den Karten-Blob aus der Geräte-Telemetrie,
   dekodiert ihn und rendert das gescannte Occupancy-Grid + den echten
   Serpentinen-Pfad + Dock/Roboter; ein „Plan ⇄ Roboterkarte"-Umschalter, mit
   Plan-Fallback. Der Simulator liefert eine L-förmige Wohnungskarte in exakt
   den Tuya-Bytes, die der Decoder parst — die Pipeline läuft ohne Credentials
   durch. 9 Tests. Offen: Zonen-/Raum-Kommandos direkt auf Kartenkoordinaten.
3. **Matter/HA-Vakuum-Brücke.** ✅ *Umgesetzt.* Der `/robot`-Screen ist
   herstellerneutral: er erkennt *jedes* Gerät mit `Vacuum`-Capability aus
   *jedem* Connector — HA-Live, Matter, echtes Tuya Cloud, Demo — ohne
   markenspezifischen Code. Eine echte Quelle wird der Demo vorgezogen, der
   eco-Tuya-Simulator startet nur, wenn der Twin gar keinen Roboter hat. Bei
   mehreren Robotern schaltet ein Picker im Header um; das Verbindungs-Badge
   zeigt die echte Quelle (Home Assistant / Tuya Cloud / Matter …) samt Farbe.
4. **Geräte-Onboarding.** ✅ *Umgesetzt.* Ein geführter „Gerät verbinden"-
   Wizard (4-Schritt-Stepper) bündelt die vorher verstreuten Karten: Quelle
   wählen (HA Live · Tuya Cloud Live · simuliertes Ökosystem) → Zugangsdaten
   (nur bei Live-Quellen) → Verbinden & Entdecken (Spinner → Trefferliste) →
   gefundene Geräte den Plan-Räumen zuordnen. Jede Quelle endet als derselbe
   neutrale Connector im geteilten Twin — der Wizard orchestriert nur, kein
   markenspezifischer Code. Aufruf über einen Button im Digital-Twin-Header.

**Damit ist Horizont 1 vollständig** — aus simulierten Quellen sind reale
geworden, mit einem einheitlichen Weg sie anzubinden.

## Horizont 2 — Bald: SaaS-Reife

1. **Konten & Pläne teilen.** Projekt-Freigabe per Link (lesen/bearbeiten),
   Team-Workspaces auf Supabase-RLS-Basis.
2. **Abrechnung.** Free/Pro-Stufen (Stripe): Pro = Cloud-Sync unbegrenzt,
   Live-Connectors, Export in hoher Auflösung.
3. **Automationen.** Regel-Engine auf dem Twin (Auslöser: Zeit/Sonnenstand/
   Sensor → Aktion: Szenen/Kommandos), UI im Editor-Kontext. Das
   Umgebungsmodell (`environment.ts`) liefert Sonnenstand bereits.
4. **Energie-Analyse.** Verbrauchs-Dashboard aus `Energy`-Capabilities mit
   Historie (Supabase), Kosten-Hochrechnung; später Solar-Ertrag aus dem
   vorhandenen Solarmodell + Fensterflächen.
5. **Onboarding-Verfeinerung.** Der gelobte Start-Flow bekommt Vorlagen nach
   Wohnungstyp und einen „erste 5 Minuten“-Pfad bis zum ersten Live-Gerät.

## Horizont 3 — Später: Erlebnis & Intelligenz

- **Begehbarer Modus:** First-Person-Walkthrough im 3D-Renderer, optional
  WebXR.
- **Cinematic-Export:** Kamerafahrten als Video/GIF rendern und teilen.
- **KI-Assistent:** Vorschläge auf Twin-Basis („Flurlicht nachts auf 20 %“),
  Grundriss-Import aus Foto/PDF.
- **Anwesenheits-Simulation:** Urlaubsmodus, der Szenen realistisch abspielt.
- **Roboter-Historie:** Reinigungs-Archiv mit Karten-Snapshots und Statistik.

## Laufend (jeder Horizont)

- Testabdeckung wächst mit jedem Feature (Domain zuerst, UI-Flows per
  Playwright-Screenshots verifiziert).
- Performance-Budget: Initial-Bundle klein halten (Route-Chunks), 3D nur wo
  sichtbar.
- Hell/Dunkel-Parität und A11y bei jedem neuen Screen.
