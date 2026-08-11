/**
 * geo.ts — small, dependency-free geodesy for the Composer.
 *
 * Everything the pipeline needs to move between WGS84 degrees and the local
 * metric frame (metres, x → east, y → south from a NW origin), plus an
 * offline geocoder: a compact gazetteer of German localities and a
 * deterministic synthesiser for anything unknown, so address search works with
 * zero network (offline-first).
 */

import type { GeoPoint, GeoResult, LocalPoint, LocalPolygon } from './types'
import { hashString, SeededRng } from './rng'

/** Metres per degree of latitude (near-constant on the WGS84 ellipsoid). */
export const METERS_PER_DEG_LAT = 111_320

const DEG = Math.PI / 180

/** Metres per degree of longitude at a given latitude. */
export function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG)
}

/** Great-circle distance between two geo-points, metres (haversine). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG
  const dLng = (b.lng - a.lng) * DEG
  const la1 = a.lat * DEG
  const la2 = b.lat * DEG
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Offset a geo-point by metres north and east. */
export function offsetGeo(origin: GeoPoint, northM: number, eastM: number): GeoPoint {
  return {
    lat: origin.lat + northM / METERS_PER_DEG_LAT,
    lng: origin.lng + eastM / metersPerDegLng(origin.lat),
  }
}

/**
 * Project a geo-point into the local metric frame anchored at `origin`
 * (the NW corner): x grows east, y grows south (down), matching plan axes.
 */
export function geoToLocal(origin: GeoPoint, p: GeoPoint): LocalPoint {
  return {
    x: (p.lng - origin.lng) * metersPerDegLng(origin.lat),
    y: (origin.lat - p.lat) * METERS_PER_DEG_LAT,
  }
}

/** Inverse of {@link geoToLocal}. */
export function localToGeo(origin: GeoPoint, local: LocalPoint): GeoPoint {
  return {
    lat: origin.lat - local.y / METERS_PER_DEG_LAT,
    lng: origin.lng + local.x / metersPerDegLng(origin.lat),
  }
}

/** Shoelace area of a local polygon, m² (always non-negative). */
export function polygonAreaSqm(poly: LocalPolygon): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return Math.abs(a) / 2
}

/** Centroid of a local polygon (falls back to vertex average if degenerate). */
export function polygonCentroid(poly: LocalPolygon): LocalPoint {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y
    a += cross
    cx += (poly[j].x + poly[i].x) * cross
    cy += (poly[j].y + poly[i].y) * cross
  }
  a *= 0.5
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Clamp a latitude/longitude pair into valid WGS84 ranges. */
export function clampGeo(p: GeoPoint): GeoPoint {
  return {
    lat: Math.max(-85, Math.min(85, p.lat)),
    lng: ((((p.lng + 180) % 360) + 360) % 360) - 180,
  }
}

/** Format a coordinate for display. */
export function formatGeo(p: GeoPoint): string {
  const ns = p.lat >= 0 ? 'N' : 'S'
  const ew = p.lng >= 0 ? 'O' : 'W'
  return `${Math.abs(p.lat).toFixed(5)}° ${ns}, ${Math.abs(p.lng).toFixed(5)}° ${ew}`
}

// ───────────────────────── Offline geocoder ─────────────────────────

interface GazetteerEntry {
  name: string
  lat: number
  lng: number
}

/** A compact gazetteer of German-speaking localities (offline seed data). */
export const GAZETTEER: readonly GazetteerEntry[] = [
  { name: 'Berlin', lat: 52.5200, lng: 13.4050 },
  { name: 'Hamburg', lat: 53.5511, lng: 9.9937 },
  { name: 'München', lat: 48.1351, lng: 11.5820 },
  { name: 'Köln', lat: 50.9375, lng: 6.9603 },
  { name: 'Frankfurt', lat: 50.1109, lng: 8.6821 },
  { name: 'Stuttgart', lat: 48.7758, lng: 9.1829 },
  { name: 'Düsseldorf', lat: 51.2277, lng: 6.7735 },
  { name: 'Leipzig', lat: 51.3397, lng: 12.3731 },
  { name: 'Dortmund', lat: 51.5136, lng: 7.4653 },
  { name: 'Dresden', lat: 51.0504, lng: 13.7373 },
  { name: 'Hannover', lat: 52.3759, lng: 9.7320 },
  { name: 'Nürnberg', lat: 49.4521, lng: 11.0767 },
  { name: 'Bremen', lat: 53.0793, lng: 8.8017 },
  { name: 'Freiburg', lat: 47.9990, lng: 7.8421 },
  { name: 'Münster', lat: 51.9607, lng: 7.6261 },
  { name: 'Wien', lat: 48.2082, lng: 16.3738 },
  { name: 'Zürich', lat: 47.3769, lng: 8.5417 },
  { name: 'Salzburg', lat: 47.8095, lng: 13.0550 },
]

/** Geographic centre of Germany — the anchor for synthesised locations. */
const GERMANY_CENTER: GeoPoint = { lat: 51.1657, lng: 10.4515 }

