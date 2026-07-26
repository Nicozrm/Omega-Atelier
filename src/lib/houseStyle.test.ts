import { describe, it, expect } from 'vitest'
import {
  FACADE_KINDS, STONE_COLORS, ROOF_KINDS, ROOF_COLORS,
  DEFAULT_HOUSE_STYLE, facadeHints, roofHints, resolveHouseStyle,
} from './houseStyle'

const hex = /^#[0-9a-f]{6}$/i

describe('Bau-Studio catalogs', () => {
  it('offer multiple constructions, stone colours, roof shapes and roof colours', () => {
    expect(FACADE_KINDS.length).toBeGreaterThanOrEqual(4)
    expect(STONE_COLORS.length).toBeGreaterThanOrEqual(5)
    expect(ROOF_KINDS.length).toBe(3)
    expect(ROOF_COLORS.length).toBeGreaterThanOrEqual(5)
    for (const o of [...FACADE_KINDS, ...STONE_COLORS, ...ROOF_KINDS, ...ROOF_COLORS]) {
      expect(o.swatch, o.id).toMatch(hex)
      expect(o.label.length).toBeGreaterThan(0)
    }
  })
})

describe('facadeHints', () => {
  it('textures brick/stone/board and renders plaster smooth', () => {
    expect(facadeHints('klinker')).toMatchObject({ textured: true, map: 'brick' })
    expect(facadeHints('stone')).toMatchObject({ textured: true, map: 'brick' })
    expect(facadeHints('board')).toMatchObject({ textured: true, map: 'board' })
    expect(facadeHints('plaster')).toMatchObject({ textured: false, map: 'none' })
  })
  it('stone is rougher than klinker (matte natural stone)', () => {
    expect(facadeHints('stone').roughness).toBeGreaterThan(facadeHints('klinker').roughness)
  })
})

describe('roofHints', () => {
  it('marks the flat roof and pitches the sloped ones', () => {
    expect(roofHints('flat')).toMatchObject({ flat: true, pitch: 0 })
    expect(roofHints('gable').flat).toBe(false)
    expect(roofHints('gable').pitch).toBeGreaterThan(0)
    expect(roofHints('hip').pitch).toBeGreaterThan(0)
  })
})

describe('resolveHouseStyle', () => {
  it('fills defaults for missing / invalid fields', () => {
    expect(resolveHouseStyle(null)).toEqual(DEFAULT_HOUSE_STYLE)
    expect(resolveHouseStyle({ facade: 'nope', roofTint: 'red' })).toEqual(DEFAULT_HOUSE_STYLE)
  })
  it('keeps valid fields verbatim', () => {
    const s = { facade: 'board', facadeTint: '#e6cdaa', roof: 'flat', roofTint: '#c67b56' }
    expect(resolveHouseStyle(s)).toEqual(s)
  })
})
