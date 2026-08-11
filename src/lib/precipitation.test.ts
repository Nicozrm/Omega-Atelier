import { describe, it, expect } from 'vitest'
import {
  PRECIP_LABEL, precipParams, seededRandom, seedField, advanceField, seasonalPrecip,
} from './precipitation'

describe('precipParams', () => {
  it('returns nothing for clear weather', () => {
    expect(precipParams('none')).toBeNull()
    expect(precipParams('none', 'ultra')).toBeNull()
  })

  it('separates rain from snow by the properties that read on screen', () => {
    const rain = precipParams('rain')!
    const snow = precipParams('snow')!
    expect(rain.speed).toBeGreaterThan(snow.speed * 5) // rain falls fast
    expect(snow.size).toBeLessThan(rain.size)          // flakes are points, rain is streaks
    expect(snow.opacity).toBeGreaterThan(rain.opacity) // rain is barely there
  })

  it('scales the particle count down off the top tiers, never to zero', () => {
    const counts = (['ultra', 'high', 'low', 'off'] as const).map((t) => precipParams('snow', t)!.count)
    expect(counts[0]).toBe(counts[1])            // ultra == high: more flakes is not better
    expect(counts[2]).toBeLessThan(counts[1])
    expect(counts[3]).toBeLessThan(counts[2])
    for (const c of counts) expect(c).toBeGreaterThanOrEqual(80)
  })

  it('does not hand out the shared base object', () => {
    const a = precipParams('rain')!
    a.count = 1
    expect(precipParams('rain')!.count).toBeGreaterThan(1)
  })
})

describe('seededRandom', () => {
  it('is deterministic for a seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    for (let i = 0; i < 20; i++) expect(a()).toBe(b())
  })

  it('differs between seeds', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)())
  })

  it('stays inside [0, 1)', () => {
    const r = seededRandom(7)
    for (let i = 0; i < 500; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('survives a zero seed', () => {
    expect(Number.isFinite(seededRandom(0)())).toBe(true)
  })
})

describe('seedField', () => {
  it('produces three floats per particle', () => {
    expect(seedField(100, 40, 20).length).toBe(300)
  })

  it('places every particle inside the box', () => {
    const span = 40, height = 20
    const pos = seedField(200, span, height, 3)
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i])).toBeLessThanOrEqual(span / 2)
      expect(pos[i + 1]).toBeGreaterThanOrEqual(0)
      expect(pos[i + 1]).toBeLessThanOrEqual(height)
      expect(Math.abs(pos[i + 2])).toBeLessThanOrEqual(span / 2)
    }
  })

  it('is reproducible for a seed and empty for a non-positive count', () => {
    expect(Array.from(seedField(10, 8, 4, 9))).toEqual(Array.from(seedField(10, 8, 4, 9)))
    expect(seedField(0, 8, 4).length).toBe(0)
    expect(seedField(-5, 8, 4).length).toBe(0)
  })
})

describe('advanceField', () => {
  const params = precipParams('snow')!

  it('moves particles downward', () => {
    const pos = seedField(30, 20, 10, 2)
    const before = Array.from(pos)
    advanceField(pos, 0.05, params, 20, 10)
    let fell = 0
    for (let i = 1; i < pos.length; i += 3) if (pos[i] < before[i]) fell++
    expect(fell).toBeGreaterThan(0)
  })

  it('mutates in place and returns the same buffer — no per-frame allocation', () => {
    const pos = seedField(10, 20, 10)
    expect(advanceField(pos, 0.016, params, 20, 10)).toBe(pos)
  })

  it('recycles particles that fall through the floor back to the top', () => {
    const pos = seedField(60, 20, 10, 5)
    for (let i = 0; i < 400; i++) advanceField(pos, 0.05, params, 20, 10, i * 0.05)
    for (let i = 1; i < pos.length; i += 3) {
      expect(pos[i]).toBeGreaterThanOrEqual(0)
      expect(pos[i]).toBeLessThanOrEqual(10)
    }
  })

  it('keeps particles inside the horizontal span over a long run', () => {
    const span = 20
    const pos = seedField(60, span, 10, 6)
    for (let i = 0; i < 600; i++) advanceField(pos, 0.05, params, span, 10, i * 0.05)
    for (let i = 0; i < pos.length; i += 3) {
      expect(Math.abs(pos[i])).toBeLessThanOrEqual(span)
    }
  })

  it('clamps a huge dt so a backgrounded tab cannot teleport the field', () => {
    const pos = seedField(20, 20, 10, 4)
    const before = Array.from(pos)
    advanceField(pos, 30, pos.length ? params : params, 20, 10)
    // One clamped step (0.1 s) of fall at most, plus the wrap.
    for (let i = 1; i < pos.length; i += 3) {
      const moved = Math.abs(before[i] - pos[i])
      expect(moved).toBeLessThanOrEqual(10 + params.speed * 0.1 + 1e-6)
    }
  })

  it('ignores a non-positive or non-finite dt', () => {
    const pos = seedField(10, 20, 10, 8)
    const before = Array.from(pos)
    advanceField(pos, 0, params, 20, 10)
    advanceField(pos, -1, params, 20, 10)
    advanceField(pos, Number.NaN, params, 20, 10)
    expect(Array.from(pos)).toEqual(before)
  })

  it('leaves particles unswayed when drift is zero', () => {
    const still = { ...params, drift: 0 }
    const pos = seedField(20, 20, 10, 11)
    const before = Array.from(pos)
    advanceField(pos, 0.05, still, 20, 10, 1.7)
    for (let i = 0; i < pos.length; i += 3) expect(pos[i]).toBe(before[i])
  })
})

describe('seasonalPrecip', () => {
  it('snows only in winter', () => {
    expect(seasonalPrecip('winter')).toBe('snow')
    for (const s of ['spring', 'summer', 'autumn'] as const) {
      expect(seasonalPrecip(s)).toBe('rain')
    }
  })
})

describe('PRECIP_LABEL', () => {
  it('labels every kind', () => {
    for (const k of ['none', 'rain', 'snow'] as const) {
      expect(PRECIP_LABEL[k].length).toBeGreaterThan(0)
    }
  })
})
