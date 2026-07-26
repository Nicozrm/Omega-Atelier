# Sprint Report — Nachtschicht „Referenz-Realismus: Möbel & Geräte"

## Ziel
Den 3D-Renderer sichtbar auf das Niveau der Referenzbilder heben — Schwerpunkt
Möbel- und Gerätequalität — und jeden Schritt headless (Chromium/Swiftshader)
gegen die Referenz verifizieren. Abschluss: Live-Deployment.

## Ergebnis (Kurzfassung)
Die 3D-Szene liest sich jetzt strukturell wie die Referenz: dunkle
Anthrazit-Hülle (Schnittkanten, Fassade, Sockel) um warm glühende, vollständig
eingerichtete Räume — in Dollhouse- und Ego-Perspektive. Alle Räume sind
möbliert (Wohnen/Küche/Essen/Schlafen/Bad), alle Hero-Geräte haben erkennbare
Produkt-Silhouetten.

## Diese Nachtschicht (Auszug der Commits)
| Commit | Inhalt |
|---|---|
| `8a0e8e0` | Walk-Mode Hero-Spawn (kollisionsbewusst) + Interior-Detailpass (Sofa-Rückenkissen/Armlehnen, Bett-Textilien, Falten-Vorhänge, TV-Cove-LED, Couchtisch-Deko, Pflanzen-Poly) |
| `3ae8bf1` | Downlight-Kalibrierung (Ego-View-Überstrahlung) + echter Bad-Waschtisch (Unterschrank/Stein/Aufsatzbecken/Chrom) |
| `c74db2a` | Möbelqualität: 4 Esszimmerstühle (neues Stuhl-Design), Kleiderschrank (Sockel/Türfugen/Chrom-Stangengriffe), Kommode (Schubladen/Chrom/Füße), Lowboard (Füße/Fugen) |
| `1c56367` | Geräte-Silhouetten: Sonos-Arc-Soundbar & Apple-TV-Puck **auf** dem Lowboard, Echo Dot (blauer Lichtring), Hue Bridge (Status-LEDs), Rauchmelder **an der Decke**, Aqara FP2 (Wand-Puck), Eve Thermo (**echter Heizkörper** + Ventil) |
| *(dieser)* | Wandbild von Schrankkante gelöst, Doku |

## Gates (jeder Commit)
| Gate | Ergebnis |
|---|---|
| TypeScript | ✅ 0 Fehler |
| ESLint (`--max-warnings 0`) | ✅ 0/0 |
| Vitest | ✅ 224/224 |
| Build | ✅ (~17–27 s) |
| Bundle | ✅ konstant (Entry ~28 kB gz, three ~251 kB gz) |
| Visuell | ✅ Headless-Screenshots (Dollhouse + Walk) pro Schritt |

## Performance
Reiner Szenen-Code, kein neuer Import. Lichtbudget: ≤10 schattenlose
Downlights (Tier-gated) + wenige Akzentlichter; pro Lampe kein doppeltes
Punktlicht (Mesh glüht, `RoomLights` beleuchtet). Neue Geometrie ausschließlich
gebevelte Primitives — kein Draw-Call-Hotspot.

## Ehrliche Grenzen
Swiftshader-Farben/Helligkeit können von echter GPU abweichen; finale
Belichtungsabnahme braucht das Auge des Nutzers am Gerät. GLB-Assets (Poly
Haven/CC0) sind vorbereitet (Registry + Lazy-Load + Fallback), aber noch nicht
eingepflegt — prozedurale Meshes sind Stand heute die Qualitätsquelle.

## Nächste Prioritäten
1. Ego-View-Kontrast (dunklere Akzent-Textilien, Boden-Sichtbarkeit auf Augenhöhe)
2. Bibliothek-Karten mit Thumbnails (letzter großer UI-Baustein der Referenz)
3. CC0-GLB-Assets für Sofa/Bett/Stühle einpflegen
4. Automations-/Szenen-Visualisierung im Digital Twin
