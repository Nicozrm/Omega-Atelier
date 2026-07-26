import { describe, it, expect } from 'vitest'
import {
  EsriWorldImageryProvider, esriTileUrl,
  lonToTileX, latToTileY, tileGroundMeters,
} from './onlineProvider'
import { spanForZoom } from './mapProvider'

const berlin = { lat: 52.52, lng: 13.405 }

describe('tile math', () => {
  it('maps the prime meridian / equator to the tile-grid centre', () => {
    expect(lonToTileX(0, 1)).toBeCloseTo(1, 6)
    expect(latToTileY(0, 1)).toBeCloseTo(1, 6)
  })

  it('locates Berlin on the z10 grid (known slippy values)', () => {
    expect(Math.floor(lonToTileX(berlin.lng, 10))).toBe(550)
    expect(Math.floor(latToTileY(berlin.lat, 10))).toBe(335)
  })

  it('tile ground size halves per zoom step and shrinks with latitude', () => {
    const z16 = tileGroundMeters(berlin.lat, 16)
    expect(tileGroundMeters(berlin.lat, 17)).toBeCloseTo(z16 / 2, 6)
    expect(tileGroundMeters(60, 16)).toBeLessThan(tileGroundMeters(0, 16))
  })

  it('builds the Esri URL in z/y/x order', () => {
    expect(esriTileUrl(17, 70406, 42987)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/42987/70406',
    )
  })
})

describe('EsriWorldImageryProvider', () => {
  const jsonRes = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as Response

  it('geocodes via Nominatim and maps hits to GeoResults', async () => {
    const p = new EsriWorldImageryProvider(async (url) => {
      expect(url).toContain('nominatim.openstreetmap.org/search')
      expect(url).toContain('q=Kolpingstra%C3%9Fe')
      return jsonRes([{ display_name: 'Kolpingstraße, Deutschland', lat: '52.52', lon: '13.405', importance: 0.72 }])
    })
    const hits = await p.geocode('Kolpingstraße')
    expect(hits).toHaveLength(1)
    expect(hits[0].point.lat).toBeCloseTo(52.52)
    expect(hits[0].point.lng).toBeCloseTo(13.405)
    expect(hits[0].source).toBe('gazetteer')
    expect(hits[0].confidence).toBeCloseTo(0.72)
  })

  it('returns no hits on network failure instead of throwing', async () => {
    const p = new EsriWorldImageryProvider(async () => { throw new Error('offline') })
    await expect(p.geocode('irgendwo')).resolves.toEqual([])
  })

  it('reverse-geocode falls back to coordinates when blocked', async () => {
    const p = new EsriWorldImageryProvider(async () => jsonRes({}, false))
    await expect(p.reverseGeocode(berlin)).resolves.toBe('52.52000, 13.40500')
  })

  it('capture is deterministic, centred on the tap, with the zoom-derived span', async () => {
    const p = new EsriWorldImageryProvider(async () => jsonRes([]))
    const view = { center: berlin, zoom: 18 }
    const a = p.capture(berlin, view)
    const b = p.capture(berlin, view)
    expect(a.seed).toBe(b.seed) // same tap → same analysis
    expect(a.center).toEqual(berlin)
    expect(a.spanMeters).toBe(spanForZoom(18))
    expect(a.provider).toBe('esri-world-imagery')
    expect(a.metersPerPixel).toBeCloseTo(a.spanMeters / 640)
  })
})
