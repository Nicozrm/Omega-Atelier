import { describe, it, expect } from 'vitest'
import { springCurve, SPRINGS } from './motion'

describe('springCurve', () => {
  it('starts at 0 and settles exactly at 1', () => {
    for (const spec of Object.values(SPRINGS)) {
      const { samples } = springCurve(spec)
      expect(samples[0]).toBe(0)
      expect(samples[samples.length - 1]).toBe(1)
      // Physically settled: the tail stays within the tolerance band.
      const tail = samples.slice(-5)
      for (const x of tail) expect(Math.abs(x - 1)).toBeLessThan(0.01)
    }
  })

  it('underdamped springs overshoot, overdamped ones never do', () => {
    const bouncy = springCurve({ stiffness: 340, damping: 20.3 }) // ζ≈0.55
    expect(Math.max(...bouncy.samples)).toBeGreaterThan(1.05)

    const heavy = springCurve({ stiffness: 300, damping: 60 }) // ζ≈1.73
    expect(Math.max(...heavy.samples)).toBeLessThanOrEqual(1)
    // …and is monotonic: never moves backwards.
    for (let i = 1; i < heavy.samples.length; i++) {
      expect(heavy.samples[i]).toBeGreaterThanOrEqual(heavy.samples[i - 1] - 1e-9)
    }
  })

  it('stiffer springs settle faster', () => {
    const soft = springCurve({ stiffness: 120, damping: 18 })
    const stiff = springCurve({ stiffness: 900, damping: 49 }) // same ζ≈0.82
    expect(stiff.durationMs).toBeLessThan(soft.durationMs)
  })

  it('emits a valid CSS linear() easing', () => {
    const { easing } = springCurve(SPRINGS.pop, { points: 24 })
    expect(easing.startsWith('linear(0 0%')).toBe(true)
    expect(easing.endsWith('1 100%)')).toBe(true)
    expect(easing.split(',').length).toBe(25)
  })

  it('clamps the duration to sane interface bounds', () => {
    const endless = springCurve({ stiffness: 40, damping: 1 })
    expect(endless.durationMs).toBeLessThanOrEqual(1200)
    const instant = springCurve({ stiffness: 5000, damping: 200 })
    expect(instant.durationMs).toBeGreaterThanOrEqual(120)
  })
})
