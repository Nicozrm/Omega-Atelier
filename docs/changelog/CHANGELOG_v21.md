# OMEGA Atelier 2.0 — v21 Changelog

Polish nach v20 — Brand-Konsistenz und Editor-Look angeglichen.

## Brand-Konsistenz für Deploy

### Favicon
`public/favicon.svg` neu — exakt das Arch-Logo der Startseite:
- Gold-Plate mit linearem Gradient (e9c477→c4a150→8f7638)
- Sheen-Overlay
- Ω-Stroke als 4 Path-Segmente (Fuß+Aufstieg+Aufstieg+Fuß)
- Diamond-Akzent unten

### PWA Manifest
`public/manifest.json` modernisiert:
- `theme_color` → `#c4a150` (Gold) statt schwarz
- `background_color` → `#faf8f2` (warmes Off-White) statt schwarz
- `description` aktualisiert auf 2026er Wording
- `categories` erweitert (productivity, lifestyle, utilities)
- SVG-favicon zusätzlich als Icon registriert
- `orientation` von `portrait-primary` auf `any` (Editor profitiert von Landscape)

### index.html
- `theme-color` Meta auf Gold
- Description aktualisiert

## Editor-Look angeglichen

### Topbar
Mini-Logo statt einfaches Ω-Zeichen — derselbe Arch-SVG wie auf der Startseite,
in 32×32, mit Inset-Highlight + Gold-Drop-Shadow + Hover-Scale 1.05.
Schriftzug **OMEGA *Atelier*** — Atelier kursiv in Gold, passt zur Magazin-Optik
der Startseite.

### Toolbar
- Container: `rounded-xl` mit Backdrop-Blur, dezenter Inset-Highlight, weicher Schatten
- ToolButtons:
  - Active: Gold-Gradient (e9c477→c4a150) mit Inset-Highlight + Glow + scale 1.03
  - Inactive: Hover -translateY-0.5 (subtle lift)
  - Hotkey-Label klein in der unteren rechten Ecke (Mono, Surface-Pille)
- Smoothere Transitions (200ms quart easing)

## ⚙️ Verifikation
- typecheck → 0 Fehler
- vite build → erfolgreich
