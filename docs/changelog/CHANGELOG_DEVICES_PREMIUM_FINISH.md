# Geräte D1 — Premium-Materialien (Anodisiertes Aluminium + Soft-Touch-Schwarz)

## Analyse / Problem
Geräte (Lautsprecher, Kamera, Lampen, Sensoren) nutzten generisches `matteWhite`/`matteBlack`/
Inline-Standardmaterial → wirkten wie billiger Kunststoff statt wie hochwertige Markenprodukte
(Sonos/Apple/Hue-Anmutung).

## Warum dieser Hebel
Der Smart-Home-Twin ist gerätezentriert — die Geräte sind die „Helden-Produkte". Premium-
Oberflächen heben den Produktcharakter spürbar. GPU-günstig (Parametermaterialien, **keine**
neue Textur), und über die Material-Registry zentral wiederverwendbar.

## Implementierung (additiv)
Zwei neue Materialien:
- **`aluminium`** — anodisiert: `metalness 0.9`, `roughness 0.42`, dezenter `clearcoat 0.15`
  → satinmattes Premium-Metall.
- **`softBlack`** — Soft-Touch-Elektronikschwarz: `roughness 0.55`, `clearcoat 0.25` → matter
  Kunststoff mit feinem Schimmer statt flachem Schwarz.

Verdrahtung der ikonischen Geräte: **Lautsprecher-Korpus → softBlack**, **Kamera-Korpus →
aluminium**, **Lampensäule → aluminium**. (Weitere Geräte folgen inkrementell.)

## Performance / Risiko
- **GPU:** zwei zusätzliche, geteilte Materialinstanzen; Clearcoat nur auf kleinen
  Geräte-Meshes (wenige Fragmente) und auf schwachen Geräten ohnehin via `leanizeForPerf`
  entfernt. **Per-Light-Kosten praktisch unverändert.** Bundle ~konstant (+0,07 kB gz).
- **Risiko:** gering; bestehende geteilte `matteWhite/Black` unangetastet (keine Seiteneffekte).

## Vorher / Nachher
- Vorher: Geräte in flachem Weiß/Schwarz (Plastik-Look).
- Nachher: Lautsprecher in Soft-Touch-Schwarz, Kamera/Lampe in anodisiertem Aluminium →
  Markenprodukt-Anmutung.

## Validierung
TS 0 · ESLint 0/0 · Tests 224/224 · Build ✓ · Bundle ~konstant · Desktop/Mobile 200 ·
Offline-First ✓.

## Nächster Hebel
Weitere Geräte-Verdrahtung (Thermostat, Hub, Sensoren, Plugs → aluminium/softBlack) sowie
**Lautsprecher-Bespannung** als Stoff-Sheen-Material; danach **Specular/IOR-Korrektheit** auf
Dielektrika (GPU-neutral).
