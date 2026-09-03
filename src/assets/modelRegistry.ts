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
  /**
   * Y rotation (rad) so the model's *front* faces +Z.
   *
   * The build pipeline already squares up each asset's footprint and sits it on
   * the floor, so this is only needed when a model is correctly proportioned but
   * facing the wrong way — which no amount of measuring can detect.
   */
  rotationY?: number
  /**
   * Escape hatch for an asset the pipeline cannot fit automatically (a lamp
   * whose shade should not scale with its footprint, say). Normally omitted:
   * the runtime fits the model to the footprint of the instance it is drawing,
   * from the measured sizes in `modelSizes.ts`.
   */
  scale?: number
  /** Position offset (m) applied after placement. Rarely needed — the pipeline
   *  centres each asset on the origin and seats it on the floor. */
  offset?: [number, number, number]
  /**
   * Footprint (m, `[width, depth]`) the asset was *authored* at, as measured by
   * the Blender build and written into `tools/blender/manifest.json`.
   *
   * This is what makes a placed piece follow the plan: the catalogue says a sofa
   * is 2.2 m wide, the user drags it to 2.75 m, and the asset is stretched by
   * the ratio between the two. Present only on generated assets — the CC0
   * downloads carry no nominal, so they render exactly as before.
   */
  nominal?: [number, number]
  /** How the asset adapts when the placed footprint differs from `nominal`.
   *  Defaults to `stretch` when a `nominal` is known, `none` otherwise. */
  fit?: ModelFit
}

/**
 * Per-axis scale that fits a model authored at `def.nominal` into the footprint
 * (m, `[width, depth]`) the plan actually reserved for the instance.
 *
 * Returns `[1, 1, 1]` — never `0`, `Infinity` or `NaN` — whenever there is
 * nothing to fit against (no `nominal`, no footprint, a degenerate number), so a
 * missing measurement costs the correction, never the model.
 */
export function fitScale(
  def: ModelDef,
  footprint: readonly [number, number] | undefined,
): [number, number, number] {
  const identity: [number, number, number] = [1, 1, 1]
  const nominal = def.nominal
  const mode: ModelFit = def.fit ?? (nominal ? 'stretch' : 'none')
  if (mode === 'none' || !nominal || !footprint) return identity

  const [nw, nd] = nominal
  const [w, d] = footprint
  if (!(nw > 1e-6) || !(nd > 1e-6) || !(w > 1e-6) || !(d > 1e-6)) return identity

  const sx = w / nw
  const sz = d / nd
  if (!Number.isFinite(sx) || !Number.isFinite(sz) || sx <= 0 || sz <= 0) return identity

  // `uniform` takes the tighter axis so proportions survive and the piece stays
  // inside the space the plan gave it. `stretch` leaves height alone — a wider
  // sofa is not a taller sofa.
  if (mode === 'uniform') {
    const s = Math.min(sx, sz)
    return [s, s, s]
  }
  return [sx, 1, sz]
}

/**
 * id (furnitureId or deviceId) → local GLB.
 *
 * Several ids may share one file: each instance is fitted to its own catalogue
 * footprint at runtime, so the three plant ids need one asset between them
 * rather than three scale factors.
 *
 * Assets are CC0 from Poly Haven (polyhaven.com), rebuilt by
 * `scripts/assets/build.mjs`:
 *  - plant.glb        ← potted_plant_04
 *  - armchair.glb     ← modern_arm_chair_01
 *  - table-coffee.glb ← modern_coffee_table_01
 */
export const MODELS: Record<string, ModelDef> = {
  /* ── CC0 assets (Poly Haven) ──────────────────────────────────────────────
   * No `nominal`, so these keep rendering at their authored size exactly as
   * before. Measuring them is a separate job from generating our own. */
  'plant':        { file: 'plant' },
  'plant-tall':   { file: 'plant' },
  'plant-large':  { file: 'plant' },
  'armchair':     { file: 'armchair' },
  'table-coffee': { file: 'table-coffee' },
  'chair-dining': { file: 'chair-dining' },
  'nightstand':   { file: 'nightstand' },
  'vase-floor':   { file: 'vase-floor' },

  /* ── Generated in Blender by `tools/blender/build.py` ─────────────────────
   * Each carries the footprint the build measured, so a resized instance is
   * stretched by the ratio between the two rather than rendered at the size it
   * happened to be authored at. */
  'barstool':       { file: 'barstool', nominal: [0.38, 0.38] },
  'bathtub':        { file: 'bathtub', nominal: [1.7, 0.8] },
  'bed-140':        { file: 'bed-140', nominal: [1.4, 2] },
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
  'tv-sideboard':   { file: 'tv-sideboard', nominal: [2, 0.461] },
  'wardrobe-200':   { file: 'wardrobe-200', nominal: [2, 0.613] },
  'washer':         { file: 'washer', nominal: [0.6, 0.607] },
}

export function hasModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id)
}

/** Base-aware URL (works under the GitHub Pages sub-path and at root). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}.glb`
}
