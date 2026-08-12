# OMEGA Atelier

<p align="center">
  <strong>The intelligent workspace for designing, visualizing and connecting smart homes.</strong>
</p>

<p align="center">
  Design your home. Visualize it in 3D. Connect your devices.
  <br>
  One workspace. One Digital Twin.
</p>

<p align="center">
  <img src="./docs/assets/omega-atelier-showcase.gif"
       alt="OMEGA Atelier product showcase"
       width="900">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-TypeScript-blue">
  <img src="https://img.shields.io/badge/3D-Three.js-black">
  <img src="https://img.shields.io/badge/Cloud-Supabase-green">
  <img src="https://img.shields.io/badge/PWA-Ready-purple">
</p>

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 3. Lokal starten

```bash
pnpm dev
# → http://localhost:5173
```

### 4. Build & Preview

```bash
pnpm build
pnpm preview
```

## Deployment (GitHub Pages + Supabase)

1. Repo nach GitHub pushen — der Workflow `deploy-pages.yml` baut und veröffentlicht bei jedem Push auf `main`.
2. Unter **Settings → Secrets and variables → Actions** die beiden Werte hinterlegen:
   `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`.
3. Unter **Settings → Pages** als Source **GitHub Actions** wählen.
4. Die Live-URL in Supabase unter **Authentication → URL Configuration** ergänzen.

Der `anon`-Key ist für den Browser bestimmt und landet im Bundle — das ist so vorgesehen.
Was ihn absichert, ist Row Level Security, nicht seine Geheimhaltung. Der `service_role`-Key
dagegen umgeht RLS und darf niemals in eine `VITE_`-Variable.

## Feature-Matrix

| Feature | Status | Phase |
|---|---|---|
| E-Mail-Auth + Google OAuth | ✅ | 1 |
| Cloud-Speicherung (`plans` Tabelle, JSONB) | ✅ | 1 |
| Row Level Security | ✅ | 1 |
| Multi-Floor Editor | ✅ | 1 |
| Geräte-/Möbel-Bibliothek | ✅ | 1 |
| 9 Omega-Modi mit Readiness-Score | ✅ | 1 |
| Undo/Redo Stack | ✅ | 1 |
| Responsive + PWA | ✅ | 1 |
| Realtime-Sync (Live-Cursor, Presence) | 🔶 | 2 |
| Version-History | 🔶 | 2 |
| Share-Links (view/edit) | 🔶 | 2 |
| Export PNG/PDF/YAML/glTF/Shortcut | 🔶 | 2 |
| Kommentare | 🔶 | 2 |
| 25+ Templates | 🔶 | 2 |
| Globale Suche (⌘K) | 🔶 | 3 |
| Image Blaster 3D (Bild → 3D-Asset, GLB/USDZ/OBJ/PLY/STL) | ✅ | 3 |
| Auto-Layout-Vorschläge | 🔶 | 3 |
| Multi-User-Haushalte | 🔶 | 3 |

## Projektstruktur

```
src/
  components/
    auth/            Login, Signup, OAuth-Buttons
    layout/          AppShell, Topbar, MobileNav
    editor/          Canvas, Toolbar, FloorTabs, LayerPanel, PropertyPanel
    library/         DeviceLibrary, FurnitureLibrary
    modes/           ModesPanel mit Readiness-Score
    export/          Export-Dialog (PNG/JSON/YAML/Shortcut)
    plans/           Plans-Liste, Templates
    ui/              Atomic UI (Button, Input, Dialog, Toast)
  connectors/        Geräte-Ökosystem-Anbindungen (Home Assistant, MQTT, Tuya, …)
  design-system/     Typisierte Design-Tokens
  domain/            Geräte-/Capability-Domänenmodell
  features/          Workspace-Komposition (Rail, Inspector, Library)
  twin/              Digitaler Zwilling / Reflection-Logik
  pages/             Login, Plans, Editor, Settings
  store/             Zustand stores (plan, auth, ui)
  hooks/             useAuth, useCanvas, useRealtimePlan, useHotkeys
  lib/               Domänenlogik: Licht, Schatten, Solar, Sound, DayCycle, …
  data/              devices, furniture, templates (statisch)
  types/             Alle TS-Typen zentral
  styles/            index.css mit @theme
supabase/
  migrations/        SQL-Schema + RLS-Policies
nobleframe/          Statische NobleFrame-Site (eigenes Deployment)
```

## Design-System — OMEGA Design Language v2 „Quiet Luxury"

| Token | Wert |
|---|---|
| `--bg` (Void) | `#0B0F14` |
| Surface L1 / L2 / L3 | `#111823` / `#161F2B` / `#1C2836` |
| `--accent` (Electric Indigo) | `#4C7DFF` |
| `--cyan` (Secondary Glow) | `#35D3FF` |
| `--color-omega-danger` | `#FF4D4D` |
| `--color-omega-success` | `#2EE59D` |
| Display / Body / Mono | Inter · Inter · JetBrains Mono |
| Spacing | 8px-Grid (4/8/12/16/24/32/48/64) |
| Radien | 8 · 12 · 16 · 20–24 |

Dark-First, theme-aware (kühles Light-Companion inklusive). Alle Farben über
CSS-Variablen; typisierte Spiegelung in `src/design-system/tokens.ts`.

**Wiederverwendbare UI-Primitives** (`src/ui/`): Button, IconButton, Panel,
Card, Badge, Divider, SegmentedControl, InspectorSection, Tooltip, Toolbar.
**Workspace-Komposition** (`src/features/workspace/`): WorkspaceRail,
InspectorPanel, LibraryPanel.

## Tastaturkürzel

| Shortcut | Aktion |
|---|---|
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + Shift + Z` | Redo |
| `⌘/Ctrl + S` | Speichern (Cloud) |
| `⌘/Ctrl + K` | Globale Suche |
| `V` | Select-Tool |
| `W` | Wall-Tool |
| `D` | Device-Platzier-Modus |
| `Del` | Löschen |
| `+ / -` | Zoom |
| `Space + Drag` | Pan |

## Supabase SQL

Siehe `supabase/migrations/20260101000000_init.sql`. Enthält:
- `profiles`, `plans`, `plan_versions`, `plan_collaborators`, `comments`
- RLS-Policies: Eigentümer sehen alles, Collaborators je nach Rolle
- Realtime-Kanäle auf `plans` und `plan_cursors`
- Trigger für `updated_at` und automatisches Versioning

## Lizenz

Proprietär – OMEGA Atelier © 2026.

## Tests & Qualität

```bash
npm run lint        # ESLint — 0 Errors, 0 Warnings (--max-warnings 0)
npm run typecheck   # tsc --noEmit (App + vite.config.ts)
npm run test        # Vitest — 477 Unit-Tests in 49 Dateien
npm run test:watch  # Vitest Watch-Modus
npm run test:coverage
```

**Test-Stack:** Vitest 2.1 + jsdom + Testing Library. Unit-Tests decken die
pure Domänenlogik (`src/lib`, `src/domain`, `src/twin`), die Connector-
Mappings und den Plan-Store ab — Geometrie, Readiness-Scoring, Mode-Szenen,
Licht-/Schatten-Berechnung, Day-Cycle, RadioMesh sowie Undo/Redo.

CI (`.github/workflows/ci.yml`) führt bei jedem Push/PR lint → typecheck →
test → build aus.
