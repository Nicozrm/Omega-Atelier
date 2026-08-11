/**
 * cityStyle.ts — the **regional building culture** of the surrounding world.
 *
 * The neighbourhood around the plan is generated, not modelled, so everything
 * that makes a place *look like where it is* has to be expressed as parameters:
 * how wide the streets are, how deep the blocks run, how big a plot is, how far
 * a house sits back from the kerb, which roofs and facades are common, how the
 * front boundary is drawn, which trees grow there.
 *
 * This module is the single catalogue of those parameters. It is deliberately
 * renderer-neutral (no THREE, no React) and geometry-free: the generator reads
 * a spec to lay out streets and plots, and the renderer reads the same spec for
 * palettes and material hints. Adding a region means adding one entry here —
 * no generator change, no renderer change.
 *
 * Distances are metres, probabilities 0…1.
 */

export type CityStyle = 'de' | 'scandi' | 'us' | 'med'

export const CITY_STYLES: CityStyle[] = ['de', 'scandi', 'us', 'med']

export const CITY_STYLE_LABEL: Record<CityStyle, string> = {
  de: 'Deutschland',
  scandi: 'Skandinavien',
  us: 'USA',
  med: 'Mittelmeer',
}

/** Short label for the compact HUD chips. */
export const CITY_STYLE_SHORT: Record<CityStyle, string> = {
  de: 'DE',
  scandi: 'SKA',
  us: 'USA',
  med: 'MED',
}

/** Roof forms the generator can draw, with per-style weights. */
export type RoofForm = 'gable' | 'hip' | 'flat' | 'pent' | 'mansard'

/** How a plot is separated from the pavement. */
export type BoundaryKind = 'hedge' | 'fence' | 'wall' | 'open'

/** Canopy silhouettes available to the vegetation pass. */
export type TreeKind = 'broadleaf' | 'conifer' | 'birch' | 'cypress' | 'olive' | 'palm'

export interface StreetMetrics {
  /** Carriageway width of the quiet residential streets. */
  residentialWidthM: number
  /** Carriageway width of the collector road (Sammelstraße). */
  collectorWidthM: number
  /** Pavement width on each side. 0 means no pavement (rare). */
  sidewalkWidthM: number
  /** Centre dashes on residential streets — absent in calmed Dutch/German estates. */
  centreLine: boolean
  /** Painted kerb-side edge lines. */
  edgeLines: boolean
  /** Asphalt vs. block-paved carriageway. */
  surface: 'asphalt' | 'pavers'
}

export interface BlockMetrics {
  /** Distance between two parallel residential streets (street centre to centre). */
  depthM: number
  /** Distance between two cross streets. */
  widthM: number
  /** Plot frontage range along the street. */
  plotWidthM: [number, number]
  /** How far the house front sits back from the property line. */
  setbackM: number
  /** Share of plots that get a garage or carport. */
  garageRatio: number
}

export interface BuildingMetrics {
  /** Storey count range (inclusive). */
  stories: [number, number]
  /** Relative weights per roof form; normalised on read. */
  roofWeights: Partial<Record<RoofForm, number>>
  /** Storey height. */
  storeyHeightM: number
  /** Share of houses carrying a rooftop solar array. */
  solarRatio: number
  /** Share of houses with a chimney. */
  chimneyRatio: number
  /** Share of two-storey houses with a balcony. */
  balconyRatio: number
  /** Share of plots whose house is semi-detached / terraced rather than free-standing. */
  attachedRatio: number
}

export interface Palette {
  /** Facade albedos — the renderer tints its procedural plaster/brick with these. */
  facades: string[]
  /** Which procedural surface each facade entry wants. */
  facadeSurface: ('brick' | 'plaster' | 'board' | 'render')[]
  roofs: string[]
  /** Trim: window frames, fascia, sills. */
  trim: string
  /** Mown lawn base tint (the season palette still re-tints on top). */
  lawn: string
  road: string
  kerb: string
  sidewalk: string
}

export interface VegetationMetrics {
  /** Relative weights per canopy silhouette. */
  treeWeights: Partial<Record<TreeKind, number>>
  /** Street trees per 100 m of frontage. */
  streetTreeDensity: number
  /** Share of plots with a front-garden tree. */
  gardenTreeRatio: number
  /** Front boundary treatment weights. */
  boundaryWeights: Partial<Record<BoundaryKind, number>>
  /** Typical clipped-hedge height. */
  hedgeHeightM: number
}

export interface CityStyleSpec {
  id: CityStyle
  label: string
  /** One-line description shown as the control's tooltip. */
  hint: string
  /** Latitude the environment model should assume for this region's sun. */
  latitudeDeg: number
  street: StreetMetrics
  block: BlockMetrics
  building: BuildingMetrics
  palette: Palette
  vegetation: VegetationMetrics
  /** Which amenities belong to this culture (see lib/world/amenities). */
  amenities: AmenityKind[]
}

