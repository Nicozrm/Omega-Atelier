import { describe, it, expect } from 'vitest'
import { detectBuilding, BuildingRecognizer, eavesHeight } from './buildingDetector'
import { detectProperty } from './propertyDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import { polygonAreaSqm } from './geo'
import type { AnalysisContext, GeoPoint, PropertyFeature } from './types'

function build(tap: GeoPoint) {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  const ctx: AnalysisContext = { rng: new SeededRng(image.seed), image }
  const property = detectProperty(image, ctx)
  return { property, building: detectBuilding(property, ctx), ctx }
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('eavesHeight', () => {
  it('scales with storeys', () => {
    expect(eavesHeight(1)).toBeLessThan(eavesHeight(2))
    expect(eavesHeight(2)).toBeCloseTo(6.1, 5)
  })
})

describe('detectBuilding', () => {
  it('is deterministic for the same parcel', () => {
    const a = build(BERLIN).building
    const b = build(BERLIN).building
    expect(a).toEqual(b)
  })

  it('produces a footprint inside the property bounds', () => {
    const { property, building } = build(BERLIN)
    for (const pt of building.footprint) {
      expect(pt.x).toBeGreaterThanOrEqual(-0.01)
      expect(pt.x).toBeLessThanOrEqual(property.widthM + 0.01)
      expect(pt.y).toBeGreaterThanOrEqual(-0.01)
      expect(pt.y).toBeLessThanOrEqual(property.depthM + 0.01)
    }
  })

  it('always includes a main part matching the footprint area', () => {
    const { building } = build(BERLIN)
    const main = building.parts.find((p) => p.kind === 'main')
    expect(main).toBeDefined()
    expect(building.areaSqm).toBeGreaterThan(30)
    expect(Math.abs(building.areaSqm - polygonAreaSqm(building.footprint))).toBeLessThan(2)
  })

  it('has a plausible storey count and height', () => {
    const { building } = build(BERLIN)
    expect([1, 2, 3]).toContain(building.stories)
    expect(building.heightM).toBeGreaterThan(2.5)
    expect(building.heightM).toBeLessThan(12)
  })

  it('every part has a normalized confidence', () => {
    const { building } = build(BERLIN)
    for (const part of building.parts) {
      expect(part.confidence).toBeGreaterThan(0)
      expect(part.confidence).toBeLessThanOrEqual(1)
      expect(part.polygon).toHaveLength(4)
    }
  })

  it('produces garages on at least some lots but never both garage and carport', () => {
    let garages = 0
    for (let i = 0; i < 40; i++) {
      const tap = { lat: 52.5 + i * 0.001, lng: 13.4 + i * 0.001 }
      const { building } = build(tap)
      const kinds = building.parts.map((p) => p.kind)
      const hasGarage = kinds.includes('garage')
      const hasCarport = kinds.includes('carport')
      expect(hasGarage && hasCarport).toBe(false)
      if (hasGarage) garages++
    }
    expect(garages).toBeGreaterThan(0)
  })

  it('only emits known part kinds', () => {
    const valid = new Set(['main', 'garage', 'extension', 'conservatory', 'carport', 'balcony', 'terrace'])
    for (let i = 0; i < 20; i++) {
      const tap = { lat: 48.1 + i * 0.002, lng: 11.5 + i * 0.002 }
      const { building } = build(tap)
      for (const part of building.parts) expect(valid.has(part.kind)).toBe(true)
    }
  })

  it('is exposed as a labelled module', () => {
    const property: PropertyFeature = build(BERLIN).property
    expect(BuildingRecognizer.id).toBe('building-recognizer')
    const via = BuildingRecognizer.run(property, build(BERLIN).ctx)
    expect(via.footprint).toHaveLength(4)
  })
})
