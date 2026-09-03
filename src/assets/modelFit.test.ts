import { describe, it, expect } from 'vitest'
import { fitScale, anchorOffsetY, CEILING_HEIGHT, WALL_MOUNT_HEIGHT } from './modelFit'

describe('fitScale', () => {
  it('scales a model down to sit inside a smaller footprint', () => {
    // 1 m square model into a 0.5 m square slot.
    expect(fitScale([1, 1, 1], 0.5, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('scales a model up into a larger footprint', () => {
    // The measured plant: 0.50 × 0.45 footprint into a 1.0 × 1.0 slot.
    expect(fitScale([0.5, 0.72, 0.45], 1.0, 1.0)).toBeCloseTo(2.0, 6)
  })

  it('never overflows the footprint — the tighter axis wins', () => {
    // Wide-but-shallow slot: depth is binding, so width must come in under.
    const scale = fitScale([1, 1, 1], 2.0, 0.5)
    expect(scale).toBeCloseTo(0.5, 6)
    expect(1 * scale).toBeLessThanOrEqual(2.0)
    expect(1 * scale).toBeLessThanOrEqual(0.5)
  })

  it('is uniform — proportions survive a non-square footprint', () => {
    const size = [2, 3, 1] as const
    const s = fitScale(size, 1, 1)
    const fitted = size.map((n) => n * s)
    // Aspect ratios unchanged.
    expect(fitted[1] / fitted[0]).toBeCloseTo(size[1] / size[0], 6)
    expect(fitted[2] / fitted[0]).toBeCloseTo(size[2] / size[0], 6)
  })

  it('ignores height — a footprint says nothing about how tall a thing is', () => {
    const short = fitScale([1, 0.2, 1], 1, 1)
    const tall = fitScale([1, 5.0, 1], 1, 1)
    expect(short).toBeCloseTo(tall, 6)
  })

  it('lets one asset serve several catalogue sizes', () => {
    // One plant asset, measured 0.50 × 0.45, across the three registered ids.
    const plant = [0.5, 0.7238, 0.4544] as const
    const at = (cm: number) => fitScale(plant, cm / 100, cm / 100)
    expect(at(50)).toBeGreaterThan(at(40))
    // Fitted footprint must stay within each declared box.
    for (const cm of [40, 50]) {
      expect(plant[0] * at(cm)).toBeLessThanOrEqual(cm / 100 + 1e-9)
      expect(plant[2] * at(cm)).toBeLessThanOrEqual(cm / 100 + 1e-9)
    }
  })

  it('falls back to 1 rather than making an asset vanish or explode', () => {
    expect(fitScale(undefined, 1, 1)).toBe(1)
    expect(fitScale([0, 0, 0], 1, 1)).toBe(1)
    expect(fitScale([1, 1, 1], 0, 1)).toBe(1)
    expect(fitScale([1, 1, 1], 1, 0)).toBe(1)
    expect(fitScale([Number.NaN, 1, 1], 1, 1)).toBe(1)
  })

  it('never returns a non-finite or non-positive scale', () => {
    const cases: Array<[number, number, number]> = [
      [1, 1, 1], [1e-9, 1, 1e-9], [1e6, 1, 1e6], [Number.NaN, 1, 1], [Infinity, 1, 1],
    ]
    for (const size of cases) {
      for (const [w, d] of [[1, 1], [0.01, 5], [1e-9, 1e-9]]) {
        const s = fitScale(size, w, d)
        expect(Number.isFinite(s)).toBe(true)
        expect(s).toBeGreaterThan(0)
      }
    }
  })
})

describe('anchorOffsetY', () => {
  const size = [0.34, 0.75, 0.34] as const   // the pendant lamp, as measured

  it('leaves floor-standing furniture where the pipeline put it', () => {
    expect(anchorOffsetY(size, 1, 'floor')).toBe(0)
    expect(anchorOffsetY(size, 1)).toBe(0)
  })

  it('hangs a ceiling piece so its top meets the ceiling', () => {
    const offset = anchorOffsetY(size, 1, 'ceiling')
    expect(offset + size[1]).toBeCloseTo(CEILING_HEIGHT, 6)
  })

  it('keeps a ceiling piece touching the ceiling at any fitted scale', () => {
    // A pendant fitted to a smaller footprint hangs shorter; its cord still has
    // to reach the same ceiling.
    for (const scale of [0.5, 1, 1.8]) {
      const offset = anchorOffsetY(size, scale, 'ceiling')
      expect(offset + size[1] * scale).toBeCloseTo(CEILING_HEIGHT, 6)
    }
  })

  it('centres a wall piece at mounting height', () => {
    const mirror = [0.6, 0.92, 0.03] as const
    const offset = anchorOffsetY(mirror, 1, 'wall')
    expect(offset + mirror[1] / 2).toBeCloseTo(WALL_MOUNT_HEIGHT, 6)
  })

  it('honours an explicit height', () => {
    expect(anchorOffsetY(size, 1, 'ceiling', 3.0) + size[1]).toBeCloseTo(3.0, 6)
    expect(anchorOffsetY(size, 1, 'wall', 2.0) + size[1] / 2).toBeCloseTo(2.0, 6)
  })

  it('never pushes a piece below the floor', () => {
    // A model taller than the ceiling would otherwise get a negative offset and
    // sink through the floor.
    const tall = [1, 4, 1] as const
    expect(anchorOffsetY(tall, 1, 'ceiling')).toBe(0)
    expect(anchorOffsetY(tall, 1, 'wall')).toBe(0)
  })

  it('degrades to no offset for a missing or degenerate size', () => {
    expect(anchorOffsetY(undefined, 1, 'ceiling')).toBe(0)
    expect(anchorOffsetY([1, 0, 1], 1, 'ceiling')).toBe(0)
    expect(anchorOffsetY([1, Number.NaN, 1], 1, 'wall')).toBe(0)
  })
})
