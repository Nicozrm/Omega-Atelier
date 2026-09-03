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

import type { ModelAnchor } from './modelFit'

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
  /**
   * How the piece is mounted. The pipeline seats every asset on the floor, which
   * is right for furniture and wrong for anything hung — a pendant lamp would
   * lie on the carpet, a wall mirror lean against the skirting. Defaults to
   * `'floor'`; the offset is derived from the model's fitted height.
   */
  anchor?: ModelAnchor
  /** Ceiling height for `anchor: 'ceiling'`, centre height for `'wall'` (m).
   *  Defaults to the scene's 2.5 m ceiling / 1.35 m mounting height. */
  anchorHeight?: number
  /** Extra position offset (m). Rarely needed — the pipeline centres each asset
   *  on the origin, and `anchor` handles the vertical placement. */
  offset?: [number, number, number]
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
  // Seating
  'armchair':        { file: 'armchair' },
  'lounge-chair':    { file: 'lounge-chair' },
  'chair-dining':    { file: 'chair-dining' },
  'barstool':        { file: 'barstool' },
  // Tables
  'table-coffee':    { file: 'table-coffee' },
  'table-side':      { file: 'table-side' },
  'outdoor-table':   { file: 'outdoor-table' },
  'desk-office':     { file: 'desk' },
  'desk-160':        { file: 'desk' },
  'desk-180':        { file: 'desk' },
  // Storage
  'nightstand':      { file: 'nightstand' },
  'bookshelf':       { file: 'bookshelf' },
  'bookshelf-wide':  { file: 'shelf-wide' },
  'tv-sideboard':    { file: 'sideboard' },
  'tv-stand':        { file: 'sideboard' },
  // Lighting
  'pendant-lamp':    { file: 'pendant-lamp', anchor: 'ceiling' },
  // Decor
  'plant':           { file: 'plant' },
  'plant-tall':      { file: 'plant' },
  'plant-large':     { file: 'plant-large' },
  'vase-floor':      { file: 'vase-floor' },
  'mirror':          { file: 'mirror', anchor: 'wall' },
}

export function hasModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id)
}

/** Base-aware URL (works under the GitHub Pages sub-path and at root). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}.glb`
}
