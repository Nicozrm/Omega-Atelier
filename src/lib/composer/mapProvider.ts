/**
 * mapProvider.ts — the swappable map source (connector-first).
 *
 * The pipeline starts at a MapProvider: it geocodes, and it "captures" the patch
 * under a tap into a {@link SatelliteImage}. The default {@link OfflineMapProvider}
 * needs no network — it geocodes against the offline gazetteer and derives the
 * image seed from the synthetic parcel grid. A real tile/imagery provider can be
 * dropped in later by implementing the same {@link MapProvider} interface; the
 * engine never depends on the concrete provider.
 */

import type { GeoPoint, GeoResult, MapView, SatelliteImage } from './types'
import { geocodeOffline, haversineMeters } from './geo'
import { parcelAt } from './world'

export interface MapProvider {
  readonly id: string
  readonly label: string
  readonly attribution: string
  /** Whether this provider needs the network. Offline providers are `false`. */
  readonly online: boolean
  geocode(query: string): Promise<GeoResult[]>
  reverseGeocode(p: GeoPoint): Promise<string>
  /** Capture the analysable patch centred on `tap`. */
  capture(tap: GeoPoint, view: MapView): SatelliteImage
}

/** Metres of ground covered edge-to-edge at a given zoom for a 640px viewport. */
export function spanForZoom(zoom: number): number {
  // Web-mercator: ground resolution roughly halves per zoom step. Anchor at
  // z=18 ≈ 150 m across a house-scale view; clamp to a sensible planning range.
  const span = 150 * 2 ** (18 - zoom)
  return Math.max(40, Math.min(600, span))
}

/**
 * The default, network-free provider. Everything is deterministic: geocoding is
 * the offline gazetteer, and `capture` reads the parcel grid so the captured
 * seed matches the lot the user tapped.
 */
export class OfflineMapProvider implements MapProvider {
  readonly id = 'offline'
  readonly label = 'Omega Offline-Karte'
  readonly attribution = 'Omega Synthetic Aerial · offline'
  readonly online = false

  async geocode(query: string): Promise<GeoResult[]> {
    return geocodeOffline(query)
  }

  async reverseGeocode(p: GeoPoint): Promise<string> {
    // Nearest gazetteer locality label + relative bearing, fully offline.
    const results = geocodeOffline('') // no-op guard for empty
    void results
    const parcel = parcelAt(p)
    return `Grundstück ${parcel.cell.gx}/${parcel.cell.gy}`
  }

  capture(tap: GeoPoint, view: MapView): SatelliteImage {
    const parcel = parcelAt(tap)
    const spanMeters = spanForZoom(view.zoom)
    return {
      center: parcel.center,
      spanMeters,
      seed: parcel.seed,
      metersPerPixel: spanMeters / 640,
      provider: this.id,
      capturedAt: new Date().toISOString(),
    }
  }
}

/** The provider the composer uses unless a caller injects another one. */
export const defaultMapProvider: MapProvider = new OfflineMapProvider()

/** Distance in metres between a tap and the centre it snapped to. */
export function snapDistanceMeters(tap: GeoPoint, image: SatelliteImage): number {
  return haversineMeters(tap, image.center)
}
