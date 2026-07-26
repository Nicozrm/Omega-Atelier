import { describe, it, expect } from 'vitest'
import { computeConfidence, formatConfidence, ConfidenceEngine } from './confidenceEngine'
import { detectBuilding } from './buildingDetector'
import { detectProperty } from './propertyDetector'
import { detectRoof } from './roofDetector'
import { detectTerrain } from './terrainDetector'
import { detectVegetation } from './vegetationDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import type { AnalysisContext, GeoPoint } from './types'

function reportFor(tap: GeoPoint) {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  const ctx: AnalysisContext = { rng: new SeededRng(image.seed), image }
  const property = detectProperty(image, ctx)
  const building = detectBuilding(property, ctx)
  const roof = detectRoof(building, ctx)
  const terrain = detectTerrain({ property, building }, ctx)
  const vegetation = detectVegetation({ property, building }, ctx)
  return computeConfidence({ property, building, roof, terrain, vegetation, rng: ctx.rng })
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('formatConfidence', () => {
  it('formats a 0..1 value as whole percent', () => {
    expect(formatConfidence(0.923)).toBe('92 %')
    expect(formatConfidence(1)).toBe('100 %')
    expect(formatConfidence(-1)).toBe('0 %')
  })
})

describe('computeConfidence', () => {
  it('reports every canonical object with a 0..1 score', () => {
    const r = reportFor(BERLIN)
    for (const key of ['property', 'building', 'roof', 'garage', 'terrain', 'vegetation', 'interior'] as const) {
      expect(r.byObject[key]).toBeGreaterThanOrEqual(0)
      expect(r.byObject[key]).toBeLessThanOrEqual(1)
    }
  })

  it('scores the interior lowest — it is never observed from above', () => {
    const r = reportFor(BERLIN)
    expect(r.byObject.interior).toBeLessThan(r.byObject.property)
    expect(r.byObject.interior).toBeLessThan(r.byObject.building)
    expect(r.byObject.interior).toBeLessThan(0.55)
  })

  it('overall is a sensible aggregate between interior and property', () => {
    const r = reportFor(BERLIN)
    expect(r.overall).toBeGreaterThan(r.byObject.interior)
    expect(r.overall).toBeLessThanOrEqual(r.byObject.property)
  })

  it('is deterministic per tap', () => {
    expect(reportFor(BERLIN)).toEqual(reportFor(BERLIN))
  })

  it('exposes the engine facade', () => {
    expect(ConfidenceEngine.id).toBe('confidence-engine')
    expect(ConfidenceEngine.format(0.5)).toBe('50 %')
    expect(typeof ConfidenceEngine.compute).toBe('function')
  })
})
