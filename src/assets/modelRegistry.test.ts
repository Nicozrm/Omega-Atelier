import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { MODELS, fitScale, hasModel, modelUrl, type ModelDef } from './modelRegistry'
import { FURNITURE } from '@/data/furniture'

/**
 * The registry has three neighbours it can silently disagree with: the files in
 * `public/models`, the Blender build's manifest, and the app's furniture
 * catalog. Each disagreement fails in a different, quiet way — a 404 that falls
 * back to the placeholder, a model stretched to the wrong proportions, an entry
 * nothing ever renders. These tests are what keeps the four in step.
 */

const ROOT = resolve(__dirname, '..', '..')
const modelPath = (file: string) => resolve(ROOT, 'public', 'models', `${file}.glb`)

interface ManifestAsset {
  triangles: number
  materials: number
  nominal: [number, number]
  size: [number, number, number]
  bytes: number
}
const manifest: Record<string, ManifestAsset> = JSON.parse(
  readFileSync(resolve(ROOT, 'tools', 'blender', 'manifest.json'), 'utf8'),
).assets

/** The app resolves duplicate catalog ids last-wins; mirror that exactly. */
const catalogSize = Object.fromEntries(FURNITURE.map((f) => [f.id, f.size] as const))

describe('every registered model resolves to a real file', () => {
  it.each(Object.entries(MODELS))('%s', (_id, def: ModelDef) => {
    expect(existsSync(modelPath(def.file))).toBe(true)
  })

  it('builds a base-aware URL', () => {
    expect(modelUrl('sofa-3seat')).toContain('models/sofa-3seat.glb')
  })

  it('reports registration honestly', () => {
    expect(hasModel('sofa-3seat')).toBe(true)
    expect(hasModel('definitely-not-a-model')).toBe(false)
  })
})

describe('generated assets match the build manifest', () => {
  const generated = Object.keys(manifest)

  it.each(generated)('%s is registered', (id) => {
    expect(MODELS[id], `${id} was built but never registered`).toBeDefined()
  })

  it.each(generated)('%s declares the footprint the build measured', (id) => {
    const def = MODELS[id]
    expect(def.nominal).toBeDefined()
    // A drifted nominal is the subtle one: the model still loads, and every
    // placement is quietly scaled to the wrong proportions.
    expect(def.nominal![0]).toBeCloseTo(manifest[id].nominal[0], 3)
    expect(def.nominal![1]).toBeCloseTo(manifest[id].nominal[1], 3)
  })

  it.each(generated)('%s was authored at its catalog footprint', (id) => {
    const size = catalogSize[id]
    expect(size, `${id} is not in the furniture catalog`).toBeDefined()
    // 4 cm of tolerance covers bevels and protruding handles.
    expect(Math.abs(manifest[id].nominal[0] - size[0] / 100)).toBeLessThanOrEqual(0.04)
    expect(Math.abs(manifest[id].nominal[1] - size[1] / 100)).toBeLessThanOrEqual(0.04)
  })

  it('keeps every generated asset inside the web budget', () => {
    for (const [id, asset] of Object.entries(manifest)) {
      // These load on a phone. The CC0 assets are ~0.5–2.7 MB each *with*
      // textures; an untextured generated piece has no excuse to approach that.
      expect(asset.bytes, `${id} is oversized`).toBeLessThan(250 * 1024)
      expect(asset.triangles, `${id} is too dense`).toBeLessThanOrEqual(12000)
      expect(statSync(modelPath(id)).size).toBe(asset.bytes)
    }
  })

  it('draws each generated piece in a handful of primitives, not dozens', () => {
    // The performance half of the upgrade: the procedural fallbacks are built
    // from ~20 meshes each, a joined asset from one node per material.
    for (const [id, asset] of Object.entries(manifest)) {
      expect(asset.materials, `${id} has too many material slots`).toBeLessThanOrEqual(4)
    }
  })
})

describe('fitScale — a registered model follows a resized item', () => {
  const sofa: ModelDef = { file: 'sofa-3seat', nominal: [2.2, 0.95] }

  it('is identity at the authored footprint', () => {
    expect(fitScale(sofa, [2.2, 0.95])).toEqual([1, 1, 1])
  })

  it('stretches width and depth to the placed footprint', () => {
    const [x, y, z] = fitScale(sofa, [2.75, 0.95])
    expect(x).toBeCloseTo(1.25)
    expect(z).toBeCloseTo(1)
    // Height is deliberately untouched — a wider sofa is not a taller sofa.
    expect(y).toBe(1)
  })

  it('shrinks as well as grows', () => {
    expect(fitScale(sofa, [1.1, 0.475])[0]).toBeCloseTo(0.5)
  })

  it('scales uniformly when asked, so proportions survive', () => {
    const plant: ModelDef = { file: 'plant', nominal: [0.5, 0.5], fit: 'uniform' }
    const [x, y, z] = fitScale(plant, [0.75, 0.5])
    expect([x, y, z]).toEqual([1, 1, 1]) // min(1.5, 1) — never distorts
  })

  it('leaves the pre-existing CC0 assets exactly as they were', () => {
    // They carry no `nominal`, so the default is `none` and nothing changes.
    for (const id of ['plant', 'armchair', 'table-coffee', 'chair-dining', 'nightstand', 'vase-floor']) {
      expect(MODELS[id].nominal).toBeUndefined()
      expect(fitScale(MODELS[id], [9, 9])).toEqual([1, 1, 1])
    }
  })

  it('never distorts when there is nothing to fit against', () => {
    expect(fitScale(sofa, undefined)).toEqual([1, 1, 1])
    expect(fitScale({ file: 'x' }, [2, 2])).toEqual([1, 1, 1])
  })

  it('refuses degenerate footprints rather than collapsing the model', () => {
    expect(fitScale(sofa, [0, 0.95])).toEqual([1, 1, 1])
    expect(fitScale(sofa, [Number.NaN, 0.95])).toEqual([1, 1, 1])
    expect(fitScale({ file: 'x', nominal: [0, 1] }, [2, 2])).toEqual([1, 1, 1])
  })
})
