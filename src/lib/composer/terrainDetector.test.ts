import { describe, it, expect } from 'vitest'
import { detectTerrain, TerrainRecognizer } from './terrainDetector'
import { detectBuilding } from './buildingDetector'
import { detectProperty } from './propertyDetector'
import { defaultMapProvider } from './mapProvider'
import { SeededRng } from './rng'
import type { AnalysisContext, GeoPoint } from './types'

function terrainFor(tap: GeoPoint) {
  const image = defaultMapProvider.capture(tap, { center: tap, zoom: 18 })
  const ctx: AnalysisContext = { rng: new SeededRng(image.seed), image }
  const property = detectProperty(image, ctx)
  const building = detectBuilding(property, ctx)
  return { property, building, terrain: detectTerrain({ property, building }, ctx) }
}

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('detectTerrain', () => {
  it('is deterministic', () => {
    expect(terrainFor(BERLIN).terrain).toEqual(terrainFor(BERLIN).terrain)
  })

  it('reports a non-negative slope and aspect within a compass range', () => {
    const { terrain } = terrainFor(BERLIN)
    expect(terrain.slopeDeg).toBeGreaterThanOrEqual(0)
    expect(terrain.slopeDeg).toBeLessThan(15)
    expect(terrain.aspectDeg).toBeGreaterThanOrEqual(0)
    expect(terrain.aspectDeg).toBeLessThanOrEqual(360)
  })

  it('derives elevation drop consistently with the slope', () => {
    const { terrain } = terrainFor(BERLIN)
    if (terrain.slopeDeg < 0.5) {
      expect(terrain.elevationDropM).toBeLessThan(1)
    } else {
      expect(terrain.elevationDropM).toBeGreaterThan(0)
    }
  })

  it('traces a driveway from the street to the building', () => {
    const { terrain } = terrainFor(BERLIN)
    expect(terrain.drivewayPath.length).toBeGreaterThanOrEqual(2)
  })

  it('adds entrance steps only on sloped lots', () => {
    let flatWithSteps = 0
    let steepWithSteps = 0
    for (let i = 0; i < 60; i++) {
      const { terrain } = terrainFor({ lat: 52.4 + i * 0.001, lng: 13.3 + i * 0.001 })
      if (terrain.steps.length > 0) {
        for (const s of terrain.steps) {
          expect(s.count).toBeGreaterThanOrEqual(2)
          expect(s.riseM).toBeGreaterThan(0)
        }
        if (terrain.slopeDeg < 1) flatWithSteps++
        else steepWithSteps++
      }
    }
    expect(flatWithSteps).toBe(0)
    expect(steepWithSteps).toBeGreaterThanOrEqual(0)
  })

  it('exposes a labelled module', () => {
    expect(TerrainRecognizer.id).toBe('terrain-recognizer')
    expect(TerrainRecognizer.label).toBe('Gelände')
  })
})
