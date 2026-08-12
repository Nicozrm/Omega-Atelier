import { describe, it, expect } from 'vitest'
import {
  resolveSnap, projectOnSegment, constrainToAngle, collectVertices, snapLabel,
  type SnapOptions, type SnapSegment,
} from './snapEngine'

/** A 400×300 room, drawn off-grid on purpose — the case the grid cannot serve. */
const ROOM: SnapSegment[] = [
  { a: { x: 13, y: 7 }, b: { x: 413, y: 7 } },
  { a: { x: 413, y: 7 }, b: { x: 413, y: 307 } },
  { a: { x: 413, y: 307 }, b: { x: 13, y: 307 } },
  { a: { x: 13, y: 307 }, b: { x: 13, y: 7 } },
]

function opts(over: Partial<SnapOptions> = {}): SnapOptions {
  return {
    segments: ROOM, tolerance: 20, gridStep: 10, grid: true, magnet: true, ...over,
  }
}

describe('projectOnSegment', () => {
  const s: SnapSegment = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }

  it('finds the perpendicular foot inside the segment', () => {
    const r = projectOnSegment({ x: 40, y: 25 }, s)
    expect(r.point).toEqual({ x: 40, y: 0 })
    expect(r.t).toBeCloseTo(0.4, 10)
    expect(r.distance).toBeCloseTo(25, 10)
  })

  it('reports t outside 0…1 beyond the ends, without clamping', () => {
    expect(projectOnSegment({ x: 150, y: 0 }, s).t).toBeCloseTo(1.5, 10)
    expect(projectOnSegment({ x: -50, y: 0 }, s).t).toBeCloseTo(-0.5, 10)
  })

  it('treats a zero-length segment as a point instead of dividing by zero', () => {
    const degenerate: SnapSegment = { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }
    const r = projectOnSegment({ x: 8, y: 9 }, degenerate)
    expect(r.point).toEqual({ x: 5, y: 5 })
    expect(r.distance).toBeCloseTo(5, 10)
    expect(Number.isFinite(r.t)).toBe(true)
  })
})

describe('constrainToAngle', () => {
  const origin = { x: 0, y: 0 }

  it('rounds the direction to the step', () => {
    // 4° off horizontal, with a 15° step → straightened to 0°.
    const p = constrainToAngle(origin, { x: 100, y: 7 }, 15, 0)
    expect(p.y).toBeCloseTo(0, 8)
    expect(p.x).toBeCloseTo(Math.hypot(100, 7), 8)
  })

  it('rounds the length to the grid as well as the angle', () => {
    const p = constrainToAngle(origin, { x: 297, y: 2 }, 15, 10)
    expect(p).toEqual({ x: 300, y: 0 })
  })

  it('keeps the raw length when the grid is off', () => {
    const p = constrainToAngle(origin, { x: 297, y: 0 }, 15, 0)
    expect(p.x).toBeCloseTo(297, 8)
  })

  it('never collapses a short drag to zero length', () => {
    // Rounding 4 cm to a 10 cm grid would give 0 — a wall with no length.
    const p = constrainToAngle(origin, { x: 4, y: 0 }, 15, 10)
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 8)
  })

  it('returns the origin when there is no direction to constrain', () => {
    expect(constrainToAngle(origin, { x: 0, y: 0 }, 15, 10)).toEqual({ x: 0, y: 0 })
  })

  it('reaches the diagonals a 45° step should reach', () => {
    const p = constrainToAngle(origin, { x: 100, y: 96 }, 45, 0)
    expect(p.x).toBeCloseTo(p.y, 8)
  })
})

describe('collectVertices', () => {
  it('returns each corner once, however many walls meet there', () => {
    // Four walls, four shared corners — eight endpoints, four vertices.
    expect(collectVertices(ROOM)).toHaveLength(4)
  })

  it('treats coordinates within a tenth of a centimetre as the same corner', () => {
    const v = collectVertices([
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 0.02, y: 0 }, b: { x: 10, y: 5 } },
    ])
    expect(v).toHaveLength(3)
  })
})

