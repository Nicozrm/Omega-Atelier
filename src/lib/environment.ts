import { kelvinToHex } from '@/lib/lighting'
import { solarPosition, dayOfYear } from '@/lib/solar'

/**
 * environment.ts — the renderer-neutral **environment domain**.
 *
 * This is the single source of truth for the *physical state of the world around
 * the model*: time, the sun's position, the sky, and the weather — and, derived
 * from that physical state, the renderable lighting. Output is plain data (hex
 * colours, scalars, a unit vector); there are no THREE types and no rendering
 * concerns, and every colour-from-temperature step is delegated to `lighting.ts`
 * (`kelvinToHex`) so Kelvin maths lives in exactly one place.
 *
 * Design intent (Digital-Twin platform): this domain is deliberately *more
 * general than any one renderer*. `deriveEnvironment` is the only entry point —
 * renderers (and, later, solar-yield, shading, window-light and energy analyses)
 * consume the returned `EnvironmentState`, never internal helpers. The physical
 * fields (`sun`, `weather`, `time`) exist so those future features read the same
 * world state the 3D view does, and so weather, seasons, window light and
 * atmospheric parameters slot in here without touching a renderer.
 */

export type Weather = 'clear' | 'cloudy' | 'overcast'
export type DayPhase = 'night' | 'dawn' | 'goldenHour' | 'day' | 'dusk'

export interface EnvironmentInput {
  /** Hour of day, 0…24. The primary driver. Default: noon (12). */
  timeOfDay?: number
  /** Calendar date for seasonal sun. Default: spring equinox. */
  date?: { month: number; day: number }
  /** Observer latitude, degrees (+N / −S). Default: central-European latitude. */
  latitudeDeg?: number
  /** Building orientation, degrees (plan vs true compass). Default: 0. */
  orientationDeg?: number
  /** Sky / weather condition. Default: 'clear'. */
  weather?: Weather
}

/** Physical sun — reusable for solar yield, shading and window light. */
export interface SunState {
  azimuth: number
  elevation: number
  aboveHorizon: boolean
  /** Unit vector toward the sun, +X=east, +Y=up, +Z=south (plan-aligned). */
  direction: { x: number; y: number; z: number }
}

export interface SkyState {
  zenithColor: string
  horizonColor: string
  /** Overall sky luminance, 0…1 (background brightness, IBL strength, …). */
  intensity: number
}

export interface WeatherState {
  condition: Weather
  /** 0 (clear) … 1 (fully overcast). */
  cloudiness: number
}

/** Renderable lighting derived from the physical state. */
export interface RenderLighting {
  ambient: { color: string; intensity: number }
  hemisphere: { skyColor: string; groundColor: string; intensity: number }
  sun: {
    color: string
    intensity: number
    castShadow: boolean
    /** Shadow strength, normalised for direct use as a shadow opacity (0…~0.55). */
    shadowIntensity: number
  }
  /**
   * Exterior-albedo multiplier, 0.07 (deep night) … 1 (full day). The world
   * *around* the model has no interior fixtures, so its surfaces recede with
   * daylight. A single **continuous** scalar (see `exteriorLightScale`) drives
   * every exterior surface — neighbourhood, own-house shell, distant backdrop —
   * so scrubbing time never steps the surroundings between brightness buckets.
   */
  exteriorAlbedoScale: number
}

export interface EnvironmentState {
  time: { hour: number; dayOfYear: number }
  sun: SunState
  phase: DayPhase
  weather: WeatherState
  sky: SkyState
  lighting: RenderLighting
}

// ─── Defaults ────────────────────────────────────────────────
const DEFAULT_LATITUDE = 52 // ~ central Europe
const DEFAULT_DATE = { month: 3, day: 20 } // spring equinox (balanced day length)

// ─── Small colour helpers (kept local; Kelvin stays in lighting.ts) ───
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}
/** Pull a colour toward its grey luminance (weather desaturation). */
function desaturate(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex)
  const grey = 0.299 * r + 0.587 * g + 0.114 * b
  const k = Math.max(0, Math.min(1, t))
  return rgbToHex(r + (grey - r) * k, g + (grey - g) * k, b + (grey - b) * k)
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

// Sky anchor colours, blended by daylight factor + weather.
const SKY_DAY_ZENITH = '#6f9fd0'
const SKY_DAY_HORIZON = '#cfe0ec'
// Near-neutral night sky — the archviz reference floats the lit model on a
// near-black backdrop; a strong blue cast reads as "video game night".
const SKY_NIGHT_ZENITH = '#080a11'
const SKY_NIGHT_HORIZON = '#131722'
const SKY_GOLDEN_HORIZON = '#e8a25c'

function cloudinessFor(w: Weather): number {
  switch (w) {
    case 'overcast':
      return 0.9
    case 'cloudy':
      return 0.45
    default:
      return 0.0
  }
}

/** Sun colour temperature from elevation: warm near the horizon, cool high. */
function sunKelvin(elevationDeg: number): number {
  const t = clamp01(elevationDeg / 60)
  return Math.round(2100 + t * (5800 - 2100))
}

