import { describe, it, expect } from 'vitest'
import {
  pathLength, pointAt, insidePolygon, polygonAreaCm2, polygonCenter,
  planCoveragePath, planRooms, createVacuumRun,
  type VacPoint,
} from './vacuum'

const rect = (x: number, y: number, w: number, h: number): VacPoint[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
]

/** Drive a run for `seconds` in small steps (rAF-sized). */
function drive(run: ReturnType<typeof createVacuumRun>, seconds: number) {
  let s = run.state()
  for (let t = 0; t < seconds; t += 0.25) s = run.step(0.25)
  return s
}

describe('vacuum geometry', () => {
  it('measures polyline length and interpolates along it', () => {
    const pts: VacPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }]
    expect(pathLength(pts)).toBe(150)
    expect(pointAt(pts, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAt(pts, 50)).toEqual({ x: 50, y: 0 })
    expect(pointAt(pts, 125)).toEqual({ x: 100, y: 25 })
    expect(pointAt(pts, 999)).toEqual({ x: 100, y: 50 }) // clamped
  })

  it('classifies points against a polygon and measures its area', () => {
    const room = rect(0, 0, 400, 300)
    expect(insidePolygon({ x: 200, y: 150 }, room)).toBe(true)
    expect(insidePolygon({ x: 500, y: 150 }, room)).toBe(false)
    expect(polygonAreaCm2(room)).toBe(400 * 300)
    expect(polygonCenter(room)).toEqual({ x: 200, y: 150 })
  })
})

describe('planCoveragePath', () => {
  it('keeps the whole serpentine inside the room, inset by the margin', () => {
    const room = rect(0, 0, 400, 300)
    const path = planCoveragePath(room, 26, 16)
    expect(path.length).toBeGreaterThan(10)
    for (const p of path) {
      expect(p.x).toBeGreaterThanOrEqual(16)
      expect(p.x).toBeLessThanOrEqual(384)
      expect(p.y).toBeGreaterThanOrEqual(16)
      expect(p.y).toBeLessThanOrEqual(284)
      expect(insidePolygon(p, room)).toBe(true)
    }
  })

  it('spaces lanes by laneCm and alternates direction (boustrophedon)', () => {
    const path = planCoveragePath(rect(0, 0, 400, 300), 26, 16)
    const lanes = [...new Set(path.map((p) => p.y))]
    for (let i = 1; i < lanes.length; i++) expect(lanes[i] - lanes[i - 1]).toBeCloseTo(26, 6)
    // Lane 1 runs left→right, lane 2 right→left.
    expect(path[0].x).toBeLessThan(path[1].x)
    expect(path[2].x).toBeGreaterThan(path[3].x)
  })

  it('avoids the notch of an L-shaped room', () => {
    const lShape: VacPoint[] = [
      { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 },
      { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 },
    ]
    const path = planCoveragePath(lShape, 26, 16)
    expect(path.length).toBeGreaterThan(10)
    for (const p of path) {
      expect(insidePolygon(p, lShape)).toBe(true)
      // Nothing inside the cut-out quadrant.
      expect(p.x > 200 && p.y > 200).toBe(false)
    }
  })

  it('returns an empty plan for degenerate or too-small polygons', () => {
    expect(planCoveragePath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([])
    expect(planCoveragePath(rect(0, 0, 20, 20), 26, 16)).toEqual([])
  })
})

describe('planRooms', () => {
  it('cleans the nearest room first, then the next', () => {
    const near = rect(0, 0, 200, 200)
    const far = rect(600, 0, 200, 200)
    const path = planRooms([far, near], { x: 10, y: 10 })
    expect(path.length).toBeGreaterThan(4)
    // First stroke belongs to the near room, the last one to the far room.
    expect(insidePolygon(path[0], near)).toBe(true)
    expect(insidePolygon(path[path.length - 1], far)).toBe(true)
  })
})

describe('createVacuumRun', () => {
  const room = rect(0, 0, 300, 200)
  const path = planCoveragePath(room, 26, 16)
  const dock: VacPoint = { x: 0, y: 0 }

  it('starts docked at the dock with the given battery', () => {
    const s = createVacuumRun({ path, dock, batteryPercent: 84 }).state()
    expect(s.activity).toBe('docked')
    expect(s.position).toEqual(dock)
    expect(s.batteryPercent).toBe(84)
    expect(s.cleanedAreaM2).toBe(0)
    expect(s.progress).toBe(0)
  })

  it('first drives a transit leg to the path start without cleaning', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 30 })
    run.start()
    const s = run.step(0.25)
    expect(s.activity).toBe('cleaning')
    expect(s.progress).toBe(0) // still in transit
    expect(s.position).not.toEqual(dock) // but moving
  })

  it('cleans the plan, then returns and docks; area ≈ driven × swath', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 200, drainPerS: 0.01 })
    run.start()
    const s = drive(run, 120)
    expect(s.activity).toBe('docked')
    expect(s.position).toEqual(dock)
    expect(s.progress).toBe(1)
    expect(s.cleanedAreaM2).toBeCloseTo((pathLength(path) * 26) / 10_000, 0)
    expect(s.durationS).toBeGreaterThan(0)
    expect(s.trail.length).toBe(path.length) // full stroke painted
  })

  it('drains the battery while driving and recharges 4× on the dock', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 1, drainPerS: 0.5, batteryPercent: 80 })
    run.start()
    let s = run.state()
    for (let i = 0; i < 10; i++) s = run.step(1)
    expect(s.activity).toBe('cleaning')
    expect(s.batteryPercent).toBeCloseTo(75, 5) // 10 s × 0.5 %/s
    run.returnToDock()
    while (run.state().activity !== 'docked') run.step(0.25)
    const before = run.state().batteryPercent
    const after = run.step(1).batteryPercent
    expect(after - before).toBeCloseTo(2, 0) // 4 × 0.5 %/s (0.1-step rounding)
  })

  it('pauses and resumes from the same spot', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 50 })
    run.start()
    drive(run, 4)
    run.pause()
    const frozen = run.step(1)
    expect(frozen.activity).toBe('idle')
    const p1 = run.step(1).position
    expect(p1).toEqual(frozen.position)
    run.start()
    const resumed = drive(run, 2)
    expect(resumed.activity).toBe('cleaning')
    expect(resumed.position).not.toEqual(frozen.position)
  })

  it('heads home mid-run on returnToDock and refuses to start when empty', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 50 })
    run.start()
    drive(run, 3)
    run.returnToDock()
    const s = drive(run, 60)
    expect(s.activity).toBe('docked')
    expect(s.position).toEqual(dock)
    expect(s.progress).toBeLessThan(1)

    const empty = createVacuumRun({ path, dock, batteryPercent: 1 })
    empty.start()
    expect(empty.state().activity).toBe('docked')
  })

  it('aborts to the dock when the battery hits the reserve', () => {
    const run = createVacuumRun({ path, dock, speedCmS: 10, drainPerS: 5, batteryPercent: 10 })
    run.start()
    const s = drive(run, 30)
    expect(s.activity).toBe('docked')
    expect(s.progress).toBeLessThan(1)
  })

  it('setPace changes speed mid-run', () => {
    const slow = createVacuumRun({ path, dock, startPosition: pointAt(path, 0), speedCmS: 10 })
    slow.start()
    const fast = createVacuumRun({ path, dock, startPosition: pointAt(path, 0), speedCmS: 10 })
    fast.start()
    fast.setPace({ speedCmS: 60 })
    const a = drive(slow, 3)
    const b = drive(fast, 3)
    expect(b.progress).toBeGreaterThan(a.progress)
  })
})
