import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PLANTS, hasPlant, plantMaterialRole, plantScale, plantUrl } from './plantRegistry'
import type { TreeKind } from '@/lib/world'

/**
 * The vegetation has to agree with three things: the files on disk, the build
 * manifest, and the sizes the procedural trees already had. The last one is the
 * subtle one — a model authored at a different height than the tree it replaces
 * would silently rescale every tree in the neighbourhood, and nothing would
 * error.
 */

const ROOT = resolve(__dirname, '..', '..')
const modelPath = (file: string) => resolve(ROOT, 'public', 'models', 'env', `${file}.glb`)

interface PlantRecord {
  triangles: number
  materials: number
  height: number
  bytes: number
}
const manifest: Record<string, PlantRecord> = JSON.parse(
  readFileSync(resolve(ROOT, 'tools', 'blender', 'plants.json'), 'utf8'),
).plants

describe('every registered plant resolves to a built model', () => {
  const entries = Object.entries(PLANTS) as [TreeKind, NonNullable<typeof PLANTS[TreeKind]>][]

  it.each(entries)('%s', (_kind, def) => {
    expect(existsSync(modelPath(def.file))).toBe(true)
    expect(manifest[def.file]).toBeDefined()
  })

  it.each(entries)('%s declares the height the build measured', (_kind, def) => {
    // Drift here rescales every tree of that kind in the scene, silently.
    expect(def.authored).toBeCloseTo(manifest[def.file].height, 2)
  })

  it('leaves no built model unused', () => {
    // Every built model must be one the scene actually renders.
    const referenced = new Set(Object.values(PLANTS).map((d) => `${d.file}.glb`))
    expect(readdirSync(resolve(ROOT, 'public', 'models', 'env')).sort())
      .toEqual([...referenced].sort())
  })

  it('keeps every plant inside the budget it is paid for', () => {
    // A neighbourhood plants hundreds of these and `Static` merges them, so a
    // triangle here is a triangle a few hundred times over.
    for (const [file, record] of Object.entries(manifest)) {
      expect(record.triangles, `${file} is too dense`).toBeLessThanOrEqual(900)
      expect(record.materials, `${file} has too many materials`).toBeLessThanOrEqual(2)
      expect(record.bytes, `${file} is oversized`).toBeLessThan(24 * 1024)
      expect(statSync(modelPath(file)).size).toBe(record.bytes)
    }
  })

  it('reports registration honestly', () => {
    expect(hasPlant('broadleaf')).toBe(true)
    // Olive and palm keep their procedural form — a supported outcome.
    expect(hasPlant('olive')).toBe(false)
    expect(hasPlant('palm')).toBe(false)
  })
})

describe('plantScale — the model occupies the procedural tree’s space', () => {
  it('maps the authored height onto the kind’s natural height', () => {
    const conifer = PLANTS.conifer!
    // A model 7.5 m tall standing in for a 4.03 m procedural tree at scale 1.
    expect(plantScale(conifer, 1)).toBeCloseTo(conifer.unit / conifer.authored, 5)
    expect(plantScale(conifer, 1) * conifer.authored).toBeCloseTo(conifer.unit, 5)
  })

  it('is linear in the world model’s scale', () => {
    const broadleaf = PLANTS.broadleaf!
    expect(plantScale(broadleaf, 2)).toBeCloseTo(plantScale(broadleaf, 1) * 2, 6)
    expect(plantScale(broadleaf, 1.7) * broadleaf.authored).toBeCloseTo(broadleaf.unit * 1.7, 5)
  })

  it('never collapses a tree when the numbers are unusable', () => {
    expect(plantScale({ file: 'x', authored: 0, unit: 4 }, 1.5)).toBe(1.5)
    expect(plantScale(PLANTS.birch!, Number.NaN)).toBeNaN()
  })

  it('keeps every kind close to the size it replaces', () => {
    // Each built model must land within a few per cent of the procedural tree
    // it stands in for, or the street changes proportions on swap.
    for (const [kind, def] of Object.entries(PLANTS)) {
      const rendered = plantScale(def, 1) * def.authored
      expect(Math.abs(rendered - def.unit), kind).toBeLessThan(0.01)
    }
  })
})

describe('material roles — the scene tints the foliage, not the file', () => {
  it('routes the palette names the models actually carry', () => {
    for (const name of ['lawn_green', 'conifer_green', 'hedge_green', 'birch_leaf']) {
      expect(plantMaterialRole(name), name).toBe('foliage')
    }
    for (const name of ['walnut', 'birch_bark']) {
      expect(plantMaterialRole(name), name).toBe('bark')
    }
  })

  it('treats an unnamed material as bark rather than tinting it as leaves', () => {
    // The safe default: a mis-tinted trunk is a wrong colour, a mis-tinted
    // canopy turns a whole street the wrong shade in autumn.
    expect(plantMaterialRole('')).toBe('bark')
  })
})

describe('plantUrl', () => {
  it('points into the env model folder', () => {
    expect(plantUrl('tree-birch')).toContain('models/env/tree-birch.glb')
  })
})
