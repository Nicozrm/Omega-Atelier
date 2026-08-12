import { describe, it, expect } from 'vitest'
import {
  parallaxSteps, parallaxDepthFor, PARALLAX_DEPTH, MIN_STEPS, MAX_STEPS,
  type ParallaxFamily,
} from './parallaxOcclusion'

describe('parallaxSteps', () => {
  it('spends the fewest samples head-on, where the ray barely moves', () => {
    expect(parallaxSteps(1)).toBe(MIN_STEPS)
  })

  it('spends the most at grazing incidence, where the artefact lives', () => {
    expect(parallaxSteps(0)).toBe(MAX_STEPS)
  })

  it('never marches fewer steps as the angle flattens', () => {
    let previous = 0
    for (const nDotV of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      const steps = parallaxSteps(nDotV)
      expect(steps).toBeGreaterThanOrEqual(previous)
      previous = steps
    }
  })

  it('treats a back-facing cosine like its magnitude', () => {
    // Double-sided walls hand the shader a negative cosine; the ray travels the
    // same distance either way, so it must not collapse to the cheap path.
    expect(parallaxSteps(-1)).toBe(parallaxSteps(1))
    expect(parallaxSteps(-0.3)).toBe(parallaxSteps(0.3))
  })

  it('stays inside its budget for any input, including nonsense', () => {
    for (const v of [-5, -1, 0, 0.5, 1, 5, Number.NaN]) {
      const steps = parallaxSteps(Number.isNaN(v) ? 0 : v)
      expect(steps).toBeGreaterThanOrEqual(MIN_STEPS)
      expect(steps).toBeLessThanOrEqual(MAX_STEPS)
    }
  })

  it('honours an explicit budget', () => {
    expect(parallaxSteps(1, 4, 16)).toBe(4)
    expect(parallaxSteps(0, 4, 16)).toBe(16)
  })
})

describe('parallaxDepthFor', () => {
  const families = Object.keys(PARALLAX_DEPTH) as ParallaxFamily[]

  it('keeps apparent depth constant as tiling density rises', () => {
    // The offset is measured in the tile's UV space. A wall repeating the map
    // eight times shows bricks an eighth the size, so the raw depth would push
    // the ray eight times too far and smear the courses together.
    expect(parallaxDepthFor('brick', 8)).toBeCloseTo(PARALLAX_DEPTH.brick / 8, 12)
    expect(parallaxDepthFor('brick', 2)).toBeCloseTo(PARALLAX_DEPTH.brick / 2, 12)
  })

  it('never amplifies depth on a sparsely tiled surface', () => {
    // Repeat below 1 means the tile is stretched; deepening the relief to match
    // would exaggerate it, so the authored depth is the ceiling.
    expect(parallaxDepthFor('brick', 0.5)).toBe(PARALLAX_DEPTH.brick)
    expect(parallaxDepthFor('brick', 0)).toBe(PARALLAX_DEPTH.brick)
  })

  it('ranks the families the way the real materials rank', () => {
    // Roof pantiles have a genuine trough; board cladding only a shadow line.
    expect(PARALLAX_DEPTH.roof).toBeGreaterThan(PARALLAX_DEPTH.brick)
    expect(PARALLAX_DEPTH.brick).toBeGreaterThan(PARALLAX_DEPTH.paver)
    expect(PARALLAX_DEPTH.paver).toBeGreaterThan(PARALLAX_DEPTH.board)
  })

  it('keeps every family in a range that reads as relief, not as liquid', () => {
    // Past roughly 0.1 of a tile the march overshoots and the surface swims.
    for (const f of families) {
      expect(PARALLAX_DEPTH[f]).toBeGreaterThan(0)
      expect(PARALLAX_DEPTH[f]).toBeLessThan(0.1)
    }
  })
})
