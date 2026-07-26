# OMEGA Atelier 2.0 — v11 Changelog

Patch auf v10. Fokus: Bugfixes + saubere Skalierung + ein bisschen „mehr".

## 🔴 Bugfixes

### 1. Demo-Plan Geräte/Möbel sichtbar (war: alle grau)
`src/data/demoPlan.ts` referenzierte Katalog-IDs, die im Katalog gar nicht
existierten (z.B. `'philips-hue-white-color'` statt `'hue-e27-white-color'`,
`'sofa-3-seater'` statt `'sofa-3seat'`). Folge: jeder Lookup gegen
`DEVICE_MAP` / `FURN_MAP` lieferte `undefined`, das Canvas zeichnete nur
graue Fallback-Kreise ohne Namen. Komplett neu geschrieben mit gültigen IDs
und angereichert auf 18 Geräte / 12 Möbel quer durch alle 9 Modi.

### 2. React 18 ↔ React-Three-Fiber 9 Peer-Konflikt
`@react-three/fiber@^9.6.0` setzt React ≥19 voraus, das Projekt fährt
React 18.3.1. `npm install` schlug ohne `--legacy-peer-deps` fehl.
Pinned auf:
- `@react-three/fiber: ^8.17.10`
- `@react-three/drei:  ^9.114.0`
- `three:              ^0.169.0`
- `@types/three:       ^0.169.0`

### 3. Initial-Zoom-to-Fit war fragil
`src/components/editor/Canvas.tsx` triggerte den Auto-Fit nur, wenn
`viewport === { zoom: 0.5, offsetX: 100, offsetY: 80 }` exakt galt. Sobald
einmal gepant wurde, kam man nie mehr auf die initiale Ansicht zurück, und
auf Mobile/4K war der Default-Zoom sowieso falsch.

Ersetzt durch:
- Neue `fitToView(canvasW, canvasH, padding?)`-Action im Plan-Store.
- Canvas trackt eine `lastFitKey` aus `(planId, floorId, canvasW×H)` und
  re-fittet exakt bei Änderungen — nicht permanent, nicht magisch.

### 4. „Maximize"-Button machte echtes Reset, nicht Fit
`Toolbar.tsx` rief jetzt `fitToView()` mit der aktuellen Canvas-Größe.
Hotkey: `0` für Fit, `1` für 100% Zoom (in `useHotkeys.ts`).

### 5. Property-Panel war für Labels blind
Selektierte Beschriftungen zeigten gar nichts. Jetzt:
- Inline-Edit für Text
- Slider für Schriftgröße (10–48 px)
- Position-Readout

## 🟢 Neue Features

### Quick-Stats-Card
Neue Komponente `src/components/editor/QuickStats.tsx` in der rechten
Sidebar. Aggregiert über alle Etagen:
- Anzahl Geräte (+ Anzahl Ökosysteme, + ungeklärte Catalog-IDs)
- Anzahl Möbel
- Gesamt-Stromverbrauch (W) — nur Geräte mit `power`-Feld
- Material-Kosten (€) — nur Geräte mit `price`
- Gesamt-Wohnfläche (m²)

### Auto-Save zur Cloud
`src/pages/Editor.tsx` hat jetzt einen Debounce-Watcher auf `doc.updatedAt`.
Wenn eingeloggt + `planRowId` gesetzt + Supabase konfiguriert: 1.5 s nach
der letzten Änderung wird automatisch gespeichert. Manuelle ⌘S funktioniert
weiterhin.

### Erweiterte HUD
Canvas-HUD zeigt jetzt unten links: `Etage · Zoom% · Devices/Möbel/Wände`,
unten rechts: aktuelle Mauspos in cm.

### `.env.example`
Neue Datei mit den zwei Pflicht-Variablen:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
plus Hinweis dass `service_role` nichts im Frontend zu suchen hat.

## ⚙️ Verifikation

- `tsc -p tsconfig.json --noEmit` → **0 Fehler**
- `vite build`                    → **erfolgreich**, 1.07 MB / 302 KB gzipped
- Production-Build erstellt PWA + Service-Worker korrekt

## ⏭️ Was als nächstes drankommen sollte

Nicht in v11 enthalten, weil Scope zu groß:

1. **Live-Cursor rendern.** `useRealtimePlan` liefert `cursors` schon
   zurück, aber `Canvas` zeichnet sie nicht und `publishCursor` wird
   nirgends aufgerufen. ~30 LoC Patch.
2. **Measure-Tool**. UI-Hinweise sind da, aber `tool === 'measure'`
   ist im Canvas-PointerDown nicht behandelt — Tool ist tot.
3. **Bundle-Splitting**. Vite warnt bei 1 MB. Drei.js/lucide-react
   per dynamic import laden.
4. **Mode-Vorschau im Canvas**. Geräte nach `modeTags`-Coverage des
   aktiven Modus farblich highlighten.