function phaseFor(elevationDeg: number, hour: number): DayPhase {
  if (elevationDeg <= -3) return 'night'
  if (elevationDeg <= 0) return hour < 12 ? 'dawn' : 'dusk'
  if (elevationDeg <= 10) return 'goldenHour'
  return 'day'
}

/**
 * Continuous exterior-albedo scale from the sun's elevation, 0.07 … 1.
 *
 * The surroundings carry no interior lighting, so at night they must recede
 * toward black — but as a **smooth** function of the sun, never a step. Earlier
 * this was a five-value lookup keyed on the day phase, so scrubbing the clock
 * popped the whole neighbourhood between brightness levels at each phase border
 * (≈0.36 in one frame).
 *
 * The tuned brightness *plateaus* are preserved exactly — deep night 0.07,
 * golden hour 0.62, full day 1.0 — so a settled time of day looks identical to
 * before. Only the three narrow bands *between* plateaus are smoothed
 * (smoothstep, C¹), turning each former pop into a seamless dissolve. The 0.07
 * night floor keeps the estate legible in the dark instead of crushing it to
 * pure black.
 */
export function exteriorLightScale(elevationDeg: number): number {
  const smooth = (e0: number, e1: number, x: number) => {
    const t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
  }
  const NIGHT = 0.07, TWILIGHT = 0.32, GOLDEN = 0.62, DAY = 1.0
  return (
    NIGHT +
    (TWILIGHT - NIGHT) * smooth(-6, 0, elevationDeg) + // night → twilight
    (GOLDEN - TWILIGHT) * smooth(-3, 3, elevationDeg) + // twilight → golden hour
    (DAY - GOLDEN) * smooth(6, 14, elevationDeg) //       golden hour → full day
  )
}

/**
 * Resolve the complete environment state for the given world conditions.
 * The single entry point for the environment domain.
 */
export function deriveEnvironment(input: EnvironmentInput = {}): EnvironmentState {
  const hour = input.timeOfDay ?? 12
  const date = input.date ?? DEFAULT_DATE
  const doy = dayOfYear(date.month, date.day)
  const latitudeDeg = input.latitudeDeg ?? DEFAULT_LATITUDE
  const orientationDeg = input.orientationDeg ?? 0
  const condition = input.weather ?? 'clear'
  const cloudiness = cloudinessFor(condition)

  const pos = solarPosition({ hour, dayOfYear: doy, latitudeDeg, orientationDeg })
  const elevation = pos.elevation

  // Daylight factor: 0 below the horizon (incl. civil twilight) … 1 at zenith.
  const daylightF = clamp01((elevation + 6) / 60)
  const phase = phaseFor(elevation, hour)

  // ── Sky ──
  const zenithBase = mix(SKY_NIGHT_ZENITH, SKY_DAY_ZENITH, daylightF)
  let horizonBase = mix(SKY_NIGHT_HORIZON, SKY_DAY_HORIZON, daylightF)
  // Warm the horizon while the sun is low (golden hour / twilight).
  if (elevation > -4 && elevation <= 12) {
    const golden = clamp01(1 - Math.abs(elevation - 3) / 9)
    horizonBase = mix(horizonBase, SKY_GOLDEN_HORIZON, golden * 0.7)
  }
  const sky: SkyState = {
    zenithColor: desaturate(zenithBase, cloudiness * 0.7),
    horizonColor: desaturate(horizonBase, cloudiness * 0.7),
    intensity: clamp01(0.1 + daylightF * 0.9) * (1 - cloudiness * 0.25),
  }

  // ── Sun (render light) ──
  const above = pos.aboveHorizon
  const sunStrength = clamp01(Math.sin(Math.max(0, elevation) * (Math.PI / 180)))
  // Perceptual drive: sin(elevation) alone leaves the golden-hour sun nearly
  // invisible (5° → 0.09). The sub-linear curve lifts the low sun into the
  // warm, long-shadow drama archviz golden hour is known for, while noon
  // changes only marginally (0.87 → 0.92).
  const sunDrive = Math.pow(sunStrength, 0.6)
  const sunColor = kelvinToHex(above ? sunKelvin(elevation) : 6500)
  const sunIntensity = above ? sunDrive * 1.4 * (1 - 0.75 * cloudiness) : 0
  const shadowIntensity = above ? sunDrive * (1 - 0.85 * cloudiness) * 0.55 : 0

  // ── Ambient + hemisphere ──
  const ambient = {
    color: kelvinToHex(Math.round(3000 + daylightF * 3000)),
    intensity: 0.04 + daylightF * 0.2 + cloudiness * 0.05,
  }
  const hemisphere = {
    skyColor: sky.zenithColor,
    groundColor: kelvinToHex(3200),
    intensity: (0.15 + daylightF * 0.5) * (1 - cloudiness * 0.25),
  }

  return {
    time: { hour, dayOfYear: doy },
    sun: {
      azimuth: pos.azimuth,
      elevation,
      aboveHorizon: above,
      direction: pos.direction,
    },
    phase,
    weather: { condition, cloudiness },
    sky,
    lighting: {
      ambient,
      hemisphere,
      sun: { color: sunColor, intensity: sunIntensity, castShadow: above, shadowIntensity },
      exteriorAlbedoScale: exteriorLightScale(elevation),
    },
  }
}
