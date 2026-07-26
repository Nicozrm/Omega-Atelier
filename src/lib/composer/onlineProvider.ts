import type { GeoPoint, GeoResult, MapView, SatelliteImage } from './types'
import { spanForZoom, type MapProvider } from './mapProvider'
import { parcelAt } from './world'

/**
 * onlineProvider.ts — the REAL satellite view.
 *
 * Drops into the composer's {@link MapProvider} slot: geocoding via the public
 * Nominatim (OpenStreetMap) endpoint, imagery via **Esri World Imagery** tiles.
 * Esri permits displaying this service with attribution; Google's tiles are
 * ToS-restricted to their own SDKs, which is why Esri is the imagery source.
 * The browser fetches tiles directly — no key, no server, no build step.
 *
 * Analysis stays deterministic: `capture` derives the seed from the same world
 * hash the offline provider uses, so the downstream detectors behave
 * identically no matter which provider produced the image descriptor.
 */

export const ESRI_ATTRIBUTION = 'Bilder © Esri · Maxar · Earthstar Geographics'

/** Slippy-tile URL for Esri World Imagery (z/y/x order!). */
export function esriTileUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
}

// ── Web-mercator tile math (float — callers floor for indices) ──
export function lonToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z
}
export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
/** Ground metres covered by one 256px tile at `z` near latitude `lat`. */
export function tileGroundMeters(lat: number, z: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

type FetchLike = (url: string) => Promise<Response>

const NOMINATIM = 'https://nominatim.openstreetmap.org'

interface NominatimHit { display_name: string; lat: string; lon: string; importance?: number }

export class EsriWorldImageryProvider implements MapProvider {
  readonly id = 'esri-world-imagery'
  readonly label = 'Satellit (Esri World Imagery)'
  readonly attribution = ESRI_ATTRIBUTION
  readonly online = true

  // Injectable for tests; wrapped so the global fetch keeps its binding.
  constructor(private readonly fetchFn: FetchLike = (url) => fetch(url)) {}

  async geocode(query: string): Promise<GeoResult[]> {
    const q = query.trim()
    if (!q) return []
    try {
      const res = await this.fetchFn(`${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=de&q=${encodeURIComponent(q)}`)
      if (!res.ok) return []
      const hits = (await res.json()) as NominatimHit[]
      return hits.map((h) => ({
        label: h.display_name,
        point: { lat: Number(h.lat), lng: Number(h.lon) },
        source: 'gazetteer' as const,
        confidence: Math.max(0, Math.min(1, h.importance ?? 0.6)),
      }))
    } catch {
      return [] // offline / blocked → the wizard falls back to no hits
    }
  }

  async reverseGeocode(p: GeoPoint): Promise<string> {
    try {
      const res = await this.fetchFn(`${NOMINATIM}/reverse?format=jsonv2&accept-language=de&lat=${p.lat}&lon=${p.lng}`)
      if (res.ok) {
        const hit = (await res.json()) as NominatimHit
        if (hit.display_name) return hit.display_name
      }
    } catch { /* fall through to coordinates */ }
    return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
  }

  capture(tap: GeoPoint, view: MapView): SatelliteImage {
    // Real imagery → analyse exactly where the user tapped; the seed comes from
    // the same deterministic world hash the offline provider uses.
    const spanMeters = spanForZoom(view.zoom)
    return {
      center: tap,
      spanMeters,
      seed: parcelAt(tap).seed,
      metersPerPixel: spanMeters / 640,
      provider: this.id,
      capturedAt: new Date().toISOString(),
    }
  }
}

/** Shared instance for the wizard toggle. */
export const esriProvider = new EsriWorldImageryProvider()
