import { describe, it, expect } from 'vitest'
import {
  shadowRadius, sunDistance, siteMargin, SITE_HEIGHT, MIN_SITE_MARGIN, MAX_SITE_MARGIN,
} from './shadowFrustum'

const PLANS: Array<[number, number]> = [[6, 6], [8, 6], [12, 10], [12, 12], [20, 16], [30, 24]]

describe('siteMargin', () => {
  it('stays within its bounds at both extremes', () => {
    expect(siteMargin(3, 3)).toBe(MIN_SITE_MARGIN)
    expect(siteMargin(200, 200)).toBe(MAX_SITE_MARGIN)
  })

  it('grows with the plan between those bounds', () => {
    expect(siteMargin(16, 12)).toBeGreaterThan(siteMargin(10, 8))
  })
})

describe('shadowRadius', () => {
  it('covers the whole site including its margin and roof height', () => {
    for (const [w, h] of PLANS) {
      const r = shadowRadius(w, h)
      // Every corner of the margined footprint, at roof height, must fall inside
      // the sphere — otherwise casters silently drop out of the shadow map.
      const margin = siteMargin(w, h)
      const corner = Math.hypot(w / 2 + margin, h / 2 + margin, SITE_HEIGHT / 2)
      expect(r).toBeGreaterThanOrEqual(corner - 1e-9)
    }
  })

  it('is rotation invariant — a square frustum fits the site from any sun azimuth', () => {
    // A sphere has no preferred axis, so swapping the plan's width and height
    // (a 90° rotation of the same site) must not change the frustum size.
    expect(shadowRadius(12, 10)).toBeCloseTo(shadowRadius(10, 12), 12)
  })

  it('grows with the plan', () => {
    expect(shadowRadius(20, 20)).toBeGreaterThan(shadowRadius(10, 10))
  })

  it('is never looser than the origin-centred frustum it replaces', () => {
    // The frustum used to be centred on the world origin, which is the plan's
    // *corner* — plan coordinates run 0…extent — so it had to reach `max+4` in
    // every direction and spent most of its texels on empty ground west and
    // north of the site. Centring on the building is the actual win; the size
    // reduction that comes with it is real but modest, and must never invert
    // into a regression for small plans.
    for (const [w, h] of PLANS) {
      const centred = shadowRadius(w, h)
      const originCentred = Math.max(w, h) + 4
      expect(centred).toBeLessThan(originCentred)
      // Texel density scales with the area covered, i.e. the half-extent squared.
      expect((originCentred / centred) ** 2).toBeGreaterThan(1.35)
    }
  })
})

describe('sunDistance', () => {
  it('keeps the whole site in front of the shadow camera', () => {
    const r = shadowRadius(14, 11)
    const d = sunDistance(r)
    // near = d - r - 1 must stay positive, or geometry falls behind the camera.
    expect(d - r - 1).toBeGreaterThan(0)
  })

  it('scales with the site so large plans keep a valid depth range', () => {
    const small = shadowRadius(6, 6)
    const large = shadowRadius(60, 60)
    expect(sunDistance(large) - large - 1).toBeGreaterThan(0)
    expect(sunDistance(large)).toBeGreaterThan(sunDistance(small))
  })
})
