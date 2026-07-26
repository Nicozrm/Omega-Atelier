# OMEGA Atelier 2.0 — v13 Changelog

Volles Programm: alle drei v13-Kandidaten + Bonus.

## 🟢 Lucide-React Bundle-Slim (massiv)

`ModesPanel.tsx` hatte `import * as Icons from 'lucide-react'`. Das hat
Vite gezwungen, die komplette 737-KB-Icon-Library ins Bundle zu legen,
weil nichts tree-shakable war.

Ersetzt durch eine explizite Icon-Map (`MODE_ICONS`) plus benannte Imports.
Resultat:

| Chunk             | v12         | v13       |
|-------------------|------------:|----------:|
| index.js          |     107 KB |  142 KB   |
| **ui-vendor.js**  |  **737 KB** |  **— weg** |
| three.js (lazy)   |     952 KB |  952 KB   |
| supabase          |     194 KB |  194 KB   |
| router            |     162 KB |  162 KB   |

**Initial Page-Load: 844 KB → 142 KB.** Nochmal -83 % oben drauf.

## 🟢 Realtime-Konfliktlösung (Optimistic Locking)

`PlanDocument` hat ein neues `docVersion?: number` Feld. Bei jedem
`saveToCloud()`:

1. Liest die aktuelle Remote-`docVersion`
2. Wenn Remote &gt; Local → `{ conflict: true, remoteVersion }`
   wird zurückgegeben statt zu überschreiben
3. Sonst Update mit `docVersion = local + 1`

`Topbar`-Save und Auto-Save in `Editor.tsx` zeigen einen warnenden Toast
auf Konflikt. Topbar ruft 1.2 s später automatisch `reloadFromCloud()` auf,
damit der User seinen aktuellen Stand sieht statt im Konflikt zu hängen.

Neue Action: `reloadFromCloud(planRowId)` — wirft lokale Änderungen weg
und lädt den Server-Stand.

## 🟢 `applyMode()` — Mode-State auf Geräten

Neues File `src/lib/modeState.ts` definiert per Kategorie + Modus die
Default-Zustände. Beispiele:

- `light` + `night`     → `{ on: false, brightness: 0 }`
- `light` + `film`      → `{ on: true, brightness: 15, kelvin: 2200 }`
- `blind` + `morning`   → `{ position: 100 }`
- `lock` + `away`       → `{ locked: true }`
- `speaker` + `night`   → `{ volume: 0 }`
- `alarm` + `alarm`     → `{ armed: true, sounding: true }`

Komplett für alle 9 Modi × 11 aktive Kategorien (Sensors / Hubs / Other
sind passiv und bleiben leer).

`PlanStore.applyMode(key?)`:
- Geht durch alle Devices auf allen Floors
- Prüft `entry.modeTags.includes(targetMode)` (außer `auto` → alle)
- Schreibt `dev.modeState[targetMode] = modeStateFor(category, mode)`
- Returnt `{ applied, skipped }`

UI-Anbindung:
- **Button „Aktiven Modus anwenden"** im ModesPanel
- **Hotkey Shift+Enter** triggert dasselbe
- **PropertyPanel** zeigt für selektiertes Gerät den Soll-Zustand des
  aktiven Modus + Liste aller bereits konfigurierten Modi
- Toast bestätigt: `"X Geräte konfiguriert, Y übersprungen"`

## 🟢 Bonus: Cursor-Tool im Live-Cursor-Pill

Remote-Cursor zeigen jetzt nicht nur den Namen, sondern auch was der
Peer gerade tut — z.B. „Mike · Wand" oder „Anna · Messen". Auswahl-Tool
wird unterdrückt (zu rauschig).

## ⚙️ Verifikation

- `tsc --noEmit` → **0 Fehler**
- `vite build`   → **erfolgreich**

Bundle-Vergleich von v10 → v13:

```
v10  Initial:  1.07 MB           (Modes-Score: 0%, Demo: alle grau)
v11  Initial:  1.07 MB           (Demo fixed, Stats Card)
v12  Initial:    844 KB          (Lazy-load Three/Dialoge)
v13  Initial:    142 KB    🎯
```

## ⏭️ Was noch zur Vollendung fehlt

- **Mode-State pro Gerät editierbar** — Slider für brightness/temp im
  PropertyPanel, der `dev.modeState[mode][key]` direkt mutiert
- **Visuelle Konflikt-UI** statt nur Toast — z.B. Diff-Dialog
  „Hier ist was anderes passiert: A, B, C — überschreiben?"
- **Postgres CHECK auf docVersion**: Die optimistische Sperre läuft
  client-seitig. Race-Condition möglich (Read → Conflicting Write zwischen
  Read und Update). Sauber wäre eine `WHERE doc->>'docVersion' = ...`-Klausel
  im UPDATE.
- **OnboardingTour** zeigt aktuell veraltete Hotkeys.
