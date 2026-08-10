import { describe, it, expect } from 'vitest'
import { lightScore, selectLights, lightBudgetForTier, type PointLightSpec } from './lightBudget'

const spec = (over: Partial<PointLightSpec> & { key: string }): PointLightSpec => ({
  position: [0, 0, 0],
  color: '#ffffff',
  intensity: 1,
  distance: 5,
  decay: 2,
  priority: 1,
  ...over,
})

describe('lightScore', () => {
  it('scores a light the camera stands inside at full strength', () => {
    const s = spec({ key: 'a', position: [0, 0, 0], distance: 5 })
    // Camera 3 m away, inside the 5 m influence sphere → no falloff.
    expect(lightScore(s, [3, 0, 0])).toBeCloseTo(1, 6)
  })

  it('falls off with distance to the influence sphere, not the centre', () => {
    const s = spec({ key: 'a', position: [0, 0, 0], distance: 5 })
    const inside = lightScore(s, [4, 0, 0])
    const justOutside = lightScore(s, [6, 0, 0])
    const farOutside = lightScore(s, [10, 0, 0])
    expect(inside).toBeGreaterThan(justOutside)
    expect(justOutside).toBeGreaterThan(farOutside)
    // 1 m beyond the sphere → 1 / (1 + 1²)
    expect(justOutside).toBeCloseTo(0.5, 6)
  })

  it('treats distance 0 as unbounded influence', () => {
    const s = spec({ key: 'a', position: [0, 0, 0], distance: 0 })
    expect(lightScore(s, [50, 0, 0])).toBeCloseTo(1, 6)
  })

  it('ranks a high-priority luminaire over an ambient wash at equal distance', () => {
    const lamp = spec({ key: 'lamp', priority: 1.0 })
    const cove = spec({ key: 'cove', priority: 0.45 })
    expect(lightScore(lamp, [20, 0, 0])).toBeGreaterThan(lightScore(cove, [20, 0, 0]))
  })

  it('scores dark and disabled sources at zero', () => {
    expect(lightScore(spec({ key: 'off', intensity: 0 }), [0, 0, 0])).toBe(0)
    expect(lightScore(spec({ key: 'muted', priority: 0 }), [0, 0, 0])).toBe(0)
  })
})

describe('selectLights', () => {
  const near = spec({ key: 'near', position: [0, 0, 0] })
  const mid = spec({ key: 'mid', position: [20, 0, 0] })
  const far = spec({ key: 'far', position: [60, 0, 0] })

  it('keeps only the budget-many most relevant sources', () => {
    const picked = selectLights({ sources: [far, near, mid], camera: [0, 0, 0], budget: 2 })
    expect(picked.map((p) => p.key)).toEqual(['near', 'mid'])
  })

  it('never returns more than the sources available', () => {
    const picked = selectLights({ sources: [near], camera: [0, 0, 0], budget: 8 })
    expect(picked).toHaveLength(1)
  })

  it('selects nothing for a non-positive budget', () => {
    expect(selectLights({ sources: [near, mid], camera: [0, 0, 0], budget: 0 })).toEqual([])
  })

  it('drops sources that cannot contribute light', () => {
    const dark = spec({ key: 'dark', intensity: 0 })
    const picked = selectLights({ sources: [dark, near], camera: [0, 0, 0], budget: 8 })
    expect(picked.map((p) => p.key)).toEqual(['near'])
  })

  it('breaks ties deterministically by key', () => {
    const a = spec({ key: 'b', position: [1, 0, 0] })
    const b = spec({ key: 'a', position: [1, 0, 0] })
    const first = selectLights({ sources: [a, b], camera: [0, 0, 0], budget: 1 })
    const second = selectLights({ sources: [b, a], camera: [0, 0, 0], budget: 1 })
    expect(first.map((p) => p.key)).toEqual(['a'])
    expect(second.map((p) => p.key)).toEqual(first.map((p) => p.key))
  })

  it('lets an incumbent hold its slot against a marginally better challenger', () => {
    // Challenger is ~10 % better — below the 25 % margin, so the pool stays put.
    const incumbent = spec({ key: 'incumbent', position: [6.0, 0, 0], distance: 5 })
    const challenger = spec({ key: 'challenger', position: [5.9, 0, 0], distance: 5 })
    const picked = selectLights({
      sources: [incumbent, challenger],
      camera: [0, 0, 0],
      budget: 1,
      previous: ['incumbent'],
    })
    expect(picked.map((p) => p.key)).toEqual(['incumbent'])
  })

  it('displaces an incumbent once a challenger clears the margin', () => {
    const incumbent = spec({ key: 'incumbent', position: [40, 0, 0] })
    const challenger = spec({ key: 'challenger', position: [1, 0, 0] })
    const picked = selectLights({
      sources: [incumbent, challenger],
      camera: [0, 0, 0],
      budget: 1,
      previous: ['incumbent'],
    })
    expect(picked.map((p) => p.key)).toEqual(['challenger'])
  })

  it('is stable across repeated evaluations from the same viewpoint', () => {
    const sources = [near, mid, far]
    let previous: string[] = []
    for (let i = 0; i < 5; i++) {
      const picked = selectLights({ sources, camera: [5, 2, 5], budget: 2, previous })
      previous = picked.map((p) => p.key)
    }
    expect(previous).toEqual(['near', 'mid'])
  })
})

describe('lightBudgetForTier', () => {
  it('scales the pool with the tier', () => {
    expect(lightBudgetForTier('high')).toBe(8)
    expect(lightBudgetForTier('low')).toBe(4)
    expect(lightBudgetForTier('off')).toBe(2)
  })
})
