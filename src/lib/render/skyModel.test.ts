import { describe, it, expect } from 'vitest'
import { deriveEnvironment } from '@/lib/environment'
import { skyParamsFor, skyFingerprint, daylightWeight } from './skyModel'

/** Noon and midnight for the domain's default site/date. */
const at = (hour: number, weather?: 'clear' | 'cloudy' | 'overcast') =>
  deriveEnvironment({ timeOfDay: hour, weather })

describe('daylightWeight', () => {
  it('is zero deep in the night and saturated with the sun well up', () => {
    expect(daylightWeight(-30)).toBe(0)
    expect(daylightWeight(60)).toBe(1)
  })

  it('lifts during civil twilight, before the sun clears the horizon', () => {
    expect(daylightWeight(-3)).toBeGreaterThan(0)
    expect(daylightWeight(-3)).toBeLessThan(1)
  })

  it('rises monotonically with elevation', () => {
    let last = -1
    for (let e = -20; e <= 40; e += 2) {
      const w = daylightWeight(e)
      expect(w).toBeGreaterThanOrEqual(last)
      last = w
    }
  })
})

describe('skyParamsFor', () => {
  it('dims the environment overnight without letting metals go dead black', () => {
    const noon = skyParamsFor(at(12))
    const night = skyParamsFor(at(1))
    expect(noon.environmentIntensity).toBeCloseTo(1, 2)
    expect(night.environmentIntensity).toBeLessThan(0.4)
    expect(night.environmentIntensity).toBeGreaterThan(0.2)
  })

  it('ramps exposure continuously — no step at a day-phase border', () => {
    // This replaced a per-phase lookup table, whose borders popped. Sweeping
    // dawn at fine resolution must show no jump.
    let previous = skyParamsFor(at(2)).environmentIntensity
    for (let h = 2; h <= 10; h += 0.02) {
      const next = skyParamsFor(at(h)).environmentIntensity
      expect(Math.abs(next - previous)).toBeLessThan(0.01)
      previous = next
    }
  })

  it('hands the night over to interior bounce', () => {
    const noon = skyParamsFor(at(12))
    const night = skyParamsFor(at(1))
    expect(night.interior.intensity).toBeGreaterThan(noon.interior.intensity)
    // Interior bounce never vanishes by day — lamps and warm walls still bounce.
    expect(noon.interior.intensity).toBeGreaterThan(0)
  })

  it('keeps every weight within its documented range', () => {
    for (let h = 0; h <= 24; h += 0.5) {
      for (const w of ['clear', 'cloudy', 'overcast'] as const) {
        const p = skyParamsFor(at(h, w))
        expect(p.environmentIntensity).toBeGreaterThan(0)
        expect(p.environmentIntensity).toBeLessThanOrEqual(1)
        expect(p.interior.intensity).toBeGreaterThan(0)
        expect(p.interior.intensity).toBeLessThanOrEqual(1)
        expect(p.ground.intensity).toBeGreaterThan(0)
        expect(p.rayleigh).toBeGreaterThanOrEqual(0)
        expect(p.turbidity).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('thickens and desaturates the atmosphere as cloud builds', () => {
    const clear = skyParamsFor(at(12, 'clear'))
    const overcast = skyParamsFor(at(12, 'overcast'))
    expect(overcast.turbidity).toBeGreaterThan(clear.turbidity)
    expect(overcast.rayleigh).toBeLessThan(clear.rayleigh)
    expect(overcast.mieCoefficient).toBeGreaterThan(clear.mieCoefficient)
    expect(overcast.mieDirectionalG).toBeLessThan(clear.mieDirectionalG)
  })
})

describe('skyFingerprint', () => {
  it('is stable for imperceptible changes', () => {
    expect(skyFingerprint(at(12))).toBe(skyFingerprint(at(12.002)))
  })

  it('changes once the sun has visibly moved', () => {
    expect(skyFingerprint(at(12))).not.toBe(skyFingerprint(at(14)))
  })

  it('dedupes a full day sweep well below the sample count', () => {
    // Sampling every 5 minutes across the whole day. The fingerprint is a coarse
    // filter — the renderer rate-limits on top of it — so the bar here is that
    // it meaningfully collapses the sweep while staying fine enough to animate.
    const samples = 289
    const seen = new Set<string>()
    for (let h = 0; h <= 24; h += 1 / 12) seen.add(skyFingerprint(at(h)))
    expect(seen.size).toBeLessThan(samples / 2)
    expect(seen.size).toBeGreaterThan(20)
  })

  it('distinguishes weather at the same instant', () => {
    expect(skyFingerprint(at(12, 'clear'))).not.toBe(skyFingerprint(at(12, 'overcast')))
  })
})