describe('resolveSnap — priority between kinds', () => {
  it('prefers a distant corner over a near grid point', () => {
    // The defining rule. The cursor sits 1 cm from the grid point (20, 10) and
    // 8 cm from the real corner (13, 7): the corner must win, because a join
    // that is 1 cm out is a hole in the room.
    const r = resolveSnap({ x: 19, y: 11 }, opts())
    expect(r.kind).toBe('endpoint')
    expect(r.point).toEqual({ x: 13, y: 7 })
  })

  it('falls back to the grid when nothing is in reach', () => {
    const r = resolveSnap({ x: 203, y: 154 }, opts())
    expect(r.kind).toBe('grid')
    expect(r.point).toEqual({ x: 200, y: 150 })
  })

  it('returns the raw point when both snapping modes are off', () => {
    const r = resolveSnap({ x: 19, y: 11 }, opts({ grid: false, magnet: false }))
    expect(r.kind).toBe('none')
    expect(r.point).toEqual({ x: 19, y: 11 })
  })

  it('ignores geometry but keeps the grid when the magnet is off', () => {
    const r = resolveSnap({ x: 19, y: 11 }, opts({ magnet: false }))
    expect(r.kind).toBe('grid')
    expect(r.point).toEqual({ x: 20, y: 10 })
  })

  it('snaps to a corner even with the grid switched off', () => {
    const r = resolveSnap({ x: 19, y: 11 }, opts({ grid: false }))
    expect(r.kind).toBe('endpoint')
    expect(r.point).toEqual({ x: 13, y: 7 })
  })
})

describe('resolveSnap — geometry candidates', () => {
  it('takes the nearest corner when several are in range', () => {
    const near: SnapSegment[] = [
      { a: { x: 0, y: 0 }, b: { x: 30, y: 0 } },
      { a: { x: 30, y: 0 }, b: { x: 30, y: 30 } },
    ]
    const r = resolveSnap({ x: 26, y: 3 }, opts({ segments: near }))
    expect(r.point).toEqual({ x: 30, y: 0 })
  })

  it('snaps to a wall midpoint', () => {
    // Centre of the top wall is (213, 7); stay clear of both corners.
    const r = resolveSnap({ x: 215, y: 15 }, opts())
    expect(r.kind).toBe('midpoint')
    expect(r.point.x).toBeCloseTo(213, 8)
    expect(r.point.y).toBeCloseTo(7, 8)
  })

  it('snaps flush onto a wall face away from corner and midpoint', () => {
    const r = resolveSnap({ x: 120, y: 18 }, opts())
    expect(r.kind).toBe('segment')
    expect(r.point).toEqual({ x: 120, y: 7 })
    expect(r.anchor).toEqual({ x: 120, y: 7 })
  })

  it('continues a wall past its end, and says which wall', () => {
    // Beyond the top wall's right end (413, 7), still on its line.
    const r = resolveSnap({ x: 500, y: 12 }, opts({ segments: [ROOM[0]] }))
    expect(r.kind).toBe('extension')
    expect(r.point).toEqual({ x: 500, y: 7 })
    expect(r.guides).toEqual([{ kind: 'extension', a: { x: 413, y: 7 }, b: { x: 500, y: 7 } }])
  })

  it('stops extending one segment length past the end', () => {
    // The top wall is 400 long; 900 is well past the 813 cut-off, so the
    // extension must not reach — an unbounded line would carpet the canvas.
    const r = resolveSnap({ x: 900, y: 12 }, opts({ segments: [ROOM[0]], gridStep: 0, grid: false }))
    expect(r.kind).not.toBe('extension')
  })

  it('prefers a point on the wall to a point on its extension', () => {
    // Both candidates are genuinely in range at (150, 3): the vertical wall
    // passes through it, and the horizontal wall's extension runs 3 cm below.
    // Landing *on* geometry outranks landing on where geometry would go.
    const walls: SnapSegment[] = [
      { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },     // extension reaches x = 200
      { a: { x: 150, y: -10 }, b: { x: 150, y: 100 } }, // midpoint far from the test point
    ]
    const r = resolveSnap({ x: 150, y: 3 }, opts({ segments: walls, tolerance: 10 }))
    expect(r.kind).toBe('segment')
    expect(r.point).toEqual({ x: 150, y: 3 })
  })

  it('lines up with an existing corner on one axis', () => {
    const walls: SnapSegment[] = [{ a: { x: 137, y: 0 }, b: { x: 137, y: 40 } }]
    const r = resolveSnap({ x: 141, y: 600 }, opts({ segments: walls, tolerance: 10 }))
    expect(r.kind).toBe('axis')
    expect(r.point).toEqual({ x: 137, y: 600 })
    expect(r.guides).toHaveLength(1)
    expect(r.guides[0].kind).toBe('axis')
  })

  it('infers the corner where two alignments cross', () => {
    // This is how a rectangle closes exactly: the fourth corner exists in the
    // drawing (x from one wall, y from another) but in no wall's geometry.
    const walls: SnapSegment[] = [
      { a: { x: 100, y: 0 }, b: { x: 100, y: 10 } },
      { a: { x: 900, y: 500 }, b: { x: 910, y: 500 } },
    ]
    const r = resolveSnap({ x: 104, y: 496 }, opts({ segments: walls, tolerance: 10 }))
    expect(r.kind).toBe('axis')
    expect(r.point).toEqual({ x: 100, y: 500 })
    expect(r.guides).toHaveLength(2)
  })

  it('skips the wall the caller asks it to ignore', () => {
    // A wall being dragged must not snap to itself.
    const walls: SnapSegment[] = [{ a: { x: 13, y: 7 }, b: { x: 413, y: 7 } }]
    expect(resolveSnap({ x: 19, y: 11 }, opts({ segments: walls })).kind).toBe('endpoint')
    const r = resolveSnap({ x: 19, y: 11 }, opts({ segments: walls, ignore: () => true }))
    expect(r.kind).toBe('grid')
    expect(r.point).toEqual({ x: 20, y: 10 })
  })

  it('still infers a corner that no single wall owns', () => {
    // Removing both walls that meet at (13, 7) does not remove the *corner*:
    // the two remaining walls still supply an x and a y that cross there. That
    // is the axis candidate doing its job, not the endpoint snap leaking.
    const r = resolveSnap({ x: 19, y: 11 }, opts({
      ignore: (s) => (s.a.x === 13 && s.a.y === 7) || (s.b.x === 13 && s.b.y === 7),
    }))
    expect(r.kind).toBe('axis')
    expect(r.point).toEqual({ x: 13, y: 7 })
  })
})

