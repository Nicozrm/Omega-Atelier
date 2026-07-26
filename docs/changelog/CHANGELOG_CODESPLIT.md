# CHANGELOG — Meilenstein: Route-level Code-Splitting & Performance

> Bewertet nach Phase-2-Protokoll (P0–P4). **P1 (Performance)** — verkleinert
> das Initial-Bundle messbar, ohne Funktionsverlust.

## Problem (P1 — Performance)

Alle Seiten wurden in `App.tsx` **eager** importiert. Der schwere Editor
(inkl. Canvas + Dialog-Abhängigkeiten) steckte damit im Haupt-Bundle und wurde
auch von Nutzern geladen, die nur auf Start / Login / Plans landeten. Das 3D
und die Dialoge waren bereits gesplittet — der verbleibende Hebel waren die
Seiten selbst.

## Lösung

**`React.lazy` + `Suspense` für die Routen** in `App.tsx`. Jede Seite wird zu
einem eigenen Chunk, der erst bei Navigation geladen wird. Die Seiten nutzen
Named-Exports, daher das `default`-Re-Mapping
(`import('@/pages/X').then(m => ({ default: m.XPage }))`).

**StartScreen bleibt eager** — als „/"-Landing-Route muss sie ohne zusätzlichen
Round-Trip sofort rendern.

**Neuer markenkonformer Suspense-Fallback** (`RouteFallback`): voll-viewport,
void-hinterlegt, pulsierendes Ω-Glyph + indeterminate Fortschrittsleiste.
Bewusst winzig + abhängigkeitsfrei (muss im Initial-Bundle sitzen, bevor ein
Route-Chunk ankommt). A11y: `role="status"`, `aria-busy`, `aria-live`,
Screenreader-Label; respektiert `prefers-reduced-motion`.

## Ergebnis (gemessen am Build-Output)

| Chunk | Vorher | Nachher |
|---|---|---|
| **`index` (Initial-Bundle)** | **226 KB** | **97 KB** (−57 %) |
| `Editor` (schwerste Seite) | im `index` | **109 KB**, lazy |
| `Topbar` | im `index` | 12 KB |
| `Plans` / `Login` / `Settings` | im `index` | 5 / 4 / 3 KB, lazy |

Vendor-Chunks (`three` 876 KB, `supabase` 205 KB, `router` 158 KB) bleiben
unverändert und werden bedarfsweise geladen; `three` lädt weiterhin nur beim
Öffnen der 3D-Ansicht.

**Laufzeit verifiziert** (Playwright): auf der Landing-Seite wird **kein**
Editor-Chunk geladen; bei Navigation zu `/plan/:id` lädt er on-demand, der
Fallback geht sauber in die fertige Seite über (kein FOUC/Broken State).

## Tests (P1)

`src/components/ui/RouteFallback.test.tsx` — 2 Tests (A11y-Kontrakt:
`role=status`/`aria-busy`, Lade-Label). Validiert zugleich das **RTL + jsdom +
jest-dom**-Setup für Komponenten end-to-end (bisher nur Logik/Store getestet).
Gesamt-Testsuite jetzt **90 Tests**.

## Validierung (Phase 5)

`npm run lint` 0/0 · `npm run typecheck` sauber · `npm run test` 90/90 ·
`npm run build` grün · Lazy-Loading per Playwright bestätigt.

## Entscheidungsmatrix-Abgleich

Architektur ✓ (Route-Boundaries als natürliche Split-Punkte) ·
Wiederverwendbarkeit ✓ (`RouteFallback`) · Tech-Schuld ↓ · skalierbar ✓ (jede
neue Route splittet automatisch) · Design-System ✓ (Fallback markenkonform) ·
wartbar ✓ · testbar ✓ · **performant ✓✓** (Initial-Bundle −57 %) · sicher ✓ ·
größter Nutzen ✓ (messbar schnellerer First Paint für die häufigsten
Einstiegs-Routen).
