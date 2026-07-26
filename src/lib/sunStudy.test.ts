import { describe, it, expect } from 'vitest'
import { solarDeclination, sunPosition, sunColor, windowLightPatch, sunTimes, convexHull, sunShadowPolygon } from './sunStudy'
import type { Wall } from '@/types'

// Day-of-year anchors: ~172 = Jun 21, ~355 = Dec 21, ~80 = Mar 21.
describe('solarDeclination', () => {
  it('peaks near +23.4° at the June solstice and −23.4° in December', () => {
    expect(solarDeclination(172)).toBeGreaterThan(23)
    expect(solarDeclination(355)).toBeLessThan(-23)
  })
  it('crosses ~0° at the equinox', () => {
    expect(Math.abs(solarDeclination(80))).toBeLessThan(1.5)
  })
})

describe('sunPosition', () => {
  it('solar noon altitude ≈ 90 − latitude + declination', () => {
    const s = sunPosition(172, 12, 51)
    expect(s.altitude).toBeCloseTo(90 - 51 + solarDeclination(172), 0)
    expect(s.azimuth).toBeCloseTo(180, 0)
  })
  it('is below the horizon at midnight', () => {
    const s = sunPosition(172, 0, 51)
    expect(s.altitude).toBeLessThan(0)
    expect(s.intensity).toBe(0)
  })
  it('rises in the east: morning light travels westward (−x)', () => {
    const s = sunPosition(80, 8, 51)
    expect(s.azimuth).toBeGreaterThan(60)
    expect(s.azimuth).toBeLessThan(180)
    expect(s.lightDir.x).toBeLessThan(0)
  })
  it('noon light travels northward (−y, north = up)', () => {
    const s = sunPosition(172, 12, 51)
    expect(s.lightDir.y).toBeLessThan(-0.9)
    expect(Math.abs(s.lightDir.x)).toBeLessThan(0.15)
  })
})

describe('sunColor', () => {
  it('is warm amber at the horizon and near-white when high', () => {
    expect(sunColor(0)).toBe('#ff9a3c')
    expect(sunColor(60)).toBe('#fff3df')
    // Between: still warm (r ≥ g ≥ b), greener than the horizon value.
    const mid = sunColor(20)
    const [r, g, b] = [mid.slice(1, 3), mid.slice(3, 5), mid.slice(5, 7)].map((h) => parseInt(h, 16))
    expect(r).toBeGreaterThanOrEqual(g)
    expect(g).toBeGreaterThanOrEqual(b)
    expect(g).toBeGreaterThan(0x9a)
  })
})

describe('windowLightPatch', () => {
  const win: Wall = {
    id: 'w', a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, thickness: 12,
    subtype: 'window', openingWidth: 120, openingHeight: 100, openingSill: 90,
  }
  const noonHigh = sunPosition(172, 12, 51) // alt ≈ 62°

  it('projects a parallelogram past the sill shadow along the light direction', () => {
    const p = windowLightPatch(win, noonHigh)!
    expect(p).not.toBeNull()
    // Light at noon travels north (−y): the patch lies above the wall (y < 0).
    for (const c of p.quad) expect(c.y).toBeLessThan(0)
    // Near edge starts past the sill shadow, far edge beyond it.
    expect(Math.abs(p.quad[0].y)).toBeLessThan(Math.abs(p.quad[3].y))
  })

  it('lengthens as the sun sinks (true length along the light direction)', () => {
    const evening = sunPosition(172, 17, 51)
    const noonP = windowLightPatch(win, noonHigh)!
    const eveP = windowLightPatch(win, evening)!
    const len = (q: { quad: { x: number; y: number }[] }) =>
      Math.hypot(q.quad[3].x - q.quad[0].x, q.quad[3].y - q.quad[0].y)
    expect(len(eveP)).toBeGreaterThan(len(noonP))
  })

  it('returns null for solid walls and for a sun on/below the horizon', () => {
    expect(windowLightPatch({ ...win, subtype: 'wall' }, noonHigh)).toBeNull()
    expect(windowLightPatch(win, sunPosition(172, 0, 51))).toBeNull()
  })
})

describe('convexHull / sunShadowPolygon', () => {
  const rect = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 },
  ]

  it('hull of a square with an interior point drops the interior point', () => {
    const h = convexHull([...rect, { x: 50, y: 30 }])
    expect(h).toHaveLength(4)
  })

  it('shadow extends along the light direction and lengthens at low sun', () => {
    const noon = sunPosition(172, 12, 51)
    const evening = sunPosition(172, 17.5, 51)
    const sNoon = sunShadowPolygon(rect, noon, 80)!
    const sEve = sunShadowPolygon(rect, evening, 80)!
    const minY = (poly: { y: number }[]) => Math.min(...poly.map((p) => p.y))
    // Noon light travels north (−y): shadow reaches negative y beyond the rect.
    expect(minY(sNoon)).toBeLessThan(0)
    const area = (poly: { x: number; y: number }[]) => Math.abs(poly.reduce((acc, p, i) => {
      const q = poly[(i + 1) % poly.length]
      return acc + p.x * q.y - q.x * p.y
    }, 0)) / 2
    expect(area(sEve)).toBeGreaterThan(area(sNoon))
  })

  it('returns null when the sun is down', () => {
    expect(sunShadowPolygon(rect, sunPosition(172, 0, 51), 80)).toBeNull()
  })
})

describe('sunTimes', () => {
  it('summer days are long, winter days short (51°N)', () => {
    const summer = sunTimes(172)
    const winter = sunTimes(355)
    expect(summer.sunset - summer.sunrise).toBeGreaterThan(14)
    expect(winter.sunset - winter.sunrise).toBeLessThan(9)
  })
})
