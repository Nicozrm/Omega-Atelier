/**
 * Image Blaster 3D — default placement inside the floor plan.
 *
 * Pure geometry over plan types: wall art snaps to the midpoint of a room's
 * longest polygon edge (facing into the room), floor objects go to the room
 * centroid. All coordinates are plan-space cm; rotation follows the 3D-view
 * convention worldNormal = (sin θ, cos θ) in plan (x, y).
 */

import type { Point, Room } from '@/types'

export interface Placement {
  position: Point
  /** Degrees around the vertical axis; 0 = asset faces plan +y. */
  rotation: number
}

export function polygonCentroid(polygon: Point[]): Point {
  // Area-weighted centroid; falls back to the vertex mean for degenerate rings.
  let areaSum = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const cross = p.x * q.y - q.x * p.y
    areaSum += cross
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  if (Math.abs(areaSum) < 1e-9) {
    const n = polygon.length || 1
    return {
      x: polygon.reduce((s, p) => s + p.x, 0) / n,
      y: polygon.reduce((s, p) => s + p.y, 0) / n,
    }
  }
  return { x: cx / (3 * areaSum), y: cy / (3 * areaSum) }
}

export function polygonArea2D(polygon: Point[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    area += p.x * q.y - q.x * p.y
  }
  return Math.abs(area) / 2
}

/** Room with the largest polygon area, or null when there are none. */
export function largestRoom(rooms: Room[]): Room | null {
  let best: Room | null = null
  let bestArea = -1
  for (const r of rooms) {
    const a = polygonArea2D(r.polygon)
    if (a > bestArea) { bestArea = a; best = r }
  }
  return best
}

/**
 * Wall-art placement: midpoint of the room's longest edge, nudged into the
 * room by `inset` cm, rotated so the artwork faces the room centroid.
 */
export function wallArtPlacement(room: Room, inset = 6): Placement {
  const poly = room.polygon
  const centroid = polygonCentroid(poly)
  let bestLen = -1
  let mid: Point = centroid
  let normal = { x: 0, y: 1 }
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const len = Math.hypot(dx, dy)
    if (len <= bestLen) continue
    bestLen = len
    mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
    // Edge normal; flip it toward the centroid so the art faces inward.
    let nx = -dy / (len || 1)
    let ny = dx / (len || 1)
    if (nx * (centroid.x - mid.x) + ny * (centroid.y - mid.y) < 0) { nx = -nx; ny = -ny }
    normal = { x: nx, y: ny }
  }
  return {
    position: { x: mid.x + normal.x * inset, y: mid.y + normal.y * inset },
    rotation: (Math.atan2(normal.x, normal.y) * 180) / Math.PI,
  }
}

/** Floor-object placement: room centroid, facing plan +y. */
export function floorObjectPlacement(room: Room): Placement {
  return { position: polygonCentroid(room.polygon), rotation: 180 }
}

/** Inward-facing placement on ONE polygon edge (see wallArtPlacement). */
function edgePlacement(room: Room, edgeIndex: number, inset: number): Placement {
  const poly = room.polygon
  const centroid = polygonCentroid(poly)
  const p = poly[edgeIndex % poly.length]
  const q = poly[(edgeIndex + 1) % poly.length]
  const dx = q.x - p.x
  const dy = q.y - p.y
  const len = Math.hypot(dx, dy) || 1
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  let nx = -dy / len
  let ny = dx / len
  if (nx * (centroid.x - mid.x) + ny * (centroid.y - mid.y) < 0) { nx = -nx; ny = -ny }
  return {
    position: { x: mid.x + nx * inset, y: mid.y + ny * inset },
    rotation: (Math.atan2(nx, ny) * 180) / Math.PI,
  }
}

/**
 * Cycle wall art to the next wall of its room: finds the edge whose midpoint
 * placement is closest to `currentPos`, then returns the placement on the
 * following polygon edge. Skips edges shorter than `minEdge` cm (door gaps,
 * corner cuts) as long as at least one edge qualifies.
 */
export function nextWallPlacement(room: Room, currentPos: Point, inset = 6, minEdge = 80): Placement {
  const poly = room.polygon
  const n = poly.length
  const edgeLen = (i: number) => {
    const p = poly[i % n]
    const q = poly[(i + 1) % n]
    return Math.hypot(q.x - p.x, q.y - p.y)
  }
  const usable = Array.from({ length: n }, (_, i) => i).filter((i) => edgeLen(i) >= minEdge)
  const candidates = usable.length > 0 ? usable : Array.from({ length: n }, (_, i) => i)

  let nearest = candidates[0]
  let bestDist = Infinity
  for (const i of candidates) {
    const pl = edgePlacement(room, i, inset)
    const d = Math.hypot(pl.position.x - currentPos.x, pl.position.y - currentPos.y)
    if (d < bestDist) { bestDist = d; nearest = i }
  }
  const next = candidates[(candidates.indexOf(nearest) + 1) % candidates.length]
  return edgePlacement(room, next, inset)
}
