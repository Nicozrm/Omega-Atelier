import { describe, it, expect } from 'vitest'
import { deriveEnvironment, exteriorLightScale } from './environment'

const hex = /^#[0-9a-f]{6}$/
// red/blue ratio — higher = warmer
const warmth = (c: string) => parseInt(c.slice(1, 3), 16) / Math.max(1, parseInt(c.slice(5, 7), 16))

describe('deriveEnvironment — domain shape', () => {
  it('exposes physical world state beyond lighting (sun, weather, sky, time)', () => {
    const env = deriveEnvironment({ timeOfDay: 12 })
    expect(env.time.hour).toBe(12)
    expect(env.time.dayOfYear).toBeGreaterThan(0)
    expect(env.sun).toHaveProperty('azimuth')
    expect(env.sun).toHaveProperty('elevation')
    expect(env.sun).toHaveProperty('direction')
    expect(env.weather).toHaveProperty('cloudiness')
    expect(env.sky).toHaveProperty('zenithColor')
    expect(env.lighting.sun).toHaveProperty('shadowIntensity')
  })

  it('produces valid hex colours throughout', () => {
    const env = deriveEnvironment({ timeOfDay: 12 })
    expect(env.sky.zenithColor).toMatch(hex)
    expect(env.sky.horizonColor).toMatch(hex)
    expect(env.lighting.ambient.color).toMatch(hex)
    expect(env.lighting.hemisphere.skyColor).toMatch(hex)
    expect(env.lighting.sun.color).toMatch(hex)
  })

  it('sun direction is a unit vector', () => {
    const { x, y, z } = deriveEnvironment({ timeOfDay: 12 }).sun.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
  })
})

describe('deriveEnvironment — day cycle', () => {
  it('classifies noon as day and midnight as night', () => {
    expect(deriveEnvironment({ timeOfDay: 12 }).phase).toBe('day')
    expect(deriveEnvironment({ timeOfDay: 23 }).phase).toBe('night')
  })

  it('has a low-sun golden/twilight phase around sunrise', () => {
    const phase = deriveEnvironment({ timeOfDay: 6.6 }).phase
    expect(['goldenHour', 'dawn', 'dusk']).toContain(phase)
  })

  it('night is darker than noon (ambient + sun) and the sun is off', () => {
    const noon = deriveEnvironment({ timeOfDay: 12 })
    const night = deriveEnvironment({ timeOfDay: 23 })
    expect(night.lighting.ambient.intensity).toBeLessThan(noon.lighting.ambient.intensity)
    expect(night.sun.aboveHorizon).toBe(false)
    expect(night.lighting.sun.intensity).toBe(0)
    expect(noon.lighting.sun.intensity).toBeGreaterThan(0)
  })

  it('the low sun is warmer than the noon sun', () => {
    const low = deriveEnvironment({ timeOfDay: 7 })
    const noon = deriveEnvironment({ timeOfDay: 12 })
    expect(warmth(low.lighting.sun.color)).toBeGreaterThan(warmth(noon.lighting.sun.color))
  })
})

describe('deriveEnvironment — weather', () => {
  it('overcast dims the sun and softens shadows vs clear at the same time', () => {
    const clear = deriveEnvironment({ timeOfDay: 12, weather: 'clear' })
    const overcast = deriveEnvironment({ timeOfDay: 12, weather: 'overcast' })
    expect(overcast.weather.cloudiness).toBeGreaterThan(clear.weather.cloudiness)
    expect(overcast.lighting.sun.intensity).toBeLessThan(clear.lighting.sun.intensity)
    expect(overcast.lighting.sun.shadowIntensity).toBeLessThan(clear.lighting.sun.shadowIntensity)
  })
})

describe('exteriorLightScale — continuous surroundings dimming', () => {
  it('stays within [0.07, 1] and hits the day / night extremes', () => {
    expect(exteriorLightScale(-40)).toBeCloseTo(0.07, 5) // deep night floor
    expect(exteriorLightScale(90)).toBeCloseTo(1, 5) //     high sun → full albedo
    for (let e = -90; e <= 90; e += 1) {
      const k = exteriorLightScale(e)
      expect(k).toBeGreaterThanOrEqual(0.07 - 1e-9)
      expect(k).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('is monotone increasing in sun elevation (dimmer sun → dimmer surroundings)', () => {
    let prev = -Infinity
    for (let e = -20; e <= 40; e += 0.5) {
      const k = exteriorLightScale(e)
      expect(k).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = k
    }
  })

  it('is continuous — no bucket pop as the clock is scrubbed (small steps stay small)', () => {
    // The old five-value phase lookup jumped ~0.36 in a single frame at a
    // border; a smooth ramp must never move more than a few percent for a
    // quarter-degree of sun (here ≥10× smaller than that former pop).
    let maxStep = 0
    for (let e = -20; e <= 40; e += 0.25) {
      maxStep = Math.max(maxStep, Math.abs(exteriorLightScale(e) - exteriorLightScale(e - 0.25)))
    }
    expect(maxStep).toBeLessThan(0.03)
  })

  it('preserves the tuned brightness plateaus (golden hour, day, night stay put)', () => {
    expect(exteriorLightScale(5)).toBeCloseTo(0.62, 2) //   golden-hour plateau
    expect(exteriorLightScale(20)).toBeCloseTo(1, 2) //     full-day plateau
    expect(exteriorLightScale(-10)).toBeCloseTo(0.07, 2) // deep-night plateau
    // The plateaus are flat, not sloped: two points inside each read the same.
    expect(exteriorLightScale(4)).toBeCloseTo(exteriorLightScale(6), 5) // golden
    expect(exteriorLightScale(16)).toBeCloseTo(exteriorLightScale(40), 5) // day
  })

  it('is surfaced on the derived environment for renderers to consume', () => {
    const env = deriveEnvironment({ timeOfDay: 12 })
    expect(env.lighting.exteriorAlbedoScale).toBeCloseTo(exteriorLightScale(env.sun.elevation), 6)
    expect(deriveEnvironment({ timeOfDay: 0 }).lighting.exteriorAlbedoScale)
      .toBeLessThan(env.lighting.exteriorAlbedoScale)
  })
})

describe('deriveEnvironment — seasons & inputs', () => {
  it('accepts date + latitude and reflects seasonal sun height', () => {
    const summer = deriveEnvironment({ timeOfDay: 12, date: { month: 6, day: 21 } })
    const winter = deriveEnvironment({ timeOfDay: 12, date: { month: 12, day: 21 } })
    expect(summer.sun.elevation).toBeGreaterThan(winter.sun.elevation)
  })

  it('uses sensible defaults when called with no input', () => {
    const env = deriveEnvironment()
    expect(env.time.hour).toBe(12)
    expect(env.sky.zenithColor).toMatch(hex)
  })
})
