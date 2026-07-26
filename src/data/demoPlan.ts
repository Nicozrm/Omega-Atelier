import type { PlanDocument } from '@/types'
import { OMEGA_MODES } from '@/lib/constants'

/**
 * Demo plan — Nachbau einer echten Erdgeschoss-Neubauwohnung mit Terrasse.
 *
 * Grundriss (nach Architektenplan + Saugroboter-Karte rekonstruiert):
 *   Eingang/Flur (West) → Gäste-Bad, Schlafzimmer, Abstellraum, offene
 *   Wohnküche mit Essbereich, große Schiebetür zur Terrasse (Ost).
 *
 * Möblierung & Smart-Home spiegeln die Referenzfotos wider:
 *   - Govee-Lichter (Lichterzweige, RGBIC-Strips als Underglow, Steh-/Tischlampen)
 *   - Nuki Smart-Lock + Netatmo-Türsprechanlage am Eingang
 *   - Aquarium (Zwischenstecker), Plissees, Unterschrank-LED in der Küche
 *   - Außenspots, Lichterkette in der Hecke, Bewässerung & Kamera auf der Terrasse
 *
 * Koordinaten in cm, Ursprung oben-links. Innenblock 740×820, Terrasse östlich.
 * Alle deviceId/furnitureId referenzieren gültige Katalog-Einträge
 * (devices.ts / furniture.ts), Materialien via *MaterialId (materials.ts).
 */
