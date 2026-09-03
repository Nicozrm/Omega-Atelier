import { describe, it, expect } from 'vitest'
import { lightScore, selectLights, assignSlots, lightBudgetForProfile, type PointLightSpec } from './lightBudget'
import { RENDER_PROFILES } from './quality'

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

describe('lightBudgetForProfile', () => {
  it('honours the profile budget verbatim', () => {
    // The four shipped profiles, so a change to RENDER_PROFILES that the rig
    // cannot carry shows up here rather than as a stutter on someone's laptop.
    expect(lightBudgetForProfile(RENDER_PROFILES.ultra.maxDynamicLights)).toBe(24)
    expect(lightBudgetForProfile(RENDER_PROFILES.high.maxDynamicLights)).toBe(16)
    expect(lightBudgetForProfile(RENDER_PROFILES.balanced.maxDynamicLights)).toBe(10)
    expect(lightBudgetForProfile(RENDER_PROFILES.performance.maxDynamicLights)).toBe(6)
  })

  it('keeps at least one slot, so a single-lamp plan is still lit', () => {
    expect(lightBudgetForProfile(0)).toBe(1)
    expect(lightBudgetForProfile(-5)).toBe(1)
    expect(lightBudgetForProfile(Number.NaN)).toBe(1)
  })

  it('yields a whole number of slots — the pool is an array length', () => {
    expect(lightBudgetForProfile(7.9)).toBe(7)
  })
})

describe('assignSlots', () => {
  it('fills empty slots with the selection', () => {
    expect(assignSlots([null, null, null], ['a', 'b'])).toEqual(['a', 'b', null])
  })

  it('keeps a retained source in the slot it already holds', () => {
    // 'b' stays selected but is now ranked first; it must not move slots.
    expect(assignSlots(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual(['a', 'b', 'c'])
  })

  it('is stable under arbitrary reordering of the same set', () => {
    const current = ['a', 'b', 'c', 'd']
    for (const order of [['d', 'c', 'b', 'a'], ['b', 'd', 'a', 'c'], ['c', 'a', 'd', 'b']]) {
      expect(assignSlots(current, order)).toEqual(current)
    }
  })

  it('drops a source that left the selection and frees its slot', () => {
    expect(assignSlots(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', null, 'c'])
  })

  it('hands a freed slot to the newcomer that replaced it', () => {
    expect(assignSlots(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual(['a', 'd', 'c'])
  })

  it('never returns more slots than it was given', () => {
    expect(assignSlots([null, null], ['a', 'b', 'c', 'd'])).toHaveLength(2)
  })

  it('never assigns the same source to two slots', () => {
    const next = assignSlots(['a', null, 'b'], ['a', 'b', 'c'])
    const used = next.filter((k): k is string => k !== null)
    expect(new Set(used).size).toBe(used.length)
  })

  it('idles every slot when nothing is selected', () => {
    expect(assignSlots(['a', 'b'], [])).toEqual([null, null])
  })

  it('reaches a fixed point — reapplying the same selection changes nothing', () => {
    const first = assignSlots([null, null, null], ['x', 'y'])
    expect(assignSlots(first, ['y', 'x'])).toEqual(first)
  })
})
