import type {
  PlanDocument, Floor, Wall, Room, Point,
  PlacedDevice, PlacedFurniture, Label,
} from '@/types'
import { uuid } from '@/lib/utils'
import { OMEGA_MODES, DEFAULT_FLOOR_EXTENT } from '@/lib/constants'

/** Build rectangular walls around a given extent. */
function rectWalls(w: number, h: number, thickness = 24): Wall[] {
  return [
    { id: uuid(), a: { x: 0, y: 0 }, b: { x: w, y: 0 }, thickness },
    { id: uuid(), a: { x: w, y: 0 }, b: { x: w, y: h }, thickness },
    { id: uuid(), a: { x: w, y: h }, b: { x: 0, y: h }, thickness },
    { id: uuid(), a: { x: 0, y: h }, b: { x: 0, y: 0 }, thickness },
  ]
}

function blankFloor(name: string, index = 0): Floor {
  return {
    id: uuid(),
    name,
    index,
    walls: rectWalls(DEFAULT_FLOOR_EXTENT.width, DEFAULT_FLOOR_EXTENT.height),
    rooms: [],
    devices: [],
    furniture: [],
    labels: [],
    layers: { walls: true, furniture: true, devices: true, labels: true },
    extent: DEFAULT_FLOOR_EXTENT,
  }
}

