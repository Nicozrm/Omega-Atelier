/**
 * layout.ts — street-relative placement helpers.
 *
 * Detectors reason in a "front frame": `a` runs along the street, `b` runs
 * inward from the street edge (both increasing). {@link mapAB} projects that
 * frame into the local metric frame for whichever side the street is on, so the
 * building, driveway and garden logic is written once and stays orthogonal for
 * south/east/west-fronting lots.
 */

import type { LocalPoint, LocalPolygon, PropertyFeature } from './types'

export type StreetSide = PropertyFeature['streetSide']

export interface FrontFrame {
  /** Length parallel to the street. */
  alongLen: number
  /** Depth of the lot away from the street. */
  depthLen: number
}

/** Dimensions of the front frame for a lot of width W × depth D. */
export function frameOf(streetSide: StreetSide, widthM: number, depthM: number): FrontFrame {
  return streetSide === 'south' || streetSide === 'north'
    ? { alongLen: widthM, depthLen: depthM }
    : { alongLen: depthM, depthLen: widthM }
}

/** Project a front-frame coordinate (a along street, b inward) to local metres. */
export function mapAB(
  streetSide: StreetSide,
  widthM: number,
  depthM: number,
  a: number,
  b: number,
): LocalPoint {
  switch (streetSide) {
    case 'south':
      return { x: a, y: depthM - b }
    case 'north':
      return { x: a, y: b }
    case 'east':
      return { x: widthM - b, y: a }
    case 'west':
      return { x: b, y: a }
  }
}

/** Build a local, axis-aligned rectangle from a front-frame box. */
export function rectAB(
  streetSide: StreetSide,
  widthM: number,
  depthM: number,
  a0: number,
  b0: number,
  a1: number,
  b1: number,
): LocalPolygon {
  const p0 = mapAB(streetSide, widthM, depthM, a0, b0)
  const p1 = mapAB(streetSide, widthM, depthM, a1, b1)
  const xMin = Math.min(p0.x, p1.x)
  const yMin = Math.min(p0.y, p1.y)
  const xMax = Math.max(p0.x, p1.x)
  const yMax = Math.max(p0.y, p1.y)
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax },
  ]
}

/** Clamp a value into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
