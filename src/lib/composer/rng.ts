/**
 * rng.ts — a tiny, fast, fully-deterministic PRNG for the Composer.
 *
 * The whole analysis pipeline is seeded so that a given coordinate always
 * yields the same Digital Twin (offline-first + testable). `mulberry32` gives a
 * good-quality, 32-bit stream from a 32-bit seed; `hashGeo`/`hashInts` derive
 * stable seeds from geo-coordinates and grid cells via FNV-1a.
 */

import type { Rng } from './types'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a hash of a string → uint32. Stable across engines. */
export function hashString(input: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}

/** Hash a list of integers into a uint32 seed. */
export function hashInts(...values: number[]): number {
  let h = FNV_OFFSET
  for (const v of values) {
    // fold the 32 bits of each value through the hash
    let x = v | 0
    for (let b = 0; b < 4; b++) {
      h ^= x & 0xff
      h = Math.imul(h, FNV_PRIME)
      x >>>= 8
    }
  }
  return h >>> 0
}

/**
 * Hash a geo-coordinate into a uint32 seed. `precision` decimal places decide
 * how much a coordinate must move before it seeds a different twin (default 5 ≈
 * 1.1 m). Two taps on the same house therefore produce the same result.
 */
export function hashGeo(lat: number, lng: number, precision = 5): number {
  const la = Math.round(lat * 10 ** precision)
  const ln = Math.round(lng * 10 ** precision)
  return hashInts(la, ln)
}

/** mulberry32 — a compact, well-distributed 32-bit generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A deterministic random source with typed convenience helpers. */
export class SeededRng implements Rng {
  private readonly seed: number
  private readonly gen: () => number
  private spare: number | null = null

  constructor(seed: number) {
    // Never allow a 0 seed (mulberry32 would still work, but keep it defensive).
    this.seed = (seed >>> 0) || 0x9e3779b9
    this.gen = mulberry32(this.seed)
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.gen()
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.gen()
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min]
    return min + Math.floor(this.gen() * (max - min + 1))
  }

  /** True with probability `p` (default 0.5). */
  bool(p = 0.5): boolean {
    return this.gen() < p
  }

  /** Uniformly pick one element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRng.pick: empty list')
    return items[Math.floor(this.gen() * items.length)]
  }

  /** Gaussian sample via Box–Muller (cached spare for efficiency). */
  gaussian(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare
      this.spare = null
      return mean + sd * s
    }
    let u = 0
    let v = 0
    let s = 0
    do {
      u = this.gen() * 2 - 1
      v = this.gen() * 2 - 1
      s = u * u + v * v
    } while (s === 0 || s >= 1)
    const mul = Math.sqrt((-2 * Math.log(s)) / s)
    this.spare = v * mul
    return mean + sd * (u * mul)
  }

  /** Derive an independent child stream — used to isolate module randomness. */
  fork(salt: number): SeededRng {
    return new SeededRng(hashInts(this.seed, salt | 0))
  }
}

/** Convenience factory. */
export function rngFromSeed(seed: number): SeededRng {
  return new SeededRng(seed)
}
