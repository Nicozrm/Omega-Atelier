# OmegaAtelier — Quiet Luxury Transformation Notes

## Design language (NEW — "Omega Design Language v2")
- BG deep off-black #0B0F14
- Surface L1 #111823 / L2 #161F2B / L3 #1C2836
- Primary accent Electric Blue/Indigo #4C7DFF
- Secondary Cyan glow #35D3FF
- Danger #FF4D4D / Success #2EE59D
- Font: Inter / SF Pro / system-ui (NO Playfair serif)
- 8px grid: 4/8/12/16/24/32/48/64
- Radius: 8 (small) / 12 (panel) / 16 (card) / 20-24 (floating)
- Shadows: soft elevation blur, ambient glow on active
- Light theme = clean cool white companion

## Signature
3-panel "Atelier Workspace": Left Sidebar (tools/rooms/devices) | Main Canvas (silent) | Right Inspector. Panels collapsible + animated. Selection = soft blue glow outline. Quiet, disciplined surroundings; the workspace itself is the hero.

## Architecture additions
- src/design-system/tokens.ts  (typed token mirror of CSS vars)
- src/ui/  reusable primitives: Button, IconButton, Panel, Card, Badge, InspectorSection, Toolbar, Tooltip, Divider, SegmentedControl, PanelHeader
- All UI primitives: typed, no business logic, theme-aware, animation-ready

## Mechanism insight
- Most components use var(--accent), var(--border) etc → reskin via index.css
- Canvas reads colors from --canvas-* and --accent via readTheme() → reskins automatically
- Hardcoded gold offenders to refactor: StartScreen (own <style>), Topbar logo, Toolbar active state, Canvas selection handles, OMEGA_MODES accents, 3D view

## Done log

### Completed (v27)
- index.css fully rewritten → Quiet Luxury token system (dark default + light companion)
- index.html: dark default, Inter+JetBrains Mono only, theme-color #0B0F14
- /design-system/tokens.ts (typed mirror) + /ui primitives (11 components, barrel)
- /features/workspace: WorkspaceRail (collapsible animated), InspectorPanel, LibraryPanel
- UI store: persisted leftRailOpen/rightRailOpen + toggles
- Editor.tsx: rewritten 3-panel collapsible layout + reopen tabs (positioning fixed)
- StartScreen: full Quiet Luxury rewrite (indigo Ω, sequenced reveal)
- Topbar: new primitives + shared OmegaMark
- Toolbar: IconButton active glow + ToolbarGroup
- Canvas + canvasGlyphs.ts: ALL gold → theme tokens; device palette harmonised (cool jewel)
- OMEGA_MODES accents, ThreeDView (selection/emissive/status), Toast, CommandPalette,
  libraries, ExportDialog, Login/FloorTabs contrast — all rethemed
- Verified: build green, dark+light themes, 3-panel collapse, all pages consistent

### Verification screenshots taken
01 start, 02-05 editor (clean/collapsed/tabs), 06 login, 07 settings, 08 plans,
09 light editor, 10 3D