/**
 * Everything the local centre and the open blocks can hold. Kept here rather
 * than in `amenities.ts` so a style can declare its own mix without importing
 * the placement logic.
 */
export type AmenityKind =
  | 'supermarket'
  | 'bakery'
  | 'cafe'
  | 'pharmacy'
  | 'fuel'
  | 'charging'
  | 'playground'
  | 'park'
  | 'busStop'
  | 'kiosk'
  | 'school'
  | 'workshop'

const COMMON_AMENITIES: AmenityKind[] = [
  'supermarket', 'bakery', 'cafe', 'pharmacy', 'charging', 'playground', 'park', 'busStop',
]

const SPECS: Record<CityStyle, CityStyleSpec> = {
  /**
   * German Neubausiedlung — the estate the app was built around. Narrow calmed
   * streets, deep plots, steep tiled roofs over Klinker, clipped hedges.
   */
  de: {
    id: 'de',
    label: 'Deutschland',
    hint: 'Neubausiedlung — Klinker, Satteldächer, Hecken, verkehrsberuhigte Straßen',
    latitudeDeg: 52,
    street: {
      residentialWidthM: 5.5, collectorWidthM: 7.5, sidewalkWidthM: 1.8,
      centreLine: false, edgeLines: true, surface: 'asphalt',
    },
    block: {
      depthM: 62, widthM: 74, plotWidthM: [17, 26], setbackM: 5.5, garageRatio: 0.72,
    },
    building: {
      stories: [1, 2], roofWeights: { gable: 0.62, hip: 0.2, flat: 0.14, pent: 0.04 },
      storeyHeightM: 2.7, solarRatio: 0.42, chimneyRatio: 0.55, balconyRatio: 0.35,
      attachedRatio: 0.22,
    },
    palette: {
      facades: ['#c9a08c', '#e4cabb', '#d8d0c2', '#b98d78', '#5f6064'],
      facadeSurface: ['brick', 'brick', 'plaster', 'brick', 'render'],
      roofs: ['#3a3336', '#4a3f38', '#2c2a2b', '#6d4136'],
      trim: '#e9e5dc', lawn: '#6f7551', road: '#8b857a', kerb: '#9a9184', sidewalk: '#9a948a',
    },
    vegetation: {
      treeWeights: { broadleaf: 0.62, conifer: 0.22, birch: 0.16 },
      streetTreeDensity: 4.2, gardenTreeRatio: 0.7,
      boundaryWeights: { hedge: 0.55, fence: 0.3, open: 0.15 }, hedgeHeightM: 0.95,
    },
    amenities: [...COMMON_AMENITIES, 'kiosk', 'workshop'],
  },

  /**
   * Scandinavian — timber boards in falu red and off-white, shallow gables,
   * generous open plots with no fences, pine and birch, wide verges.
   */
  scandi: {
    id: 'scandi',
    label: 'Skandinavien',
    hint: 'Holzfassaden, Falunrot, offene Grundstücke, Kiefern und Birken',
    latitudeDeg: 60,
    street: {
      residentialWidthM: 5.0, collectorWidthM: 7.0, sidewalkWidthM: 1.5,
      centreLine: false, edgeLines: false, surface: 'asphalt',
    },
    block: {
      depthM: 72, widthM: 86, plotWidthM: [22, 34], setbackM: 7.5, garageRatio: 0.6,
    },
    building: {
      stories: [1, 2], roofWeights: { gable: 0.78, hip: 0.08, pent: 0.1, flat: 0.04 },
      storeyHeightM: 2.6, solarRatio: 0.18, chimneyRatio: 0.72, balconyRatio: 0.2,
      attachedRatio: 0.06,
    },
    palette: {
      facades: ['#7d3230', '#e8e3d8', '#3f4a4d', '#c8b89c', '#2f3a38'],
      facadeSurface: ['board', 'board', 'board', 'board', 'board'],
      roofs: ['#3b3a38', '#4b4340', '#2a2c2e'],
      trim: '#f4f1e8', lawn: '#67744a', road: '#8a8680', kerb: '#95908a', sidewalk: '#9a9790',
    },
    vegetation: {
      treeWeights: { conifer: 0.52, birch: 0.32, broadleaf: 0.16 },
      streetTreeDensity: 5.5, gardenTreeRatio: 0.85,
      boundaryWeights: { open: 0.62, hedge: 0.22, fence: 0.16 }, hedgeHeightM: 0.7,
    },
    amenities: [...COMMON_AMENITIES, 'kiosk', 'school'],
  },

  /**
   * North-American suburb — wide streets, no fences to the street, deep
   * driveways with an attached front garage, hipped shingle roofs, big lawns.
   */
  us: {
    id: 'us',
    label: 'USA',
    hint: 'Weite Straßen, Vorgarten-Rasen, angebaute Garagen, Schindeldächer',
    latitudeDeg: 40,
    street: {
      residentialWidthM: 8.5, collectorWidthM: 12, sidewalkWidthM: 1.5,
      centreLine: true, edgeLines: false, surface: 'asphalt',
    },
    block: {
      depthM: 66, widthM: 96, plotWidthM: [20, 30], setbackM: 9, garageRatio: 0.92,
    },
    building: {
      stories: [1, 2], roofWeights: { hip: 0.5, gable: 0.42, flat: 0.04, mansard: 0.04 },
      storeyHeightM: 2.9, solarRatio: 0.24, chimneyRatio: 0.48, balconyRatio: 0.12,
      attachedRatio: 0.04,
    },
    palette: {
      facades: ['#d9d2c4', '#b9c3bd', '#c9b39a', '#8f9a8e', '#e6e1d6'],
      facadeSurface: ['board', 'board', 'brick', 'board', 'board'],
      roofs: ['#4a4640', '#3a3733', '#5c4a3c'],
      trim: '#ffffff', lawn: '#6f8148', road: '#8f8b84', kerb: '#a8a49c', sidewalk: '#a5a19a',
    },
    vegetation: {
      treeWeights: { broadleaf: 0.78, conifer: 0.12, birch: 0.1 },
      streetTreeDensity: 3.6, gardenTreeRatio: 0.62,
      boundaryWeights: { open: 0.82, hedge: 0.1, fence: 0.08 }, hedgeHeightM: 0.6,
    },
    amenities: [...COMMON_AMENITIES, 'fuel', 'school'],
  },

  /**
   * Mediterranean — render in warm ochres, low-pitch pantiles or flat terraces,
   * boundary walls right on the plot line, cypress, olive and palm.
   */
  med: {
    id: 'med',
    label: 'Mittelmeer',
    hint: 'Putzfassaden in Ocker, flache Ziegeldächer, Mauern, Zypressen und Oliven',
    latitudeDeg: 38,
    street: {
      residentialWidthM: 4.8, collectorWidthM: 7.0, sidewalkWidthM: 1.4,
      centreLine: false, edgeLines: false, surface: 'pavers',
    },
    block: {
      depthM: 52, widthM: 62, plotWidthM: [13, 20], setbackM: 2.5, garageRatio: 0.5,
    },
    building: {
      stories: [1, 3], roofWeights: { pent: 0.4, gable: 0.3, flat: 0.28, hip: 0.02 },
      storeyHeightM: 2.8, solarRatio: 0.3, chimneyRatio: 0.3, balconyRatio: 0.72,
      attachedRatio: 0.45,
    },
    palette: {
      facades: ['#e2c79c', '#e8dcc4', '#d8a97c', '#efe6d6', '#cfa98c'],
      facadeSurface: ['plaster', 'plaster', 'render', 'plaster', 'render'],
      roofs: ['#a4633d', '#8d5334', '#b57448'],
      trim: '#f6f1e4', lawn: '#7d7b4c', road: '#98918a', kerb: '#a89e92', sidewalk: '#b0a596',
    },
    vegetation: {
      treeWeights: { cypress: 0.34, olive: 0.32, palm: 0.2, broadleaf: 0.14 },
      streetTreeDensity: 3.0, gardenTreeRatio: 0.75,
      boundaryWeights: { wall: 0.66, hedge: 0.22, open: 0.12 }, hedgeHeightM: 1.2,
    },
    amenities: [...COMMON_AMENITIES, 'kiosk'],
  },
}