export function createDemoPlan(): PlanDocument {
  const F = 'floor-oak-parquet'
  const W = 'wall-plaster'
  const C = 'ceiling-white'
  return {
    schemaVersion: 2,
    id: 'demo',
    title: 'Mein Smart Home',
    description: 'Nachbau meiner Wohnung — Erdgeschoss-Neubau mit Terrasse, voll möbliert & vernetzt',
    floors: [
      {
        id: 'f1',
        name: 'Erdgeschoss',
        index: 0,
        rooms: [
          { id: 'r_bad',    name: 'Bad',            polygon: [{ x:   0, y:   0 }, { x: 250, y:   0 }, { x: 250, y: 270 }, { x:   0, y: 270 }], floorMaterialId: 'floor-ceramic-light', wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_flur',   name: 'Flur',           polygon: [{ x:   0, y: 270 }, { x: 250, y: 270 }, { x: 250, y: 500 }, { x:   0, y: 500 }], floorMaterialId: F, wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_abst',   name: 'Abstellraum',    polygon: [{ x:   0, y: 500 }, { x: 250, y: 500 }, { x: 250, y: 820 }, { x:   0, y: 820 }], floorMaterialId: 'floor-vinyl-light', wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_schlaf', name: 'Schlafzimmer',   polygon: [{ x: 250, y:   0 }, { x: 740, y:   0 }, { x: 740, y: 340 }, { x: 250, y: 340 }], floorMaterialId: F, wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_kueche', name: 'Küche',          polygon: [{ x: 250, y: 340 }, { x: 740, y: 340 }, { x: 740, y: 520 }, { x: 250, y: 520 }], floorMaterialId: F, wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_wohnen', name: 'Wohnen / Essen', polygon: [{ x: 250, y: 520 }, { x: 740, y: 520 }, { x: 740, y: 820 }, { x: 250, y: 820 }], floorMaterialId: F, wallMaterialId: W, ceilingMaterialId: C },
          { id: 'r_terr',   name: 'Terrasse',       polygon: [{ x: 740, y: 340 }, { x: 1200, y: 340 }, { x: 1200, y: 820 }, { x: 740, y: 820 }], zoneType: 'outdoor' },
        ],
        walls: [
          // ── Außenwände (mit Fenstern/Türen an Raumgrenzen aufgeteilt) ──
          // Nord
          { id: 'wN1a', a: { x:   0, y:   0 }, b: { x: 115, y:   0 }, thickness: 24 },                                                                          // hinter der Walk-in-Dusche (fensterlos)
          { id: 'wN1b', a: { x: 115, y:   0 }, b: { x: 250, y:   0 }, thickness: 24, subtype: 'window', openingWidth: 70,  openingHeight: 70,  openingSill: 130 }, // Milchglas-Fenster über dem Waschbecken
          { id: 'wN2', a: { x: 250, y:   0 }, b: { x: 740, y:   0 }, thickness: 24, subtype: 'window', openingWidth: 170, openingHeight: 130, openingSill: 90 },
          // Ost — Schlafzimmer (bodentiefes Fenster mit Plissee)
          { id: 'wE1', a: { x: 740, y:   0 }, b: { x: 740, y: 340 }, thickness: 24, subtype: 'window', openingWidth: 180, openingHeight: 210, openingSill: 15 },
          // Ost — Küche → Terrasse (Fenster)
          { id: 'wE2', a: { x: 740, y: 340 }, b: { x: 740, y: 520 }, thickness: 24, subtype: 'window', openingWidth: 140, openingHeight: 140, openingSill: 95 },
          // Ost — Wohnen → Terrasse (große Schiebetür)
          { id: 'wE3', a: { x: 740, y: 520 }, b: { x: 740, y: 820 }, thickness: 24, subtype: 'door', openingWidth: 210 },
          // Süd
          { id: 'wS1', a: { x: 740, y: 820 }, b: { x: 250, y: 820 }, thickness: 24 },
          { id: 'wS2', a: { x: 250, y: 820 }, b: { x:   0, y: 820 }, thickness: 24 },
          // West — Abstellraum, Flur (Eingangstür), Bad
          { id: 'wW1', a: { x:   0, y: 820 }, b: { x:   0, y: 500 }, thickness: 24 },
          { id: 'wW2', a: { x:   0, y: 500 }, b: { x:   0, y: 270 }, thickness: 24, subtype: 'door', openingWidth: 100 },
          { id: 'wW3', a: { x:   0, y: 270 }, b: { x:   0, y:   0 }, thickness: 24 },
          // ── Innenwände ──
          { id: 'wI1', a: { x: 250, y:   0 }, b: { x: 250, y: 340 }, thickness: 14 },                                            // Bad/Flur ↔ Schlafzimmer
          { id: 'wI2', a: { x: 250, y: 340 }, b: { x: 250, y: 500 }, thickness: 14, subtype: 'door', openingWidth: 110 },        // Flur ↔ Wohnküche (offener Durchgang)
          { id: 'wI3', a: { x: 250, y: 500 }, b: { x: 250, y: 820 }, thickness: 14 },                                            // Abstellraum ↔ Wohnen
          { id: 'wI4a', a: { x:   0, y: 270 }, b: { x:  90, y: 270 }, thickness: 14, subtype: 'door', openingWidth: 74 },        // Flur ↔ Bad (Tür westlich, Nische frei)
          { id: 'wI4b', a: { x:  90, y: 270 }, b: { x: 250, y: 270 }, thickness: 14 },                                           // Wand über der Garderoben-Nische
          { id: 'wI5', a: { x:   0, y: 500 }, b: { x: 250, y: 500 }, thickness: 14, subtype: 'door', openingWidth: 80 },         // Flur ↔ Abstellraum
          { id: 'wI6', a: { x: 250, y: 340 }, b: { x: 740, y: 340 }, thickness: 14, subtype: 'door', openingWidth: 90 },         // Schlafzimmer ↔ Küche
          // (keine Wand zwischen Küche & Wohnen/Essen — offener Wohnküchen-Grundriss)
        ],
        devices: [
          // ── Flur / Eingang ──
          { id: 'd1',  deviceId: 'lockin-g30',         position: { x:  16, y: 360 }, rotation: 90, roomId: 'r_flur', note: 'Wohnungstür — Lockin Smart-Lock' },
          { id: 'd40', deviceId: 'aqara-door-sensor', position: { x:  16, y: 340 }, rotation: 90, roomId: 'r_flur', note: 'Tür-Kontaktsensor' },
          { id: 'd2',  deviceId: 'netatmo-doorbell',  position: { x:  24, y: 305 }, rotation: 90, roomId: 'r_flur', note: 'RITTO Türsprechanlage' },
          { id: 'd42', deviceId: 'switchbot-bot',     position: { x:  24, y: 312 }, rotation: 90, roomId: 'r_flur', note: 'SwitchBot — Türöffner-Taste' },
          { id: 'd3',  deviceId: 'hue-motion',        position: { x:  30, y: 470 }, rotation: 0,  roomId: 'r_flur', note: 'Bewegung Flur' },
          { id: 'd41', deviceId: 'govee-string-lights', position: { x: 240, y: 305 }, rotation: 0, roomId: 'r_flur', note: 'Lichterkette Mooswand', modeState: { auto: { on: true, brightness: 45, color: '#ffcf82' }, relax: { on: true, brightness: 45, color: '#ffcf82' }, film: { on: true, brightness: 25, color: '#ffbf6a' }, night: { on: true, brightness: 16, color: '#ffbf6a' }, party: { on: true, brightness: 60, color: '#ffbe73' } } },
          { id: 'd4',  deviceId: 'govee-table-lamp',  position: { x: 166, y: 304 }, rotation: 0,  roomId: 'r_flur', note: 'Tischlampe (Schuhbank)', modeState: { relax: { on: true, brightness: 45, color: '#ffab54' }, film: { on: true, brightness: 20, color: '#ff8a3a' }, party: { on: true, brightness: 70, color: '#1e90ff' }, night: { on: true, brightness: 14, color: '#ff8a3a' } } },
          { id: 'd5',  deviceId: 'govee-rgbic-strip-pro', position: { x: 195, y: 306 }, rotation: 0, roomId: 'r_flur', note: 'LED-Underglow Schuhbank', modeState: { relax: { on: true, brightness: 40, color: '#ffcf82' }, film: { on: true, brightness: 22, color: '#ffbf6a' }, party: { on: true, brightness: 70, color: '#1e90ff' }, night: { on: true, brightness: 16, color: '#ffbf6a' } } },

          // ── Bad ──
          { id: 'd6',  deviceId: 'shelly-1pm-mini',   position: { x: 125, y: 135 }, rotation: 0, roomId: 'r_bad', note: 'Deckenlicht Bad' },
          { id: 'd7',  deviceId: 'govee-rgbic-strip-pro', position: { x: 244, y: 85 }, rotation: 0, roomId: 'r_bad', note: 'RGB-Backlight Spiegel (blau/lila)', modeState: { relax: { on: true, brightness: 45, color: '#3b6bff' }, film: { on: true, brightness: 30, color: '#6a3bff' }, party: { on: true, brightness: 75, color: '#8a2be2' }, night: { on: true, brightness: 12, color: '#2440cc' } } },
          { id: 'd8',  deviceId: 'hue-motion',        position: { x: 240, y:  22 }, rotation: 0, roomId: 'r_bad', note: 'Bewegung Bad' },

          // ── Schlafzimmer ──
          { id: 'd9',  deviceId: 'govee-table-lamp',  position: { x: 300, y: 110 }, rotation: 0, roomId: 'r_schlaf', note: 'Nachttischlampe RGB', modeState: { relax: { on: true, brightness: 40, color: '#ff2f1e' }, film: { on: true, brightness: 22, color: '#ff2a2a' }, party: { on: true, brightness: 70, color: '#ff1e5a' }, night: { on: true, brightness: 10, color: '#ff5a2a' } } },
          { id: 'd10', deviceId: 'shelly-1pm-mini',   position: { x: 450, y: 150 }, rotation: 0, roomId: 'r_schlaf', note: 'Pendelleuchte Schlafzimmer' },
          { id: 'd11', deviceId: 'govee-rgbic-strip-pro', position: { x: 400, y: 300 }, rotation: 0, roomId: 'r_schlaf', note: 'LED unterm Bett', modeState: { relax: { on: true, brightness: 35, color: '#ff2f1e' }, film: { on: true, brightness: 18, color: '#e01e1e' }, party: { on: true, brightness: 65, color: '#ff1e5a' }, night: { on: true, brightness: 8, color: '#ff3a1e' } } },
          { id: 'd12', deviceId: 'aqara-fp2',         position: { x: 470, y:  30 }, rotation: 0, roomId: 'r_schlaf', note: 'Präsenz Schlafzimmer' },
          { id: 'd13', deviceId: 'eve-thermo',        position: { x: 720, y: 300 }, rotation: 0, roomId: 'r_schlaf', note: 'Heizkörper Schlafzimmer' },
          { id: 'd14', deviceId: 'apple-tv-4k',       position: { x: 480, y: 320 }, rotation: 0, roomId: 'r_schlaf', note: 'Beamer / Google TV' },

          // ── Küche ──
          { id: 'd15', deviceId: 'shelly-plus-2pm',   position: { x: 490, y: 358 }, rotation: 0, roomId: 'r_kueche', note: 'Küchenlicht' },
          { id: 'd16', deviceId: 'govee-rgbic-strip-pro', position: { x: 490, y: 368 }, rotation: 0, roomId: 'r_kueche', note: 'Unterschrank-LED', modeState: { relax: { on: true, brightness: 45, color: '#ffcf99' }, film: { on: false, brightness: 0 }, party: { on: true, brightness: 70, color: '#33dd88' }, night: { on: true, brightness: 10, color: '#ffb066' } } },
          { id: 'd17', deviceId: 'eve-energy',        position: { x: 610, y: 375 }, rotation: 0, roomId: 'r_kueche', note: 'Kaffeemaschine' },
          { id: 'd18', deviceId: 'echo-dot-5',        position: { x: 330, y: 375 }, rotation: 0, roomId: 'r_kueche', note: 'Alexa Küche' },
          { id: 'd19', deviceId: 'smartlife-plug',    position: { x: 285, y: 360 }, rotation: 0, roomId: 'r_kueche', note: 'Aquarium (Steckdose)' },
          { id: 'd20', deviceId: 'hue-e27-white-color', position: { x: 500, y: 430 }, rotation: 0, roomId: 'r_kueche', note: 'Pendelleuchte Essbereich' },
          { id: 'd39', deviceId: 'govee-rgbic-strip-pro', position: { x: 300, y: 348 }, rotation: 0, roomId: 'r_kueche', note: 'Aquarium-Beleuchtung (grün)', modeState: { auto: { on: true, brightness: 55, color: '#2fdd6a' }, morning: { on: true, brightness: 55, color: '#2fdd6a' }, 'day-office': { on: true, brightness: 55, color: '#2fdd6a' }, relax: { on: true, brightness: 45, color: '#2fdd6a' }, film: { on: true, brightness: 40, color: '#25c85e' }, night: { on: true, brightness: 25, color: '#25c85e' }, party: { on: true, brightness: 70, color: '#33ff88' } } },

          // ── Wohnen / Essen ──
          { id: 'd21', deviceId: 'sonos-arc-ultra',   position: { x: 380, y: 800 }, rotation: 0, roomId: 'r_wohnen', note: 'Soundbar' },
          { id: 'd22', deviceId: 'apple-tv-4k',       position: { x: 410, y: 800 }, rotation: 0, roomId: 'r_wohnen', note: 'Apple TV' },
          { id: 'd23', deviceId: 'hue-lightstrip-plus', position: { x: 350, y: 805 }, rotation: 0, roomId: 'r_wohnen', note: 'TV-Backlight' },
          { id: 'd24', deviceId: 'govee-floor-lamp',  position: { x: 280, y: 620 }, rotation: 0, roomId: 'r_wohnen', note: 'Stehlampe RGB', modeState: { relax: { on: true, brightness: 45, color: '#ffb066' }, film: { on: true, brightness: 15, color: '#ff8a4d' }, party: { on: true, brightness: 80, color: '#2e6bff' }, night: { on: true, brightness: 10, color: '#ff8a4d' } } },
          { id: 'd25', deviceId: 'govee-string-lights', position: { x: 690, y: 580 }, rotation: 0, roomId: 'r_wohnen', note: 'Lichterzweige Wand', modeState: { relax: { on: true, brightness: 50, color: '#ffbe73' }, film: { on: true, brightness: 20, color: '#ffa04d' }, party: { on: true, brightness: 80, color: '#ff2ea6' }, night: { on: true, brightness: 14, color: '#ffbe73' } } },
          { id: 'd26', deviceId: 'govee-rgbic-strip-pro', position: { x: 430, y: 762 }, rotation: 0, roomId: 'r_wohnen', note: 'Sofa-Underglow', modeState: { relax: { on: true, brightness: 40, color: '#ffb066' }, film: { on: true, brightness: 18, color: '#ff8a4d' }, party: { on: true, brightness: 75, color: '#33dd88' }, night: { on: true, brightness: 10, color: '#ff8a4d' } } },
          { id: 'd27', deviceId: 'govee-table-lamp',  position: { x: 500, y: 460 }, rotation: 0, roomId: 'r_wohnen', note: 'Tisch-Stimmungslampe (Essen)', modeState: { relax: { on: true, brightness: 45, color: '#ff5a3c' }, film: { on: true, brightness: 20, color: '#ff4d2a' }, party: { on: true, brightness: 70, color: '#ff2ea6' }, night: { on: true, brightness: 12, color: '#ff5a3c' } } },
          { id: 'd28', deviceId: 'ikea-praktlysing',  position: { x: 735, y: 660 }, rotation: 0, roomId: 'r_wohnen', note: 'Plissee Terrassentür' },
          { id: 'd29', deviceId: 'bosch-twinguard',   position: { x: 350, y: 680 }, rotation: 0, roomId: 'r_wohnen', note: 'Rauchmelder' },
          { id: 'd30', deviceId: 'google-nest-hub-2', position: { x: 690, y: 560 }, rotation: 0, roomId: 'r_wohnen', note: 'Nest Hub' },
          { id: 'd31', deviceId: 'aqara-fp2',         position: { x: 300, y: 540 }, rotation: 0, roomId: 'r_wohnen', note: 'Präsenz Wohnzimmer' },
          { id: 'd32', deviceId: 'hue-bridge',        position: { x: 700, y: 805 }, rotation: 0, roomId: 'r_wohnen', note: 'Hue Bridge' },

          // ── Abstellraum ──
          { id: 'd33', deviceId: 'shelly-plug-s',     position: { x:  55, y: 765 }, rotation: 0, roomId: 'r_abst', note: 'Waschmaschine (Zwischenstecker)' },

          // ── Terrasse ──
          { id: 'd34', deviceId: 'govee-permanent-outdoor', position: { x: 760, y: 360 }, rotation: 0, roomId: 'r_terr', note: 'Fassaden-Spots' },
          { id: 'd35', deviceId: 'govee-string-lights',     position: { x: 900, y: 360 }, rotation: 0, roomId: 'r_terr', note: 'Lichterkette Hecke' },
          { id: 'd36', deviceId: 'osaio-outdoor-4mp',       position: { x: 760, y: 400 }, rotation: 0, roomId: 'r_terr', note: 'Außenkamera' },
          { id: 'd37', deviceId: 'gardena-irrigation',      position: { x: 1150, y: 500 }, rotation: 0, roomId: 'r_terr', note: 'Bewässerung Beet' },
          { id: 'd38', deviceId: 'govee-floor-lamp',        position: { x: 1000, y: 660 }, rotation: 0, roomId: 'r_terr', note: 'Outdoor-Laterne' },
        ],
        furniture: [
          // ── Bad ── (1:1-Klon des echten EG-Badezimmers: Walk-in-Dusche mit
          //   Punktablauf, kleines Wand-Waschbecken unter RGB-Spiegel, Wand-WC,
          //   weißer Hochschrank + Handtuchheizkörper, dunkle Hochflor-Matten)
          { id: 'fu1',  furnitureId: 'shower',         position: { x:  52, y: 107 }, rotation: 0,   size: [103, 214], roomId: 'r_bad', label: 'Walk-in-Dusche' },
          { id: 'fu2',  furnitureId: 'toilet',         position: { x: 220, y: 200 }, rotation: 270, size: [40, 60],   roomId: 'r_bad', label: 'Wand-WC' },
          { id: 'fu3',  furnitureId: 'sink-bath',      position: { x: 230, y:  85 }, rotation: 270, size: [50, 39],   roomId: 'r_bad', label: 'Waschbecken' },
          { id: 'fu4',  furnitureId: 'mirror',         position: { x: 248, y:  85 }, rotation: 270, size: [50, 4],    roomId: 'r_bad', label: 'Spiegel (RGB-Backlight)' },
          { id: 'fu5',  furnitureId: 'bath-mat',       position: { x: 150, y: 150 }, rotation: 0,   size: [80, 55],   roomId: 'r_bad', label: 'Badematte' },
          { id: 'fu5b', furnitureId: 'bath-mat',       position: { x: 138, y: 242 }, rotation: 0,   size: [70, 46],   roomId: 'r_bad', label: 'Badematte (Tür)' },
          { id: 'fu6',  furnitureId: 'towel-radiator', position: { x: 205, y: 262 }, rotation: 180, size: [60, 10],   roomId: 'r_bad', label: 'Handtuchheizkörper' },
          { id: 'fu6b', furnitureId: 'bath-cabinet',   position: { x: 120, y: 257 }, rotation: 180, size: [40, 24],   roomId: 'r_bad', label: 'Hochschrank' },

          // ── Eingang / Flur (1:1 nach Fotos) ──
          { id: 'fu51', furnitureId: 'entrance-door', position: { x:  10, y: 385 }, rotation: 90, size: [96, 5],   roomId: 'r_flur', label: 'Wohnungstür' },
          { id: 'fu52', furnitureId: 'intercom',      position: { x:   8, y: 305 }, rotation: 90, size: [12, 4],   roomId: 'r_flur', label: 'Türsprechanlage' },
          { id: 'fu53', furnitureId: 'coat-rail',     position: { x: 195, y: 276 }, rotation: 0,  size: [90, 6],   roomId: 'r_flur', label: 'Garderobe mit Jacken' },
          { id: 'fu9',  furnitureId: 'neon-sign',     position: { x: 195, y: 274 }, rotation: 0,  size: [34, 4],   roomId: 'r_flur', label: 'Neon-Schild' },
          { id: 'fu7',  furnitureId: 'shoe-bench',    position: { x: 195, y: 302 }, rotation: 0,  size: [95, 34],  roomId: 'r_flur', label: 'Schuhbank (LED)' },
          { id: 'fu8',  furnitureId: 'branch-lights', position: { x:  30, y: 290 }, rotation: 0,  size: [32, 32],  roomId: 'r_flur', label: 'Lichterzweige' },
          { id: 'fu10', furnitureId: 'fur-rug',       position: { x: 195, y: 372 }, rotation: 0,  size: [115, 90], roomId: 'r_flur', label: 'Fell-Teppich' },
          { id: 'fu54', furnitureId: 'moss-wall-art', position: { x: 243, y: 305 }, rotation: 270, size: [72, 6],  roomId: 'r_flur', label: 'Mooswand' },
          { id: 'fu55', furnitureId: 'ceiling-panel', position: { x: 125, y: 400 }, rotation: 0,   size: [42, 42], roomId: 'r_flur', label: 'LED-Deckenpanel' },

          // ── Abstellraum ──
          { id: 'fu11', furnitureId: 'washing-machine', position: { x:  55, y: 770 }, rotation: 0, size: [60, 60], roomId: 'r_abst', label: 'Waschmaschine' },
          { id: 'fu12', furnitureId: 'bookshelf', position: { x:  55, y: 555 }, rotation: 0, size: [80, 30], roomId: 'r_abst', label: 'Regal' },

          // ── Schlafzimmer ──
          { id: 'fu13', furnitureId: 'bed-180',   position: { x: 400, y: 190 }, rotation: 0,   size: [185, 210], roomId: 'r_schlaf', label: 'Boxspringbett', materialKey: 'fabricGray' },
          { id: 'fu14', furnitureId: 'nightstand', position: { x: 285, y:  95 }, rotation: 0,  size: [45, 40],  roomId: 'r_schlaf', label: 'Nachttisch' },
          { id: 'fu15', furnitureId: 'dresser',   position: { x: 700, y: 180 }, rotation: 90,  size: [110, 45], roomId: 'r_schlaf', label: 'Sideboard (LED)', materialKey: 'leatherBlack' },
          { id: 'fu16', furnitureId: 'wardrobe-200', position: { x: 355, y: 315 }, rotation: 0, size: [190, 50], roomId: 'r_schlaf', label: 'Kleiderschrank' },
          { id: 'fu17', furnitureId: 'wall-art',   position: { x: 300, y:  10 }, rotation: 0,   size: [110, 4],  roomId: 'r_schlaf', label: 'Mondphasen-Poster' },
          { id: 'fu18', furnitureId: 'wall-art',   position: { x: 620, y: 335 }, rotation: 180, size: [90, 4],   roomId: 'r_schlaf', label: 'Hirsch-Bild' },
          { id: 'fu19', furnitureId: 'rug-small',  position: { x: 400, y: 250 }, rotation: 0,   size: [120, 180], roomId: 'r_schlaf', label: 'Fell-Teppich' },
          { id: 'fu20', furnitureId: 'plant',      position: { x: 700, y:  60 }, rotation: 0,   size: [50, 50],  roomId: 'r_schlaf', label: 'Pflanze' },
          { id: 'fu46', furnitureId: 'gym-rings',  position: { x: 700, y: 120 }, rotation: 0,   size: [40, 20],  roomId: 'r_schlaf', label: 'Gymnastikringe' },
          { id: 'fu47', furnitureId: 'wall-screen', position: { x: 400, y: 336 }, rotation: 180, size: [180, 4], roomId: 'r_schlaf', label: 'Beamer-Projektion' },

          // ── Küche + Essbereich (offen) ──
          { id: 'fu21', furnitureId: 'kitchen-row', position: { x: 490, y: 372 }, rotation: 0, size: [340, 60], roomId: 'r_kueche', label: 'Küchenzeile', materialKey: 'leatherBlack' },
          { id: 'fu22', furnitureId: 'plant',      position: { x: 300, y: 370 }, rotation: 0, size: [40, 40], roomId: 'r_kueche', label: 'Kräuter' },
          { id: 'fu23', furnitureId: 'table-dining-6', position: { x: 500, y: 460 }, rotation: 0, size: [180, 90], roomId: 'r_kueche', label: 'Esstisch Eiche', materialKey: 'oak' },
          { id: 'fu24', furnitureId: 'chair-dining', position: { x: 430, y: 405 }, rotation: 180, size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu25', furnitureId: 'chair-dining', position: { x: 500, y: 405 }, rotation: 180, size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu26', furnitureId: 'chair-dining', position: { x: 570, y: 405 }, rotation: 180, size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu27', furnitureId: 'chair-dining', position: { x: 430, y: 515 }, rotation: 0,   size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu28', furnitureId: 'chair-dining', position: { x: 500, y: 515 }, rotation: 0,   size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu29', furnitureId: 'chair-dining', position: { x: 570, y: 515 }, rotation: 0,   size: [45, 50], roomId: 'r_kueche', label: 'Stuhl' },
          { id: 'fu48', furnitureId: 'pendant-lamp', position: { x: 500, y: 455 }, rotation: 0, size: [34, 34], roomId: 'r_kueche', label: 'Pendelleuchte Esstisch' },

          // ── Wohnen / Essen ──
          { id: 'fu30', furnitureId: 'sofa-corner', position: { x: 430, y: 690 }, rotation: 0, size: [280, 200], roomId: 'r_wohnen', label: 'Ecksofa Samt Grau', materialKey: 'fabricGray' },
          { id: 'fu31', furnitureId: 'table-coffee', position: { x: 400, y: 660 }, rotation: 0, size: [110, 60], roomId: 'r_wohnen', label: 'Couchtisch' },
          { id: 'fu32', furnitureId: 'rug-large',   position: { x: 430, y: 700 }, rotation: 0, size: [250, 300], roomId: 'r_wohnen', label: 'Hochflor-Teppich' },
          { id: 'fu33', furnitureId: 'tv-stand',    position: { x: 380, y: 805 }, rotation: 0, size: [140, 40], roomId: 'r_wohnen', label: 'Media-Konsole', materialKey: 'leatherBlack' },
          { id: 'fu34', furnitureId: 'plant-tall',  position: { x: 270, y: 560 }, rotation: 0, size: [40, 40], roomId: 'r_wohnen', label: 'Pflanze' },
          { id: 'fu35', furnitureId: 'branch-lights', position: { x: 700, y: 545 }, rotation: 0, size: [32, 32], roomId: 'r_wohnen', label: 'Lichterzweige' },
          { id: 'fu36', furnitureId: 'wall-art-wide', position: { x: 495, y: 815 }, rotation: 180, size: [140, 4], roomId: 'r_wohnen', label: 'Wandbild' },
          { id: 'fu49', furnitureId: 'pendant-lamp', position: { x: 430, y: 690 }, rotation: 0, size: [34, 34], roomId: 'r_wohnen', label: 'Pendelleuchte' },
          { id: 'fu50', furnitureId: 'table-side',   position: { x: 640, y: 700 }, rotation: 0, size: [50, 50], roomId: 'r_wohnen', label: 'Beistelltisch' },

          // ── Terrasse ──
          { id: 'fu37', furnitureId: 'sofa-corner', position: { x: 900, y: 700 }, rotation: 0, size: [280, 200], roomId: 'r_terr', label: 'Lounge-Sofa', materialKey: 'leatherBlack' },
          { id: 'fu38', furnitureId: 'outdoor-table', position: { x: 900, y: 610 }, rotation: 0, size: [110, 60], roomId: 'r_terr', label: 'Loungetisch' },
          { id: 'fu39', furnitureId: 'lounge-chair', position: { x: 810, y: 770 }, rotation: 0, size: [80, 80], roomId: 'r_terr', label: 'Sessel' },
          { id: 'fu40', furnitureId: 'plant-large',  position: { x: 1155, y: 470 }, rotation: 0, size: [50, 50], roomId: 'r_terr', label: 'Kübelpflanze' },
          { id: 'fu41', furnitureId: 'plant-large',  position: { x: 780, y: 470 }, rotation: 0, size: [50, 50], roomId: 'r_terr', label: 'Kübelpflanze' },
          // Hecke / Beet entlang der Terrassen-Nordkante (wie auf den Fotos)
          { id: 'fu42', furnitureId: 'plant-large',  position: { x: 820, y: 385 }, rotation: 0, size: [55, 55], roomId: 'r_terr', label: 'Hecke' },
          { id: 'fu43', furnitureId: 'plant-large',  position: { x: 920, y: 385 }, rotation: 0, size: [55, 55], roomId: 'r_terr', label: 'Hecke' },
          { id: 'fu44', furnitureId: 'plant-large',  position: { x: 1020, y: 385 }, rotation: 0, size: [55, 55], roomId: 'r_terr', label: 'Hecke' },
          { id: 'fu45', furnitureId: 'plant-large',  position: { x: 1120, y: 385 }, rotation: 0, size: [55, 55], roomId: 'r_terr', label: 'Hecke' },
        ],
        labels: [
          { id: 'l1', position: { x: 125, y: 135 }, text: 'Bad',            size: 15 },
          { id: 'l2', position: { x: 125, y: 385 }, text: 'Flur',           size: 15 },
          { id: 'l3', position: { x: 125, y: 660 }, text: 'Abstellraum',    size: 14 },
          { id: 'l4', position: { x: 470, y: 170 }, text: 'Schlafzimmer',   size: 18 },
          { id: 'l5', position: { x: 400, y: 360 }, text: 'Küche',          size: 16 },
          { id: 'l6', position: { x: 495, y: 700 }, text: 'Wohnen / Essen', size: 18 },
          { id: 'l7', position: { x: 970, y: 580 }, text: 'Terrasse',       size: 18 },
        ],
        layers: { walls: true, furniture: true, devices: true, labels: true },
        extent: { width: 1200, height: 820 },
      },
    ],
    activeFloorId: 'f1',
    activeModeKey: 'auto',
    modes: OMEGA_MODES,
    settings: {
      unit: 'cm',
      gridSize: 50,
      snap: true,
      snapStep: 10,
      showGrid: true,
      theme: 'light',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
