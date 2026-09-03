import { describe, it, expect } from 'vitest'
import {
  polygonBBox, rotatePolygon, normalizePolygon, convexHull, orientedBounds,
} from './geo'
import type { LocalPolygon } from './types'

/** A 20 × 10 m rectangle, axis-aligned, anchored away from the origin. */
const RECT: LocalPolygon = [
  { x: 5, y: 3 }, { x: 25, y: 3 }, { x: 25, y: 13 }, { x: 5, y: 13 },
]

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('polygonBBox', () => {
  it('measures the axis-aligned extent', () => {
    expect(polygonBBox(RECT)).toEqual({ minX: 5, minY: 3, maxX: 25, maxY: 13 })
  })

  it('returns a zero box for an empty polygon rather than NaN or Infinity', () => {
    const b = polygonBBox([])
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
    for (const v of Object.values(b)) expect(Number.isFinite(v)).toBe(true)
  })

  it('collapses to a point for a single vertex', () => {
    expect(polygonBBox([{ x: 4, y: -2 }])).toEqual({ minX: 4, minY: -2, maxX: 4, maxY: -2 })
  })
})

describe('rotatePolygon', () => {
  it('is the identity at zero', () => {
    expect(rotatePolygon(RECT, 0)).toEqual(RECT)
  })

  it('rotates x toward y for a positive angle', () => {
    const [p] = rotatePolygon([{ x: 1, y: 0 }], Math.PI / 2)
    expect(approx(p.x, 0)).toBe(true)
    expect(approx(p.y, 1)).toBe(true)
  })

  it('preserves area and returns to the original after a full turn', () => {
    const round = rotatePolygon(rotatePolygon(RECT, Math.PI), Math.PI)
    for (let i = 0; i < RECT.length; i++) {
      expect(approx(round[i].x, RECT[i].x, 1e-9)).toBe(true)
      expect(approx(round[i].y, RECT[i].y, 1e-9)).toBe(true)
    }
  })
})

describe('normalizePolygon', () => {
  it('anchors the bounding box at the origin without changing the shape', () => {
    const n = normalizePolygon(RECT)
    const b = polygonBBox(n)
    expect(b.minX).toBe(0)
    expect(b.minY).toBe(0)
    expect(b.maxX).toBe(20)
    expect(b.maxY).toBe(10)
  })

  it('is idempotent', () => {
    expect(normalizePolygon(normalizePolygon(RECT))).toEqual(normalizePolygon(RECT))
  })
})

describe('convexHull', () => {
  it('drops interior points', () => {
    const withInterior = [...RECT, { x: 15, y: 8 }, { x: 10, y: 5 }]
    const hull = convexHull(withInterior)
    expect(hull).toHaveLength(4)
    for (const p of hull) {
      expect(RECT.some((r) => r.x === p.x && r.y === p.y)).toBe(true)
    }
  })

  it('passes degenerate input straight through', () => {
    expect(convexHull([])).toEqual([])
    expect(convexHull([{ x: 1, y: 1 }])).toHaveLength(1)
    expect(convexHull([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toHaveLength(2)
  })

  it('keeps only the extremes of a collinear run', () => {
    const line = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]
    expect(convexHull(line).length).toBeLessThanOrEqual(2)
  })
})

describe('orientedBounds', () => {
  it('recovers the exact dimensions of an axis-aligned rectangle', () => {
    const ob = orientedBounds(RECT)
    const dims = [ob.widthM, ob.depthM].sort((a, b) => a - b)
    expect(approx(dims[0], 10, 1e-9)).toBe(true)
    expect(approx(dims[1], 20, 1e-9)).toBe(true)
    expect(approx(ob.areaSqm, 200, 1e-9)).toBe(true)
  })

  it('recovers them for a rotated rectangle — the whole point of the function', () => {
    // 30° is exactly the case an axis-aligned box gets wrong.
    const rotated = rotatePolygon(RECT, Math.PI / 6)
    const ob = orientedBounds(rotated)
    const dims = [ob.widthM, ob.depthM].sort((a, b) => a - b)
    expect(approx(dims[0], 10, 1e-6)).toBe(true)
    expect(approx(dims[1], 20, 1e-6)).toBe(true)
    expect(approx(ob.areaSqm, 200, 1e-6)).toBe(true)
  })

  it('beats the axis-aligned bounding box on a rotated plot', () => {
    const rotated = rotatePolygon(RECT, Math.PI / 6)
    const bb = polygonBBox(rotated)
    const bbArea = (bb.maxX - bb.minX) * (bb.maxY - bb.minY)
    expect(orientedBounds(rotated).areaSqm).toBeLessThan(bbArea * 0.95)
  })

  it('is invariant to rotation of the input', () => {
    const areas = [0, 0.3, 1.1, 2.4, 5.0].map(
      (a) => orientedBounds(rotatePolygon(RECT, a)).areaSqm,
    )
    for (const a of areas) expect(approx(a, 200, 1e-6)).toBe(true)
  })

  it('never reports less area than the polygon it encloses', () => {
    const pentagon: LocalPolygon = [
      { x: 0, y: 0 }, { x: 12, y: 2 }, { x: 16, y: 11 }, { x: 6, y: 15 }, { x: -2, y: 8 },
    ]
    // Shoelace area of the pentagon itself.
    let a2 = 0
    for (let i = 0, j = pentagon.length - 1; i < pentagon.length; j = i++) {
      a2 += pentagon[j].x * pentagon[i].y - pentagon[i].x * pentagon[j].y
    }
    expect(orientedBounds(pentagon).areaSqm).toBeGreaterThanOrEqual(Math.abs(a2 / 2) - 1e-9)
  })

  it('degrades gracefully for fewer than three points', () => {
    const ob = orientedBounds([{ x: 0, y: 0 }, { x: 4, y: 0 }])
    expect(ob.angle).toBe(0)
    expect(ob.widthM).toBe(4)
    expect(ob.depthM).toBe(0)
    expect(Number.isFinite(ob.areaSqm)).toBe(true)
  })
})
