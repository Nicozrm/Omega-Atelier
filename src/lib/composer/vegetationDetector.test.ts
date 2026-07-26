import { describe, it, expect } from 'vitest'
import { detectVegetation, VegetationRecognizer } from './vegetationDetector'
import { detectBuilding } from './buildingDetector'
import { detectProperty } from './propertyDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import type { AnalysisContext, BuildingFeature, GeoPoint, LocalPoint } from './types'

function vegFor(tap: GeoPoint) {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  const ctx: AnalysisContext = { rng: new SeededRng(image.seed), image }
  const property = detectProperty(image, ctx)
  const building = detectBuilding(property, ctx)
  return { property, building, vegetation: detectVegetation({ property, building }, ctx) }
}

function footprintContains(building: BuildingFeature, p: LocalPoint): boolean {
  const main = building.parts.find((pt) => pt.kind === 'main')!.polygon
  const xs = main.map((c) => c.x)
  const ys = main.map((c) => c.y)
  return p.x >= Math.min(...xs) && p.x <= Math.max(...xs) && p.y >= Math.min(...ys) && p.y <= Math.max(...ys)
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('detectVegetation', () => {
  it('is deterministic', () => {
    expect(vegFor(BERLIN).vegetation).toEqual(vegFor(BERLIN).vegetation)
  })

  it('never places a plant on the main building', () => {
    for (let i = 0; i < 40; i++) {
      const { building, vegetation } = vegFor({ lat: 52.4 + i * 0.0011, lng: 13.3 + i * 0.0011 })
      for (const plant of vegetation.plants) {
        expect(footprintContains(building, plant.at)).toBe(false)
      }
    }
  })

  it('places at least one tree and a street-front hedge', () => {
    const { vegetation } = vegFor(BERLIN)
    expect(vegetation.plants.some((p) => p.kind === 'tree')).toBe(true)
    expect(vegetation.hedges.length).toBeGreaterThanOrEqual(1)
    for (const h of vegetation.hedges) expect(h.path.length).toBe(2)
  })

  it('produces a back lawn with positive area', () => {
    const { vegetation } = vegFor(BERLIN)
    for (const lawn of vegetation.lawns) {
      expect(lawn.areaSqm).toBeGreaterThan(0)
      expect(lawn.polygon).toHaveLength(4)
    }
  })

  it('adds pools on some lots but not most', () => {
    let pools = 0
    const n = 80
    for (let i = 0; i < n; i++) {
      const { vegetation } = vegFor({ lat: 52.0 + i * 0.0013, lng: 13.0 + i * 0.0013 })
      if (vegetation.pools.length > 0) {
        pools++
        for (const pool of vegetation.pools) {
          expect(pool.areaSqm).toBeGreaterThan(0)
          expect(pool.confidence).toBeGreaterThan(0)
        }
      }
    }
    expect(pools).toBeGreaterThan(0)
    expect(pools).toBeLessThan(n * 0.6)
  })

  it('exposes a labelled module', () => {
    expect(VegetationRecognizer.id).toBe('vegetation-recognizer')
    expect(VegetationRecognizer.label).toBe('Vegetation')
  })
})
