import { describe, it, expect } from 'vitest'
import {
  shadowRadius, sunDistance, siteMargin, shadowBiasFor, shadowTexelSize,
  SITE_HEIGHT, MIN_SITE_MARGIN, MAX_SITE_MARGIN,
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

describe('shadowTexelSize', () => {
  it('is the frustum width divided by the map resolution', () => {
    expect(shadowTexelSize(24, 4096)).toBeCloseTo(48 / 4096, 9)
    // The number the whole bias question turns on: about a centimetre on
    // `ultra`, and nearly five on `performance`.
    expect(shadowTexelSize(24, 1024)).toBeCloseTo(4 * shadowTexelSize(24, 4096), 9)
  })

  it('never divides by zero on a degenerate map size', () => {
    expect(Number.isFinite(shadowTexelSize(24, 0))).toBe(true)
  })
})

describe('shadowBiasFor', () => {
  it('scales the normal offset with the texel size', () => {
    // The bug it fixes: one fixed 0.02 m offset served a 1.2 cm texel (4096²)
    // and a 4.7 cm one (1024²) — acne at one end, detached contacts at the other.
    const radius = shadowRadius(20, 16)
    const coarse = shadowBiasFor(radius, 1024)
    const fine = shadowBiasFor(radius, 4096)
    expect(coarse.texelSize).toBeCloseTo(fine.texelSize * 4, 6)
    expect(coarse.normalBias).toBeGreaterThan(fine.normalBias)
    // Roughly one texel, which is the lateral error a PCF lookup can make.
    expect(fine.normalBias / fine.texelSize).toBeGreaterThan(1)
    expect(fine.normalBias / fine.texelSize).toBeLessThan(2)
  })

  it('keeps the depth bias negative and small', () => {
    for (const [w, h] of PLANS) {
      for (const size of [1024, 2048, 3072, 4096]) {
        const { bias } = shadowBiasFor(shadowRadius(w, h), size)
        expect(bias).toBeLessThan(0)
        expect(bias).toBeGreaterThan(-0.002)
      }
    }
  })

  it('clamps at both extremes instead of running away', () => {
    const tiny = shadowBiasFor(0.5, 4096)
    const huge = shadowBiasFor(5000, 1024)
    expect(tiny.normalBias).toBeGreaterThanOrEqual(0.01)
    expect(huge.normalBias).toBeLessThanOrEqual(0.15)
    expect(huge.bias).toBeGreaterThanOrEqual(-0.0015)
  })

  it('gives every profile a bias in a plausible band for a real plan', () => {
    const radius = shadowRadius(12, 10)
    for (const size of [1024, 2048, 3072, 4096]) {
      const { normalBias } = shadowBiasFor(radius, size)
      // Under a centimetre would not clear the texel; over ten would lift the
      // shadow visibly off the floor.
      expect(normalBias).toBeGreaterThan(0.009)
      expect(normalBias).toBeLessThan(0.1)
    }
  })
})
