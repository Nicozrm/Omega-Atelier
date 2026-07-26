import { describe, it, expect } from 'vitest'
import { projectFrom, distToSegment, shadowQuad } from './shadow2d'

describe('projectFrom', () => {
  it('projects a point radially to the requested distance', () => {
    const p = projectFrom({ x: 0, y: 0 }, { x: 10, y: 0 }, 100)!
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(0)
  })
  it('keeps the direction for diagonal points', () => {
    const p = projectFrom({ x: 0, y: 0 }, { x: 3, y: 4 }, 10)!
    expect(p.x).toBeCloseTo(6)
    expect(p.y).toBeCloseTo(8)
  })
  it('returns null when the point coincides with the light', () => {
    expect(projectFrom({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toBeNull()
  })
})

describe('distToSegment', () => {
  it('measures perpendicular distance inside the span', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3)
  })
  it('measures to the nearest endpoint outside the span', () => {
    expect(distToSegment({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5)
  })
  it('handles degenerate (point) segments', () => {
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5)
  })
})

describe('shadowQuad', () => {
  const light = { x: 0, y: 0 }
  it('builds [a, b, b→reach, a→reach] for a wall inside the pool', () => {
    const q = shadowQuad(light, { x: 50, y: -20 }, { x: 50, y: 20 }, 100, 220)!
    expect(q[0]).toEqual({ x: 50, y: -20 })
    expect(q[1]).toEqual({ x: 50, y: 20 })
    // Projections lie beyond the wall, radially outward at distance `reach`.
    expect(Math.hypot(q[2].x, q[2].y)).toBeCloseTo(220)
    expect(Math.hypot(q[3].x, q[3].y)).toBeCloseTo(220)
    expect(q[2].x).toBeGreaterThan(50)
    expect(q[3].x).toBeGreaterThan(50)
  })
  it('returns null for a wall entirely outside the pool radius', () => {
    expect(shadowQuad(light, { x: 500, y: -20 }, { x: 500, y: 20 }, 100, 220)).toBeNull()
  })
  it('returns null when the light sits on a wall endpoint', () => {
    expect(shadowQuad(light, { x: 0, y: 0 }, { x: 50, y: 0 }, 100, 220)).toBeNull()
  })
})
