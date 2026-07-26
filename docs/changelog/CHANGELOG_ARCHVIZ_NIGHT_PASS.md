# Changelog — Archviz Night Pass (Referenz-Abgleich)

**Ziel:** Die 3D-Ansicht an der visuellen Goldreferenz messen (Premium-Archviz-
Dollhouse bei Nacht: warm beleuchtetes Modell vor fast schwarzer, ruhiger
Umgebung) und in kleinen, einzeln verifizierten Iterationen dorthin führen.
Jede Änderung wurde per Headless-Screenshot (Playwright/SwiftShader) gegen die
Referenzbilder geprüft; Verschlechterungen wurden verworfen (u. a. ein
Walk-Spawn-Experiment revertiert).

## Nacht-Rezession der Umgebung

- `Neighborhood` und `TerraceParking` erhalten die Tagesphase statt eines
  binären `lit`-Flags und dimmen ihre **Albedo phasenabhängig** (Nacht ≈
  near-black, Dämmerung gedimmt, Tag unverändert). Grund: die Innenraum-
  Punktlichter sind schattenlos und würden Rasen/Straße sonst dauerhaft
  taghell anstrahlen. Wichtig: `multiplyScalar` dimmt **linear** — die
  Faktoren liegen deshalb weit unter dem wahrgenommenen Ziel (Nacht 0.07).
- Beleuchtete Nachbar-Fenster, Sconces und Straßenlampen bleiben bewusst
  warm — das Viertel liest sich bewohnt, ohne die Szene aufzuhellen.
- Geparkte Autos fahren nicht mehr mit Licht: Scheinwerfer/Rückleuchten sind
  jetzt unbeleuchtete Klar-/Rotglas-Linsen.

## Nachthimmel

- `environment.ts`: Zenit/Horizont der Nacht von blaustichig auf
  **neutrales Anthrazit** (`#080a11` / `#131722`) — Canvas-Hintergrund, Fog
  und Hemisphere folgen automatisch. Der Blaustich las sich als
  „Videospiel-Nacht"; die Referenz schwebt auf neutralem Dunkel.

## Leuchten & Emissives

- Pendel-Diffusoren (Esstisch + generischer Tisch) und die
  Stehleuchten-Diffusoren sind nicht länger `toneMapped={false}`: ACES rollt
  sie jetzt in warmes Gold ab, statt sie zu weißen Scheiben zu clippen;
  Pendel-Punktlicht leicht gezähmt (2.6 → 2.1) gegen den Tisch-Hotspot.
- Geräte-Raumlichter (Lampen aus dem Lighting-Modell) minimal weicher
  gemappt (0.4+2.2 → 0.35+1.85, decay 2.0).

## Pflanzen & Materialien

- Topfpflanzen (`FurnitureMesh`, `plant*`): statt vier fixer Kugeln jetzt
  6–8 **per-Item deterministisch gejitterte, gestauchte Laub-Klumpen** in
  drei tiefen, entsättigten Grüntönen + greige Keramiktopf (statt
  Leucht-Weiß). Kein Pflanzen-Zwilling gleicht dem anderen.
- `woodOak` von blassem Kiefern-Gelb auf **Honig-Eiche** (`#c2ab8b`)
  vertieft; `matteWhite` auf warmes Off-White (`#e9e3d6`, Roughness 0.78)
  gegen Papier-Clipping unter Downlights.
- Standard-Tageszeit der 3D-Ansicht: **20:00 (Nacht)** — der Hero-Look der
  Referenz ist der Default; Tageslicht bleibt einen Slider-Zug entfernt.

## Verifikation

- `tsc --noEmit` ✓ · ESLint (0 Warnungen) ✓ · Vitest 239/239 ✓ ·
  `vite build` ✓ — nach jeder committeten Stufe.
- Screenshot-Matrix: Dollhouse persp/corner × Tag/Dämmerung/Nacht, Dashboard-
  Hero, Walkthrough — jeweils vor/nach jedem Schritt verglichen.
