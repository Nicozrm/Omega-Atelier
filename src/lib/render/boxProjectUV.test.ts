import { describe, it, expect } from 'vitest'
import { boxProjectUV } from './boxProjectUV'

/** One vertex at `p` with normal `n`, returned as its `[u, v]`. */
const project = (p: [number, number, number], n: [number, number, number], tile = 1) => {
  const uv = boxProjectUV(p, n, tile)
  return [uv[0], uv[1]] as const
}

/** Coordinates come back out of a Float32Array, so compare with tolerance. */
const expectUV = (actual: readonly [number, number], expected: [number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 6)
  expect(actual[1]).toBeCloseTo(expected[1], 6)
}

describe('boxProjectUV', () => {
  it('emits two coordinates per vertex', () => {
    const uv = boxProjectUV([0, 0, 0, 1, 1, 1], [0, 1, 0, 0, 1, 0])
    expect(uv).toHaveLength(4)
  })

  it('drops the axis a face points down', () => {
    // A top face (+Y): moving in Y must not move the texture.
    const a = project([0.3, 0.0, 0.7], [0, 1, 0])
    const b = project([0.3, 2.5, 0.7], [0, 1, 0])
    expectUV(a, [b[0], b[1]])
  })

  it('uses the in-plane axes for each of the three orientations', () => {
    // +Y face → (x, z)
    expectUV(project([0.4, 9, 0.6], [0, 1, 0]), [0.4, 0.6])
    // +Z face → (x, y)
    expectUV(project([0.4, 0.6, 9], [0, 0, 1]), [0.4, 0.6])
    // +X face → (-z, y)
    expectUV(project([9, 0.6, -0.4], [1, 0, 0]), [0.4, 0.6])
  })

  it('scales to world size, so one tile is the same physical size everywhere', () => {
    // A 2 m wardrobe and a 0.45 m nightstand must show the same grain size.
    const [u] = project([2, 0, 0], [0, 1, 0], 0.5)
    expect(u).toBeCloseTo(4, 6)   // 2 m across a 0.5 m tile = 4 repeats
    const [u2] = project([0.45, 0, 0], [0, 1, 0], 0.5)
    expect(u2).toBeCloseTo(0.9, 6)
  })

  it('keeps texel density constant regardless of tile size', () => {
    const near = project([1, 0, 0], [0, 1, 0], 0.25)[0]
    const far = project([1, 0, 0], [0, 1, 0], 1)[0]
    expect(near / far).toBeCloseTo(4, 6)
  })

  it('mirrors opposite faces so the grain runs consistently around a box', () => {
    // Front and back of the same slab: the pattern must not read reversed.
    const front = project([0.3, 0.5, 1], [0, 0, 1])
    const back = project([0.3, 0.5, -1], [0, 0, -1])
    expect(front[0]).toBeCloseTo(-back[0], 6)
    expect(front[1]).toBeCloseTo(back[1], 6)
  })

  it('picks the dominant axis for a slightly tilted normal', () => {
    // A bevel normal leaning off +Y still projects as a top face.
    expectUV(project([0.4, 9, 0.6], [0.1, 0.99, 0.05]), [0.4, 0.6])
  })

  it('survives a degenerate or missing normal instead of producing NaN', () => {
    for (const n of [[0, 0, 0], [Number.NaN, 1, 0]] as Array<[number, number, number]>) {
      const [u, v] = project([0.5, 0.5, 0.5], n)
      expect(Number.isFinite(u)).toBe(true)
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('never divides by a non-positive tile size', () => {
    for (const tile of [0, -1, Number.NaN, Infinity]) {
      const [u, v] = project([1, 1, 1], [0, 1, 0], tile)
      expect(Number.isFinite(u)).toBe(true)
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('handles an empty mesh', () => {
    expect(boxProjectUV([], [], 1)).toHaveLength(0)
  })
})
