import type { ModeKey, DeviceCategory, PlacedDevice, Point } from '@/types'
import { modeStateFor } from '@/lib/modeState'

/**
 * lighting.ts — the renderer-neutral lighting model.
 *
 * Turns *where light devices are placed* + *the active scene/mode* into an
 * effective per-room lighting state that any renderer can visualise (2D tint,
 * 3D point lights, …) and that a future connector can reconcile against the
 * real luminaires. Pure and dependency-light: it reads the existing per-mode
 * light defaults from `modeState.ts` rather than duplicating them.
 */

/** Minimal device-category lookup, injected so this stays decoupled from the
 *  full device catalog (mirrors the readiness module's approach). */
export type CategoryLookup = (deviceId: string) => DeviceCategory | undefined

export interface RoomLighting {
  /** At least one light in the room is on for the active mode. */
  on: boolean
  /** Average brightness of the on-lights, 0…1. */
  intensity: number
  /** Average correlated colour temperature of the on-lights, in Kelvin. */
  kelvin: number
  /** `kelvin` rendered to an sRGB hex colour. */
  color: string
  /** Total light fixtures in the room (on or off). */
  lightCount: number
}

const NEUTRAL_KELVIN = 3000

/**
 * Approximate a correlated colour temperature (Kelvin) as an sRGB hex string.
 * Tanner-Helland approximation, clamped to a sensible luminaire range.
 */
export function kelvinToHex(kelvin: number): string {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100
  let r: number
  let g: number
  let b: number

  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }

  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307

  const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
  return '#' + [r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

function lightStateFor(device: PlacedDevice, mode: ModeKey): { on: boolean; brightness: number; kelvin: number; color?: string } {
  // Per-device override wins over the category default for the mode.
  const override = device.modeState?.[mode]
  const base = modeStateFor('light', mode)
  const s = { ...base, ...(override ?? {}) }

  const on = s.on === true || (typeof s.brightness === 'number' && s.brightness > 0)
  const brightness = typeof s.brightness === 'number' ? s.brightness : on ? 100 : 0
  const kelvin = typeof s.kelvin === 'number' ? s.kelvin : NEUTRAL_KELVIN
  // Optional saturated RGB (e.g. an RGB strip set to blue/purple for a scene).
  // A valid `#rrggbb` overrides the Kelvin-derived white; otherwise undefined.
  const color = typeof s.color === 'string' && HEX6.test(s.color) ? s.color.toLowerCase() : undefined
  return { on, brightness, kelvin, color }
}

export interface LightSource {
  /** Placed-device id of the luminaire. */
  deviceId: string
  /** Room the luminaire belongs to (if assigned). */
  roomId: string | undefined
  /** Plan-space position (cm). Renderers map this into their own space and
   *  choose a mounting height — keeping spatial transforms out of the model. */
  position: Point
  on: boolean
  /** Brightness as 0…1. */
  intensity: number
  kelvin: number
  /** `kelvin` rendered to an sRGB hex colour (computed here, never downstream). */
  color: string
}

export interface LightSourcesInput {
  devices: PlacedDevice[]
  lookup: CategoryLookup
  mode: ModeKey
}

/**
 * The single source of truth for *individual* luminaires under the active mode.
 * Every renderer that needs per-light placement (e.g. 3D point lights) consumes
 * this — no renderer re-derives light state, colour, or brightness itself.
 */
export function deriveLightSources({ devices, lookup, mode }: LightSourcesInput): LightSource[] {
  const sources: LightSource[] = []
  for (const d of devices) {
    if (lookup(d.deviceId) !== 'light') continue
    const s = lightStateFor(d, mode)
    sources.push({
      deviceId: d.id,
      roomId: d.roomId,
      position: d.position,
      on: s.on,
      intensity: s.brightness / 100,
      kelvin: s.kelvin,
      // A per-scene saturated colour (RGB strip) wins; else derive white from Kelvin.
      color: s.color ?? kelvinToHex(s.kelvin),
    })
  }
  return sources
}

export interface RoomLightingInput {
  roomId: string
  devices: PlacedDevice[]
  lookup: CategoryLookup
  mode: ModeKey
}

/**
 * Compute the effective lighting for a single room under the active mode.
 * Derived from {@link deriveLightSources} (no duplicated logic): the room is
 * "on" if any of its lights is on; intensity/kelvin are averaged over the
 * on-lights.
 */
export function deriveRoomLighting({ roomId, devices, lookup, mode }: RoomLightingInput): RoomLighting {
  const inRoom = deriveLightSources({ devices, lookup, mode }).filter((s) => s.roomId === roomId)
  const lit = inRoom.filter((s) => s.on)
  const onCount = lit.length
  const on = onCount > 0
  const intensity = on ? lit.reduce((acc, s) => acc + s.intensity, 0) / onCount : 0
  const kelvin = on ? Math.round(lit.reduce((acc, s) => acc + s.kelvin, 0) / onCount) : NEUTRAL_KELVIN

  return {
    on,
    intensity,
    kelvin,
    color: kelvinToHex(kelvin),
    lightCount: inRoom.length,
  }
}