export function cityStyleSpec(style: CityStyle): CityStyleSpec {
  return SPECS[style] ?? SPECS.de
}

/**
 * Resolve a weighted catalogue into a concrete choice.
 * `t` is a uniform sample in [0, 1); weights need not sum to 1.
 */
export function pickWeighted<K extends string>(weights: Partial<Record<K, number>>, t: number): K {
  const entries = Object.entries(weights) as [K, number][]
  const total = entries.reduce((s, [, w]) => s + (w > 0 ? w : 0), 0)
  if (total <= 0) return entries[0]?.[0] as K
  let acc = 0
  const target = Math.min(0.999999, Math.max(0, t)) * total
  for (const [k, w] of entries) {
    acc += w > 0 ? w : 0
    if (target < acc) return k
  }
  return entries[entries.length - 1][0]
}

const STORAGE_KEY = 'omega.cityStyle'

/** Read the persisted city style (defaults to the German estate). */
export function loadCityStyle(): CityStyle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && (CITY_STYLES as string[]).includes(raw)) return raw as CityStyle
  } catch { /* storage unavailable — fall through to the default */ }
  return 'de'
}

export function saveCityStyle(style: CityStyle): void {
  try { localStorage.setItem(STORAGE_KEY, style) } catch { /* non-fatal */ }
}
