/**
 * GLB model registry — the bridge for replacing procedural placeholders with
 * real, optimised glTF/GLB assets, one id at a time.
 *
 * Offline-first + bundle-safe by design:
 *  - `MODELS` is EMPTY by default, so every furniture/device renders from its
 *    procedural mesh (no network, no loader in the loaded bundle).
 *  - To use a real model: drop an optimised `<file>.glb` into `public/models/`
 *    and add an entry here. Only then does the lazy GLTF loader load (with the
 *    model), and only for that id — everything else stays procedural.
 *
 * Licensing: only commit assets you are licensed to redistribute (your own
 * files or CC0 sources such as Poly Haven). Do NOT bundle branded/3rd-party
 * models without a redistribution licence.
 */

/**
 * How a model adapts when the placed item's footprint differs from the size the
 * asset was authored at.
 *
 *  `stretch`  scale X and Z to the placed footprint, keep the height. What a
 *             planner wants: a sofa dragged to 2.6 m gets wider, not taller.
 *  `uniform`  one scale factor for all three axes — for anything whose
 *             proportions must not change (a plant, a vase).
 *  `none`     render at the authored size and ignore the footprint.
 */
export type ModelFit = 'stretch' | 'uniform' | 'none'

export interface ModelDef {
  /** File name in `public/models/`, without the `.glb` extension. */
  file: string
  /** Uniform scale applied to the loaded model (model units → metres). */
  scale?: number
  /** Position offset (m) applied after placement, e.g. to sit it on the floor. */
  offset?: [number, number, number]
  /** Y rotation (rad) so the model's front faces +Z, matching the placement. */
  rotationY?: number
  /**
   * The footprint this asset was authored at, in metres [x, z] *after*
   * `rotationY`. Required for fitting — without it the model renders at its
   * authored size, which is what every asset here did before.
   */
  nominal?: [number, number]
  /** Defaults to `stretch` when `nominal` is present, `none` otherwise. */
  fit?: ModelFit
}

/**
 * The per-axis scale that fits a model to a placed footprint.
 *
 * Pure, and exported for its test: this is the piece that decides whether a
 * resized piece of furniture actually changes size, and until now it did not
 * exist at all — `GltfModel` ignored the placed width/depth entirely, so a
 * registered model rendered at its authored size while the selection ring and
 * the 2D plan followed the real footprint. The procedural fallback had always
 * honoured it, so replacing a placeholder with a real asset silently broke
 * resizing for that id.
 *
 * `target` is the placed footprint in metres. Returns `[1, 1, 1]` whenever
 * there is nothing to fit against, so an unmeasured asset is never distorted.
 */
export function fitScale(
  def: ModelDef,
  target?: readonly [number, number],
): [number, number, number] {
  const mode: ModelFit = def.fit ?? (def.nominal ? 'stretch' : 'none')
  if (mode === 'none' || !def.nominal || !target) return [1, 1, 1]

  const [nx, nz] = def.nominal
  if (!(nx > 0) || !(nz > 0)) return [1, 1, 1]
  const sx = target[0] / nx
  const sz = target[1] / nz
  if (!Number.isFinite(sx) || !Number.isFinite(sz) || sx <= 0 || sz <= 0) return [1, 1, 1]

  // Height is deliberately untouched by `stretch`: widening a wardrobe must not
  // push it through the ceiling.
  if (mode === 'stretch') return [sx, 1, sz]
  const s = Math.min(sx, sz)
  return [s, s, s]
}

/**
 * id (furnitureId or deviceId) → local GLB.
 *
 * Current assets — all CC0 from Poly Haven (polyhaven.com), 1k textures,
 * packed to single GLBs via gltf-pipeline:
 *  - plant.glb        ← potted_plant_04
 *  - armchair.glb     ← modern_arm_chair_01
 *  - table-coffee.glb ← modern_coffee_table_01
 */
export const MODELS: Record<string, ModelDef> = {
  /* ── CC0 assets (Poly Haven) ──────────────────────────────────────────────
   * No `nominal`, so these keep rendering at their authored size exactly as
   * before. Measuring them is a separate job from generating our own. */
  'plant':        { file: 'plant' },
  'plant-tall':   { file: 'plant', scale: 1.15 },
  'plant-large':  { file: 'plant', scale: 1.3 },
  'armchair':     { file: 'armchair', rotationY: Math.PI / 2 },
  'table-coffee': { file: 'table-coffee' },
  'chair-dining': { file: 'chair-dining' },
  'nightstand':   { file: 'nightstand' },
  'vase-floor':   { file: 'vase-floor', scale: 2.1 },

  /* ── Generated in Blender (tools/blender) ─────────────────────────────────
   * `nominal` is the footprint the build measured, copied from
   * `tools/blender/manifest.json`; a test holds the two together. These fit the
   * placed footprint, so resizing a sofa in the plan resizes the model. */
  'barstool':       { file: 'barstool', nominal: [0.38, 0.38] },
  'bathtub':        { file: 'bathtub', nominal: [1.7, 0.8] },
  'bed-140':        { file: 'bed-140', nominal: [1.4, 2.0] },
  'bed-180':        { file: 'bed-180', nominal: [1.85, 2.1] },
  'bookshelf':      { file: 'bookshelf', nominal: [0.8, 0.3] },
  'desk-160':       { file: 'desk-160', nominal: [1.6, 0.8] },
  'dishwasher':     { file: 'dishwasher', nominal: [0.6, 0.6] },
  'dresser':        { file: 'dresser', nominal: [1.1, 0.461] },
  'fridge':         { file: 'fridge', nominal: [0.6, 0.65] },
  'lounge-chair':   { file: 'lounge-chair', nominal: [0.8, 0.8] },
  'office-chair':   { file: 'office-chair', nominal: [0.6283, 0.6287] },
  'oven':           { file: 'oven', nominal: [0.6, 0.6] },
  'shoe-rack':      { file: 'shoe-rack', nominal: [0.9, 0.3] },
  'sink-bath':      { file: 'sink-bath', nominal: [0.6, 0.5] },
  'sofa-2seat':     { file: 'sofa-2seat', nominal: [1.6, 0.95] },
  'sofa-3seat':     { file: 'sofa-3seat', nominal: [2.2, 0.95] },
  'table-dining-6': { file: 'table-dining-6', nominal: [1.8, 0.9] },
  'table-side':     { file: 'table-side', nominal: [0.5, 0.5] },
  'toilet':         { file: 'toilet', nominal: [0.38, 0.6999] },
  'tv-sideboard':   { file: 'tv-sideboard', nominal: [2.0, 0.461] },
  'wardrobe-200':   { file: 'wardrobe-200', nominal: [2.0, 0.613] },
  'washer':         { file: 'washer', nominal: [0.6, 0.607] },
}

export function hasModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id)
}

/** Base-aware URL (works under the GitHub Pages sub-path and at root). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}.glb`
}
