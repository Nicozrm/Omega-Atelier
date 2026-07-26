/**
 * sunStudy.ts — a real architectural sun study for the plan (pure).
 *
 * Genuine solar geometry: declination + hour angle give the sun's altitude
 * and azimuth for a date, hour and latitude. From that, this module derives
 * what a plan renderer needs — the horizontal direction sunlight travels in
 * plan space (north = −y, east = +x), a colour temperature that warms toward
 * the horizon, and the parallelogram of light a window opening projects onto
 * the floor (a patch that starts past the sill shadow and lengthens as the
 * sun sinks — exactly how morning light creeps across a real parquet).
 */

import type { Point, Wall } from '@/types'

export interface SunPosition {
  /** Degrees above the horizon (negative = night). */
  altitude: number
  /** Degrees from north, clockwise (90 = east, 180 = south). */
  azimuth: number
  /** Horizontal direction the LIGHT travels in plan space (unit, north = −y). */
  lightDir: Point
  /** 0…1 — sin(altitude), clamped. */
  intensity: number
}

const RAD = Math.PI / 180

/** Solar declination (deg) for a day of year (1…365). Cooper's formula. */
export function solarDeclination(dayOfYear: number): number {
  return 23.44 * Math.sin(((284 + dayOfYear) / 365) * 2 * Math.PI)
}

/**
 * The sun's position for a day-of-year, local solar hour (0–24) and latitude.
 * Plan convention: north = −y, east = +x.
 */
export function sunPosition(dayOfYear: number, hour: number, latitudeDeg = 51): SunPosition {
  const decl = solarDeclination(dayOfYear) * RAD
  const lat = latitudeDeg * RAD
  const hourAngle = (hour - 12) * 15 * RAD

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle)
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD

  const cosAz = (Math.sin(decl) - sinAlt * Math.sin(lat)) / (Math.cos(Math.asin(sinAlt)) * Math.cos(lat) || 1e-9)
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / RAD
  if (hourAngle > 0) azimuth = 360 - azimuth

  // Direction TOWARD the sun in plan space, then invert: light travels away.
  const towardX = Math.sin(azimuth * RAD)
  const towardY = -Math.cos(azimuth * RAD)
  return {
    altitude,
    azimuth,
    lightDir: { x: -towardX, y: -towardY },
    intensity: Math.max(0, sinAlt),
  }
}

/** Sunlight colour: warm amber at the horizon → near-white when high. */
export function sunColor(altitudeDeg: number): string {
  const t = Math.max(0, Math.min(1, altitudeDeg / 55))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  const r = mix(0xff, 0xff)
  const g = mix(0x9a, 0xf3)
  const b = mix(0x3c, 0xdf)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** The floor patch a window opening projects, or null when the sun can't cast one. */
export interface SunPatch {
  /** Parallelogram, plan cm: [nearA, nearB, farB, farA]. */
  quad: [Point, Point, Point, Point]
  /** Midpoint a hand's width into the patch — for the room-inside test. */
  probe: Point
}

/** Longest beam we render, cm — low sun otherwise streaks across the flat. */
const MAX_REACH_CM = 460

/**
 * Project a window's opening onto the floor. The lit band starts where the
 * sill's shadow ends (sill/tanα past the wall) and reaches to the head's
 * shadow ((sill+height)/tanα), along the horizontal light direction.
 */
export function windowLightPatch(window: Wall, sun: SunPosition): SunPatch | null {
  if ((window.subtype ?? 'wall') !== 'window') return null
  if (sun.altitude <= 2) return null

  const tanAlt = Math.tan(sun.altitude * RAD)
  const sill = window.openingSill ?? 90
  const height = window.openingHeight ?? 100
  const width = window.openingWidth ?? 120

  const near = Math.min(MAX_REACH_CM, sill / tanAlt)
  const far = Math.min(MAX_REACH_CM, (sill + height) / tanAlt)
  if (far - near < 4) return null

  // Opening: centred sub-segment of the wall, clamped to the wall's length.
  const dx = window.b.x - window.a.x
  const dy = window.b.y - window.a.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return null
  const ux = dx / len
  const uy = dy / len
  const half = Math.min(width, len) / 2
  const cx = (window.a.x + window.b.x) / 2
  const cy = (window.a.y + window.b.y) / 2
  const A = { x: cx - ux * half, y: cy - uy * half }
  const B = { x: cx + ux * half, y: cy + uy * half }

  const d = sun.lightDir
  const quad: [Point, Point, Point, Point] = [
    { x: A.x + d.x * near, y: A.y + d.y * near },
    { x: B.x + d.x * near, y: B.y + d.y * near },
    { x: B.x + d.x * far, y: B.y + d.y * far },
    { x: A.x + d.x * far, y: A.y + d.y * far },
  ]
  const mid = (near + far) / 2
  return { quad, probe: { x: cx + d.x * mid, y: cy + d.y * mid } }
}

/** Convex hull (Andrew's monotone chain). Returns points in CCW order. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length <= 2) return pts
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** Longest furniture shadow we render, cm. */
const MAX_SHADOW_CM = 380

/**
 * The soft shadow a piece of furniture throws in the sun: the convex hull of
 * its footprint and the footprint displaced along the light direction by
 * height/tan(altitude) — long in the evening, tucked-in at noon.
 */
export function sunShadowPolygon(footprint: Point[], sun: SunPosition, heightCm = 80): Point[] | null {
  if (sun.altitude <= 2 || footprint.length < 3) return null
  const reach = Math.min(MAX_SHADOW_CM, heightCm / Math.tan(sun.altitude * RAD))
  if (reach < 3) return null
  const d = sun.lightDir
  const displaced = footprint.map((p) => ({ x: p.x + d.x * reach, y: p.y + d.y * reach }))
  return convexHull([...footprint, ...displaced])
}

/** Sunrise/sunset hours (fractional, local solar time) for the day, by scan. */
export function sunTimes(dayOfYear: number, latitudeDeg = 51): { sunrise: number; sunset: number } {
  let sunrise = 6
  let sunset = 18
  let prev = sunPosition(dayOfYear, 0, latitudeDeg).altitude
  for (let h = 0.1; h <= 24; h += 0.1) {
    const alt = sunPosition(dayOfYear, h, latitudeDeg).altitude
    if (prev <= 0 && alt > 0) sunrise = h
    if (prev > 0 && alt <= 0) sunset = h
    prev = alt
  }
  return { sunrise: Math.round(sunrise * 10) / 10, sunset: Math.round(sunset * 10) / 10 }
}
