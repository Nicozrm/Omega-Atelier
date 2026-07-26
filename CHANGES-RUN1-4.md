# Änderungen gegenüber OmegaAteliermain_5.zip (Run 1–4)

Vollständig verifiziert: **699 Tests grün · Typecheck · Lint · Production-Build sauber.**
Git ist gesperrt (in Klärung) → Auslieferung als ZIP.

## Run 1 — Vorteile für zahlende Nutzer, grafisch
- `src/pages/Landing.tsx` — Sektion **„Was Pro und Max freischalten"**: Apple-ruhige Vergleichs-Matrix (Planen · Erleben · Verbinden & Erschaffen), im Nav verlinkt. Daten spiegeln exakt die echten Feature-Schalter.
- `src/lib/entitlements.ts` — vier echt gegatete Zahler-Features: ✨ Auto-Möblieren (Pro), Etagen-Stack (Pro), AI Composer (Max), **Bau-Studio** (Max).
- `src/components/editor/Toolbar.tsx` — Auto-Möblieren bei Free = Schloss → Preise.
- `src/pages/Plans.tsx` — AI Composer Max-gegated.

## Run 2 — Echte Satellitenansicht (AI Composer)
Esri World Imagery (Google-Kacheln sind außerhalb der Google-SDKs per ToS verboten; Esri erlaubt Anzeige mit Attribution).
- `src/lib/composer/onlineProvider.ts` (+Test) — Esri-Tile-Provider + Nominatim-Geocoding, implementiert die `MapProvider`-Schnittstelle; deterministische Analyse-Seeds wie offline.
- `src/components/composer/MapCanvas.tsx` — echte Kacheln über der synthetischen Karte (Lade-Fallback bleibt), Tile-Cache.
- `src/components/composer/MapComposer.tsx` — Satelliten-Toggle + Pflicht-Attribution.

## Run 3–4 — 3D-Engine, Stacking, Bau-Studio, Photorealismus

### Häuser nach Etagen stacken (Explosionsansicht)
- `src/lib/floorStack.ts` (+Test) — reine Stapel-Geometrie.
- `src/components/3d/ThreeDView.tsx` — `GhostFloors`: andere Stockwerke als transluzente Geist-Etagen mit Gold-Rahmen; Layers-Toggle (Pro-gegated).

### Bau-Studio — Fassade · Bauart · Dach · Steinfarbe & mehr
- `src/lib/houseStyle.ts` (+Test) — reine Domäne: **4 Bauarten** (Klinker · Putz · Naturstein · Holz), **6 Steinfarben**, **3 Dachformen** (Satteldach · Walmdach · Flachdach), **5 Dachfarben** + Material-/Dach-Hints, Persistenz.
- `src/components/3d/ThreeDView.tsx` — HouseShell rendert die gewählte **Dachform** (inkl. neuem Walmdach & Flachdach mit Attika/Kies) und **Bauart** (neuer prozeduraler Holz-Textur-Generator `boardTextures`); UI: **Bau-Studio-Popover** (4 Wähler) statt fixer Swatches.

### Photorealismus & Performance
- **Anisotropes Filtering 8→16** auf allen prozeduralen Texturen (scharfe Flächen bei flachem Blick).
- **`powerPreference: 'high-performance'`** in der GL-Config.
- **Foto-Look-Toggle**: opt-in **AgX-Tonemapping** (natürlicherer Highlight-Rolloff) — Standard bleibt der getunte ACES-Look, damit nichts ungewollt kippt.

## Offen (braucht Live-Augen)
Weiterer Photorealismus-/Performance-Feinschliff (z. B. Instancing der Nachbarschaft, TAA) ist sinnvoll nur mit Blick auf den Bildschirm — schick Screenshots von Stellen, die „noch nicht krass genug" sind, dann drehe ich gezielt an Licht, Materialien und Post-Processing.
