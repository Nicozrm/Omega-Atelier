import { describe, it, expect } from 'vitest'
import { skyModel, airMass, beamTransmittance, linearToHex, type RGB } from './sky'

const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
/** How red-shifted a colour is — the sunset signature. */
const warmth = (c: RGB) => c[0] / Math.max(1e-6, c[2])

describe('airMass', () => {
  it('is 1 at the zenith and grows steeply toward the horizon', () => {
    expect(airMass(90)).toBeCloseTo(1, 2)
    expect(airMass(30)).toBeGreaterThan(1.9)
    expect(airMass(30)).toBeLessThan(2.1)
    expect(airMass(0)).toBeGreaterThan(30)
  })

  it('increases monotonically as the sun drops', () => {
    let last = 0
    for (let e = 90; e >= 0; e -= 5) {
      const m = airMass(e)
      expect(m).toBeGreaterThanOrEqual(last)
      last = m
    }
  })
})

describe('beamTransmittance', () => {
  it('strips blue faster than red (Rayleigh λ⁻⁴)', () => {
    const t = beamTransmittance(airMass(5), 2.6)
    expect(t[0]).toBeGreaterThan(t[1])
    expect(t[1]).toBeGreaterThan(t[2])
  })

  it('is near-neutral overhead and strongly red-shifted at the horizon', () => {
    const noon = beamTransmittance(airMass(90), 2.6)
    const set = beamTransmittance(airMass(0.5), 2.6)
    expect(warmth(noon)).toBeLessThan(1.4)
    expect(warmth(set)).toBeGreaterThan(3)
  })

  it('haze removes more light overall', () => {
    const clear = beamTransmittance(airMass(20), 2)
    const hazy = beamTransmittance(airMass(20), 9)
    expect(lum(hazy)).toBeLessThan(lum(clear))
  })

  it('never leaves the physical 0…1 range', () => {
    for (const e of [90, 45, 10, 1, 0, -2]) {
      for (const c of beamTransmittance(airMass(e), 6)) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('skyModel', () => {
  it('paints a blue zenith at noon', () => {
    const s = skyModel({ sunElevationDeg: 60 })
    expect(s.zenith[2]).toBeGreaterThan(s.zenith[1])
    expect(s.zenith[1]).toBeGreaterThan(s.zenith[0])
  })

  it('turns the horizon warm at sunset while the zenith stays cooler', () => {
    const s = skyModel({ sunElevationDeg: 1 })
    expect(warmth(s.horizon)).toBeGreaterThan(warmth(s.zenith))
    expect(warmth(s.horizon)).toBeGreaterThan(1.2)
  })

  it('reddens the sun disc as it sets', () => {
    expect(warmth(skyModel({ sunElevationDeg: 1 }).sunDisc))
      .toBeGreaterThan(warmth(skyModel({ sunElevationDeg: 60 }).sunDisc))
  })

  it('keeps the disc brighter than the sky it sits in', () => {
    const s = skyModel({ sunElevationDeg: 40 })
    expect(lum(s.sunDisc)).toBeGreaterThan(lum(s.zenith) * 10)
  })

  it('darkens continuously into night and lights the stars there', () => {
    const noon = skyModel({ sunElevationDeg: 60 })
    const dusk = skyModel({ sunElevationDeg: 0 })
    const night = skyModel({ sunElevationDeg: -20 })
    expect(lum(dusk.zenith)).toBeLessThan(lum(noon.zenith))
    expect(lum(night.zenith)).toBeLessThan(lum(dusk.zenith))
    expect(night.stars).toBeCloseTo(1, 1)
    expect(noon.stars).toBe(0)
    expect(dusk.stars).toBeLessThan(0.5)
  })

  it('is continuous across the horizon — no pop when scrubbing the clock', () => {
    let prev = skyModel({ sunElevationDeg: 12 })
    for (let e = 12; e >= -18; e -= 0.5) {
      const s = skyModel({ sunElevationDeg: e })
      // No single half-degree step may change zenith luminance by more than a
      // few percent of the full day range.
      expect(Math.abs(lum(s.zenith) - lum(prev.zenith))).toBeLessThan(0.06)
      expect(Math.abs(s.stars - prev.stars)).toBeLessThan(0.12)
      prev = s
    }
  })

  it('overcast flattens the dome toward grey and dims it', () => {
    const clear = skyModel({ sunElevationDeg: 40, cloudiness: 0 })
    const grey = skyModel({ sunElevationDeg: 40, cloudiness: 1 })
    const spread = (c: RGB) => Math.max(...c) - Math.min(...c)
    expect(spread(grey.zenith)).toBeLessThan(spread(clear.zenith))
    expect(grey.luminance).toBeLessThan(clear.luminance)
    expect(grey.stars).toBe(0)
  })

  it('turbidity widens the haze lobe', () => {
    expect(skyModel({ sunElevationDeg: 30, turbidity: 9 }).haze)
      .toBeGreaterThan(skyModel({ sunElevationDeg: 30, turbidity: 2 }).haze)
  })

  it('clamps its scalar outputs and keeps colours non-negative', () => {
    for (const e of [90, 45, 8, 0, -6, -30]) {
      const s = skyModel({ sunElevationDeg: e, turbidity: 10, cloudiness: 0.5 })
      expect(s.luminance).toBeGreaterThanOrEqual(0)
      expect(s.luminance).toBeLessThanOrEqual(1)
      expect(s.stars).toBeGreaterThanOrEqual(0)
      expect(s.stars).toBeLessThanOrEqual(1)
      expect(s.haze).toBeGreaterThanOrEqual(0)
      expect(s.haze).toBeLessThanOrEqual(1)
      for (const c of [...s.zenith, ...s.horizon, ...s.sunDisc, ...s.ground]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(c)).toBe(true)
      }
    }
  })
})

describe('linearToHex', () => {
  it('encodes with the sRGB transfer curve and clamps overbright values', () => {
    expect(linearToHex([0, 0, 0])).toBe('#000000')
    expect(linearToHex([1, 1, 1])).toBe('#ffffff')
    expect(linearToHex([40, 40, 40])).toBe('#ffffff')
    // Linear 0.5 encodes to ~0.735 in sRGB, not 0.5.
    expect(linearToHex([0.5, 0.5, 0.5])).toBe('#bcbcbc')
  })

  it('always returns a valid 6-digit hex', () => {
    for (const e of [90, 10, 0, -12]) {
      expect(linearToHex(skyModel({ sunElevationDeg: e }).horizon)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