describe('resolveSnap — angle', () => {
  const origin = { x: 0, y: 0 }

  it('obeys the lock outright, ignoring nearby geometry', () => {
    // A corner sits right under the cursor. Holding the lock means the user
    // asked for a direction, so the corner must not steal the point.
    const walls: SnapSegment[] = [{ a: { x: 300, y: 40 }, b: { x: 300, y: 80 } }]
    const r = resolveSnap({ x: 300, y: 40 }, opts({
      segments: walls, origin, angleLock: true, angleStep: 90, tolerance: 50,
    }))
    expect(r.kind).toBe('angle')
    expect(r.point.y).toBeCloseTo(0, 8)
    expect(r.guides[0]).toMatchObject({ kind: 'angle', a: origin })
  })

  it('needs no origin to be safe — the lock is simply inert', () => {
    const r = resolveSnap({ x: 203, y: 154 }, opts({ angleLock: true }))
    expect(r.kind).toBe('grid')
  })

  it('assists unlocked only when the cursor is already near the true ray', () => {
    const close = resolveSnap({ x: 400, y: 6 }, opts({
      segments: [], origin, angleStep: 90, tolerance: 20,
    }))
    expect(close.kind).toBe('angle')
    expect(close.point.y).toBeCloseTo(0, 8)

    const far = resolveSnap({ x: 400, y: 60 }, opts({
      segments: [], origin, angleStep: 90, tolerance: 20,
    }))
    expect(far.kind).toBe('grid')
  })

  it('tightens the window as the wall gets longer', () => {
    // Same half-degree error, two lengths. Measuring perpendicular offset
    // rather than angle is what keeps a long wall from drifting off true.
    const halfDegree = Math.tan((0.5 * Math.PI) / 180)
    const shortDrag = resolveSnap({ x: 100, y: 100 * halfDegree }, opts({
      segments: [], origin, angleStep: 90, tolerance: 5, grid: false, gridStep: 0,
    }))
    const longDrag = resolveSnap({ x: 2000, y: 2000 * halfDegree }, opts({
      segments: [], origin, angleStep: 90, tolerance: 5, grid: false, gridStep: 0,
    }))
    expect(shortDrag.kind).toBe('angle')
    expect(longDrag.kind).toBe('none')
  })

  it('defers to real geometry when unlocked', () => {
    // A corner within reach outranks a tidy angle — the join matters more.
    const walls: SnapSegment[] = [{ a: { x: 400, y: 3 }, b: { x: 400, y: 90 } }]
    const r = resolveSnap({ x: 400, y: 1 }, opts({
      segments: walls, origin, angleStep: 90, tolerance: 20,
    }))
    expect(r.kind).toBe('endpoint')
    expect(r.point).toEqual({ x: 400, y: 3 })
  })
})

describe('snapLabel', () => {
  it('names the kinds worth showing and stays quiet about the rest', () => {
    expect(snapLabel('endpoint')).toBe('Eckpunkt')
    expect(snapLabel('extension')).toBe('Verlängerung')
    expect(snapLabel('grid')).toBeNull()
    expect(snapLabel('none')).toBeNull()
  })
})
