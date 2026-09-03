/**
 * outdoorTextures.ts — the baked outdoor material library, as data.
 *
 * The world around the plan is drawn by the canvas generators in
 * `proceduralTextures`. Those are good at pattern and structurally incapable of
 * grain: they paint rectangles and speckle, so a roof reads as roof-coloured
 * stripes and a lawn as a green plane. That is the "Umgebung zu schwach".
 *
 * These sets are baked in Blender (`tools/blender/bake.py`) from procedural
 * node graphs — noise with real spatial structure, per-brick colour variation,
 * bump-derived normals — and come out as four small images the browser samples
 * for free. Original geometry and original shading, so no third-party licence
 * attaches to any of it.
 *
 * The table mirrors `tools/blender/textures.json`, and a test asserts the two
 * against each other and against the files on disk.
 */

/** The maps a baked set can provide. */
export type OutdoorMap = 'diff' | 'nor' | 'rough' | 'bump'

export interface OutdoorSet {
  /** Which maps the bake actually wrote. */
  maps: readonly OutdoorMap[]
  /**
   * Values the bake found to be constant across the whole surface.
   *
   * A constant map is a 512² image of one number: it costs bandwidth and a
   * texture unit to say what a scalar already says. The baker refuses to write
   * those and records the value here instead.
   */
  constants: Partial<Record<OutdoorMap, number>>
}

export const OUTDOOR_SETS = {
  'asphalt': { maps: ['bump', 'diff', 'nor', 'rough'], constants: {} },
  'facade-plaster': { maps: ['bump', 'diff', 'nor', 'rough'], constants: {} },
  'gravel': { maps: ['bump', 'diff', 'nor'], constants: { rough: 0.8784 } },
  'klinker': { maps: ['bump', 'diff', 'nor', 'rough'], constants: {} },
  'lawn': { maps: ['bump', 'diff', 'nor'], constants: { rough: 0.9294 } },
  'paver': { maps: ['bump', 'diff', 'nor', 'rough'], constants: {} },
  'roof-tile': { maps: ['bump', 'diff', 'nor', 'rough'], constants: {} },
} as const satisfies Record<string, OutdoorSet>

export type OutdoorSetKey = keyof typeof OUTDOOR_SETS

/**
 * Which canvas generator each baked set replaces.
 *
 * Keyed by the generator's own name so the mapping reads as the substitution it
 * is: `brickTextures()` keeps its signature and its callers, and only the
 * pixels behind it change.
 */
export const GENERATOR_SETS: Record<string, OutdoorSetKey> = {
  brickTextures: 'klinker',
  roofTextures: 'roof-tile',
  asphaltSurface: 'asphalt',
  paverTextures: 'paver',
  grassTexture: 'lawn',
}

/** Base-aware URL for one map (works under the GitHub Pages sub-path). */
export function outdoorTextureUrl(name: OutdoorSetKey, kind: OutdoorMap): string {
  return `${import.meta.env.BASE_URL}textures/outdoor/${name}_${kind}.jpg`
}

export function hasOutdoorMap(name: OutdoorSetKey, kind: OutdoorMap): boolean {
  return (OUTDOOR_SETS[name].maps as readonly OutdoorMap[]).includes(kind)
}

/** The constant value for a map the bake did not write, if there is one. */
export function outdoorConstant(name: OutdoorSetKey, kind: OutdoorMap): number | undefined {
  return (OUTDOOR_SETS[name].constants as Partial<Record<OutdoorMap, number>>)[kind]
}

export function outdoorSetNames(): OutdoorSetKey[] {
  return Object.keys(OUTDOOR_SETS) as OutdoorSetKey[]
}

/**
 * Should the baked library be used at all?
 *
 * Same flag that gates the interior photographic maps and the roughness detail
 * maps: a device that cannot afford an extra texture sample per fragment cannot
 * afford seven PBR sets in GPU memory either, and the canvas library it falls
 * back to is complete and correct on its own.
 */
export function shouldUseBakedOutdoor(profile: { detailMaps: boolean }): boolean {
  return profile.detailMaps
}
