# CHANGELOG — Meilenstein: Accessibility-Foundation für modale Dialoge

> Bewertet nach Phase-2-Protokoll (P0–P4). **P1 (Accessibility)** — schließt
> die letzte große a11y-Lücke der interaktiven Oberfläche.

## Problem (P1 — Accessibility)

Eine Probe belegte: `ExportDialog`, `ShareDialog` und `OnboardingTour` waren
modale Overlays **ohne jede Modal-Affordanz** — 0 Treffer für `role="dialog"`,
`aria-modal`, Fokus-Trap oder Tastatur-Handling. Konkret fehlten:

- semantische Auszeichnung (`role="dialog"` / `aria-modal` / `aria-labelledby`),
- **Fokus-Trap** — Tab verließ den Dialog in den dahinterliegenden Editor,
- **Fokus-Rückgabe** an das auslösende Element beim Schließen,
- **Escape**-zum-Schließen,
- **Scroll-Lock** des Hintergrunds.

Tastatur- und Screenreader-Nutzer konnten Dialoge weder zuverlässig bedienen
noch verlassen.

## Lösung

**Ein wiederverwendbarer `Dialog`-Primitive (`src/ui/Dialog.tsx`)** ersetzt die
drei Ad-hoc-`<div className="fixed inset-0 …">`-Overlays. API:
`<Dialog open onClose title size?="sm|md|lg">…</Dialog>` — rendert Backdrop,
Panel mit voller ARIA-Auszeichnung und einen Header mit zugänglichem
Schließen-Button.

**Ein geteilter Hook (`src/ui/useModalA11y.ts`)** kapselt das
Fokus-/Tastatur-/Scroll-Verhalten und wird von **beiden** Modal-Arten genutzt —
dem `Dialog`-Primitive *und* der `OnboardingTour` (die ihr eigenes Layout +
`position`-Feature behält und daher nicht in den Primitive passt). Der Hook:

- bewegt den Fokus beim Öffnen in den Dialog,
- fängt Tab / Shift+Tab im Panel (Wrap an beiden Enden),
- schließt bei Escape (capture-Phase → leakt nicht an globale Key-Handler wie
  die Command-Palette),
- sperrt den Hintergrund-Scroll,
- gibt den Fokus beim Schließen an den Auslöser zurück.
- `onClose` wird per Ref gelesen → der Trap-Effekt läuft **nur** bei
  `open`-Wechsel neu, nicht bei jedem Re-Render (z. B. Tour-Schrittwechsel),
  der sonst den Fokus mitten in der Interaktion neu setzen würde.

## Migration (Phase 4)

- **ExportDialog** (206 Z.) → `Dialog size="md"`; gesamte Export-Logik (JSON /
  CSV / PNG / Apple-Shortcuts / HA-YAML / glTF) unverändert.
- **ShareDialog** (223 Z., zwei Render-Pfade) → beide Pfade auf `Dialog`
  (Fehler-Variante `size="sm"`, Haupt `size="md"`).
- **OnboardingTour** (138 Z.) → ARIA-Wiring + `useModalA11y`, **eigener Header**
  (Icon + Titel + Schrittzähler), das `position`-Feature (center/top/bottom)
  und `max-w-sm` bleiben erhalten.

Alle drei behalten ihr exaktes Erscheinungsbild (per Playwright verifiziert) und
gewinnen die vollständige a11y-Grundlage.

## Tests (P1)

`src/ui/Dialog.test.tsx` — **8 RTL-Tests** für den kompletten Kontrakt:
ARIA-Wiring, Render-bei-`open=false`, Escape schließt, Backdrop-Klick schließt
(Panel-Klick nicht), Initial-Fokus im Dialog, Tab/Shift+Tab-Trap-Zyklus,
Scroll-Lock + Wiederherstellung, Fokus-Rückgabe an den Auslöser.
Gesamt-Testsuite jetzt **98 Tests**.

## Validierung (Phase 5)

`npm run lint` 0/0 · `npm run typecheck` sauber · `npm run test` 98/98 ·
`npm run build` grün · Laufzeit (Playwright): Onboarding + Export tragen
`role=dialog`/`aria-modal`, Fokus liegt im Dialog, Escape schließt — bei null
visueller Regression.

## Entscheidungsmatrix-Abgleich

Architektur ✓✓ (ein Primitive + ein Hook statt drei Einzellösungen) ·
Wiederverwendbarkeit ✓✓ (jeder künftige Modal erbt die a11y-Grundlage) ·
Tech-Schuld ↓↓ · Design-System ✓ (markenkonform) · wartbar ✓ · testbar ✓✓ ·
**zugänglich ✓✓** (WCAG-konforme Modal-Semantik + Tastaturbedienung) · sicher ✓
· größter Nutzen ✓ (Grundvoraussetzung für ein professionelles, bedienbares
Produkt).
