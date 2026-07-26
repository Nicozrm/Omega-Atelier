import { describe, it, expect } from 'vitest'
import { computeFloorStack, stackSpan } from './floorStack'

const floors = [
  { id: 'ug', index: -1 },
  { id: 'eg', index: 0 },
  { id: 'og', index: 1 },
  { id: 'dg', index: 2 },
]

describe('computeFloorStack', () => {
  it('anchors the active floor at 0 and displaces the rest by storey gap', () => {
    const levels = computeFloorStack(floors, 'eg', 4)
    expect(levels.map((l) => l.id)).toEqual(['ug', 'eg', 'og', 'dg']) // sorted bottom→top
    const by = Object.fromEntries(levels.map((l) => [l.id, l.yOffset]))
    expect(by).toEqual({ ug: -4, eg: 0, og: 4, dg: 8 })
    expect(levels.filter((l) => l.active).map((l) => l.id)).toEqual(['eg'])
  })

  it('re-anchors when a different floor is active', () => {
    const levels = computeFloorStack(floors, 'og', 4)
    const by = Object.fromEntries(levels.map((l) => [l.id, l.yOffset]))
    expect(by).toEqual({ ug: -8, eg: -4, og: 0, dg: 4 })
  })

  it('offsets increase monotonically with storey index', () => {
    const levels = computeFloorStack(floors, 'eg', 3.5)
    for (let i = 1; i < levels.length; i++) expect(levels[i].yOffset).toBeGreaterThan(levels[i - 1].yOffset)
  })

  it('handles a single floor and an unknown active id', () => {
    expect(computeFloorStack([{ id: 'only', index: 0 }], 'only', 4)).toEqual([{ id: 'only', index: 0, yOffset: 0, active: true }])
    // unknown active → anchor at index 0, nothing marked active
    const levels = computeFloorStack(floors, 'nope', 4)
    expect(levels.find((l) => l.id === 'eg')!.yOffset).toBe(0)
    expect(levels.some((l) => l.active)).toBe(false)
  })
})

describe('stackSpan', () => {
  it('is the vertical extent between the lowest and highest level', () => {
    expect(stackSpan(computeFloorStack(floors, 'eg', 4))).toBe(12) // -4 … 8
    expect(stackSpan([])).toBe(0)
  })
})
