/**
 * reflection.ts — pure mappings from a room's renderer-neutral live state to 3D
 * presentation values (light intensity, glow opacity, climate colour).
 *
 * Deliberately free of three.js and React so it stays unit-testable. The 3D
 * `LiveTwinReflection` component consumes these; the room aggregation itself
 * (`deriveRoomLiveState`) is shared verbatim with the 2D floorplan — no duplicate
 * logic between 2D and 3D.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const COOL = '#6aa8ff' // ≤16 °C
const NEUTRAL = '#ffd9a0' // ~21 °C
const HOT = '#ff6a4a' // ≥27 °C

function parseHex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

/** Map a room temperature to a cool→neutral→hot colour. Undefined when no reading. */
export function climateColor(celsius: number | undefined): string | undefined {
  if (celsius === undefined) return undefined
  if (celsius <= 21) return lerpHex(COOL, NEUTRAL, clamp((celsius - 16) / 5, 0, 1))
  return lerpHex(NEUTRAL, HOT, clamp((celsius - 21) / 6, 0, 1))
}

/** THREE point-light intensity for a room's live lights (0 when none on). */
export function lightIntensity(brightness: number | undefined, lightsOn: number): number {
  if (lightsOn <= 0) return 0
  return 0.4 + (brightness ?? 60) / 100 * 2.2
}

/** Floor-glow plane opacity from brightness (subtle, capped). */
export function glowOpacity(brightness: number | undefined): number {
  return Math.min(0.5, 0.12 + (brightness ?? 60) / 100 * 0.3)
}
