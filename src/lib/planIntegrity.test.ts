import { describe, it, expect } from 'vitest'
import type { Floor, PlacedFurniture } from '@/types'
import {
  furnitureFootprint,
  isPool,
  obbCorners,
  obbPenetration,
  checkFloorIntegrity,
  checkPlanIntegrity,
} from './planIntegrity'

// ── fixtures ────────────────────────────────────────────────
const fu = (furnitureId: string, x: number, y: number, size: [number, number], rotation = 0): PlacedFurniture =>
  ({ id: `${furnitureId}-${x}-${y}`, furnitureId, position: { x, y }, rotation, size })

const floor = (furniture: PlacedFurniture[], extra: Partial<Floor> = {}): Floor => ({
  id: 'f', name: 'Test', index: 0,
  rooms: [], walls: [], devices: [], furniture, labels: [],
  layers: { walls: true, furniture: true, devices: true, labels: true },
  extent: { width: 1000, height: 1000 },
  ...extra,
})

// A small category table for the layering rule.
const categoryOf = (id: string) =>
  ({ 'chair-dining': 'chair', 'table-dining': 'table', 'sofa-corner': 'sofa', 'plant-large': 'other' } as Record<string, string>)[id]

describe('furnitureFootprint', () => {
  it('rugs and mats lie flat (never collide)', () => {
    expect(furnitureFootprint('rug-large', [250, 350])).toBe('flat')
    expect(furnitureFootprint('fur-rug', [110, 85])).toBe('flat')
    expect(furnitureFootprint('bath-mat', [70, 50])).toBe('flat')
  })
  it('thin panels and ceiling pieces are mounted (above the floor)', () => {
    expect(furnitureFootprint('wall-art', [90, 4])).toBe('mounted')
    expect(furnitureFootprint('mirror', [60, 4])).toBe('mounted')
    expect(furnitureFootprint('pendant-lamp', [34, 34])).toBe('mounted')
    expect(furnitureFootprint('gym-rings', [40, 20])).toBe('mounted')
  })
  it('everything floor-standing is solid', () => {
    expect(furnitureFootprint('sofa-corner', [300, 220])).toBe('solid')
    expect(furnitureFootprint('pool-small', [400, 200])).toBe('solid')
    expect(furnitureFootprint('fridge', [60, 65])).toBe('solid')
  })
  it('recognises pools by id', () => {
    expect(isPool('pool-small')).toBe(true)
    expect(isPool('sofa-corner')).toBe(false)
  })
})

describe('obbPenetration', () => {
  it('is 0 for separated boxes and positive for overlapping ones', () => {
    const a = obbCorners(0, 0, 100, 100, 0)
    expect(obbPenetration(a, obbCorners(300, 0, 100, 100, 0))).toBe(0) // apart
    expect(obbPenetration(a, obbCorners(100, 0, 100, 100, 0))).toBe(0) // edge-to-edge touch
    expect(obbPenetration(a, obbCorners(60, 0, 100, 100, 0))).toBeCloseTo(40, 5) // 40cm deep
  })
  it('accounts for rotation', () => {
    // A 100×20 bar rotated 90° becomes 20 wide × 100 tall — now it reaches a
    // box 40cm away on the y-axis that the un-rotated bar would have missed.
    const box = obbCorners(0, 60, 40, 40, 0)
    expect(obbPenetration(obbCorners(0, 0, 100, 20, 0), box)).toBe(0)
    expect(obbPenetration(obbCorners(0, 0, 100, 20, 90), box)).toBeGreaterThan(0)
  })
})

describe('checkFloorIntegrity', () => {
  it('flags two solid pieces stacking into each other', () => {
    const issues = checkFloorIntegrity(floor([fu('sofa-corner', 200, 200, [200, 100]), fu('sofa-corner', 260, 200, [200, 100])]))
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('furniture-overlap')
    expect(issues[0].amount).toBeGreaterThan(3)
  })

  it('ignores flat and mounted pieces overlapping solids (rug under sofa, art on wall)', () => {
    const issues = checkFloorIntegrity(floor([
      fu('sofa-corner', 200, 200, [200, 100]),
      fu('rug-large', 200, 200, [260, 200]),
      fu('wall-art', 200, 150, [120, 4]),
    ]))
    expect(issues).toHaveLength(0)
  })

  it('always reports furniture sitting inside a pool, even seating', () => {
    const issues = checkFloorIntegrity(floor([fu('pool-small', 300, 300, [400, 200]), fu('sofa-corner', 300, 300, [80, 80])]))
    expect(issues.map((i) => i.kind)).toContain('furniture-in-pool')
  })

  it('excuses an intended layering (a chair tucked under its table)', () => {
    const withCat = checkFloorIntegrity(
      floor([fu('table-dining', 300, 300, [200, 100]), fu('chair-dining', 300, 240, [45, 50])]),
      { categoryOf },
    )
    expect(withCat).toHaveLength(0)
    // …but the very same geometry is a defect between two pieces that never nest.
    const noNest = checkFloorIntegrity(
      floor([fu('plant-large', 300, 300, [200, 100]), fu('plant-large', 300, 240, [45, 50])]),
      { categoryOf },
    )
    expect(noNest.some((i) => i.kind === 'furniture-overlap')).toBe(true)
  })

  it('flags a door or window wider than its wall', () => {
    const issues = checkFloorIntegrity(floor([], {
      walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 14, subtype: 'door', openingWidth: 95 }],
    }))
    expect(issues).toHaveLength(1)
    expect(issues[0].kind).toBe('opening-overflow')
  })

  it('accepts an opening that fits with reveals on both sides', () => {
    const issues = checkFloorIntegrity(floor([], {
      walls: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, thickness: 14, subtype: 'door', openingWidth: 80 }],
    }))
    expect(issues).toHaveLength(0)
  })

  it('flags a solid piece spilling outside the floor envelope', () => {
    const issues = checkFloorIntegrity(floor([fu('sofa-corner', 980, 500, [100, 100])])) // extent 1000 → 30cm out
    expect(issues.some((i) => i.kind === 'furniture-out-of-bounds')).toBe(true)
  })

  it('passes a clean floor', () => {
    expect(checkFloorIntegrity(floor([fu('sofa-corner', 200, 200, [200, 100]), fu('sofa-corner', 600, 200, [200, 100])]))).toHaveLength(0)
  })
})

describe('checkPlanIntegrity', () => {
  it('aggregates issues across every floor', () => {
    const bad = floor([fu('pool-small', 300, 300, [400, 200]), fu('sofa-corner', 300, 300, [80, 80])])
    const good = floor([fu('sofa-corner', 200, 200, [200, 100])])
    const doc = { floors: [good, bad] } as unknown as Parameters<typeof checkPlanIntegrity>[0]
    expect(checkPlanIntegrity(doc).length).toBeGreaterThan(0)
  })
})
