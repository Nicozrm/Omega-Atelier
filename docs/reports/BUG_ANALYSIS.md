# OMEGA Atelier 2.0 — Bug-Analyse (Root Causes)

## Bug 1: Canvas leer (Templates laden nicht / Rendering Bug)
**Datei:** `src/pages/Editor.tsx`
**Root Cause:** Wenn die Route `/plan/new` oder `/plan/local` geöffnet wird, ist `planRowId = undefined`. Der `useEffect` für DB-Laden wird übersprungen. Aber es gibt KEINEN Code, der automatisch ein neues Blank-Plan erstellt. `newBlank()` im Store existiert, wird aber nie aufgerufen.
**Fix:** Nach dem Laden-Effect, wenn `!doc && !planRowId`, `newBlank()` aufrufen.

## Bug 2: Omega-Modi alle 0%
**Dateien:** `src/types/index.ts`, `src/data/devices.ts`, `src/components/modes/ModesPanel.tsx`
**Root Cause:** `DeviceCatalogEntry` hat kein `modeTags` Feld. Der Readiness-Score in `ModesPanel` berechnet nur aus `category`, was grob ist. Die Geräte wissen nicht, welche Omega-Modi sie unterstützen.
**Fix:** 
1. `modeTags?: ModeKey[]` zu `DeviceCatalogEntry` hinzufügen
2. Alle Geräte in `devices.ts` mit passenden `modeTags` versehen
3. `ModesPanel.tsx` den Score aus `modeTags` berechnen lassen

## Bug 3: Umlaute kaputt
**Dateien:** `index.html`, `vite.config.ts`
**Root Cause:** Zwar ist `<meta charset="UTF-8" />` im HTML, aber Vite serve die JS-Bundles möglicherweise ohne korrekten Charset-Header. Kein expliziter Encoding-Hinweis in der Vite-Konfiguration.
**Fix:** `charset` in Vite-Config hinzufügen, HTML-Meta-Tags verstärken.

## Bug 4: Eigenschaften-Panel leer
**Datei:** `src/components/editor/PropertyPanel.tsx`
**Root Cause:** Folgefehler von Bug #1. Wenn kein Canvas existiert, kann nichts selektiert werden. Aber zusätzlich: `PropertyPanel` rendert keine Wall-Info und kein Measure-Tool-Panel.
**Fix:** Mit Bug #1 zusammen fixen. Zusätzlich Wall-Properties und Measurement-Panel ergänzen.

## Bug 5: useRealtimePlan nicht verdrahtet
**Datei:** `src/pages/Editor.tsx`
**Root Cause:** `useRealtimePlan` Hook ist fertig in `src/hooks/useRealtimePlan.ts`, aber `Editor.tsx` importiert ihn nicht und ruft ihn nicht auf.
**Fix:** Import hinzufügen, Hook mit `planRowId` aufrufen, Cursor-Render in Canvas optional hinzufügen.

## Bug 6: PWA-Icons fehlen
**Datei:** `public/`
**Root Cause:** Nur `favicon.svg` und `icon-placeholder.md` existieren. Kein `manifest.json`, keine PNG-Icons in verschiedenen Größen, keine Apple-Touch-Icons.
**Fix:** Manifest erstellen, Icons generieren, HTML-Link-Tags hinzufügen.
