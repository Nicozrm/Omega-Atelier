/**
 * dayCycle.ts — the Living-Home day cycle model (renderer-neutral, pure).
 *
 * Turns an hour of the day (0–24) into (a) which OMEGA mode the home should be
 * in and (b) a daylight "wash" the 2D plan paints over the floor — night
 * darkens and cools it so lamp pools glow, day brightens it, dawn/dusk warm it.
 * Both the play control and the canvas read this one source of truth.
 */

import type { ModeKey } from '@/types'

/** Wrap any hour into [0, 24). */
const wrap = (h: number): number => ((h % 24) + 24) % 24

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))
const smooth = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t) }
/** Rising edge: 0 before a, 1 after b, smooth between. */
const up = (t: number, a: number, b: number): number => smooth((t - a) / (b - a))
/** A soft bump centred on c with half-width w. */
const bump = (t: number, c: number, w: number): number => {
  const d = ((t - c) / w) ** 2
  return Math.exp(-d)
}

/**
 * The OMEGA mode a given hour belongs to. Morning / day-office / night reuse
 * the modes' own trigger windows; the evening is split relax → film for a
 * natural cosy-then-cinematic wind-down.
 */
export function modeForHour(hour: number): ModeKey {
  const t = wrap(hour)
  if (t >= 5.5 && t < 8.5) return 'morning'
  if (t >= 8.5 && t < 17.5) return 'day-office'
  if (t >= 17.5 && t < 20.5) return 'relax'
  if (t >= 20.5 && t < 23) return 'film'
  return 'night'
}

export interface DayWash {
  /** How dark/cool the floor goes (0–1) — deep night → 1. */
  night: number
  /** How bright the floor goes (0–1) — midday → 1. */
  day: number
  /** Warm amber dawn/dusk band (0–1). */
  dusk: number
}

/** The daylight wash for a given hour. */
export function daylightWash(hour: number): DayWash {
  const t = wrap(hour)
  const day = up(t, 6.5, 9.5) * (1 - up(t, 16.5, 19.5))
  const night = clamp01(Math.max(1 - up(t, 4.5, 6.5), up(t, 20, 22.5)))
  const dusk = clamp01(Math.max(bump(t, 7.2, 1.1), bump(t, 18.6, 1.5)))
  return { day: clamp01(day), night, dusk }
}

/** Format an hour as HH:MM. */
export function formatClock(hour: number): string {
  const t = wrap(hour)
  const h = Math.floor(t)
  const m = Math.floor((t - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Short German label for the phase of day (for the play control). */
export function phaseLabel(hour: number): string {
  const t = wrap(hour)
  if (t < 5.5) return 'Nacht'
  if (t < 8.5) return 'Morgen'
  if (t < 12) return 'Vormittag'
  if (t < 17.5) return 'Tag'
  if (t < 20.5) return 'Abend'
  if (t < 23) return 'Später Abend'
  return 'Nacht'
}
