# OMEGA Atelier 2.0 — v26 Changelog

Drei große Themen: per-Gerät erkennbare 2D-Icons, Tür/Fenster/Terrasse
direkt aus der Toolbar, und frei gestaltbare Terrassen.

## 1. Geräte auf den ersten Blick erkennbar (2D)

`drawDevicePin` bekommt jetzt die `deviceId` und ruft einen neuen
`drawDeviceGlyph`-Dispatcher auf. Statt nur ~14 Kategorie-Icons gibt es
jetzt ~25 gerätespezifische Glyphen, die zuerst per exaktem deviceId-Match
greifen und sonst auf die Kategorie zurückfallen:

- **Hue Bulbs** — gefüllte Glühbirne mit Sockel-Rippen
- **LED-Strips** (Hue/Govee/SwitchBot) — Zickzack-Lichtband
- **Sonos** — Box mit Schallwellen
- **Echo/Alexa** — Zylinder-Draufsicht mit Ring
- **HomePod** — abgerundete Silhouette
- **Nuki** — Hexagon mit Schlüsselloch
- **Lockin G30** — Fingerabdruck-Bögen
- **SwitchBot Lock** — Quadrat mit Dreh-Pfeil
- **Hubs/Bridges** — Box mit WLAN-Wellen
- **SwitchBot Bot** — Roboterarm
- **Vorhang/Rollo-Motoren** — hängende Drapierung
- **Govee Glide Hexa** — Hexagon-Panel
- **Steh-/Tischlampen** — Lampenschirm auf Fuß
- **Outdoor/String-Lichter** — Lichterkette
- **Kameras** (Osaio/Arenti/Ring/Blink/Doorbell) — Bullet-Cam
- **Präsenzsensoren** (FP2/mmWave) — Radar-Fächer
- **Steckdosen/Energie** (Eve/Shelly) — Blitz im Kreis
- **Thermostate** (Eve Thermo/tado/Nest) — Ventil mit Temperatur-Bogen
- **Rauchmelder** (TwinGuard) — Kreis mit Ausrufezeichen
- **Wandschalter** (Smart Life/Tuya) — Platte mit 1 oder 2 Tasten
- **Bewegungs-/Kontaktsensoren** — Geh-Figur mit Wellen
- **Meter** (SwitchBot Meter) — Display-Box

## 2. Tür / Fenster / Terrasse in der Toolbar

Neue Werkzeuge mit eigenen handgezeichneten SVG-Icons (architektonischer
Linien-Stil):

- **Tür** (Hotkey O) — zeichnet wie eine Wand, erzeugt aber direkt ein
  Wand-Segment mit `subtype: 'door'` (90 cm Öffnung). Grüne Live-Vorschau.
- **Fenster** (Hotkey E) — `subtype: 'window'` (120 cm, 100 cm hoch, 90 cm
  Brüstung). Blaue gestrichelte Vorschau.
- **Terrasse** (Hotkey R) — Aufziehen eines Rechtecks erzeugt eine
  Outdoor-Zone. Grün getönte Deck-Vorschau mit Live-Maßen.

Damit entfällt der Umweg "erst Wand zeichnen, dann im PropertyPanel auf
Tür/Fenster umstellen". Geht aber weiterhin auch so.

Toolbar ist jetzt in Gruppen unterteilt (Struktur / Platzieren / Verlauf /
Zoom / Raster) mit Trennern und `flex-wrap` für kleine Screens.

## 3. Frei gestaltbare Terrassen

- Neuer `addRoom`-Store-Befehl + `Room.zoneType: 'indoor' | 'outdoor'`
- **2D**: Terrassen werden mit Holz-Deck-Dielen + grün gestricheltem Rand
  gerendert (`drawRoomFill` erweitert)
- **3D**: Outdoor-Zonen erscheinen als **erhöhtes Holz-Deck** (extrudiert,
  6 cm, Walnuss-Unterbau + Eiche-Oberfläche) statt flacher Patch
- Möbel und Geräte lassen sich frei darauf platzieren — die Terrasse ist
  eine echte Zone, kein Deko-Element

### Räume editierbar
- Räume sind jetzt anklickbar (Point-in-Polygon Hit-Test, niedrigste
  Priorität — Geräte/Möbel darüber gewinnen)
- Neues Raum-Panel im PropertyPanel: Zone umschalten (Innen/Terrasse),
  Bodenmaterial wählen (Vinyl hell/dunkel, Parkett, Schiefer), umbenennen
- Räume/Terrassen löschbar (Delete)

## ⚙️ Verifikation
- `tsc --noEmit` → 0 Fehler
- `vite build` → erfolgreich
- Bundle three.js lazy-chunk unverändert