/** Try to parse a raw "lat,lng" (or "lat lng") coordinate string. */
export function parseCoordinate(query: string): GeoPoint | null {
  const m = query.trim().match(/^(-?\d{1,3}(?:[.,]\d+)?)[,;\s]+(-?\d{1,3}(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = parseFloat(m[1].replace(',', '.'))
  const lng = parseFloat(m[2].replace(',', '.'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/**
 * Offline geocoding. Resolution order:
 *   1. a raw coordinate ("52.52, 13.405"),
 *   2. a gazetteer locality (substring match, with a house-level jitter derived
 *      from the full query so "Musterstr. 1, Berlin" lands near Berlin but at a
 *      stable, distinct spot),
 *   3. a fully synthesised, deterministic location near the centre of Germany.
 * Always returns at least one result.
 */
export function geocodeOffline(query: string): GeoResult[] {
  const q = query.trim()
  if (!q) return []

  const coord = parseCoordinate(q)
  if (coord) {
    return [{ label: formatGeo(coord), point: coord, source: 'coordinate', confidence: 1 }]
  }

  const lower = q.toLowerCase()
  const results: GeoResult[] = []

  for (const entry of GAZETTEER) {
    if (lower.includes(entry.name.toLowerCase())) {
      const exact = lower === entry.name.toLowerCase()
      // An exact city name lands on the locality; a street address *near* a city
      // gets a stable, distinct pin jittered within ~1.2 km of it.
      const point = exact
        ? { lat: entry.lat, lng: entry.lng }
        : clampGeo(offsetGeo(
            { lat: entry.lat, lng: entry.lng },
            new SeededRng(hashString(lower + '@' + entry.name)).range(-1200, 1200),
            new SeededRng(hashString(entry.name + '#' + lower)).range(-1200, 1200),
          ))
      results.push({
        label: exact ? entry.name : `${q} · ${entry.name}`,
        point,
        source: 'gazetteer',
        confidence: exact ? 0.95 : 0.8,
      })
    }
  }

  if (results.length > 0) {
    return results.sort((a, b) => b.confidence - a.confidence).slice(0, 5)
  }

  // Nothing matched — synthesise a plausible German location from the query.
  const rng = new SeededRng(hashString(lower))
  const point = clampGeo(offsetGeo(
    GERMANY_CENTER,
    rng.range(-320_000, 320_000),
    rng.range(-320_000, 320_000),
  ))
  return [{
    label: `${q} · geschätzter Standort`,
    point,
    source: 'synthetic',
    confidence: 0.45,
  }]
}

// ─────────────────────────────────────────────────────────────────────
// Polygon geometry for the real-world layer
//
// These four helpers exist because the world layer works with *measured*
// outlines — cadastral parcels and OSM building footprints — rather than the
// axis-aligned rectangles the offline detectors synthesise. A real parcel is a
// rotated, irregular polygon, and placing a house on it needs its own axes, not
// the compass ones.
// ─────────────────────────────────────────────────────────────────────

/** Axis-aligned extent of a polygon in local metres. */
export interface LocalBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The minimum-area rectangle enclosing a polygon, in its own axes. */
export interface OrientedBounds {
  /** Rotation of the rectangle against the local axes, radians. */
  angle: number
  /** Extent along the rectangle's own axes, metres. */
  widthM: number
  depthM: number
  areaSqm: number
}

/** Axis-aligned bounding box. Degenerate input yields a zero box, never NaN. */
export function polygonBBox(poly: LocalPolygon): LocalBBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/** Rotate a polygon about the origin by `rad` (positive = x toward y). */
export function rotatePolygon(poly: LocalPolygon, rad: number): LocalPolygon {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return poly.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }))
}

/** Shift a polygon so its bounding box starts at the origin. */
export function normalizePolygon(poly: LocalPolygon): LocalPolygon {
  const b = polygonBBox(poly)
  return poly.map((p) => ({ x: p.x - b.minX, y: p.y - b.minY }))
}

/**
 * Convex hull, monotone chain (Andrew). Sorted by x then y, so the result is
 * counter-clockwise starting at the leftmost point. Fewer than three distinct
 * points are returned unchanged.
 */
export function convexHull(poly: LocalPolygon): LocalPolygon {
  const pts = [...poly].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  if (pts.length < 3) return pts
  const cross = (o: LocalPoint, a: LocalPoint, b: LocalPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: LocalPoint[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: LocalPoint[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Minimum-area enclosing rectangle, by rotating calipers over the hull.
 *
 * The minimum-area rectangle always shares an edge with the convex hull, so
 * testing one rotation per hull edge is exact rather than a search. This is
 * what gives a parcel its *own* width, depth and orientation — a plot rotated
 * 30° against north is 18 m × 40 m, not the 34 m × 47 m its axis-aligned
 * bounding box would claim.
 */
export function orientedBounds(poly: LocalPolygon): OrientedBounds {
  const hull = convexHull(poly)
  if (hull.length < 3) {
    const b = polygonBBox(poly)
    const w = b.maxX - b.minX
    const d = b.maxY - b.minY
    return { angle: 0, widthM: w, depthM: d, areaSqm: w * d }
  }

  let best: OrientedBounds | null = null
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const edge = Math.atan2(b.y - a.y, b.x - a.x)
    // Rotate the hull so this edge lies on the x axis, then measure.
    const rotated = rotatePolygon(hull, -edge)
    const bb = polygonBBox(rotated)
    const w = bb.maxX - bb.minX
    const d = bb.maxY - bb.minY
    const area = w * d
    if (!best || area < best.areaSqm) best = { angle: edge, widthM: w, depthM: d, areaSqm: area }
  }
  return best!
}
