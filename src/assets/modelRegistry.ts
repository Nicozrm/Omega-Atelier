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

export interface ModelDef {
  /** File name in `public/models/`, without the `.glb` extension. */
  file: string
  /** Uniform scale applied to the loaded model (model units → metres). */
  scale?: number
  /** Position offset (m) applied after placement, e.g. to sit it on the floor. */
  offset?: [number, number, number]
  /** Y rotation (rad) so the model's front faces +Z, matching the placement. */
  rotationY?: number
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
  'plant':        { file: 'plant' },
  'plant-tall':   { file: 'plant', scale: 1.15 },
  'plant-large':  { file: 'plant', scale: 1.3 },
  'armchair':     { file: 'armchair', rotationY: Math.PI / 2 },
  'table-coffee': { file: 'table-coffee' },
  'chair-dining': { file: 'chair-dining' },
  'nightstand':   { file: 'nightstand' },
  'vase-floor':   { file: 'vase-floor', scale: 2.1 },
}

export function hasModel(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODELS, id)
}

/** Base-aware URL (works under the GitHub Pages sub-path and at root). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}.glb`
}
