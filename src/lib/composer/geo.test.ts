import { describe, it, expect } from 'vitest'
import {
  metersPerDegLng,
  haversineMeters,
  offsetGeo,
  geoToLocal,
  localToGeo,
  polygonAreaSqm,
  polygonCentroid,
  clampGeo,
  parseCoordinate,
  geocodeOffline,
  GAZETTEER,
} from './geo'

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('geo conversions', () => {
  it('metersPerDegLng shrinks toward the poles', () => {
    expect(metersPerDegLng(0)).toBeGreaterThan(metersPerDegLng(60))
    expect(metersPerDegLng(0)).toBeCloseTo(111320, 0)
  })

  it('haversine is ~0 for identical points and positive otherwise', () => {
    expect(haversineMeters(BERLIN, BERLIN)).toBeCloseTo(0, 5)
    expect(haversineMeters(BERLIN, { lat: 52.53, lng: 13.405 })).toBeGreaterThan(1000)
  })

  it('offsetGeo moves north/east by the requested metres', () => {
    const p = offsetGeo(BERLIN, 100, 0)
    expect(haversineMeters(BERLIN, p)).toBeCloseTo(100, 0)
    expect(p.lat).toBeGreaterThan(BERLIN.lat)
  })

  it('geoToLocal → localToGeo round-trips', () => {
    const target = offsetGeo(BERLIN, -30, 45)
    const local = geoToLocal(BERLIN, target)
    expect(local.x).toBeCloseTo(45, 3)
    expect(local.y).toBeCloseTo(30, 3) // south is positive y
    const back = localToGeo(BERLIN, local)
    expect(back.lat).toBeCloseTo(target.lat, 6)
    expect(back.lng).toBeCloseTo(target.lng, 6)
  })

  it('polygonAreaSqm computes a rectangle area', () => {
    const rect = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ]
    expect(polygonAreaSqm(rect)).toBeCloseTo(50, 6)
  })

  it('polygonCentroid finds the centre of a square', () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ])
    expect(c.x).toBeCloseTo(2, 6)
    expect(c.y).toBeCloseTo(2, 6)
  })

  it('clampGeo keeps latitude in range and wraps longitude', () => {
    expect(clampGeo({ lat: 99, lng: 0 }).lat).toBe(85)
    expect(clampGeo({ lat: 0, lng: 200 }).lng).toBeCloseTo(-160, 6)
  })
})

describe('parseCoordinate', () => {
  it('parses "lat, lng"', () => {
    expect(parseCoordinate('52.52, 13.405')).toEqual({ lat: 52.52, lng: 13.405 })
  })
  it('parses comma decimals and whitespace separators', () => {
    expect(parseCoordinate('48,1351 11,5820')).toEqual({ lat: 48.1351, lng: 11.582 })
  })
  it('rejects nonsense and out-of-range', () => {
    expect(parseCoordinate('hello')).toBeNull()
    expect(parseCoordinate('200, 0')).toBeNull()
  })
})

describe('geocodeOffline', () => {
  it('returns a coordinate result for a raw coordinate', () => {
    const r = geocodeOffline('52.52, 13.405')
    expect(r[0].source).toBe('coordinate')
    expect(r[0].point).toEqual({ lat: 52.52, lng: 13.405 })
  })

  it('matches a gazetteer city (case-insensitive)', () => {
    const r = geocodeOffline('berlin')
    expect(r[0].source).toBe('gazetteer')
    expect(r[0].label).toBe('Berlin')
    expect(haversineMeters(r[0].point, { lat: 52.52, lng: 13.405 })).toBeLessThan(100)
  })

  it('jitters a street address near its city but stays deterministic', () => {
    const a = geocodeOffline('Hauptstraße 12, München')
    const b = geocodeOffline('Hauptstraße 12, München')
    expect(a[0].point).toEqual(b[0].point)
    const munich = GAZETTEER.find((g) => g.name === 'München')!
    expect(haversineMeters(a[0].point, munich)).toBeLessThan(2000)
    expect(a[0].point).not.toEqual({ lat: munich.lat, lng: munich.lng })
  })

  it('synthesises a deterministic location for an unknown query', () => {
    const a = geocodeOffline('Nirgendwo-Dorf 7')
    const b = geocodeOffline('Nirgendwo-Dorf 7')
    expect(a[0].source).toBe('synthetic')
    expect(a[0].point).toEqual(b[0].point)
    expect(a[0].confidence).toBeLessThan(0.6)
  })

  it('returns nothing for an empty query', () => {
    expect(geocodeOffline('   ')).toEqual([])
  })
})
