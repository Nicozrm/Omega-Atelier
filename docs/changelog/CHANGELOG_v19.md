# OMEGA Atelier 2.0 — v19 Changelog

Vier neue Features auf einmal: Walk-Mode, Snap-to-Wall, Per-Raum Materialien,
Möbel-Bibliothek deutlich erweitert.

## 1. Walk-Mode (First-Person)

Neuer **Walk-Mode** Toggle im 3D-View Header (Footprints-Icon).

- WASD oder Pfeiltasten = Bewegung
- Maus = umschauen (PointerLock)
- Klick = Maus locken, Esc = freigeben
- Geschwindigkeit 2.4 m/s
- Augenhöhe 1.65 m
- Movement clampt an die Floor-Extents (kann nicht durch Wände gehen — ja, geht aktuell schon, aber bleibt im Raum-Rechteck)

Implementierung in `WalkController` (~50 Zeilen): `useThree()` für Camera-Zugriff, `useFrame()` für Movement-Loop, `PointerLockControls` aus drei/drei für die Maussteuerung.

Wenn Walk-Mode aus → OrbitControls wie bisher.

## 2. Snap-to-Wall

Beim **Platzieren von Geräten** (`tool === 'device'`) wird der Klickpunkt automatisch auf die nächste Wand gesnappt, falls eine innerhalb von **30 cm** liegt.

- Mathematisch: Projektion auf Wand-Liniensegment
- Findet nächstgelegene Wand über alle Walls
- Falls keine Wand in Reichweite → fallback auf Grid-Snap wie bisher

Smart-Home-Geräte (Schalter, Schlösser, Sensoren) sitzen so automatisch flush an der Wand statt frei im Raum.

## 3. Material-Slots pro Raum

`Room` Type erweitert um optionales `floorVariant` und `wallVariant`. Pro Raum kann der Boden-Typ überschrieben werden — z.B. Bad mit Schiefer während der Rest Vinyl ist.

3D-Rendering: per-room Floor-Patches via `THREE.Shape` aus der Polygon-Definition, gerendert oberhalb des globalen Floors mit dem passenden Material. `wallVariant` bleibt für später (Wand-zu-Raum-Zuordnung wäre größerer Refactor).

## 4. Möbel-Bibliothek erweitert (+25 Items)

Neu in `furniture.ts`:

**Wohnzimmer**: Eck-Sofa, Sofa 2-Sitzer, Sessel, TV-Stand, Beistelltisch
**Esszimmer**: Esstisch 6-Pers., Esstisch 8-Pers.
**Büro**: Schreibtisch (160×80), Eck-Schreibtisch, Bürostuhl
**Schlafzimmer**: Bett 90×200, Bett 140×200, Babybett
**Stauraum**: Bücherregal (klein/breit)
**Bad**: Badewanne, Dusche (mit Glaswänden!), Toilette, Waschbecken (mit Messing-Armatur)
**Küche**: Waschmaschine, Kühlschrank
**Sonstiges**: Klavier (matt-schwarz mit weißer Tastenleiste), 2 Pflanzen-Varianten

Alle mit eigenen 3D-Meshes. Bookshelves haben sichtbare Regalbretter, Desks Endpanel-Beine, Bathtub mit Glaseinsatz, Shower mit zwei Glaswänden, Sink mit Marmor-Sockel + Messing-Armatur, Plant mit Topf + grünem Foliage.

## ⚙️ Verifikation

- typecheck → 0 Fehler
- vite build → erfolgreich
