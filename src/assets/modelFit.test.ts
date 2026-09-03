import { describe, it, expect } from 'vitest'
import { anchorOffsetY, CEILING_HEIGHT, WALL_MOUNT_HEIGHT } from './modelFit'

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
