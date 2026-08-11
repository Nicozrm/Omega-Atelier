/**
 * Rain and snow as a single recycled particle field.
 *
 * The whole system is one buffer of points that never grows or shrinks: drops
 * fall, and whatever leaves the bottom of the box is wrapped back to the top
 * instead of being destroyed and re-created. That keeps precipitation at one
 * draw call with zero allocation per frame, which is what makes it affordable
 * on the mobile budget the renderer works hard to protect.
 *
 * The geometry-free parts — sizing the field, seeding it and advancing it —
 * live here so they can be tested without a WebGL context. The renderer only
 * uploads the buffer this module maintains.
 */

export type Precip = 'none' | 'rain' | 'snow'

export const PRECIP_LABEL: Record<Precip, string> = {
  none: 'Klar',
  rain: 'Regen',
  snow: 'Schnee',
}

export interface PrecipParams {
  /** Particle count for the field. */
  count: number
  /** Fall speed in metres per second (downward). */
  speed: number
  /** Horizontal sway amplitude in metres per second. */
  drift: number
  /** Point size (snow) or streak length in metres (rain). */
  size: number
  color: string
  opacity: number
}

const BASE: Record<Exclude<Precip, 'none'>, PrecipParams> = {
  // Fast, near-vertical, barely-there streaks.
  rain: { count: 1400, speed: 9.5, drift: 0.35, size: 0.42, color: '#cfe0f0', opacity: 0.42 },
  // Slow, wandering, fat flakes.
  snow: { count: 900, speed: 0.85, drift: 0.55, size: 0.07, color: '#ffffff', opacity: 0.85 },
}

/**
 * Field parameters for a quality tier. Counts scale down hard off the high
 * tier: precipitation is atmosphere, never the thing that costs the frame.
 */
// Dieses Modul bleibt bewusst frei von Renderer- und App-Abhängigkeiten, damit
// es ohne WebGL-Kontext testbar ist. Deshalb steht die Stufe hier als eigener
// Union-Typ statt aus `lib/quality` importiert zu werden. `ultra` verhält sich
// wie `high`: mehr Tropfen wären keine bessere Grafik, nur mehr Punkte.
export function precipParams(kind: Precip, tier: 'ultra' | 'high' | 'low' | 'off' = 'high'): PrecipParams | null {
  if (kind === 'none') return null
  const base = BASE[kind]
  const scale = tier === 'ultra' || tier === 'high' ? 1 : tier === 'low' ? 0.45 : 0.22
  return { ...base, count: Math.max(80, Math.round(base.count * scale)) }
}

/** Deterministic PRNG so a scene reloads with the same field. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Fill a flat xyz buffer with `count` particles spread through a box of
 * `span × height × span`, centred on the origin in x/z and starting at ground
 * level in y.
 */
export function seedField(count: number, span: number, height: number, seed = 1): Float32Array {
  const rnd = seededRandom(seed)
  const pos = new Float32Array(Math.max(0, count) * 3)
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (rnd() - 0.5) * span
    pos[i + 1] = rnd() * height
    pos[i + 2] = (rnd() - 0.5) * span
  }
  return pos
}

/**
 * Advance the field by `dt` seconds, wrapping anything that falls below zero
 * back to the top of the box. `time` drives the horizontal sway, which is what
 * separates drifting snow from vertical rain.
 *
 * Mutates `pos` in place and returns it, so the caller can hand the same buffer
 * to the GPU every frame without reallocating.
 */
export function advanceField(
  pos: Float32Array,
  dt: number,
  params: PrecipParams,
  span: number,
  height: number,
  time = 0,
): Float32Array {
  if (!Number.isFinite(dt) || dt <= 0) return pos
  // A tab-out can hand us a huge dt; clamp so particles never teleport.
  const step = Math.min(dt, 0.1)
  const fall = params.speed * step
  for (let i = 0; i < pos.length; i += 3) {
    pos[i + 1] -= fall
    if (params.drift > 0) {
      // Phase varies per particle so the field sways incoherently.
      pos[i] += Math.sin(time * 1.3 + i) * params.drift * step
    }
    if (pos[i + 1] < 0) {
      pos[i + 1] += height
      // Re-scatter horizontally on recycle, otherwise the field collapses into
      // visible vertical lanes after a while.
      pos[i] = ((pos[i] + span * 1.5) % span) - span / 2
    }
  }
  return pos
}

/** The precipitation a season would naturally bring. */
export function seasonalPrecip(season: 'spring' | 'summer' | 'autumn' | 'winter'): Exclude<Precip, 'none'> {
  return season === 'winter' ? 'snow' : 'rain'
}
