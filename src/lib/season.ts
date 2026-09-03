/**
 * Seasons for the living world.
 *
 * The environment model already takes a calendar date to place the sun; this
 * module turns that same date into what the season *looks* like. It stays pure
 * and geometry-free on purpose: a season is expressed as colour shifts and two
 * scalars, so the renderer only re-tints materials it already builds instead of
 * spawning new meshes. That keeps the whole feature free of draw-call cost.
 *
 * Colours are hex strings so callers can hand them straight to three.js.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
  winter: 'Winter',
}

export interface SeasonPalette {
  /** Canopy tint, darkest to lightest — mapped onto the four foliage slots. */
  foliage: [string, string, string, string]
  /** Clipped hedge tint (stays greener than free-growing canopies). */
  hedge: string
  /** Mown lawn tint. */
  lawn: string
  /**
   * How much snow covers horizontal surfaces, 0…1. Drives a blend toward white
   * on ground and roofs rather than a separate snow layer.
   */
  snow: number
  /** Blossom presence, 0…1 — pale pink accents in the canopies. */
  blossom: number
}

const PALETTES: Record<Season, SeasonPalette> = {
  // Fresh, yellow-leaning growth plus blossom.
  spring: {
    foliage: ['#546b31', '#647f3c', '#74914a', '#8aa257'],
    hedge: '#465a2f',
    lawn: '#6f7d4a',
    snow: 0,
    blossom: 0.55,
  },
  // The established look — deep, saturated summer green.
  summer: {
    foliage: ['#4f6136', '#5c7040', '#647a44', '#7a6a3e'],
    hedge: '#41522f',
    lawn: '#6f7551',
    snow: 0,
    blossom: 0,
  },
  // Warm decay: amber, rust and ochre.
  autumn: {
    foliage: ['#6d4a22', '#8a5a24', '#a3712c', '#b98a33'],
    hedge: '#4a4a2b',
    lawn: '#6b6746',
    snow: 0,
    blossom: 0,
  },
  // Bare, desaturated wood under snow.
  winter: {
    foliage: ['#4a4438', '#565042', '#615a4b', '#6d6554'],
    hedge: '#3f4636',
    lawn: '#6a6d5f',
    snow: 0.75,
    blossom: 0,
  },
}

/**
 * Meteorological seasons (whole months), which match how the year *looks* far
 * better than the astronomical ones: December already reads as winter long
 * before the solstice, and March reads as spring.
 */
export function seasonFromDate(month: number, day = 1): Season {
  if (!Number.isFinite(month)) return 'summer'
  // Accept any integer month by wrapping it into 1…12.
  const m = ((Math.trunc(month) - 1) % 12 + 12) % 12 + 1
  void day
  if (m === 12 || m <= 2) return 'winter'
  if (m <= 5) return 'spring'
  if (m <= 8) return 'summer'
  return 'autumn'
}

export function seasonPalette(season: Season): SeasonPalette {
  return PALETTES[season] ?? PALETTES.summer
}

/**
 * Blend a base colour toward snow white by the palette's snow amount. Used for
 * upward-facing surfaces (ground, roofs) so winter settles on them without any
 * extra geometry.
 */
export function snowed(hex: string, snow: number, exposure = 1): string {
  const t = clamp01(snow) * clamp01(exposure)
  if (t <= 0) return hex
  return mixHex(hex, '#eef1f4', t)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0
}

/** Linear hex mix. `t = 0` returns `a`, `t = 1` returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const k = clamp01(t)
  const ca = parseHex(a)
  const cb = parseHex(b)
  const ch = (i: number) => Math.round(ca[i] + (cb[i] - ca[i]) * k)
  return '#' + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = Number.parseInt(full, 16)
  if (!Number.isFinite(n) || full.length !== 6) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
