import { describe, it, expect } from 'vitest'
import { detectRoof, RoofDetector } from './roofDetector'
import { detectBuilding } from './buildingDetector'
import { detectProperty } from './propertyDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import type { AnalysisContext, GeoPoint, RoofShape } from './types'

function roofFor(tap: GeoPoint) {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  const ctx: AnalysisContext = { rng: new SeededRng(image.seed), image }
  const property = detectProperty(image, ctx)
  const building = detectBuilding(property, ctx)
  return detectRoof(building, ctx)
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('detectRoof', () => {
  it('is deterministic', () => {
    expect(roofFor(BERLIN)).toEqual(roofFor(BERLIN))
  })

  it('emits a valid shape', () => {
    const shapes: RoofShape[] = ['gable', 'hip', 'flat', 'pent']
    expect(shapes).toContain(roofFor(BERLIN).shape)
  })

  it('keeps flat roofs nearly level and pitched roofs steep', () => {
    for (let i = 0; i < 60; i++) {
      const roof = roofFor({ lat: 52.5 + i * 0.0007, lng: 13.4 + i * 0.0007 })
      if (roof.shape === 'flat') {
        expect(roof.pitchDeg).toBeLessThanOrEqual(5)
      } else if (roof.shape === 'gable' || roof.shape === 'hip') {
        expect(roof.pitchDeg).toBeGreaterThanOrEqual(25)
      }
    }
  })

  it('ridge is at or above the eaves', () => {
    for (let i = 0; i < 40; i++) {
      const roof = roofFor({ lat: 48.1 + i * 0.001, lng: 11.5 + i * 0.001 })
      expect(roof.ridgeHeightM).toBeGreaterThanOrEqual(roof.eavesHeightM)
    }
  })

  it('reports orientation as 0 or 90 degrees', () => {
    expect([0, 90]).toContain(roofFor(BERLIN).orientationDeg)
  })

  it('exposes a labelled module', () => {
    expect(RoofDetector.id).toBe('roof-detector')
    expect(RoofDetector.label).toBe('Dach')
  })
})
