/**
 * acoustics.ts — hear the floor plan (pure, renderer-free).
 *
 * The physics behind the audible plan: a listener stands somewhere in the
 * apartment, sound sources (speakers, appliances) sit somewhere else, and the
 * REAL walls of the plan attenuate what arrives. Distance rolls the level off,
 * every wall on the straight path muffles the sound (level + a heavy low-pass,
 * exactly what a wall does to music), and the horizontal angle pans it in the
 * stereo field. No Web Audio in here — the component feeds these numbers into
 * gain/filter/panner nodes; this module is pure math and fully testable.
 */

import type { Point, Wall } from '@/types'

/** Proper segment intersection (excluding collinear touch — good enough here). */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const d1 = d(p3, p4, p1)
  const d2 = d(p3, p4, p2)
  const d3 = d(p1, p2, p3)
  const d4 = d(p1, p2, p4)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** How many solid walls sit on the straight line listener → source.
 *  Doors/windows count as light barriers, so they attenuate half as much —
 *  returned separately for the caller to weigh. */
export function barriersBetween(listener: Point, source: Point, walls: Wall[]): { solid: number; openings: number } {
  let solid = 0
  let openings = 0
  for (const w of walls) {
    if (!segmentsIntersect(listener, source, w.a, w.b)) continue
    if ((w.subtype ?? 'wall') === 'wall') solid++
    else openings++
  }
  return { solid, openings }
}

export interface AcousticPath {
  /** Straight-line distance, cm. */
  distanceCm: number
  /** Solid walls on the path. */
  walls: number
  /** Linear output gain 0…1 (distance rolloff × wall attenuation). */
  gain: number
  /** Low-pass cutoff in Hz — open air ≈ 18 kHz, falls hard per wall. */
  lowpassHz: number
  /** Stereo pan −1…1 from the horizontal offset. */
  pan: number
}

/** Distance (cm) at which a source still plays at full level. */
const NEAR_CM = 90
/** Rolloff shaping — how quickly level falls beyond NEAR_CM. */
const ROLLOFF_CM = 520
/** Per-solid-wall level multiplier (≈ −7 dB each). */
const WALL_GAIN = 0.45
/** Per-opening (door/window) level multiplier (≈ −3 dB each). */
const OPENING_GAIN = 0.7

/**
 * The full acoustic path listener → source against the plan's walls.
 * All inputs in plan centimetres.
 */
export function acousticPath(listener: Point, source: Point, walls: Wall[]): AcousticPath {
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const distanceCm = Math.hypot(dx, dy)

  const b = barriersBetween(listener, source, walls)

  // Distance rolloff: full up close, smooth inverse falloff after.
  const beyond = Math.max(0, distanceCm - NEAR_CM)
  const distGain = 1 / (1 + (beyond / ROLLOFF_CM) ** 1.6)

  const wallGain = Math.pow(WALL_GAIN, b.solid) * Math.pow(OPENING_GAIN, b.openings)
  const gain = Math.max(0, Math.min(1, distGain * wallGain))

  // Air softens highs a little with distance; walls kill them hard.
  const airHz = 18000 / (1 + distanceCm / 2200)
  const lowpassHz = Math.max(180, airHz * Math.pow(0.28, b.solid) * Math.pow(0.75, b.openings))

  // Pan from the horizontal angle, softened so it never hard-pins a channel.
  const pan = distanceCm < 1 ? 0 : Math.max(-1, Math.min(1, (dx / distanceCm) * 0.8))

  return { distanceCm, walls: b.solid, gain, lowpassHz, pan }
}
