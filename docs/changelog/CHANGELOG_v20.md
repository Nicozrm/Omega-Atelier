# OMEGA Atelier 2.0 — v20 Changelog

Startseite komplett neu gebaut. Ready to deploy.

## Was raus ist
- Alle lucide-react Icons aus dem Hero
- Generische Card-Grid Layout
- Stock Ω-Zeichen als Logo
- Statische Hero-Animation (alles fade-in zur gleichen Zeit)

## Was rein ist

### Custom SVG Logo
Komplett selbst designed — Ω wird als architektonischer Bogen interpretiert.
- Rounded-corner Plate als Trägerfläche mit Gold-Gradient (e9c477 → 8f7638)
- Inner Top-Sheen für 3D-Effekt
- Outer Glow via radialGradient
- Ω-Form gestrichen (nicht gefüllt) als 4-segmentige Path-Hierarchie:
  Linker Fuß → linker Aufstieg → Bogen-Oberseite → rechter Aufstieg → rechter Fuß
- Diamond-Akzent unten

### Sequentielle Intro-Animation
1. **Logo-Plate** scaled von 0.7 mit -6° Tilt rein (0.1s, spring easing)
2. **Logo-Sheen** fadet ein (0.4s)
3. **Logo-Stroke** zeichnet sich via `stroke-dashoffset` (0.5s, 1.2s Dauer)
4. **Diamond** scaled-pop unter dem Ω (1.4s)
5. **Eyebrow** "Smart-Home Atelier · 2026" (0.7s)
6. **Title** "OMEGA Atelier" zweizeilig — Atelier in Italic-Script-Variante mit Gold-Gradient (0.85s + 0.95s)
7. **Subhead** (1.05s)
8. **Pills** kaskadieren mit 50ms Stagger (1.2s)
9. **Bento-Cards** staggered (1.55s, 1.65s, 1.75s, 1.85s)
10. **Brand-Strip** (2.0s)
11. **Footer** (2.3s)

`prefers-reduced-motion` Media Query disabled alle Animations.

### Hand-gezeichnete Icon-Bibliothek
Alle Icons sind eigene inline SVGs in einheitlichem "architektonischem Linien"-Stil:
- 1.5px stroke, rounded line caps, currentColor
- **IconResume**: Refresh-Pfeil mit zentralem Kern
- **IconDemo**: stylisiertes Hexagon mit Play-Triangle
- **IconNew**: Architekten-Grid mit Center-Dot
- **IconQuick**: scharfer Lightning-Glyph
- **IconArrowRight**: 1.8px Pfeil für CTAs
- 6 weitere Glyphs für Pills (Light, Cube, Layers, Move, Sparkle, Palette)

### Bento-Grid statt Standard-Cards
Asymmetrisches Layout mit 4 Kartengrößen:

```
Desktop (mit Resume):     Desktop (ohne Resume):
┌────────┬───────┬───┐    ┌─────────────┬───┐
│        │       │   │    │             │ N │
│ RESUME │ DEMO  │ N │    │    DEMO     ├───┤
│        │       ├───┤    │             │ B │
│        │       │ B │    │             │   │
└────────┴───────┴───┘    └─────────────┴───┘
```

Kartenrollen:
- **Hero** ('Resume', 1.4fr breit + 2 Reihen hoch): nur wenn lokaler Plan existiert
- **Feature** ('Demo'): mit Mini-Floorplan-SVG-Preview als Ornament unten rechts
- **Compact** ('New', 'Blank'): kleiner, kompakte CTAs

Jede Karte hat:
- Background-Grid-Pattern (mask-image gefadet)
- Corner-Arc-Decoration die bei Hover scaled
- Icon-Tile mit Gold-Gradient + Inset-Highlight, scale + tilt on hover
- Tag-Pill ("empfohlen", "letzte Sitzung")
- CTA mit Pfeil-Icon, fade-in on hover

### Bessere Skalierung
- `clamp()` für alle Padding/Font-Sizes — Title 2.2rem mobile → 4.5rem desktop
- Bento-Grid bricht auf Mobile in single column ohne visuelle Brüche
- Hero-Card collapsed auf 1 Spalte unter 800px
- Subtile `mask-image` Fade-Outs an Brand-Strip-Rändern

### Edler / moderner
- Eigenes Color-Token-Set scoped via `.omega-start { --o-... }` — kein Konflikt mit globalen Vars
- Title als zwei Zeilen: "OMEGA" oben (sans serif gradient text), "Atelier" unten in Italic-Playfair mit Gold-Gradient → Magazin-Look
- Eyebrow mit kleiner Linie + Version-Badge in Mono
- Pills mit `backdrop-filter: blur(6px)` für Frosted-Glass-Effekt
- Cards mit `backdrop-filter: blur(10px)` und mehrlagigen Schatten
- 3 animierte Background-Blobs (Gold/Blau/Grün) mit unterschiedlichen Periodendauern (22s/28s/24s)
- Vignette-Fades oben und unten
- Brand-Strip mit Mask-Fade-Out an den Rändern + dezente Hover-Animation pro Brand

## ⚙️ Verifikation
- typecheck → 0 Fehler
- vite build → erfolgreich
- index.css + index.js: minimal vergrößert (alle Styles im Component scope)
