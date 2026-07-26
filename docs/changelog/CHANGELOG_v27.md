# CHANGELOG v27 — OMEGA Design Language v2 "Quiet Luxury"

Komplette Neuausrichtung der visuellen Identität: vom Gold/Noir „Brutale
Eleganz"-System zu einer ruhigen, hochwertigen Dark-First Design- &
Engineering-Plattform im Stil von Figma × Tesla UI × Linear.

## 🎨 Design System (neu)

**Farbwelt** — tiefes Off-Black `#0B0F14`, Surface-Layer
`#111823` / `#161F2B` / `#1C2836`, Primary-Accent Electric Indigo `#4C7DFF`,
Secondary Cyan `#35D3FF`, Danger `#FF4D4D`, Success `#2EE59D`. Alles
„gedimmt premium" — kein Neon-Overkill.

**Typografie** — Inter / SF Pro / system-ui durchgängig. Playfair Display
(Serif) vollständig entfernt.

**Spacing** — striktes 8px-Grid (4/8/12/16/24/32/48/64).
**Radien** — 8 (UI) / 12 (Panels) / 16 (Cards) / 20–24 (Floating).
**Tiefe** — weiche Elevation-Blurs + dezenter Ambient-Glow bei Active-States;
keine harten Schatten.

**Theme-aware** — Dark ist Default, kühles Light-Companion bleibt erhalten.
Beide vollständig über CSS-Variablen gesteuert (`var(--accent)` …), inklusive
Canvas-Farben (`--canvas-*`).

## 🧩 Neue Architektur-Layer

```
src/design-system/   tokens.ts — typisierte Spiegelung der CSS-Variablen
src/ui/              wiederverwendbare, strikt typisierte Primitives
src/features/        Komposition aus Primitives (workspace/)
```

### UI-Primitives (`src/ui/`)
Alle strict typed, ohne Business-Logik, theme-aware, animation-ready:
`Button` · `IconButton` · `Panel` / `PanelHeader` · `Card` · `Badge` ·
`Divider` · `SegmentedControl` · `InspectorSection` / `InspectorRow` ·
`Tooltip` · `Toolbar` / `ToolbarGroup`.

### Workspace-Features (`src/features/workspace/`)
`WorkspaceRail` + `RailReopenTab` · `InspectorPanel` · `LibraryPanel`.

## 🪟 3-Panel Layout (überarbeitet)

Striktes, kollabierbares 3-Panel-System mit animierten Rails:

1. **Left Rail — Bibliothek**: Geräte/Möbel via `SegmentedControl`.
2. **Main Canvas — „silent workspace"**: Off-Black, voller Fokus.
3. **Right Rail — Inspector**: kontextabhängige Eigenschaften oben
   (Progressive Disclosure) + kollabierbare Sektionen (Omega-Modi,
   Quick Stats, Ebenen).

Beide Rails klappen weich ein (nur `width`/`opacity` animiert → kein
Jitter); bei eingeklapptem Rail erscheint eine schwebende Reopen-Affordance
am Canvas-Rand.

## ⚡ Interaction Design

- Selection-Sprache: weicher blauer Glow-Outline (`--glow-accent-soft`).
- Tool-Switch: sofortiges visuelles Feedback über `IconButton active`.
- Hover-States überall subtil; Active-Press-Scale.
- Canvas-Selektion: alle Handles über Theme-Tokens (`--canvas-select*`).

## 🧱 Refactors (Gold → Indigo)

Vollständige Entfernung aller Gold-Referenzen (`#c4a150` & Verwandte) aus
dem gesamten Code: StartScreen, Topbar (+ neuer `OmegaMark`), Editor-Toolbar,
Canvas + `canvasGlyphs.ts` (Drawing-Primitives, Geräte-Farbpaletten),
`OMEGA_MODES`-Akzente, 3D-View (Selektion/Emissive/Status-LEDs), sowie
Toast, CommandPalette, Device-/Furniture-Library, Export-Dialog.
Kontrast-Fix: `text-black` auf Accent → `text-white`.

## ✅ Status

`npm run build` grün · Dark + Light verifiziert · 3-Panel-Collapse
verifiziert · Pages (Start, Login, Settings, Plans, Editor, 3D) konsistent
im neuen System.
