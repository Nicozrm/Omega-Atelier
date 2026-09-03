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
 * Two sources feed it, and they are good at different things:
 *
 *  - **Generated in Blender** (`tools/blender`) — parametric furniture built to
 *    the catalogue's own dimensions. Correct proportions, tiny files, and they
 *    stretch cleanly because the geometry is authored rather than captured.
 *  - **CC0 photoscans** (Poly Haven, via `scripts/assets/`) — real captured
 *    geometry with full PBR texture sets. Far more convincing, and far heavier;
 *    they must not be stretched, because distorting a captured mesh distorts its
 *    texture with it.
 *
 * Licensing: only commit assets you are licensed to redistribute (your own
 * files or CC0 sources such as Poly Haven). Do NOT bundle branded/3rd-party
 * models without a redistribution licence.
 */

import { MODEL_SIZES } from './modelSizes'
import type { ModelAnchor } from './modelFit'

/**
 * How a model adapts when the placed item's footprint differs from the size the
 * asset was authored at.
 *
 *  `stretch`  scale X and Z to the placed footprint, keep the height. What a
 *             planner wants: a sofa dragged to 2.6 m gets wider, not taller.
 *             Right for generated geometry, wrong for a photoscan — stretching
 *             captured geometry smears the texture that makes it convincing.
 *  `uniform`  one scale factor for all three axes — for photoscans, and for
 *             anything whose proportions must not change (a plant, a vase).
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
   * `rotationY`.
   *
   * Optional for assets built by `scripts/assets/build.mjs`: that pipeline
   * measures every model it produces into `modelSizes.ts`, and {@link fitScale}
   * falls back to it. Stating it here overrides the measurement, which is what
   * the Blender-generated models do — their footprints come from
   * `tools/blender/manifest.json`, held to the registry by a test.
   */
  nominal?: [number, number]
  /** Defaults to `stretch` when a footprint is known, `none` otherwise. */
  fit?: ModelFit
  /**
   * How the piece is mounted. Assets are authored and built sitting on the
   * floor, which is right for furniture and wrong for anything hung — a pendant
   * lamp would lie on the carpet, a wall mirror lean against the skirting.
   * Defaults to `'floor'`; the offset is derived from the model's fitted height.
   */
  anchor?: ModelAnchor
  /** Ceiling height for `anchor: 'ceiling'`, centre height for `'wall'` (m).
   *  Defaults to the scene's 2.5 m ceiling / 1.35 m mounting height. */
  anchorHeight?: number
}

/**
 * The footprint an asset was authored at, in metres `[x, z]`.
 *
 * An explicit `nominal` wins; otherwise the pipeline's own measurement is used,
 * so an asset built by `scripts/assets/build.mjs` needs no hand-copied numbers.
 */
export function nominalFootprint(def: ModelDef): readonly [number, number] | undefined {
  if (def.nominal) return def.nominal
  const measured = MODEL_SIZES[def.file]
  return measured ? [measured[0], measured[2]] : undefined
}

/**
 * The per-axis scale that fits a model to a placed footprint.
 *
 * Pure, and exported for its test: this is the piece that decides whether a
 * resized piece of furniture actually changes size, and until it existed
 * `GltfModel` ignored the placed width/depth entirely — a registered model
 * rendered at its authored size while the selection ring and the 2D plan
 * followed the real footprint. The procedural fallback had always honoured it,
 * so replacing a placeholder with a real asset silently broke resizing.
 *
 * `target` is the placed footprint in metres. Returns `[1, 1, 1]` whenever
 * there is nothing to fit against, so an unmeasured asset is never distorted.
 */
