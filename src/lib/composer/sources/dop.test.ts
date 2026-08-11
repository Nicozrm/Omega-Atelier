import { describe, it, expect } from 'vitest'
import {
  toMercator, mercatorHalfSpan, orthophotoUrl, orthophotoCandidates,
  coverageProbeUrl, MAX_WMS_PX,
} from './dop'
import { regionalDopsAt } from '../imagery'

/** Rheine, North Rhine-Westphalia — inside the 10 cm NRW coverage. */
const RHEINE = { lat: 52.2799, lng: 7.4406 }

const param = (url: string, key: string) => new URL(url).searchParams.get(key)
const bbox = (url: string) => param(url, 'BBOX')!.split(',').map(Number)

describe('toMercator', () => {
  it('maps the origin to the origin', () => {
    const m = toMercator({ lat: 0, lng: 0 })
    expect(m.x).toBeCloseTo(0, 6)
    expect(m.y).toBeCloseTo(0, 6)
  })

  it('places 180° east at the half-circumference', () => {
    expect(toMercator({ lat: 0, lng: 180 }).x).toBeCloseTo(20037508.34, 1)
  })

  it('is monotonic in both axes', () => {
    expect(toMercator({ lat: 0, lng: 10 }).x).toBeGreaterThan(toMercator({ lat: 0, lng: 5 }).x)
    expect(toMercator({ lat: 52, lng: 0 }).y).toBeGreaterThan(toMercator({ lat: 40, lng: 0 }).y)
  })

  it('is antisymmetric about the equator and the prime meridian', () => {
    expect(toMercator({ lat: -30, lng: -20 }).y).toBeCloseTo(-toMercator({ lat: 30, lng: 20 }).y, 6)
    expect(toMercator({ lat: -30, lng: -20 }).x).toBeCloseTo(-toMercator({ lat: 30, lng: 20 }).x, 6)
  })
})

describe('mercatorHalfSpan', () => {
  it('is the identity at the equator, where Mercator metres are ground metres', () => {
    expect(mercatorHalfSpan(200, 0)).toBeCloseTo(100, 9)
  })

  it('stretches by 1/cos(lat) — the ~62 % the module warns about at 52° N', () => {
    const half = mercatorHalfSpan(200, 52)
    expect(half).toBeCloseTo(100 / Math.cos((52 * Math.PI) / 180), 9)
    // Requesting 200 ground metres must ask for ~162 Mercator metres per half
    // edge. Using 100 would return a 123 m crop stretched over 200 m of scene.
    expect(half / 100).toBeGreaterThan(1.6)
    expect(half / 100).toBeLessThan(1.65)
  })

  it('grows with latitude and stays finite across the usable range', () => {
    let prev = 0
    for (const lat of [0, 20, 40, 52, 60, 70]) {
      const h = mercatorHalfSpan(100, lat)
      expect(h).toBeGreaterThan(prev)
      expect(Number.isFinite(h)).toBe(true)
      prev = h
    }
  })

  it('scales linearly with the requested ground size', () => {
    expect(mercatorHalfSpan(400, 52)).toBeCloseTo(mercatorHalfSpan(200, 52) * 2, 9)
  })
})

describe('orthophotoUrl', () => {
  const dop = regionalDopsAt(RHEINE)[0]

  it('builds a square, north-aligned EPSG:3857 GetMap request', () => {
    const photo = orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200, pixels: 1024 })
    expect(param(photo.url, 'SERVICE')).toBe('WMS')
    expect(param(photo.url, 'REQUEST')).toBe('GetMap')
    expect(param(photo.url, 'CRS')).toBe('EPSG:3857')
    expect(param(photo.url, 'WIDTH')).toBe('1024')
    expect(param(photo.url, 'HEIGHT')).toBe('1024')
    const [minX, minY, maxX, maxY] = bbox(photo.url)
    expect(maxX - minX).toBeCloseTo(maxY - minY, 6) // square
  })

  it('centres the box on the requested point', () => {
    const photo = orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200 })
    const c = toMercator(RHEINE)
    const [minX, minY, maxX, maxY] = bbox(photo.url)
    expect((minX + maxX) / 2).toBeCloseTo(c.x, 3)
    expect((minY + maxY) / 2).toBeCloseTo(c.y, 3)
  })

  it('applies the Mercator correction to the box it actually requests', () => {
    const photo = orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200 })
    const [minX, , maxX] = bbox(photo.url)
    expect(maxX - minX).toBeCloseTo(2 * mercatorHalfSpan(200, RHEINE.lat), 3)
  })

  it('clamps pixels into the range the services accept', () => {
    expect(param(orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200, pixels: 99999 }).url, 'WIDTH'))
      .toBe(String(MAX_WMS_PX))
    expect(param(orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200, pixels: 1 }).url, 'WIDTH'))
      .toBe('256')
  })

  it('reports the resolution it will actually deliver', () => {
    const photo = orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200, pixels: 2048 })
    // 200 m over 2048 px ≈ 9.8 cm/px.
    expect(photo.cmPerPixel).toBeCloseTo(9.8, 1)
    expect(photo.pixels).toBe(2048)
    expect(photo.groundSizeM).toBe(200)
  })

  it('requests JPEG for the ground — no transparency needed, far fewer bytes', () => {
    expect(param(orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200 }).url, 'FORMAT')).toBe('image/jpeg')
  })
})

describe('orthophotoCandidates', () => {
  it('offers the finest coverage first', () => {
    const list = orthophotoCandidates({ at: RHEINE, groundSizeM: 200 })
    expect(list.length).toBeGreaterThan(0)
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].source.groundResolutionM)
        .toBeLessThanOrEqual(list[i].source.groundResolutionM)
    }
  })

  it('returns nothing outside any regional coverage', () => {
    // Mid-Atlantic — no German state aerial survey applies.
    expect(orthophotoCandidates({ at: { lat: 30, lng: -40 }, groundSizeM: 200 })).toHaveLength(0)
  })
})

describe('coverageProbeUrl', () => {
  const dop = regionalDopsAt(RHEINE)[0]

  it('asks for a tiny transparent PNG covering the same box', () => {
    const photo = orthophotoUrl(dop, { at: RHEINE, groundSizeM: 200 })
    const probe = coverageProbeUrl(photo, RHEINE)
    expect(param(probe, 'FORMAT')).toBe('image/png')
    expect(param(probe, 'TRANSPARENT')).toBe('TRUE')
    expect(param(probe, 'WIDTH')).toBe('32')
    expect(bbox(probe)).toEqual(bbox(photo.url))
  })
})
