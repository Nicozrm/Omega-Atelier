/**
 * world.ts — the deterministic synthetic parcel grid.
 *
 * Offline-first means there is no real satellite tile to analyse, so the
 * Composer defines its *own* consistent aerial world: space is divided into a
 * regular grid of building lots, each seeded from its grid cell. Both the map
 * renderer (what the user sees and taps) and the PropertyDetector (what gets
 * analysed) resolve a tap through {@link parcelAt}, so the twin always matches
 * the lot under the pin.
 *
 * The grid is anchored in a metric frame derived from the equator/prime
 * meridian, so lot boundaries are stable regardless of where the user pans.
 */

import type { GeoPoint } from './types'
import { METERS_PER_DEG_LAT, metersPerDegLng, offsetGeo } from './geo'
import { hashInts, SeededRng } from './rng'

/** Nominal lot dimensions, metres. Real width/depth jitter per parcel. */
export const LOT_WIDTH_M = 26
export const LOT_DEPTH_M = 34

export interface SyntheticParcel {
  /** Grid cell indices — the stable identity of the lot. */
  cell: { gx: number; gy: number }
  /** North-west corner of the lot (the local-frame origin). */
  origin: GeoPoint
  /** Lot centre. */
  center: GeoPoint
  /** Deterministic seed for everything derived from this lot. */
  seed: number
  widthM: number
  depthM: number
  /** Long-axis rotation relative to north, degrees. */
  orientationDeg: number
  /** Whether this cell is built (some lots are parks/empty). */
  built: boolean
}

/** Approximate metres east of the prime meridian at a latitude. */
function metersEast(lng: number, lat: number): number {
  return lng * metersPerDegLng(lat)
}

/** Approximate metres north of the equator. */
function metersNorth(lat: number): number {
  return lat * METERS_PER_DEG_LAT
}

/**
 * Resolve the parcel that contains a geo-point. Deterministic: the same lot is
 * returned for every point inside it, so two taps on one roof analyse the same
 * property.
 */
export function parcelAt(p: GeoPoint): SyntheticParcel {
  const mE = metersEast(p.lng, p.lat)
  const mN = metersNorth(p.lat)
  const gx = Math.floor(mE / LOT_WIDTH_M)
  const gy = Math.floor(mN / LOT_DEPTH_M)
  return parcelFromCell(gx, gy, p.lat)
}

/** Build the parcel descriptor for a grid cell. */
export function parcelFromCell(gx: number, gy: number, refLat: number): SyntheticParcel {
  const seed = hashInts(gx, gy, 0x50415243)
  const rng = new SeededRng(seed)

  // Per-lot variation in size and a small orientation drift.
  const widthM = LOT_WIDTH_M * rng.range(0.82, 1.24)
  const depthM = LOT_DEPTH_M * rng.range(0.82, 1.28)
  const orientationDeg = rng.range(-8, 8)
  // ~12% of lots are unbuilt (parks, meadows) — gives the aerial some breathing room.
  const built = rng.next() > 0.12

  // The NW corner of the cell, back-projected to geo. We reconstruct the
  // corner's metric coordinates and convert through the reference latitude.
  const cornerN = (gy + 1) * LOT_DEPTH_M // north edge (higher lat)
  const cornerE = gx * LOT_WIDTH_M
  const originLat = cornerN / METERS_PER_DEG_LAT
  const originLng = cornerE / metersPerDegLng(refLat || originLat)
  const origin: GeoPoint = { lat: originLat, lng: originLng }
  const center = offsetGeo(origin, -depthM / 2, widthM / 2)

  return { cell: { gx, gy }, origin, center, seed, widthM, depthM, orientationDeg, built }
}

/** Enumerate every parcel whose cell overlaps a geo bounding box. */
export function parcelsInBounds(
  sw: GeoPoint,
  ne: GeoPoint,
  refLat: number,
  limit = 400,
): SyntheticParcel[] {
  const gx0 = Math.floor(metersEast(sw.lng, refLat) / LOT_WIDTH_M)
  const gx1 = Math.floor(metersEast(ne.lng, refLat) / LOT_WIDTH_M)
  const gy0 = Math.floor(metersNorth(sw.lat) / LOT_DEPTH_M)
  const gy1 = Math.floor(metersNorth(ne.lat) / LOT_DEPTH_M)
  const out: SyntheticParcel[] = []
  for (let gy = gy0; gy <= gy1 && out.length < limit; gy++) {
    for (let gx = gx0; gx <= gx1 && out.length < limit; gx++) {
      out.push(parcelFromCell(gx, gy, refLat))
    }
  }
  return out
}
