import { describe, it, expect } from 'vitest'
import { detectProperty, PropertyDetector, rect } from './propertyDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import type { AnalysisContext, GeoPoint } from './types'

function ctxFor(tap: GeoPoint): AnalysisContext {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  return { rng: new SeededRng(image.seed), image }
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('rect', () => {
  it('builds a 4-point clockwise rectangle', () => {
    expect(rect(0, 0, 2, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 3 },
      { x: 0, y: 3 },
    ])
  })
})

describe('detectProperty', () => {
  it('is deterministic for the same tap', () => {
    const ctx = ctxFor(BERLIN)
    const a = detectProperty(ctx.image, ctx)
    const ctx2 = ctxFor(BERLIN)
    const b = detectProperty(ctx2.image, ctx2)
    expect(a).toEqual(b)
  })

  it('produces a valid parcel with matching area', () => {
    const ctx = ctxFor(BERLIN)
    const p = detectProperty(ctx.image, ctx)
    expect(p.polygon).toHaveLength(4)
    expect(p.widthM).toBeGreaterThan(0)
    expect(p.depthM).toBeGreaterThan(0)
    expect(Math.abs(p.areaSqm - p.widthM * p.depthM)).toBeLessThan(2)
  })

  it('reports a valid street side and high confidence', () => {
    const ctx = ctxFor(BERLIN)
    const p = detectProperty(ctx.image, ctx)
    expect(['north', 'east', 'south', 'west']).toContain(p.streetSide)
    expect(p.confidence).toBeGreaterThanOrEqual(0.9)
    expect(p.confidence).toBeLessThanOrEqual(0.99)
  })

  it('is exposed as a labelled module', () => {
    expect(PropertyDetector.id).toBe('property-detector')
    expect(PropertyDetector.label).toBe('Grundstück')
  })
})
