import { describe, it, expect } from 'vitest'
import {
  getMaterial,
  materialsForSurface,
  resolveFloorMaterial,
  resolveWallMaterial,
  resolveCeilingMaterial,
  resolveSurfaceMaterialId,
} from './materials'
import { MATERIALS } from '@/data/materials'

describe('material catalog integrity', () => {
  it('has unique ids', () => {
    const ids = MATERIALS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses valid hex colours and 0..1 roughness/metalness', () => {
    for (const m of MATERIALS) {
      expect(m.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(m.roughness).toBeGreaterThanOrEqual(0)
      expect(m.roughness).toBeLessThanOrEqual(1)
      expect(m.metalness).toBeGreaterThanOrEqual(0)
      expect(m.metalness).toBeLessThanOrEqual(1)
      expect(m.surfaces.length).toBeGreaterThan(0)
    }
  })
})

describe('getMaterial / materialsForSurface', () => {
  it('returns a material by id, or undefined for unknown/empty', () => {
    expect(getMaterial('floor-oak-parquet')?.name).toBe('Eichenparkett')
    expect(getMaterial('nope')).toBeUndefined()
    expect(getMaterial(undefined)).toBeUndefined()
  })

  it('filters materials by surface', () => {
    expect(materialsForSurface('floor').every((m) => m.surfaces.includes('floor'))).toBe(true)
    expect(materialsForSurface('wall').every((m) => m.surfaces.includes('wall'))).toBe(true)
    expect(materialsForSurface('floor').length).toBeGreaterThan(0)
  })
})

describe('resolveFloorMaterial', () => {
  it('prefers an explicit floorMaterialId', () => {
    expect(resolveFloorMaterial({ floorMaterialId: 'floor-slate' }).id).toBe('floor-slate')
  })

  it('maps a legacy floorVariant losslessly', () => {
    expect(resolveFloorMaterial({ floorVariant: 'parquet' }).id).toBe('floor-oak-parquet')
    expect(resolveFloorMaterial({ floorVariant: 'vinylDark' }).id).toBe('floor-vinyl-dark')
    expect(resolveFloorMaterial({ floorVariant: 'slate' }).id).toBe('floor-slate')
  })

  it('falls back to the default when nothing is set', () => {
    expect(resolveFloorMaterial({}).id).toBe('floor-oak-parquet')
  })

  it('falls back through an invalid id to the legacy variant', () => {
    expect(resolveFloorMaterial({ floorMaterialId: 'ghost', floorVariant: 'slate' }).id).toBe('floor-slate')
  })

  it('falls back to default when both id and variant are invalid/absent', () => {
    expect(resolveFloorMaterial({ floorMaterialId: 'ghost' }).id).toBe('floor-oak-parquet')
  })
})

describe('resolveWallMaterial', () => {
  it('prefers explicit id, then legacy variant, then default', () => {
    expect(resolveWallMaterial({ wallMaterialId: 'wall-concrete' }).id).toBe('wall-concrete')
    expect(resolveWallMaterial({ wallVariant: 'wallpaper' }).id).toBe('wall-wallpaper')
    expect(resolveWallMaterial({}).id).toBe('wall-plaster')
  })
})

describe('resolveCeilingMaterial', () => {
  it('prefers explicit id, else falls back to the ceiling default', () => {
    expect(resolveCeilingMaterial({ ceilingMaterialId: 'ceiling-plaster' }).id).toBe('ceiling-plaster')
    expect(resolveCeilingMaterial({}).id).toBe('ceiling-white')
    expect(resolveCeilingMaterial({ ceilingMaterialId: 'ghost' }).id).toBe('ceiling-white')
  })

  it('exposes ceiling materials for the ceiling surface', () => {
    const ceil = materialsForSurface('ceiling')
    expect(ceil.length).toBeGreaterThan(0)
    expect(ceil.every((m) => m.surfaces.includes('ceiling'))).toBe(true)
  })
})

describe('resolveSurfaceMaterialId', () => {
  it('resolves a bare id, or the per-surface default when missing/invalid', () => {
    expect(resolveSurfaceMaterialId('wall-concrete', 'wall').id).toBe('wall-concrete')
    expect(resolveSurfaceMaterialId(undefined, 'wall').id).toBe('wall-plaster')
    expect(resolveSurfaceMaterialId('ghost', 'floor').id).toBe('floor-oak-parquet')
    expect(resolveSurfaceMaterialId(undefined, 'ceiling').id).toBe('ceiling-white')
  })
})