export function fitScale(
  def: ModelDef,
  target?: readonly [number, number],
): [number, number, number] {
  const nominal = nominalFootprint(def)
  const mode: ModelFit = def.fit ?? (nominal ? 'stretch' : 'none')
  if (mode === 'none' || !nominal || !target) return [1, 1, 1]

  const [nx, nz] = nominal
  if (!(nx > 0) || !(nz > 0)) return [1, 1, 1]
  const sx = target[0] / nx
  const sz = target[1] / nz
  if (!Number.isFinite(sx) || !Number.isFinite(sz) || sx <= 0 || sz <= 0) return [1, 1, 1]

  // Height is deliberately untouched by `stretch`: widening a wardrobe must not
  // push it through the ceiling.
  if (mode === 'stretch') return [sx, 1, sz]
  // Uniform fits *inside* the footprint: overflowing would collide with
  // neighbouring furniture, and undersize reads far better than distortion.
  const s = Math.min(sx, sz)
  return [s, s, s]
}

/** Photoscans keep their proportions; only their scale is fitted. */
const SCAN = { fit: 'uniform' } as const

/**
 * id (furnitureId or deviceId) → local GLB.
 *
 * Several ids may share one file: each instance is fitted to its own catalogue
 * footprint at runtime, so the three plant ids need one asset between them
 * rather than three scale factors.
 */
export const MODELS: Record<string, ModelDef> = {
  /* ── CC0 photoscans (Poly Haven), built by scripts/assets/build.mjs ───────
   * Footprints come from `modelSizes.ts`, measured by that pipeline. */
  // Seating
  'armchair':        { file: 'scan/armchair', ...SCAN },
  'chair-dining':    { file: 'scan/chair-dining', ...SCAN },
  // Tables & desks
  'table-coffee':    { file: 'scan/table-coffee', ...SCAN },
  'outdoor-table':   { file: 'scan/outdoor-table', ...SCAN },
  'desk-office':     { file: 'scan/desk', ...SCAN },
  'desk-180':        { file: 'scan/desk', ...SCAN },
  // Storage
  'nightstand':      { file: 'scan/nightstand', ...SCAN },
  'bookshelf-wide':  { file: 'scan/shelf-wide', ...SCAN },
  'tv-stand':        { file: 'scan/sideboard', ...SCAN },
  // Lighting — hangs from the ceiling rather than standing on the floor.
  'pendant-lamp':    { file: 'scan/pendant-lamp', ...SCAN, anchor: 'ceiling' },
  // Decor
  'plant':           { file: 'scan/plant', ...SCAN },
  'plant-tall':      { file: 'scan/plant', ...SCAN },
  'plant-large':     { file: 'scan/plant-large', ...SCAN },
  'vase-floor':      { file: 'scan/vase-floor', ...SCAN },
  'mirror':          { file: 'scan/mirror', ...SCAN, anchor: 'wall' },

  /* ── Generated in Blender (tools/blender) ─────────────────────────────────
   * Where both sources cover an id, the generated model wins for now: its
   * footprint is held to the catalogue by a test, and it stretches cleanly when
   * a piece is resized. Swapping any of these for the photoscan under `scan/`
   * is a deliberate look decision, not a merge accident.
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
  'bed-200':         { file: 'bed-200', nominal: [2.05, 2.15] },
  'bed-90':          { file: 'bed-90', nominal: [0.9, 2.0] },
  'chair-office':    { file: 'chair-office', nominal: [0.5831, 0.5811] },
  'desk-corner':     { file: 'desk-corner', nominal: [1.8, 1.6] },
  'sofa-corner':     { file: 'sofa-corner', nominal: [2.82, 2.2] },
  'table-dining-4':  { file: 'table-dining-4', nominal: [1.4, 0.8] },
  'table-dining-8':  { file: 'table-dining-8', nominal: [2.4, 1.0] },
  'wardrobe-300':    { file: 'wardrobe-300', nominal: [3.0, 0.613] },
  'washing-machine': { file: 'washing-machine', nominal: [0.6, 0.607] },
}

export function hasModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id)
}

/** Base-aware URL (works under the GitHub Pages sub-path and at root). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}.glb`
}
