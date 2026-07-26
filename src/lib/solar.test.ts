import { describe, it, expect } from 'vitest'
import { solarPosition, solarDeclination, dayOfYear } from './solar'

const EQUINOX = dayOfYear(3, 20)
const SUMMER = dayOfYear(6, 21)
const WINTER = dayOfYear(12, 21)

describe('dayOfYear', () => {
  it('maps calendar dates to ordinal days', () => {
    expect(dayOfYear(1, 1)).toBe(1)
    expect(dayOfYear(2, 1)).toBe(32)
    expect(dayOfYear(3, 1)).toBe(60)
  })
})

describe('solarDeclination', () => {
  it('is ~0 at the equinox and ±23.45° at the solstices', () => {
    expect(Math.abs(solarDeclination(EQUINOX))).toBeLessThan(2)
    expect(solarDeclination(SUMMER)).toBeGreaterThan(22)
    expect(solarDeclination(WINTER)).toBeLessThan(-22)
  })
})

describe('solarPosition', () => {
  const lat = 52
  it('puts the equinox noon sun high in the south', () => {
    const p = solarPosition({ hour: 12, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 0 })
    // At the equinox, noon elevation ≈ 90 − latitude.
    expect(p.elevation).toBeGreaterThan(33)
    expect(p.elevation).toBeLessThan(43)
    expect(p.aboveHorizon).toBe(true)
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(5) // due south
  })

  it('places the sun below the horizon at midnight', () => {
    const p = solarPosition({ hour: 0, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 0 })
    expect(p.elevation).toBeLessThan(0)
    expect(p.aboveHorizon).toBe(false)
  })

  it('rises in the east and sets in the west', () => {
    const morning = solarPosition({ hour: 9, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 0 })
    const evening = solarPosition({ hour: 15, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 0 })
    expect(morning.azimuth).toBeLessThan(180) // east of south
    expect(evening.azimuth).toBeGreaterThan(180) // west of south
  })

  it('returns a unit direction vector that points up when the sun is high', () => {
    const p = solarPosition({ hour: 12, dayOfYear: SUMMER, latitudeDeg: lat, orientationDeg: 0 })
    const { x, y, z } = p.direction
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
    expect(y).toBeGreaterThan(0) // above horizon → up
  })

  it('models the seasons: summer noon sun is higher than winter', () => {
    const summer = solarPosition({ hour: 12, dayOfYear: SUMMER, latitudeDeg: lat, orientationDeg: 0 })
    const winter = solarPosition({ hour: 12, dayOfYear: WINTER, latitudeDeg: lat, orientationDeg: 0 })
    expect(summer.elevation).toBeGreaterThan(winter.elevation + 30)
  })

  it('rotates azimuth into plan space via orientationDeg', () => {
    const base = solarPosition({ hour: 12, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 0 })
    const rot = solarPosition({ hour: 12, dayOfYear: EQUINOX, latitudeDeg: lat, orientationDeg: 90 })
    expect(((rot.azimuth - base.azimuth + 360) % 360)).toBeCloseTo(90, 1)
  })
})
