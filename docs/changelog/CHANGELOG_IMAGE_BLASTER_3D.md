# Changelog — Image Blaster 3D

**Feature:** Vollständiges Image-→-3D-Studio, integriert als globales Overlay
(Topbar „3D Studio", ⌘K-Palette). Verwandelt ein oder mehrere Eingabebilder
direkt im Browser in texturierte 3D-Assets — ohne Server, ohne ML-Gewichte,
PWA-tauglich offline.

## Pipeline (`src/lib/imageBlaster/` — pure, 22 Unit-Tests)

1. **Bildanalyse** — Luminanz/Kontrast/Sättigung, Kantendichte (Sobel),
   dominante Farben, Alpha-Erkennung → automatische Modus-Vorwahl.
2. **Segmentierung** — Maske aus Alpha, Helligkeit oder Chroma mit weicher
   Schwellwertkante.
3. **Tiefenschätzung** — heuristische Monocular-Depth aus gewichteten Cues
   (hell→nah, gesättigt→nah, unten→nah) + kantenerhaltende Glättung
   (bilaterale Approximation), Gamma & Invertierung.
4. **Mesh-Generierung** — drei Strategien, alle als rohe Buffer (three-frei):
   - *Relief*: Displacement-Heightfield, optional wasserdicht (Rückplatte + Skirt)
   - *Extrusion*: Flood-Fill größte Komponente → Moore-Konturverfolgung →
     RDP-Vereinfachung → Ear-Clipping-Triangulierung → Prisma
   - *Fläche*: Billboard-Quad mit Alpha-Cutout
5. **PBR-Texturierung** — Normal-Map aus der Tiefe (Sobel), optionale
   Roughness-Map aus invertierter Luminanz; flipY=false-Konvention für
   verlustfreie glTF/USDZ-Roundtrips.

## Studio-UI (`src/features/imageBlaster/`)

- Drag&Drop-Intake mit Multi-Bild-Quellenliste, Live-Pipeline-Monitor,
  Analyse-Readout und PBR-Map-Thumbnails (Albedo/Tiefe/Normal).
- Live-3D-Viewport (react-three-fiber): Studio-Lichtrig, ContactShadows,
  Drehteller, Drahtgitter, Kamera-Reset, PNG-Render-Snapshot.
- Parameter-Inspector: Geometrie/Tiefen/Material-Sektionen mit debouncetem
  Re-Run der Pipeline (Regler scrubben = Live-Update).
- **Export:** GLB · USDZ (AR Quick Look) · OBJ · PLY · STL sowie Tiefen-/
  Normal-Map als PNG. Exporter laden lazy (eigener Chunk, ~21 kB gzip).

## Integration

- `useUIStore.blasterOpen` — Studio global in `App.tsx` gemountet,
  lazy als eigener Chunk (~13 kB gzip UI).
- Einstiege: Topbar-Button „3D Studio" (Wand-Icon) + Command-Palette-Eintrag.
- A11y: Fokus-Trap, Escape, `role="dialog"` via `useModalA11y`.

## v2 — Punktwolke, Bibliothek, Mobile

- **Punktwolken-Modus** (`points`): farbige Punktwolke aus Tiefe + Albedo
  (Scan-Look), Dichte-/Punktgrößen-Regler, transparente Pixel werden
  ausgespart. Export als **binäres PLY** über einen eigenen pure Writer
  (three-frei, getestet) und als **GLB** (THREE.Points); nicht tragfähige
  Formate (USDZ/OBJ/STL) sind im Punkte-Modus sauber deaktiviert.
- **Persistente Bibliothek** (localStorage): sichert das *Rezept* eines
  Assets — Quellbild (≤512px, PNG bei Alpha / sonst JPEG) + kompletter
  Settings-Snapshot. Deterministische Pipeline ⇒ identische Reproduktion
  nach Reload; Quota-Guard mit Eviction, max. 12 Einträge.
- **Mobiler Einstieg**: Topbar-Button jetzt auf allen Breakpoints (mobil
  icon-only mit `aria-label`); Studio-Layout auf 390px verifiziert.

## v3 — Assets im Plan & Digital Twin

- **„In den Plan übernehmen"**: neue Inspector-Sektion im Studio — Raum
  wählen, Montage (Wandbild/Objekt), Breite in cm, Platzieren. Wandbilder
  hängen automatisch an der längsten Raumwand (nach innen gerichtet, 140 cm
  Galeriehöhe), Objekte stehen im Raumzentrum auf dem Boden.
- **Datenmodell**: `Floor.blasterAssets` (`PlacedBlasterAsset`) speichert das
  Rezept (Quellbild-Data-URL + Settings-Snapshot) statt Geometrie; `coercePlan`
  validiert/normalisiert tolerant (Altbestand → `[]`, kaputte Einträge fliegen).
- **3D-Rendering**: `BlasterAsset3D` rekonstruiert Assets deterministisch in
  der 3D-Ansicht (gecachte Rezept-Builds, alle vier Modi inkl. Punktwolke),
  mit Schattenwurf und PBR-Maps; Undo/Redo greift über `updateDoc`.
- **Pure Helfer**: `placement.ts` (Flächenschwerpunkt, größter Raum, längste
  Kante + Innen-Normale) und `settingsSchema.ts` (`normalizeSettings` gegen
  untrusted Snapshots) — beide unit-getestet.

## v4 — Asset-Verwaltung & 2D-Sichtbarkeit

- **Verwaltungsliste** in der „In den Plan"-Sektion: alle platzierten Assets
  des aktiven Floors mit Thumbnail, Raum, Montage und Breite; Aktionen
  Ausblenden/Einblenden, Entfernen (undo-fähig) und **„Nächste Wand"** —
  zykliert Wandbilder über die Raumkanten (kurze Kanten < 80 cm werden
  übersprungen; `nextWallPlacement`, unit-getestet).
- **2D-Editor-Marker**: platzierte Assets erscheinen im Grundriss als
  goldener Balken (Wand) bzw. Footprint (Boden) auf dem Möbel-Layer —
  read-only, verwaltet wird im Studio.

## Verifikation

- `lint` / `typecheck` / `test` (264) / `build` grün.
- E2E (Playwright, Production-Preview): Relief aus Foto (69k Dreiecke),
  Alpha-Logo → automatische Extrusion, GLB/USDZ-Downloads > 30 kB,
  Regler-Re-Runs, Escape/⌘K-Reopen — alles bestanden.
- E2E v2: Punktwolke (30k Punkte), Format-Gating, valider binärer
  PLY-Header, Punkte-GLB; Bibliothek überlebt Seiten-Reload und stellt
  Modus + Settings wieder her; Mobile (390×844) Einstieg + Pipeline.
- E2E v3: Wandbild + Objekt platziert und in der 3D-Ansicht gegen eine
  Asset-freie Baseline visuell nachgewiesen (Relief an Schlafzimmerwand,
  Extrusionsobjekt im Wohnbereich); Schema-Roundtrip unit-getestet.
- E2E v4: Verwaltungsliste, Wand-Zyklus, Ausblenden, Entfernen und
  Undo-Wiederherstellung durchgespielt; goldener 2D-Marker im Grundriss
  visuell bestätigt.