/** Build a fresh PlanDocument (used for new plans and as base for templates). */
export function createBlankPlan(title = 'Unbenannter Plan'): PlanDocument {
  const floor = blankFloor('Erdgeschoss', 0)
  return {
    schemaVersion: 2,
    id: uuid(),
    title,
    floors: [floor],
    activeFloorId: floor.id,
    activeModeKey: 'auto',
    modes: OMEGA_MODES,
    settings: {
      unit: 'cm',
      gridSize: 50,
      snap: true,
      snapStep: 10,
      showGrid: true,
      theme: 'dark',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * The Omega Residence — the flagship showcase template.
 *
 * A full luxury villa built to demonstrate *everything* OMEGA Atelier can do in
 * one plan: an exterior envelope (Klinker shell + roof), a fully furnished
 * interior, four storeys (Untergeschoss · Erdgeschoss · Obergeschoss ·
 * Dachterrasse), a garden with driveway (the procedural neighbourhood + parking
 * court around any outdoor zone) and three pools — a wellness pool in the
 * basement, a garden pool on the terrace and a rooftop plunge pool. Coordinates
 * in cm; furniture/deviceIds reference the live catalogs, materials via *MaterialId.
 */
export function buildOmegaPlan(): PlanDocument {
  const F = 'floor-oak-parquet'
  const FW = 'floor-walnut-parquet'
  const FT = 'floor-ceramic-light'
  const FS = 'floor-slate'
  const FC = 'floor-concrete'
  const FCarpet = 'floor-carpet-warm'
  const W = 'wall-plaster'
  const C = 'ceiling-white'

  const poly = (x0: number, y0: number, x1: number, y1: number): Point[] =>
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  const room = (name: string, x0: number, y0: number, x1: number, y1: number, fm: string = F, extra: Partial<Room> = {}): Room =>
    ({ id: uuid(), name, polygon: poly(x0, y0, x1, y1), floorMaterialId: fm, wallMaterialId: W, ceilingMaterialId: C, ...extra })
  const outroom = (name: string, x0: number, y0: number, x1: number, y1: number): Room =>
    ({ id: uuid(), name, polygon: poly(x0, y0, x1, y1), zoneType: 'outdoor' })
  const wl = (x0: number, y0: number, x1: number, y1: number, thickness = 24, extra: Partial<Wall> = {}): Wall =>
    ({ id: uuid(), a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, thickness, ...extra })
  const fu = (furnitureId: string, x: number, y: number, size: [number, number], rotation = 0, extra: Partial<PlacedFurniture> = {}): PlacedFurniture =>
    ({ id: uuid(), furnitureId, position: { x, y }, rotation, size, ...extra })
  const dv = (deviceId: string, x: number, y: number, rotation = 0, extra: Partial<PlacedDevice> = {}): PlacedDevice =>
    ({ id: uuid(), deviceId, position: { x, y }, rotation, ...extra })
  const lb = (text: string, x: number, y: number, size = 16): Label => ({ id: uuid(), position: { x, y }, text, size })

  const layers = { walls: true, furniture: true, devices: true, labels: true }

  // ── Erdgeschoss — open-plan living, kitchen & dining opening to a terrace
  //    with the garden pool; entrée, guest WC and utility along the west. ──
  const eg: Floor = {
    id: uuid(), name: 'Erdgeschoss', index: 0, layers,
    extent: { width: 2140, height: 1050 },
    rooms: [
      room('Gäste-WC', 0, 0, 360, 300, FT),
      room('Entrée', 0, 300, 360, 720, FS),
      room('Hauswirtschaft', 0, 720, 360, 1050, FT),
      room('Küche', 360, 0, 900, 520),
      room('Esszimmer', 900, 0, 1500, 520),
      room('Wohnzimmer', 360, 520, 1500, 1050),
      outroom('Terrasse', 1500, 430, 2140, 1050),
    ],
    walls: [
      // Outer envelope
      wl(0, 0, 360, 0, 28),
      wl(360, 0, 900, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 130, openingSill: 90 }),
      wl(900, 0, 1500, 0, 28, { subtype: 'window', openingWidth: 340, openingHeight: 130, openingSill: 90 }),
      wl(1500, 0, 1500, 430, 28, { subtype: 'window', openingWidth: 280, openingHeight: 200, openingSill: 20 }),
      wl(1500, 430, 1500, 1050, 28, { subtype: 'door', openingWidth: 340 }),
      wl(1500, 1050, 360, 1050, 28, { subtype: 'window', openingWidth: 460, openingHeight: 150, openingSill: 40 }),
      wl(360, 1050, 0, 1050, 28),
      wl(0, 1050, 0, 720, 28),
      wl(0, 720, 0, 300, 28, { subtype: 'door', openingWidth: 110 }),
      wl(0, 300, 0, 0, 28),
      // Inner partitions
      wl(0, 300, 360, 300, 14, { subtype: 'door', openingWidth: 80 }),
      wl(0, 720, 360, 720, 14, { subtype: 'door', openingWidth: 80 }),
      wl(360, 0, 360, 110, 14),
      wl(360, 110, 360, 210, 14, { subtype: 'door', openingWidth: 80 }),
      wl(360, 210, 360, 560, 14),
      wl(360, 560, 360, 680, 14, { subtype: 'door', openingWidth: 100 }),
      wl(360, 680, 360, 1050, 14),
    ],
    furniture: [
      // Küche
      fu('kitchen-row', 600, 60, [420, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }),
      fu('kitchen-island', 640, 320, [260, 100], 0, { label: 'Kochinsel', materialKey: 'oak' }),
      fu('barstool', 540, 410, [40, 40]), fu('barstool', 640, 410, [40, 40]), fu('barstool', 740, 410, [40, 40]),
      fu('fridge', 845, 60, [60, 65], 90),
      fu('pendant-lamp', 640, 320, [40, 40]),
      // Esszimmer
      fu('table-dining-8', 1180, 300, [240, 100], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 1080, 210, [45, 50], 180), fu('chair-dining', 1180, 210, [45, 50], 180), fu('chair-dining', 1280, 210, [45, 50], 180),
      fu('chair-dining', 1080, 390, [45, 50], 0), fu('chair-dining', 1180, 390, [45, 50], 0), fu('chair-dining', 1280, 390, [45, 50], 0),
      fu('pendant-lamp', 1180, 300, [40, 40]),
      fu('plant-large', 1450, 90, [50, 50]),
      // Wohnzimmer
      fu('sofa-corner', 640, 760, [300, 220], 0, { label: 'Wohnlandschaft', materialKey: 'fabricGray' }),
      fu('table-coffee', 680, 860, [120, 60]),
      fu('rug-large', 700, 830, [280, 340]),
      fu('tv-stand', 520, 1013, [200, 45], 0, { materialKey: 'leatherBlack' }),
      fu('fireplace', 380, 640, [120, 40], 90),
      fu('grand-piano', 1330, 660, [155, 200]),
      fu('armchair', 1060, 660, [85, 90]),
      fu('plant-tall', 1450, 560, [40, 40]),
      // Entrée / Hauswirtschaft / WC
      fu('coat-rail', 180, 316, [90, 6], 0, { label: 'Garderobe' }),
      fu('shoe-bench', 180, 360, [95, 34]),
      fu('dresser', 60, 520, [110, 45], 90),
      fu('mirror', 12, 520, [60, 4], 90),
      fu('washing-machine', 70, 1000, [60, 60]),
      fu('wardrobe-200', 200, 745, [200, 60]),
      fu('toilet', 320, 220, [40, 70], 270), fu('sink-bath', 320, 80, [60, 45], 270), fu('mirror', 356, 80, [60, 4], 270),
      // Terrasse — garden pool, loungers, dining & grill (all poolside, not in it)
      fu('pool-small', 1820, 730, [400, 220], 0, { label: 'Pool' }),
      fu('sunbed', 1560, 620, [200, 75], 90), fu('sunbed', 1560, 880, [200, 75], 90),
      fu('outdoor-table', 2000, 560, [180, 90]),
      fu('lounge-chair', 2085, 820, [80, 80]), fu('lounge-chair', 2085, 690, [80, 80]),
      fu('grill', 2090, 970, [130, 60], 90),
      fu('plant-large', 1560, 470, [55, 55]), fu('plant-large', 1740, 470, [55, 55]),
      fu('plant-large', 1920, 470, [55, 55]), fu('plant-large', 2090, 470, [55, 55]),
    ],
    devices: [
      dv('lockin-g30', 16, 500, 90, { note: 'Haustür' }),
      dv('netatmo-doorbell', 24, 440, 90),
      dv('hue-motion', 60, 650),
      dv('shelly-1pm-mini', 640, 260, 0, { note: 'Küchenlicht' }),
      dv('govee-rgbic-strip-pro', 640, 80, 0, { note: 'Unterschrank-LED', modeState: { relax: { on: true, brightness: 45, color: '#ffcf99' }, party: { on: true, brightness: 70, color: '#33dd88' }, night: { on: true, brightness: 10, color: '#ffb066' } } }),
      dv('hue-e27-white-color', 1180, 300, 0, { note: 'Pendel Essbereich' }),
      dv('sonos-arc-ultra', 500, 1040),
      dv('apple-tv-4k', 540, 1040),
      dv('hue-lightstrip-plus', 520, 1046, 0, { note: 'TV-Backlight' }),
      dv('govee-floor-lamp', 1060, 660, 0, { note: 'Stehlampe', modeState: { relax: { on: true, brightness: 45, color: '#ffb066' }, film: { on: true, brightness: 15, color: '#ff8a4d' }, party: { on: true, brightness: 80, color: '#2e6bff' } } }),
      dv('govee-string-lights', 1450, 560, 0, { note: 'Lichterzweige' }),
      dv('aqara-fp2', 700, 600, 0, { note: 'Präsenz Wohnen' }),
      dv('google-nest-hub-2', 860, 300),
      dv('bosch-twinguard', 700, 780, 0, { note: 'Rauchmelder' }),
      dv('eve-thermo', 1490, 300),
      dv('hue-bridge', 60, 1030),
      // Terrasse
      dv('govee-permanent-outdoor', 1520, 460, 0, { note: 'Fassaden-Spots' }),
      dv('osaio-outdoor-4mp', 1520, 500, 0, { note: 'Außenkamera' }),
      dv('govee-string-lights', 1820, 450, 0, { note: 'Lichterkette Pool' }),
      dv('gardena-irrigation', 2100, 700, 0, { note: 'Bewässerung' }),
      dv('govee-floor-lamp', 2090, 990, 0, { note: 'Outdoor-Laterne' }),
    ],
    labels: [
      lb('Gäste-WC', 180, 150, 13), lb('Entrée', 180, 510), lb('Hauswirtschaft', 180, 885, 13),
      lb('Küche', 630, 250), lb('Esszimmer', 1180, 250), lb('Wohnzimmer', 900, 800, 18),
      lb('Terrasse · Pool', 1820, 500, 18),
    ],
  }

  // ── Obergeschoss — master suite with walk-in & en-suite, two children's
  //    rooms, a family bath, a gallery landing and a home office. ──
  const og: Floor = {
    id: uuid(), name: '1. Obergeschoss', index: 1, layers,
    extent: { width: 1500, height: 1050 },
    rooms: [
      room('Master-Bad', 0, 0, 420, 360, FT),
      room('Ankleide', 0, 360, 420, 650),
      room('Schlafzimmer', 0, 650, 760, 1050, FCarpet),
      room('Kinderzimmer 1', 420, 0, 910, 360),
      room('Kinderzimmer 2', 910, 0, 1500, 360),
      room('Galerie', 420, 360, 1500, 650),
      room('Arbeitszimmer', 760, 650, 1200, 1050),
      room('Familienbad', 1200, 650, 1500, 1050, FT),
    ],
    walls: [
      // Outer envelope
      ...rectWalls(1500, 1050, 28),
      // Inner partitions
      wl(0, 360, 420, 360, 14), wl(420, 0, 420, 360, 14, { subtype: 'door', openingWidth: 80 }),
      wl(0, 650, 760, 650, 14), wl(420, 360, 420, 650, 14, { subtype: 'door', openingWidth: 80 }),
      wl(910, 0, 910, 360, 14), wl(420, 360, 1500, 360, 14, { subtype: 'door', openingWidth: 90 }),
      wl(760, 650, 760, 1050, 14, { subtype: 'door', openingWidth: 90 }),
      wl(1200, 650, 1500, 650, 14), wl(1200, 650, 1200, 1050, 14, { subtype: 'door', openingWidth: 80 }),
      wl(760, 650, 1500, 650, 14),
    ],
    furniture: [
      // Schlafzimmer
      fu('bed-200', 380, 860, [205, 215], 0, { label: 'Boxspringbett', materialKey: 'fabricGray' }),
      fu('nightstand', 250, 730, [45, 40]), fu('nightstand', 510, 730, [45, 40]),
      fu('dresser', 700, 700, [110, 45], 90), fu('rug-medium', 380, 900, [200, 300]),
      fu('armchair', 660, 1000, [85, 90]), fu('wall-art-wide', 380, 660, [140, 4]),
      // Ankleide
      fu('wardrobe-300', 210, 380, [300, 60]), fu('wardrobe-200', 60, 520, [200, 60], 90), fu('mirror', 410, 520, [60, 4], 270),
      // Master-Bad
      fu('bathtub', 120, 90, [170, 80]), fu('shower', 350, 60, [90, 90]),
      fu('toilet', 380, 300, [40, 70], 270), fu('sink-bath', 130, 320, [60, 45]), fu('towel-radiator', 300, 350, [60, 10], 180),
      // Kinderzimmer 1 & 2
      fu('bed-140', 520, 190, [145, 200]), fu('desk-160', 820, 80, [160, 80]), fu('wardrobe-200', 700, 330, [200, 60]),
      fu('bed-140', 1010, 190, [145, 200]), fu('desk-160', 1320, 80, [160, 80]), fu('bookshelf-wide', 1470, 200, [200, 35], 90),
      // Galerie
      fu('sofa-2seat', 900, 590, [160, 95]), fu('table-side', 760, 590, [50, 50]), fu('plant-tall', 470, 410, [40, 40]),
      // Arbeitszimmer
      fu('desk-180', 980, 760, [180, 80]), fu('office-chair', 980, 850, [60, 60]), fu('bookshelf-wide', 820, 1030, [200, 35]),
      // Familienbad
      fu('bathtub', 1290, 760, [170, 80], 90), fu('shower', 1440, 720, [90, 90]), fu('toilet', 1450, 1000, [40, 70], 270), fu('sink-bath', 1250, 1010, [60, 45]),
    ],
    devices: [
      dv('govee-table-lamp', 260, 740, 0, { note: 'Nachttischlampe', modeState: { relax: { on: true, brightness: 40, color: '#ff5a3c' }, night: { on: true, brightness: 10, color: '#ff5a2a' } } }),
      dv('govee-table-lamp', 500, 740),
      dv('govee-rgbic-strip-pro', 380, 950, 0, { note: 'LED unterm Bett', modeState: { relax: { on: true, brightness: 35, color: '#ff2f1e' }, night: { on: true, brightness: 8, color: '#ff3a1e' } } }),
      dv('apple-tv-4k', 700, 660), dv('aqara-fp2', 380, 700),
      dv('shelly-1pm-mini', 660, 500, 0, { note: 'Deckenlicht Galerie' }),
      dv('hue-motion', 700, 500), dv('google-nest-hub-2', 900, 380),
      dv('echo-dot-5', 520, 80), dv('echo-dot-5', 1010, 80),
      dv('eve-thermo', 40, 900), dv('eve-thermo', 1460, 200),
      dv('bosch-twinguard', 900, 500),
    ],
    labels: [
      lb('Master-Bad', 200, 180, 13), lb('Ankleide', 200, 500, 13), lb('Schlafzimmer', 380, 850, 18),
      lb('Kinderzimmer 1', 660, 180, 13), lb('Kinderzimmer 2', 1200, 180, 13),
      lb('Galerie', 950, 500), lb('Arbeitszimmer', 980, 850, 14), lb('Familienbad', 1350, 850, 13),
    ],
  }

  // ── Untergeschoss — wellness with the indoor pool & sauna, a fitness room,
  //    a wine bar, the home cinema and the technical/utility room. ──
  const ug: Floor = {
    id: uuid(), name: 'Untergeschoss · Wellness', index: -1, layers,
    extent: { width: 1500, height: 1050 },
    rooms: [
      room('Indoor-Pool', 0, 0, 900, 650, FS),
      room('Sauna', 900, 0, 1200, 360, FW),
      room('Wellness-Bad', 1200, 0, 1500, 360, FT),
      room('Fitness', 900, 360, 1500, 650, FC),
      room('Weinkeller & Bar', 0, 650, 500, 1050, FW),
      room('Heimkino', 500, 650, 1050, 1050, FCarpet),
      room('Technik', 1050, 650, 1500, 1050, FC),
    ],
    walls: [
      ...rectWalls(1500, 1050, 28),
      wl(900, 0, 900, 650, 14, { subtype: 'door', openingWidth: 90 }),
      wl(1200, 0, 1200, 360, 14, { subtype: 'door', openingWidth: 80 }),
      wl(900, 360, 1500, 360, 14),
      wl(0, 650, 1500, 650, 14),
      wl(500, 650, 500, 1050, 14, { subtype: 'door', openingWidth: 90 }),
      wl(1050, 650, 1050, 1050, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      // Indoor-Pool — loungers line the pool head, not the water
      fu('pool-small', 450, 320, [720, 380], 0, { label: 'Wellness-Pool' }),
      fu('sunbed', 220, 85, [200, 75]), fu('sunbed', 560, 85, [200, 75]),
      fu('lounge-chair', 720, 575, [80, 80]), fu('plant-large', 855, 80, [55, 55]), fu('plant-large', 855, 560, [55, 55]),
      // Sauna
      fu('shoe-bench', 1050, 80, [95, 34], 0, { label: 'Saunabank' }), fu('shoe-bench', 1050, 260, [95, 34]), fu('plant', 940, 320, [40, 40]),
      // Wellness-Bad
      fu('shower', 1440, 60, [90, 90]), fu('bathtub', 1300, 130, [170, 80], 90), fu('toilet', 1450, 300, [40, 70], 270), fu('sink-bath', 1240, 320, [60, 45]),
      // Fitness
      fu('gym-rings', 960, 410, [40, 20]), fu('rug-medium', 1150, 500, [200, 300]), fu('mirror', 1490, 500, [60, 4], 270), fu('plant-large', 960, 600, [55, 55]),
      // Weinkeller & Bar
      fu('kitchen-row', 250, 1010, [300, 60], 0, { label: 'Bar', materialKey: 'leatherBlack' }),
      fu('barstool', 150, 940, [40, 40]), fu('barstool', 250, 940, [40, 40]), fu('barstool', 350, 940, [40, 40]),
      fu('bookshelf-wide', 60, 850, [200, 35], 90), fu('table-side', 410, 760, [50, 50]),
      // Heimkino — seating faces the screen (north)
      fu('sofa-corner', 760, 900, [300, 220], 180, { label: 'Kino-Lounge', materialKey: 'leatherBlack' }),
      fu('wall-screen', 775, 665, [180, 4]), fu('table-coffee', 775, 820, [120, 60]), fu('rug-large', 775, 890, [250, 300]),
      // Technik
      fu('washing-machine', 1110, 1000, [60, 60]), fu('bookshelf', 1460, 850, [80, 30], 90),
    ],
    devices: [
      dv('govee-rgbic-strip-pro', 450, 40, 0, { note: 'Pool-LED', modeState: { relax: { on: true, brightness: 45, color: '#2fb6dd' }, party: { on: true, brightness: 80, color: '#2e6bff' }, night: { on: true, brightness: 18, color: '#1f7fa8' } } }),
      dv('govee-permanent-outdoor', 40, 40, 0, { note: 'Pool-Spots' }),
      dv('hue-motion', 460, 620), dv('shelly-plus-2pm', 450, 320, 0, { note: 'Poolraum-Licht' }),
      dv('eve-energy', 1050, 60, 0, { note: 'Sauna-Ofen' }),
      dv('sonos-arc-ultra', 775, 680), dv('apple-tv-4k', 775, 685),
      dv('hue-lightstrip-plus', 775, 672, 0, { note: 'Kino-Backlight' }),
      dv('govee-floor-lamp', 400, 760, 0, { note: 'Bar-Stimmungslicht' }),
      dv('bosch-twinguard', 700, 800), dv('aqara-fp2', 1150, 500),
      dv('shelly-plug-s', 1110, 950, 0, { note: 'Technik' }),
    ],
    labels: [
      lb('Indoor-Pool', 450, 500, 18), lb('Sauna', 1050, 180, 13), lb('Wellness-Bad', 1350, 180, 12),
      lb('Fitness', 1200, 500), lb('Weinkeller & Bar', 250, 800, 13), lb('Heimkino', 775, 800), lb('Technik', 1275, 850, 13),
    ],
  }

  // ── Dachterrasse — a glazed sky-lounge & roof bar opening onto a roof deck
  //    with the rooftop plunge pool, a hot tub, loungers and an outdoor dining set. ──
  const dg: Floor = {
    id: uuid(), name: 'Dachterrasse', index: 2, layers,
    extent: { width: 1500, height: 1050 },
    rooms: [
      room('Sky-Lounge', 0, 0, 700, 300, FW),
      room('Dach-Bar', 700, 0, 1100, 300),
      room('Gäste-WC', 1100, 0, 1500, 300, FT),
      outroom('Dachterrasse', 0, 300, 1500, 1050),
    ],
    walls: [
      wl(0, 0, 1100, 0, 28),
      wl(1100, 0, 1500, 0, 28),
      wl(1500, 0, 1500, 300, 28),
      wl(1500, 300, 0, 300, 28, { subtype: 'door', openingWidth: 360 }),
      wl(0, 300, 0, 0, 28),
      wl(700, 0, 700, 300, 14, { subtype: 'door', openingWidth: 90 }),
      wl(1100, 0, 1100, 300, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      // Sky-Lounge
      fu('sofa-3seat', 220, 210, [220, 95]), fu('table-coffee', 220, 130, [110, 60]), fu('armchair', 500, 210, [85, 90]),
      fu('fireplace', 110, 20, [120, 40]), fu('plant-tall', 650, 60, [40, 40]),
      // Dach-Bar
      fu('kitchen-row', 900, 60, [360, 60], 0, { label: 'Dach-Bar', materialKey: 'leatherBlack' }),
      fu('barstool', 820, 180, [40, 40]), fu('barstool', 900, 180, [40, 40]), fu('barstool', 980, 180, [40, 40]),
      // Gäste-WC
      fu('toilet', 1450, 240, [40, 70], 270), fu('sink-bath', 1250, 60, [60, 45]), fu('mirror', 1250, 20, [60, 4]),
      // Dachterrasse — rooftop pool, hot tub, loungers, dining
      fu('pool-small', 620, 620, [520, 260], 0, { label: 'Rooftop-Pool' }),
      fu('pool-small', 1280, 900, [200, 200], 0, { label: 'Whirlpool' }),
      fu('sunbed', 160, 470, [200, 75], 90), fu('sunbed', 160, 700, [200, 75], 90), fu('sunbed', 1320, 470, [200, 75], 90),
      fu('outdoor-table', 1000, 860, [180, 90]),
      fu('chair-dining', 940, 800, [45, 50], 180), fu('chair-dining', 1060, 800, [45, 50], 180),
      fu('chair-dining', 940, 920, [45, 50], 0), fu('chair-dining', 1060, 920, [45, 50], 0),
      fu('grill', 1440, 700, [130, 60], 90),
      fu('lounge-chair', 420, 950, [80, 80]),
      fu('plant-large', 60, 340, [55, 55]), fu('plant-large', 1440, 340, [55, 55]), fu('plant-large', 750, 1010, [55, 55]),
    ],
    devices: [
      dv('govee-permanent-outdoor', 40, 320, 0, { note: 'Dach-Spots' }),
      dv('govee-string-lights', 620, 340, 0, { note: 'Lichterkette', modeState: { relax: { on: true, brightness: 55, color: '#ffbe73' }, party: { on: true, brightness: 85, color: '#ff2ea6' } } }),
      dv('govee-rgbic-strip-pro', 620, 500, 0, { note: 'Pool-LED', modeState: { party: { on: true, brightness: 85, color: '#2e6bff' }, night: { on: true, brightness: 18, color: '#1f7fa8' } } }),
      dv('sonos-arc-ultra', 300, 320, 0, { note: 'Outdoor-Sound' }),
      dv('osaio-outdoor-4mp', 40, 40), dv('govee-floor-lamp', 1400, 700, 0, { note: 'Laterne' }),
      dv('shelly-plus-2pm', 900, 60, 0, { note: 'Bar-Licht' }), dv('hue-motion', 700, 350),
    ],
    labels: [
      lb('Sky-Lounge', 300, 150, 15), lb('Dach-Bar', 900, 150, 13), lb('Gäste-WC', 1300, 150, 12),
      lb('Dachterrasse · Rooftop-Pool', 620, 500, 18),
    ],
  }

  return {
    schemaVersion: 2,
    id: uuid(),
    title: 'Omega — Die Residenz',
    description: 'Flaggschiff-Villa: Außen · Innen · vier Stockwerke · Garten, Einfahrt & drei Pools — das schönste Gebäude, das sich mit OMEGA Atelier realisieren lässt.',
    floors: [ug, eg, og, dg],
    activeFloorId: eg.id,
    activeModeKey: 'relax',
    modes: OMEGA_MODES,
    settings: { unit: 'cm', gridSize: 50, snap: true, snapStep: 10, showGrid: true, theme: 'dark' },
    tags: ['villa', 'showcase', 'luxus'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Furnished starter templates. Each is a real, liveable plan — named rooms,
// windows and doors that fit their walls, and collision-free furniture — not a
// blank box. All are held to the same zero-tolerance plan-integrity check as
// the Residenz (see templates.test.ts): no stacking, openings that fit, nothing
// off-plan. Coordinates in cm, centre-anchored furniture (position = centre).
// ─────────────────────────────────────────────────────────────────────
const LAYERS = { walls: true, furniture: true, devices: true, labels: true }

/** Builder helpers bound to a floor's default materials. */
function H(F = 'floor-oak-parquet', W = 'wall-plaster', C = 'ceiling-white') {
  const room = (name: string, x0: number, y0: number, x1: number, y1: number, fm: string = F, extra: Partial<Room> = {}): Room =>
    ({ id: uuid(), name, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], floorMaterialId: fm, wallMaterialId: W, ceilingMaterialId: C, ...extra })
  const outroom = (name: string, x0: number, y0: number, x1: number, y1: number): Room =>
    ({ id: uuid(), name, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], zoneType: 'outdoor' })
  const wl = (x0: number, y0: number, x1: number, y1: number, t = 24, extra: Partial<Wall> = {}): Wall =>
    ({ id: uuid(), a: { x: x0, y: y0 }, b: { x: x1, y: y1 }, thickness: t, ...extra })
  const fu = (furnitureId: string, x: number, y: number, size: [number, number], rotation = 0, extra: Partial<PlacedFurniture> = {}): PlacedFurniture =>
    ({ id: uuid(), furnitureId, position: { x, y }, rotation, size, ...extra })
  const dv = (deviceId: string, x: number, y: number, rotation = 0, extra: Partial<PlacedDevice> = {}): PlacedDevice =>
    ({ id: uuid(), deviceId, position: { x, y }, rotation, ...extra })
  const lb = (text: string, x: number, y: number, size = 15): Label => ({ id: uuid(), position: { x, y }, text, size })
  return { room, outroom, wl, fu, dv, lb }
}

function plan(title: string, description: string, tags: string[], floors: Floor[], activeIdx = 0): PlanDocument {
  return {
    schemaVersion: 2, id: uuid(), title, description, floors,
    activeFloorId: floors[activeIdx].id, activeModeKey: 'relax', modes: OMEGA_MODES,
    settings: { unit: 'cm', gridSize: 50, snap: true, snapStep: 10, showGrid: true, theme: 'dark' },
    tags, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

// ── Studio · 800×400 — one open living/sleeping room + a compact bath ──
function buildStudioPlan(): PlanDocument {
  const { room, wl, fu, dv, lb } = H()
  const floor: Floor = {
    id: uuid(), name: 'Studio', index: 0, layers: LAYERS, extent: { width: 800, height: 400 },
    rooms: [room('Wohnen · Schlafen', 0, 0, 560, 400), room('Bad', 560, 0, 800, 400, 'floor-ceramic-light')],
    walls: [
      wl(0, 0, 300, 0, 24, { subtype: 'window', openingWidth: 170, openingHeight: 130, openingSill: 90 }),
      wl(300, 0, 560, 0, 24), wl(560, 0, 800, 0, 24),
      wl(800, 0, 800, 230, 24), wl(800, 230, 800, 400, 24, { subtype: 'window', openingWidth: 110, openingHeight: 90, openingSill: 100 }),
      wl(800, 400, 500, 400, 24), wl(500, 400, 200, 400, 24, { subtype: 'window', openingWidth: 200, openingHeight: 130, openingSill: 90 }), wl(200, 400, 0, 400, 24),
      wl(0, 400, 0, 230, 24), wl(0, 230, 0, 0, 24, { subtype: 'door', openingWidth: 100 }),
      wl(560, 0, 560, 400, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      fu('bed-140', 115, 280, [145, 200], 0, { label: 'Bett', materialKey: 'fabricGray' }),
      fu('nightstand', 210, 305, [45, 40]),
      fu('sofa-3seat', 370, 345, [220, 95], 180, { label: 'Sofa', materialKey: 'fabricGray' }),
      fu('table-coffee', 370, 255, [110, 60]), fu('rug-medium', 370, 330, [200, 300]),
      fu('kitchen-row', 410, 45, [260, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }),
      fu('fridge', 250, 45, [60, 65], 90), fu('plant-tall', 520, 360, [40, 40]),
      fu('wall-art-wide', 115, 12, [140, 4]),
      fu('shower', 620, 65, [90, 90]), fu('toilet', 760, 75, [40, 70], 270),
      fu('sink-bath', 600, 360, [60, 45]), fu('washing-machine', 760, 360, [60, 60]), fu('mirror', 600, 335, [60, 4]),
    ],
    devices: [
      dv('lockin-g30', 16, 115, 90, { note: 'Wohnungstür' }), dv('shelly-1pm-mini', 370, 200, 0, { note: 'Deckenlicht' }),
      dv('sonos-arc-ultra', 370, 30), dv('govee-floor-lamp', 500, 330), dv('hue-motion', 600, 20), dv('eve-thermo', 20, 200),
    ],
    labels: [lb('Wohnen · Schlafen', 200, 200, 16), lb('Bad', 680, 200, 14)],
  }
  return plan('Studio Apartment', 'Studio — offener Wohn-/Schlafraum mit Küchenzeile und kompaktem Bad.', ['klein', 'offen'], [floor])
}

// ── 2-Zimmer · 1100×600 — open kitchen-living, bedroom, bath ──
function buildApartment2Plan(): PlanDocument {
  const { room, wl, fu, dv, lb } = H()
  const floor: Floor = {
    id: uuid(), name: '2-Zimmer-Wohnung', index: 0, layers: LAYERS, extent: { width: 1100, height: 600 },
    rooms: [
      room('Wohnküche', 0, 0, 650, 600), room('Schlafzimmer', 650, 0, 1100, 360, 'floor-oak-parquet'),
      room('Bad', 650, 360, 1100, 600, 'floor-ceramic-light'),
    ],
    walls: [
      wl(0, 0, 320, 0, 24, { subtype: 'window', openingWidth: 200, openingHeight: 130, openingSill: 90 }), wl(320, 0, 650, 0, 24, { subtype: 'window', openingWidth: 200, openingHeight: 130, openingSill: 90 }),
      wl(650, 0, 1100, 0, 24, { subtype: 'window', openingWidth: 220, openingHeight: 140, openingSill: 40 }),
      wl(1100, 0, 1100, 360, 24), wl(1100, 360, 1100, 600, 24, { subtype: 'window', openingWidth: 120, openingHeight: 90, openingSill: 100 }),
      wl(1100, 600, 650, 600, 24), wl(650, 600, 300, 600, 24, { subtype: 'window', openingWidth: 240, openingHeight: 150, openingSill: 40 }), wl(300, 600, 0, 600, 24),
      wl(0, 600, 0, 300, 24), wl(0, 300, 0, 0, 24, { subtype: 'door', openingWidth: 100 }),
      wl(650, 0, 650, 360, 14, { subtype: 'door', openingWidth: 90 }), wl(650, 360, 650, 600, 14, { subtype: 'door', openingWidth: 80 }),
      wl(650, 360, 1100, 360, 14),
    ],
    furniture: [
      fu('kitchen-row', 320, 45, [420, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }),
      fu('fridge', 70, 45, [60, 65], 90),
      fu('table-dining-6', 300, 360, [180, 90], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 235, 300, [45, 50], 180), fu('chair-dining', 300, 300, [45, 50], 180), fu('chair-dining', 365, 300, [45, 50], 180),
      fu('chair-dining', 235, 420, [45, 50], 0), fu('chair-dining', 300, 420, [45, 50], 0), fu('chair-dining', 365, 420, [45, 50], 0),
      fu('sofa-3seat', 400, 540, [220, 95], 180, { label: 'Sofa', materialKey: 'fabricGray' }),
      fu('table-coffee', 400, 460, [110, 60]), fu('rug-large', 400, 520, [250, 350]),
      fu('plant-tall', 560, 540, [40, 40]),
      fu('bed-180', 870, 175, [185, 210], 0, { label: 'Bett', materialKey: 'fabricGray' }),
      fu('nightstand', 760, 105, [45, 40]), fu('nightstand', 980, 105, [45, 40]),
      fu('wardrobe-200', 870, 330, [200, 60]), fu('wall-art-wide', 870, 15, [140, 4]),
      fu('bathtub', 755, 445, [170, 80]), fu('shower', 720, 550, [90, 90]),
      fu('toilet', 1050, 430, [40, 70], 270), fu('sink-bath', 900, 560, [60, 45]),
      fu('washing-machine', 1050, 560, [60, 60]), fu('mirror', 900, 535, [60, 4]),
    ],
    devices: [
      dv('lockin-g30', 16, 300, 90, { note: 'Wohnungstür' }), dv('shelly-1pm-mini', 300, 200, 0, { note: 'Küchenlicht' }),
      dv('hue-e27-white-color', 300, 360, 0, { note: 'Pendel Esstisch' }), dv('sonos-arc-ultra', 400, 590),
      dv('govee-floor-lamp', 550, 520), dv('aqara-fp2', 870, 40, 0, { note: 'Präsenz Schlafen' }),
      dv('eve-thermo', 1080, 180), dv('hue-motion', 900, 380), dv('bosch-twinguard', 330, 300),
    ],
    labels: [lb('Wohnküche', 300, 200, 16), lb('Schlafzimmer', 870, 180, 15), lb('Bad', 880, 470, 14)],
  }
  return plan('2-Zimmer-Wohnung', 'Kompakte Stadtwohnung — Wohnküche, Schlafzimmer und Wannenbad.', ['mittel', 'city'], [floor])
}

// ── 3-Zimmer · 1300×700 — living, two bedrooms, bath, hall ──
function buildApartment3Plan(): PlanDocument {
  const { room, wl, fu, dv, lb } = H()
  const floor: Floor = {
    id: uuid(), name: '3-Zimmer-Wohnung', index: 0, layers: LAYERS, extent: { width: 1300, height: 700 },
    rooms: [
      room('Wohnküche', 0, 0, 620, 700), room('Flur', 620, 300, 900, 700, 'floor-ceramic-light'),
      room('Schlafzimmer', 620, 0, 1300, 300), room('Kinderzimmer', 900, 300, 1300, 700),
      room('Bad', 620, 300, 900, 700, 'floor-ceramic-light'),
    ],
    walls: [
      wl(0, 0, 310, 0, 24, { subtype: 'window', openingWidth: 200, openingHeight: 130, openingSill: 90 }), wl(310, 0, 620, 0, 24, { subtype: 'window', openingWidth: 200, openingHeight: 130, openingSill: 90 }),
      wl(620, 0, 1300, 0, 24, { subtype: 'window', openingWidth: 260, openingHeight: 140, openingSill: 40 }),
      wl(1300, 0, 1300, 300, 24), wl(1300, 300, 1300, 700, 24, { subtype: 'window', openingWidth: 260, openingHeight: 140, openingSill: 40 }),
      wl(1300, 700, 900, 700, 24, { subtype: 'window', openingWidth: 240, openingHeight: 150, openingSill: 40 }), wl(900, 700, 0, 700, 24),
      wl(0, 700, 0, 360, 24), wl(0, 360, 0, 0, 24),
      // partitions
      wl(620, 0, 620, 300, 14), wl(620, 300, 620, 700, 14, { subtype: 'door', openingWidth: 90 }),
      wl(620, 300, 900, 300, 14, { subtype: 'door', openingWidth: 90 }), wl(900, 300, 1300, 300, 14),
      wl(900, 300, 900, 480, 14), wl(900, 480, 900, 700, 14, { subtype: 'door', openingWidth: 90 }),
      wl(620, 480, 900, 480, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      // Wohnküche
      fu('kitchen-row', 300, 45, [420, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }), fu('fridge', 50, 45, [60, 65], 90),
      fu('table-dining-6', 300, 260, [180, 90], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 235, 200, [45, 50], 180), fu('chair-dining', 300, 200, [45, 50], 180), fu('chair-dining', 365, 200, [45, 50], 180),
      fu('chair-dining', 235, 320, [45, 50], 0), fu('chair-dining', 300, 320, [45, 50], 0), fu('chair-dining', 365, 320, [45, 50], 0),
      fu('sofa-corner', 360, 560, [300, 220], 180, { label: 'Ecksofa', materialKey: 'fabricGray' }),
      fu('table-coffee', 360, 470, [110, 60]), fu('rug-large', 360, 560, [250, 350]), fu('tv-stand', 120, 560, [140, 40], 90),
      fu('plant-tall', 560, 660, [40, 40]),
      // Schlafzimmer
      fu('bed-180', 960, 180, [185, 210], 0, { label: 'Bett', materialKey: 'fabricGray' }), fu('nightstand', 850, 110, [45, 40]), fu('nightstand', 1070, 110, [45, 40]),
      fu('wardrobe-200', 1250, 150, [200, 60], 90), fu('wall-art-wide', 960, 15, [140, 4]),
      // Kinderzimmer
      fu('bed-140', 1000, 400, [145, 200], 0, { label: 'Kinderbett' }), fu('desk-180', 1200, 560, [180, 80], 0), fu('office-chair', 1200, 480, [60, 60]),
      fu('bookshelf-wide', 1000, 670, [200, 35]),
      // Bad
      fu('bathtub', 720, 380, [170, 80], 90), fu('shower', 660, 640, [90, 90]),
      fu('toilet', 850, 640, [40, 70], 270), fu('sink-bath', 700, 560, [60, 45]), fu('washing-machine', 850, 340, [60, 60]),
    ],
    devices: [
      dv('lockin-g30', 700, 690, 0, { note: 'Wohnungstür' }), dv('shelly-1pm-mini', 300, 200, 0, { note: 'Küchenlicht' }),
      dv('hue-e27-white-color', 300, 260), dv('sonos-arc-ultra', 200, 560), dv('apple-tv-4k', 130, 560),
      dv('govee-floor-lamp', 540, 640), dv('aqara-fp2', 960, 40), dv('eve-thermo', 1280, 150),
      dv('hue-motion', 760, 320), dv('bosch-twinguard', 760, 350), dv('echo-dot-5', 1030, 330),
    ],
    labels: [lb('Wohnküche', 300, 420, 16), lb('Flur', 760, 400, 13), lb('Schlafzimmer', 960, 185, 15), lb('Kinderzimmer', 1100, 560, 14), lb('Bad', 730, 560, 13)],
  }
  return plan('3-Zimmer-Wohnung', 'Familienwohnung — Wohnküche, Schlaf- und Kinderzimmer, Wannenbad.', ['familie'], [floor])
}

// ── Loft · 1500×800 — one open volume with zoned living, dining, sleep, bath box ──
function buildLoftPlan(): PlanDocument {
  const { room, wl, fu, dv, lb } = H('floor-concrete')
  const floor: Floor = {
    id: uuid(), name: 'Loft', index: 0, layers: LAYERS, extent: { width: 1500, height: 800 },
    rooms: [room('Loft', 0, 0, 1500, 800, 'floor-concrete'), room('Bad', 1200, 0, 1500, 380, 'floor-ceramic-light')],
    walls: [
      wl(0, 0, 400, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 200, openingSill: 30 }), wl(400, 0, 800, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 200, openingSill: 30 }), wl(800, 0, 1200, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 200, openingSill: 30 }), wl(1200, 0, 1500, 0, 28),
      wl(1500, 0, 1500, 800, 28), wl(1500, 800, 800, 800, 28, { subtype: 'window', openingWidth: 400, openingHeight: 200, openingSill: 30 }), wl(800, 800, 0, 800, 28, { subtype: 'window', openingWidth: 400, openingHeight: 200, openingSill: 30 }),
      wl(0, 800, 0, 300, 28), wl(0, 300, 0, 0, 28, { subtype: 'door', openingWidth: 120 }),
      // bath box in the NE corner
      wl(1200, 0, 1200, 380, 14, { subtype: 'door', openingWidth: 90 }), wl(1200, 380, 1500, 380, 14),
    ],
    furniture: [
      // Living
      fu('sofa-corner', 460, 590, [320, 240], 180, { label: 'Wohnlandschaft', materialKey: 'fabricGray' }),
      fu('table-coffee', 460, 480, [130, 70]), fu('rug-large', 460, 590, [250, 350]), fu('tv-stand', 140, 590, [200, 45], 90, { materialKey: 'leatherBlack' }),
      fu('armchair', 720, 690, [85, 90]), fu('plant-tall', 700, 470, [40, 40]),
      // Dining
      fu('table-dining-8', 760, 250, [240, 100], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 670, 175, [45, 50], 180), fu('chair-dining', 760, 175, [45, 50], 180), fu('chair-dining', 850, 175, [45, 50], 180),
      fu('chair-dining', 670, 325, [45, 50], 0), fu('chair-dining', 760, 325, [45, 50], 0), fu('chair-dining', 850, 325, [45, 50], 0),
      // Kitchen (N-W run + island)
      fu('kitchen-row', 300, 45, [480, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }), fu('fridge', 30, 45, [60, 65], 90),
      fu('kitchen-island', 300, 200, [260, 100], 0, { label: 'Kochinsel', materialKey: 'oak' }),
      fu('barstool', 210, 290, [40, 40]), fu('barstool', 300, 290, [40, 40]), fu('barstool', 390, 290, [40, 40]),
      // Sleeping zone (E)
      fu('bed-200', 1050, 620, [205, 215], 0, { label: 'Bett', materialKey: 'fabricGray' }), fu('nightstand', 920, 540, [45, 40]), fu('nightstand', 1180, 540, [45, 40]),
      fu('wardrobe-300', 1350, 600, [300, 60], 90), fu('plant-large', 1420, 760, [55, 55]),
      // Bath box
      fu('bathtub', 1270, 60, [170, 80]), fu('shower', 1440, 60, [90, 90]), fu('toilet', 1450, 320, [40, 70], 270), fu('sink-bath', 1250, 330, [60, 45]),
    ],
    devices: [
      dv('lockin-g30', 16, 300, 90, { note: 'Loft-Tür' }), dv('shelly-plus-2pm', 300, 200, 0, { note: 'Küchenlicht' }),
      dv('hue-e27-white-color', 760, 250, 0, { note: 'Pendel Esstisch' }), dv('sonos-arc-ultra', 220, 590), dv('apple-tv-4k', 150, 590),
      dv('govee-floor-lamp', 700, 690), dv('aqara-fp2', 1050, 470), dv('eve-thermo', 1480, 400), dv('hue-motion', 1210, 200), dv('bosch-twinguard', 700, 400),
    ],
    labels: [lb('Wohnen', 460, 690, 16), lb('Essen', 760, 250, 15), lb('Küche', 300, 120, 14), lb('Schlafen', 1050, 640, 15), lb('Bad', 1350, 200, 13)],
  }
  return plan('Loft', 'Offener Loft — ein Volumen, in Wohnen · Essen · Küche · Schlafen gezont, mit Bad-Box.', ['loft', 'offen'], [floor])
}

// ── Penthouse · 1800×1000 main floor + roof terrace ──
function buildPenthousePlan(): PlanDocument {
  const { room, outroom, wl, fu, dv, lb } = H('floor-walnut-parquet')
  const main: Floor = {
    id: uuid(), name: 'Hauptetage', index: 0, layers: LAYERS, extent: { width: 1800, height: 1000 },
    rooms: [
      room('Wohnen', 0, 0, 900, 640, 'floor-walnut-parquet'), room('Küche · Essen', 900, 0, 1800, 600),
      room('Master', 0, 640, 720, 1000, 'floor-carpet-warm'), room('Ankleide', 720, 640, 1050, 1000),
      room('Master-Bad', 1050, 600, 1500, 1000, 'floor-ceramic-light'), room('Gäste-WC', 1500, 600, 1800, 1000, 'floor-ceramic-light'),
    ],
    walls: [
      wl(0, 0, 450, 0, 28, { subtype: 'window', openingWidth: 340, openingHeight: 210, openingSill: 20 }), wl(450, 0, 900, 0, 28, { subtype: 'window', openingWidth: 340, openingHeight: 210, openingSill: 20 }),
      wl(900, 0, 1400, 0, 28, { subtype: 'window', openingWidth: 360, openingHeight: 150, openingSill: 90 }), wl(1400, 0, 1800, 0, 28),
      wl(1800, 0, 1800, 600, 28), wl(1800, 600, 1800, 1000, 28, { subtype: 'window', openingWidth: 120, openingHeight: 90, openingSill: 100 }),
      wl(1800, 1000, 1050, 1000, 28), wl(1050, 1000, 300, 1000, 28, { subtype: 'window', openingWidth: 420, openingHeight: 150, openingSill: 40 }), wl(300, 1000, 0, 1000, 28),
      wl(0, 1000, 0, 500, 28), wl(0, 500, 0, 0, 28, { subtype: 'door', openingWidth: 120 }),
      // partitions
      wl(900, 0, 900, 640, 14, { subtype: 'door', openingWidth: 110 }), wl(0, 640, 720, 640, 14, { subtype: 'door', openingWidth: 100 }),
      wl(720, 640, 720, 1000, 14, { subtype: 'door', openingWidth: 90 }), wl(720, 640, 1050, 640, 14),
      wl(1050, 600, 1050, 1000, 14, { subtype: 'door', openingWidth: 90 }), wl(900, 600, 1050, 600, 14), wl(1050, 600, 1800, 600, 14),
      wl(1500, 600, 1500, 1000, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      // Wohnen
      fu('sofa-corner', 360, 430, [320, 240], 180, { label: 'Wohnlandschaft', materialKey: 'fabricGray' }),
      fu('table-coffee', 360, 320, [130, 70]), fu('rug-large', 360, 430, [250, 350]), fu('tv-stand', 120, 430, [200, 45], 90, { materialKey: 'leatherBlack' }),
      fu('armchair', 640, 520, [85, 90]), fu('grand-piano', 720, 150, [155, 200]), fu('plant-tall', 820, 560, [40, 40]),
      // Küche · Essen
      fu('kitchen-row', 1210, 45, [440, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }), fu('fridge', 945, 45, [60, 65], 90),
      fu('kitchen-island', 1200, 240, [260, 100], 0, { label: 'Kochinsel', materialKey: 'oak' }),
      fu('barstool', 1110, 330, [40, 40]), fu('barstool', 1200, 330, [40, 40]), fu('barstool', 1290, 330, [40, 40]),
      fu('table-dining-8', 1480, 340, [240, 100], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 1390, 265, [45, 50], 180), fu('chair-dining', 1480, 265, [45, 50], 180), fu('chair-dining', 1570, 265, [45, 50], 180),
      fu('chair-dining', 1390, 415, [45, 50], 0), fu('chair-dining', 1480, 415, [45, 50], 0), fu('chair-dining', 1570, 415, [45, 50], 0),
      // Master
      fu('bed-200', 360, 830, [205, 215], 0, { label: 'Bett', materialKey: 'fabricGray' }), fu('nightstand', 230, 750, [45, 40]), fu('nightstand', 490, 750, [45, 40]),
      fu('dresser', 640, 720, [110, 45], 90), fu('rug-medium', 360, 860, [200, 300]), fu('wall-art-wide', 360, 655, [140, 4]),
      // Ankleide
      fu('wardrobe-300', 1010, 810, [300, 60], 90), fu('wardrobe-200', 830, 970, [200, 60]), fu('mirror', 740, 820, [60, 4], 270),
      // Master-Bad
      fu('bathtub', 1140, 680, [170, 80]), fu('shower', 1420, 680, [90, 90]), fu('toilet', 1150, 930, [40, 70], 270), fu('sink-bath', 1330, 940, [60, 45]),
      // Gäste-WC
      fu('toilet', 1750, 940, [40, 70], 270), fu('sink-bath', 1560, 660, [60, 45]),
    ],
    devices: [
      dv('lockin-g30', 16, 500, 90, { note: 'Penthouse-Tür' }), dv('shelly-plus-2pm', 1200, 240, 0, { note: 'Küchenlicht' }),
      dv('hue-e27-white-color', 1480, 340, 0, { note: 'Pendel Esstisch' }), dv('sonos-arc-ultra', 200, 430), dv('apple-tv-4k', 130, 430),
      dv('govee-floor-lamp', 640, 520), dv('aqara-fp2', 360, 700), dv('eve-thermo', 20, 300), dv('hue-motion', 1060, 640), dv('bosch-twinguard', 400, 300),
    ],
    labels: [lb('Wohnen', 360, 540, 16), lb('Küche · Essen', 1350, 200, 15), lb('Master', 360, 830, 15), lb('Ankleide', 885, 720, 12), lb('Master-Bad', 1280, 800, 13), lb('Gäste-WC', 1650, 800, 11)],
  }
  const roof: Floor = {
    id: uuid(), name: 'Dachterrasse', index: 1, layers: LAYERS, extent: { width: 1800, height: 1000 },
    rooms: [room('Sky-Lounge', 0, 0, 700, 320, 'floor-walnut-parquet'), outroom('Dachterrasse', 0, 320, 1800, 1000)],
    walls: [
      wl(0, 0, 700, 0, 28), wl(700, 0, 700, 320, 28), wl(700, 320, 1800, 320, 28), wl(1800, 320, 1800, 0, 28), wl(1800, 0, 700, 0, 0),
      wl(0, 320, 0, 0, 28), wl(700, 320, 0, 320, 28, { subtype: 'door', openingWidth: 360 }),
    ],
    furniture: [
      fu('sofa-3seat', 240, 210, [220, 95], 0, { label: 'Lounge', materialKey: 'leatherBlack' }), fu('table-coffee', 240, 120, [110, 60]), fu('armchair', 520, 210, [85, 90]),
      fu('pool-small', 900, 640, [520, 260], 0, { label: 'Rooftop-Pool' }),
      fu('sunbed', 200, 460, [200, 75], 90), fu('sunbed', 200, 700, [200, 75], 90),
      fu('outdoor-table', 1500, 500, [180, 90]), fu('lounge-chair', 1650, 640, [80, 80]), fu('grill', 1680, 900, [130, 60], 90),
      fu('plant-large', 60, 360, [55, 55]), fu('plant-large', 1740, 360, [55, 55]),
    ],
    devices: [
      dv('govee-permanent-outdoor', 40, 340, 0, { note: 'Dach-Spots' }), dv('govee-string-lights', 900, 360, 0, { note: 'Lichterkette' }),
      dv('sonos-arc-ultra', 300, 340, 0, { note: 'Outdoor-Sound' }), dv('osaio-outdoor-4mp', 40, 40), dv('hue-motion', 700, 350),
    ],
    labels: [lb('Sky-Lounge', 300, 160, 14), lb('Dachterrasse · Pool', 900, 500, 16)],
  }
  return plan('Penthouse', 'Penthouse — offene Hauptetage mit Master-Suite plus Dachterrasse mit Pool.', ['luxus'], [main, roof])
}

// ── Einfamilienhaus · 1400×1000 — ground (living) + upper (sleeping) ──
function buildHouseFamilyPlan(): PlanDocument {
  const { room, outroom, wl, fu, dv, lb } = H()
  const eg: Floor = {
    id: uuid(), name: 'Erdgeschoss', index: 0, layers: LAYERS, extent: { width: 1400, height: 1100 },
    rooms: [
      room('Diele', 0, 0, 360, 380, 'floor-ceramic-light'), room('Gäste-WC', 0, 380, 360, 640, 'floor-ceramic-light'),
      room('Hauswirtschaft', 0, 640, 360, 1000, 'floor-ceramic-light'),
      room('Küche', 360, 0, 820, 460), room('Essen', 820, 0, 1400, 460), room('Wohnzimmer', 360, 460, 1400, 1000),
      outroom('Terrasse', 360, 1000, 1400, 1100),
    ],
    walls: [
      wl(0, 0, 360, 0, 28), wl(360, 0, 820, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 130, openingSill: 90 }), wl(820, 0, 1400, 0, 28, { subtype: 'window', openingWidth: 360, openingHeight: 140, openingSill: 90 }),
      wl(1400, 0, 1400, 460, 28, { subtype: 'window', openingWidth: 280, openingHeight: 150, openingSill: 90 }), wl(1400, 460, 1400, 1000, 28, { subtype: 'window', openingWidth: 300, openingHeight: 210, openingSill: 20 }),
      wl(1400, 1000, 820, 1000, 28, { subtype: 'door', openingWidth: 360 }), wl(820, 1000, 360, 1000, 28, { subtype: 'window', openingWidth: 360, openingHeight: 150, openingSill: 40 }), wl(360, 1000, 0, 1000, 28),
      wl(0, 1000, 0, 500, 28), wl(0, 500, 0, 0, 28, { subtype: 'door', openingWidth: 110 }),
      // partitions
      wl(0, 380, 360, 380, 14, { subtype: 'door', openingWidth: 80 }), wl(0, 640, 360, 640, 14, { subtype: 'door', openingWidth: 80 }),
      wl(360, 0, 360, 140, 14), wl(360, 140, 360, 240, 14, { subtype: 'door', openingWidth: 80 }), wl(360, 240, 360, 460, 14), wl(360, 460, 360, 620, 14, { subtype: 'door', openingWidth: 110 }), wl(360, 620, 360, 1000, 14),
      wl(820, 0, 820, 460, 14), wl(360, 460, 1400, 460, 14),
    ],
    furniture: [
      // Küche
      fu('kitchen-row', 560, 45, [360, 60], 0, { label: 'Küchenzeile', materialKey: 'leatherBlack' }), fu('fridge', 785, 45, [60, 65], 90),
      fu('kitchen-island', 600, 280, [260, 100], 0, { label: 'Kochinsel', materialKey: 'oak' }), fu('barstool', 510, 370, [40, 40]), fu('barstool', 600, 370, [40, 40]), fu('barstool', 690, 370, [40, 40]),
      // Essen
      fu('table-dining-8', 1100, 240, [240, 100], 0, { label: 'Esstisch', materialKey: 'oak' }),
      fu('chair-dining', 1010, 165, [45, 50], 180), fu('chair-dining', 1100, 165, [45, 50], 180), fu('chair-dining', 1190, 165, [45, 50], 180),
      fu('chair-dining', 1010, 315, [45, 50], 0), fu('chair-dining', 1100, 315, [45, 50], 0), fu('chair-dining', 1190, 315, [45, 50], 0), fu('plant-large', 1330, 90, [55, 55]),
      // Wohnzimmer
      fu('sofa-corner', 620, 720, [320, 240], 0, { label: 'Wohnlandschaft', materialKey: 'fabricGray' }), fu('table-coffee', 660, 620, [130, 70]), fu('rug-large', 660, 690, [250, 350]),
      fu('tv-stand', 500, 985, [200, 45], 0, { materialKey: 'leatherBlack' }), fu('fireplace', 380, 620, [120, 40], 90), fu('armchair', 1050, 620, [85, 90]), fu('plant-tall', 1330, 520, [40, 40]),
      // Diele / WC / HWR
      fu('coat-rail', 180, 16, [90, 6]), fu('shoe-bench', 180, 60, [95, 34]), fu('dresser', 60, 250, [110, 45], 90),
      fu('toilet', 320, 600, [40, 70], 270), fu('sink-bath', 60, 420, [60, 45]),
      fu('washing-machine', 70, 940, [60, 60]), fu('wardrobe-200', 200, 690, [200, 60]),
      // Terrasse
      fu('outdoor-table', 700, 1050, [180, 90]), fu('lounge-chair', 950, 1050, [80, 80]), fu('grill', 1300, 1050, [130, 60]),
    ],
    devices: [
      dv('lockin-g30', 16, 500, 90, { note: 'Haustür' }), dv('netatmo-doorbell', 24, 440, 90), dv('shelly-plus-2pm', 600, 280, 0, { note: 'Küchenlicht' }),
      dv('hue-e27-white-color', 1100, 240, 0, { note: 'Pendel Esstisch' }), dv('sonos-arc-ultra', 580, 990), dv('apple-tv-4k', 520, 990),
      dv('govee-floor-lamp', 1050, 620), dv('aqara-fp2', 700, 560), dv('eve-thermo', 1380, 300), dv('bosch-twinguard', 700, 500), dv('hue-motion', 180, 200),
    ],
    labels: [lb('Diele', 180, 200, 12), lb('Gäste-WC', 180, 510, 11), lb('HWR', 180, 820, 11), lb('Küche', 590, 220, 14), lb('Essen', 1100, 120, 14), lb('Wohnzimmer', 900, 730, 16), lb('Terrasse', 880, 1050, 13)],
  }
  const og: Floor = {
    id: uuid(), name: '1. Obergeschoss', index: 1, layers: LAYERS, extent: { width: 1400, height: 1000 },
    rooms: [
      room('Elternschlafzimmer', 0, 0, 620, 460, 'floor-carpet-warm'), room('Ankleide', 0, 460, 360, 1000),
      room('Bad', 360, 460, 760, 1000, 'floor-ceramic-light'), room('Kinderzimmer 1', 620, 0, 1400, 460),
      room('Kinderzimmer 2', 760, 460, 1400, 1000), room('Flur', 620, 460, 760, 1000, 'floor-oak-parquet'),
    ],
    walls: [
      wl(0, 0, 620, 0, 28, { subtype: 'window', openingWidth: 300, openingHeight: 140, openingSill: 60 }), wl(620, 0, 1400, 0, 28, { subtype: 'window', openingWidth: 360, openingHeight: 140, openingSill: 60 }),
      wl(1400, 0, 1400, 460, 28, { subtype: 'window', openingWidth: 260, openingHeight: 140, openingSill: 60 }), wl(1400, 460, 1400, 1000, 28, { subtype: 'window', openingWidth: 300, openingHeight: 140, openingSill: 60 }),
      wl(1400, 1000, 760, 1000, 28, { subtype: 'window', openingWidth: 360, openingHeight: 140, openingSill: 60 }), wl(760, 1000, 0, 1000, 28, { subtype: 'window', openingWidth: 200, openingHeight: 140, openingSill: 60 }),
      wl(0, 1000, 0, 0, 28),
      // partitions
      wl(620, 0, 620, 460, 14, { subtype: 'door', openingWidth: 90 }), wl(0, 460, 620, 460, 14), wl(620, 460, 1400, 460, 14),
      wl(360, 460, 360, 1000, 14, { subtype: 'door', openingWidth: 80 }), wl(760, 460, 760, 1000, 14),
      wl(620, 460, 620, 1000, 14, { subtype: 'door', openingWidth: 90 }), wl(620, 720, 760, 720, 14, { subtype: 'door', openingWidth: 80 }),
    ],
    furniture: [
      // Elternschlafzimmer
      fu('bed-200', 300, 260, [205, 215], 0, { label: 'Bett', materialKey: 'fabricGray' }), fu('nightstand', 170, 180, [45, 40]), fu('nightstand', 430, 180, [45, 40]),
      fu('dresser', 560, 240, [110, 45], 90), fu('rug-medium', 300, 290, [200, 300]), fu('wall-art-wide', 300, 15, [140, 4]),
      // Ankleide
      fu('wardrobe-300', 60, 700, [300, 60], 90), fu('wardrobe-200', 180, 950, [200, 60]), fu('mirror', 330, 720, [60, 4], 270),
      // Bad
      fu('bathtub', 450, 540, [170, 80]), fu('shower', 680, 540, [90, 90]), fu('toilet', 700, 940, [40, 70], 270), fu('sink-bath', 450, 950, [60, 45]),
      // Kinderzimmer 1
      fu('bed-140', 720, 190, [145, 200]), fu('desk-160', 1050, 90, [160, 80]), fu('wardrobe-200', 1250, 200, [200, 60], 90), fu('bookshelf-wide', 720, 430, [200, 35]),
      // Kinderzimmer 2
      fu('bed-140', 900, 640, [145, 200]), fu('desk-160', 1250, 560, [160, 80], 90), fu('wardrobe-200', 1000, 970, [200, 60]), fu('bookshelf-wide', 1350, 800, [200, 35], 90),
    ],
    devices: [
      dv('shelly-1pm-mini', 300, 200, 0, { note: 'Deckenlicht Eltern' }), dv('aqara-fp2', 300, 40), dv('eve-thermo', 20, 300),
      dv('govee-table-lamp', 170, 190), dv('hue-motion', 690, 480), dv('echo-dot-5', 720, 40), dv('echo-dot-5', 900, 490),
      dv('bosch-twinguard', 690, 500), dv('eve-thermo', 1380, 200),
    ],
    labels: [lb('Elternschlafzimmer', 300, 260, 14), lb('Ankleide', 180, 730, 12), lb('Bad', 560, 730, 13), lb('Kinderzimmer 1', 1000, 230, 13), lb('Kinderzimmer 2', 1080, 730, 13), lb('Flur', 690, 600, 11)],
  }
  return plan('Einfamilienhaus', 'Einfamilienhaus — Erdgeschoss mit offener Wohnküche & Terrasse, Obergeschoss mit Eltern- und zwei Kinderzimmern.', ['haus', 'familie'], [eg, og])
}

export interface TemplateDescriptor {
  id: string
  name: string
  subtitle: string
  tags: string[]
  build: () => PlanDocument
}

/**
 * A curated set of starter templates. These are scaffolding — walls only —
 * so users can immediately drop devices & furniture. Can be extended later
 * with preset devices/furniture for each template.
 */
export const TEMPLATES: TemplateDescriptor[] = [
  {
    id: 'omega',
    name: 'Omega — Die Residenz',
    subtitle: '4 Stockwerke · Garten · 3 Pools',
    tags: ['villa', 'showcase'],
    build: buildOmegaPlan,
  },
  {
    id: 'studio',
    name: 'Studio',
    subtitle: '1 Raum · 32 m²',
    tags: ['klein', 'offen'],
    build: buildStudioPlan,
  },
  {
    id: 'apartment-2',
    name: '2-Zimmer-Wohnung',
    subtitle: '2 Räume · 65 m²',
    tags: ['mittel', 'city'],
    build: buildApartment2Plan,
  },
  {
    id: 'apartment-3',
    name: '3-Zimmer-Wohnung',
    subtitle: '3 Räume · 85 m²',
    tags: ['familie'],
    build: buildApartment3Plan,
  },
  {
    id: 'loft',
    name: 'Loft',
    subtitle: 'Offener Grundriss · 120 m²',
    tags: ['loft', 'offen'],
    build: buildLoftPlan,
  },
  {
    id: 'penthouse',
    name: 'Penthouse',
    subtitle: '4 Räume · Dachterrasse',
    tags: ['luxus'],
    build: buildPenthousePlan,
  },
  {
    id: 'house-family',
    name: 'Einfamilienhaus',
    subtitle: '2 Etagen · Garten',
    tags: ['haus', 'familie'],
    build: buildHouseFamilyPlan,
  },
]
