import { describe, it, expect } from 'vitest'
import {
  pointInPolygon, bbox, centroid, polygonArea, pathLength,
  coveragePath, buildRoute, flattenRoute, resample, orderRooms,
  type Pt,
} from './vacuumCoverage'

const rect = (w: number, h: number, ox = 0, oy = 0): Pt[] => [
  { x: ox, y: oy }, { x: ox + w, y: oy }, { x: ox + w, y: oy + h }, { x: ox, y: oy + h },
]

describe('vacuumCoverage geometry', () => {
  it('point-in-polygon', () => {
    const r = rect(100, 100)
    expect(pointInPolygon({ x: 50, y: 50 }, r)).toBe(true)
    expect(pointInPolygon({ x: 150, y: 50 }, r)).toBe(false)
  })
  it('bbox + centroid + area', () => {
    const r = rect(200, 100, 10, 20)
    expect(bbox(r)).toEqual({ minX: 10, minY: 20, maxX: 210, maxY: 120 })
    expect(centroid(r)).toEqual({ x: 110, y: 70 })
    expect(polygonArea(r)).toBe(20000)
  })
})

describe('coveragePath (boustrophedon)', () => {
  it('fills a rectangle with alternating lanes inside the inset', () => {
    const pts = coveragePath(rect(300, 200), 26, 16)
    expect(pts.length).toBeGreaterThan(4)
    // every point stays within the inset bounds
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(16 - 1e-6)
      expect(p.x).toBeLessThanOrEqual(300 - 16 + 1e-6)
      expect(p.y).toBeGreaterThanOrEqual(16 - 1e-6)
      expect(p.y).toBeLessThanOrEqual(200 - 16 + 1e-6)
    }
    // lanes alternate direction: first lane L→R, second R→L
    expect(pts[0].x).toBeLessThan(pts[1].x)
    expect(pts[2].x).toBeGreaterThan(pts[3].x)
  })
  it('covers a plausible fraction of the room length', () => {
    const pts = coveragePath(rect(400, 300), 26, 16)
    // ~ (300-32)/26 ≈ 10 lanes × ~368cm each → well over 2000cm
    expect(pathLength(pts)).toBeGreaterThan(2000)
  })
  it('returns nothing for a room smaller than the inset', () => {
    expect(coveragePath(rect(20, 20), 26, 16)).toEqual([])
  })
})

describe('route building', () => {
  const rooms = [
    { id: 'a', name: 'A', poly: rect(300, 200, 0, 0) },
    { id: 'b', name: 'B', poly: rect(300, 200, 400, 0) },
    { id: 'c', name: 'C', poly: rect(300, 200, 400, 400) },
  ]
  it('orders rooms nearest-neighbour from the dock', () => {
    const ordered = orderRooms(rooms, { x: 0, y: 0 })
    expect(ordered.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('builds one segment per non-trivial room', () => {
    const segs = buildRoute(rooms, { x: 0, y: 0 })
    expect(segs.length).toBe(3)
    expect(segs[0].area).toBe(60000)
    expect(segs.every((s) => s.points.length > 0)).toBe(true)
  })
  it('flattens to a continuous polyline starting at the dock', () => {
    const segs = buildRoute(rooms, { x: 5, y: 5 })
    const flat = flattenRoute({ x: 5, y: 5 }, segs)
    expect(flat[0]).toEqual({ x: 5, y: 5 })
    expect(flat.length).toBeGreaterThan(10)
  })
})

describe('resample', () => {
  it('produces evenly-stepped points along a straight line', () => {
    const out = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10)
    expect(out.length).toBeGreaterThanOrEqual(10)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 })
    // spacing ~10 between interior points
    expect(Math.abs(out[2].x - out[1].x)).toBeCloseTo(10, 4)
  })
})
