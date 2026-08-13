/**
 * plantRegistry.ts — the Blender-built vegetation, and how it replaces the
 * procedural trees without resizing the neighbourhood.
 *
 * ## What this buys
 *
 * The procedural trees are cone stacks and canopy blobs on a plain six-sided
 * cylinder. The canopies are already irregular; the *trunks* are not, and a tree
 * with no branch structure reads as a lollipop. The built models add a tapered
 * stem that runs up into the crown and limbs that end inside it, for 124–368
 * triangles — a few hundred bytes each, and `Static` merges them by material
 * exactly as it merges the procedural meshes.
 *
 * ## Why two heights
 *
 * The world model scales trees by a factor where 1 means "the procedural tree of
 * this kind at its natural size". Those natural sizes are whatever the
 * procedural geometry happens to add up to, and they differ per kind. Swapping
 * in a model authored at a different height would silently rescale every tree in
 * the scene, so both numbers are recorded and the ratio does the work:
 *
 *   `unit`     the height the procedural tree of this kind has at scale 1
 *   `authored` the height the Blender model was actually built at
 *
 * Kinds with no model — olive, palm — keep their procedural form. That is a
 * supported outcome, not a gap.
 */

import type { TreeKind } from '@/lib/world'

export interface PlantDef {
  /** File in `public/models/env/`, without the `.glb`. */
  file: string
  /** Height of the built model in metres, from `tools/blender/plants.json`. */
  authored: number
  /** Height of the procedural tree of this kind at scale 1, in metres. */
  unit: number
}

/**
 * Model per tree kind.
 *
 * `unit` is measured from the procedural geometry in `Neighbourhood3D.tree()`:
 * the topmost point each kind reaches at `s = 1`. A test pins the `authored`
 * values against the build manifest.
 */
export const PLANTS: Partial<Record<TreeKind, PlantDef>> = {
  // top cone at y 3.45, height 1.15 → 4.03
  conifer: { file: 'tree-conifer', authored: 7.5, unit: 4.03 },
  // cone at y 2.4, height 4.0 → 4.40
  cypress: { file: 'tree-cypress', authored: 7.48, unit: 4.4 },
  // canopy at y 2.7, r 0.86, squashed 1.15 → 3.69
  birch: { file: 'tree-birch', authored: 5.93, unit: 3.69 },
  // highest canopy at y 2.85, r 0.48 → 3.33
  broadleaf: { file: 'tree-broadleaf', authored: 6.41, unit: 3.33 },
}

export function hasPlant(kind: TreeKind): boolean {
  return PLANTS[kind] !== undefined
}

/**
 * The uniform scale that makes a built model occupy exactly the space the
 * procedural tree of the same kind and scale would have.
 *
 * Guarded rather than trusted: a zero or missing `authored` would collapse every
 * tree in the scene to a point, which is a worse failure than not using the
 * model at all.
 */
export function plantScale(def: PlantDef, scale: number): number {
  if (!(def.authored > 0) || !Number.isFinite(scale)) return scale
  return (scale * def.unit) / def.authored
}

/** Base-aware URL (works under the GitHub Pages sub-path). */
export function plantUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/env/${file}.glb`
}

/**
 * Which app material a built model's own material stands in for.
 *
 * The models carry the palette from `tools/blender/omega/materials.py`, but the
 * neighbourhood tints its foliage by season and daylight — snow, autumn, dusk.
 * Keeping the baked colours would freeze every tree at high summer regardless of
 * the sun, so the clone's materials are swapped for the scene's. Only geometry
 * comes from the file.
 */
export function plantMaterialRole(materialName: string): 'foliage' | 'bark' {
  return /green|leaf/i.test(materialName) ? 'foliage' : 'bark'
}
