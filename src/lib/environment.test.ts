import { describe, it, expect } from 'vitest'
import { deriveEnvironment } from './environment'

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
