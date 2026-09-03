import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { WALL_TILE_M, applyBoxUvScales, boxUvScales, texelsPerMetre } from './wallUv'

/** Storey height used throughout, in metres. */
const H = 2.5

describe('boxUvScales', () => {
  it('gives every face the same metres-per-tile', () => {
    const scales = boxUvScales(6, H, 0.24)
    // +Z (the wall face) is width × height…
    expect(scales[4]).toEqual([6 / WALL_TILE_M, H / WALL_TILE_M])
    // …and the ±X reveal is depth × height, at the same density.
    expect(scales[0]).toEqual([0.24 / WALL_TILE_M, H / WALL_TILE_M])
    // …and the sliced top is width × depth.
    expect(scales[2]).toEqual([6 / WALL_TILE_M, 0.24 / WALL_TILE_M])
  })

  it('keeps a tile square in world space on every face', () => {
    // The defect this replaces: a fixed [2, 2] repeat made one tile 3.00 × 1.25 m
    // on a 6 m wall and 0.12 × 1.25 m in the reveal beside a door.
    for (const [w, d] of [[6, 0.24], [1.2, 0.24], [0.3, 0.11], [12, 0.36]]) {
      const extents: Array<[number, number]> = [
        [d, H], [d, H], [w, d], [w, d], [w, H], [w, H],
      ]
      boxUvScales(w, H, d).forEach(([su, sv], face) => {
        const [eu, ev] = extents[face]
        // Metres per tile along u and along v must agree — "square" — and both
        // must equal the one tile size, on every face of every wall.
        expect(eu / su).toBeCloseTo(WALL_TILE_M, 9)
        expect(ev / sv).toBeCloseTo(WALL_TILE_M, 9)
      })
    }
  })

  it('gives two differently sized walls the same grain', () => {
    const long = boxUvScales(6, H, 0.24)[4]
    const short = boxUvScales(1.2, H, 0.24)[4]
    // Same metres per tile, different tile counts — which is the whole point.
    expect(6 / long[0]).toBeCloseTo(1.2 / short[0], 9)
    expect(long[0]).toBeGreaterThan(short[0])
    // Height is shared, so the vertical repeat is identical.
    expect(long[1]).toBe(short[1])
  })

  it('honours a custom tile size', () => {
    expect(boxUvScales(3.2, H, 0.24, 0.8)[4][0]).toBeCloseTo(4, 9)
  })

  it('never collapses a degenerate face to zero repeat', () => {
    for (const s of boxUvScales(0, 0, 0)) {
      expect(s[0]).toBeGreaterThan(0)
      expect(s[1]).toBeGreaterThan(0)
    }
    expect(boxUvScales(3, H, 0.24, 0)[4][0]).toBeCloseTo(3 / WALL_TILE_M, 9)
  })

  it('treats a negative extent as its magnitude', () => {
    expect(boxUvScales(-4, H, 0.24)[4][0]).toBeCloseTo(4 / WALL_TILE_M, 9)
  })
})

describe('applyBoxUvScales', () => {
  it('scales a real BoxGeometry face by face', () => {
    const geometry = new THREE.BoxGeometry(6, H, 0.24)
    const uv = geometry.attributes.uv.array as Float32Array
    const before = Float32Array.from(uv)
    expect(applyBoxUvScales(uv, boxUvScales(6, H, 0.24))).toBe(true)

    // three lays a box out as six faces of four vertices; the +Z face is the
    // fifth, and its u must now span the wall's full length in tiles.
    const faceMax = (arr: ArrayLike<number>, face: number, comp: 0 | 1) => {
      let max = -Infinity
      for (let v = 0; v < 4; v++) max = Math.max(max, arr[face * 8 + v * 2 + comp])
      return max
    }
    expect(faceMax(before, 4, 0)).toBe(1)
    expect(faceMax(uv, 4, 0)).toBeCloseTo(6 / WALL_TILE_M, 5)
    expect(faceMax(uv, 4, 1)).toBeCloseTo(H / WALL_TILE_M, 5)
    // The reveal is scaled by depth, not by length — the bug in one assertion.
    expect(faceMax(uv, 0, 0)).toBeCloseTo(0.24 / WALL_TILE_M, 5)
    geometry.dispose()
  })

  it('leaves a UV array that is not a box untouched', () => {
    const uv = new Float32Array([0, 0, 1, 0, 1, 1])
    const copy = Float32Array.from(uv)
    expect(applyBoxUvScales(uv, boxUvScales(1, 1, 1))).toBe(false)
    expect(Array.from(uv)).toEqual(Array.from(copy))
  })

  it('is idempotent in effect when applied to a fresh geometry', () => {
    const build = () => {
      const g = new THREE.BoxGeometry(4, H, 0.24)
      applyBoxUvScales(g.attributes.uv.array as Float32Array, boxUvScales(4, H, 0.24))
      const out = Float32Array.from(g.attributes.uv.array as Float32Array)
      g.dispose()
      return out
    }
    expect(Array.from(build())).toEqual(Array.from(build()))
  })
})

describe('texel density', () => {
  it('states what a 512² plaster map resolves to', () => {
    // 320 texels per metre — about 3 mm per texel, which holds up at arm's
    // length in walk mode.
    expect(texelsPerMetre(512)).toBeCloseTo(320, 5)
  })

  it('is the same on every wall, which is the point', () => {
    const density = (sizeM: number, su: number) => 512 * su / sizeM
    expect(density(6, boxUvScales(6, H, 0.24)[4][0]))
      .toBeCloseTo(density(1.2, boxUvScales(1.2, H, 0.24)[4][0]), 9)
  })
})
