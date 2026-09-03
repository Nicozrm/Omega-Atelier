import { describe, it, expect } from 'vitest'
import { bokehForDistance, focalLengthForDistance, DOF_OFF_THRESHOLD } from './dof'

describe('bokehForDistance', () => {
  it('keeps the cinematic aperture at room level', () => {
    expect(bokehForDistance({ distanceM: 2 })).toBeCloseTo(1.2, 5)
    expect(bokehForDistance({ distanceM: 5 })).toBeCloseTo(1.2, 5)
  })

  it('stops down for the dollhouse overview — the hero frame stays readable', () => {
    const overview = bokehForDistance({ distanceM: 18 })
    expect(overview).toBeLessThan(0.15)
    // An order of magnitude less blur than the room-level setting.
    expect(overview).toBeLessThan(bokehForDistance({ distanceM: 2 }) / 8)
  })

  it('leaves a trace of defocus rather than switching the lens off', () => {
    expect(bokehForDistance({ distanceM: 40 })).toBeGreaterThan(0)
  })

  it('falls monotonically with distance — orbiting out never re-blurs', () => {
    let prev = Infinity
    for (let d = 0; d <= 40; d += 0.5) {
      const b = bokehForDistance({ distanceM: d })
      expect(b).toBeLessThanOrEqual(prev + 1e-9)
      prev = b
    }
  })

  it('has no corner at either end of the ramp', () => {
    // Neighbouring half-metre steps may not differ by more than a small
    // fraction of the whole range, or the transition would be visible.
    const range = bokehForDistance({ distanceM: 0 }) - bokehForDistance({ distanceM: 30 })
    let prev = bokehForDistance({ distanceM: 0 })
    for (let d = 0.5; d <= 30; d += 0.5) {
      const b = bokehForDistance({ distanceM: d })
      expect(Math.abs(b - prev)).toBeLessThan(range * 0.12)
      prev = b
    }
  })

  it('is exactly zero while walking, at any distance', () => {
    for (const d of [1, 8, 25]) {
      expect(bokehForDistance({ distanceM: d, walkMode: true })).toBe(0)
      expect(bokehForDistance({ distanceM: d, walkMode: true, pull: 1 })).toBe(0)
    }
  })

  it('lets the director override the distance rule during a glide', () => {
    const still = bokehForDistance({ distanceM: 18 })
    const pulling = bokehForDistance({ distanceM: 18, pull: 1 })
    expect(pulling).toBeGreaterThan(still * 10)
    expect(pulling).toBeGreaterThan(DOF_OFF_THRESHOLD)
  })

  it('scales continuously with the pull rather than switching', () => {
    const at = (p: number) => bokehForDistance({ distanceM: 10, pull: p })
    expect(at(0.5)).toBeGreaterThan(at(0))
    expect(at(1)).toBeGreaterThan(at(0.5))
    expect(at(2)).toBeCloseTo(at(1), 5) // clamped
    expect(at(-1)).toBeCloseTo(at(0), 5)
  })

  it('survives a degenerate distance', () => {
    expect(bokehForDistance({ distanceM: Number.NaN })).toBeGreaterThan(0)
    expect(bokehForDistance({ distanceM: -5 })).toBeCloseTo(bokehForDistance({ distanceM: 0 }), 5)
    expect(Number.isFinite(bokehForDistance({ distanceM: 1e9 }))).toBe(true)
  })
})

describe('focalLengthForDistance', () => {
  it('lengthens the lens as the camera pulls back', () => {
    expect(focalLengthForDistance(2)).toBeCloseTo(0.08, 5)
    expect(focalLengthForDistance(20)).toBeGreaterThan(focalLengthForDistance(2))
  })

  it('is monotonic, bounded and NaN-safe', () => {
    let prev = 0
    for (let d = 0; d <= 40; d += 1) {
      const f = focalLengthForDistance(d)
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(f).toBeLessThanOrEqual(0.13)
      prev = f
    }
    expect(focalLengthForDistance(Number.NaN)).toBeCloseTo(0.08, 5)
  })
})
