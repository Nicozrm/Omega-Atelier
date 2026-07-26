# OMEGA Atelier 2.0 — v18 Changelog

Wand-Subtypen: **Tür** und **Fenster** als echte Geometrie.

## Was neu ist

`Wall` Type erweitert um:
- `subtype?: 'wall' | 'door' | 'window'` (default: 'wall')
- `openingWidth?` (cm) — Default 90 Tür / 120 Fenster
- `openingHeight?` (cm) — Default 100 (Fenster, ignoriert bei Tür → 200)
- `openingSill?` (cm) — Default 90 (Fenster), 0 (Tür)

## 3D-Rendering

`Wall3D` rendert die Wand als segmentierte Box-Hierarchie um die Öffnung herum:

- **Linke + rechte Seite** voller Höhe
- **Sturz** über der Öffnung (lintel)
- **Brüstung** (sill) bei Fenstern
- **Tür-Panel** in Walnuss mit Messing-Türgriff
- **Fenster** mit Glasscheibe + matter weißer Rahmen + Mullion-Kreuz
- Brass-Cap durchläuft die ganze Wand wie bisher

Reine Wände nutzen weiterhin den ursprünglichen Single-Box-Pfad (kein Performance-Verlust).

## 2D-Rendering

`drawWall()` in `canvasGlyphs.ts` erweitert: bei Tür/Fenster werden zwei Wand-Segmente gezeichnet, in der Mitte die Öffnung.

- **Tür**: Schwellenlinie + 90°-Schwingbogen (gestrichelt) + Türblatt-Linie
- **Fenster**: glas-getöntes Rechteck + zwei parallele Rails + Mittellinie

## PropertyPanel

Bei selektierter Wand drei Buttons "Wand / Tür / Fenster". Klicken setzt `subtype` und initialisiert die Default-Maße.

## ⚙️ Verifikation
- typecheck → 0 Fehler
- vite build → erfolgreich
