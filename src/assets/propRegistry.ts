/**
 * propRegistry.ts — the Blender-built street furniture, and why only four of it.
 *
 * ## What earns a model
 *
 * Everything at the kerb is currently drawn from boxes and cylinders, and most
 * of it should stay that way: a bollard *is* a cylinder, a manhole *is* a disc,
 * and a model of either buys nothing but bytes. Four pieces are different —
 * they appear in numbers, they are seen from close by, and the primitive
 * version of each is visibly a stand-in rather than a simplification:
 *
 *   `lamp-post`   two per street segment and the tallest thing at the kerb; the
 *                 procedural one is a pole with a lump on top, which reads as a
 *                 bollard. What makes a street lamp legible is the arm reaching
 *                 over the carriageway.
 *   `bench`       at bus stops and in parks, always close to the camera; three
 *                 boxes make a plinth, and the gaps between slats are the thing
 *                 the eye actually reads.
 *   `litter-bin`  beside benches and stops, same distance from the camera.
 *   `car`         on driveways and at the kerb — a slab with a box on top, and
 *                 a cabin as wide as the body reads as a van.
 *
 * Fences are deliberately absent, for the reason the hedge model was dropped: a
 * boundary is five boxes per segment, and a panel model repeated along every
 * plot line multiplies that across the whole estate for a detail nobody looks
 * at. The cheap version is the right version there.
 *
 * ## Which way they face
 *
 * Every model is authored Z-up with its **front at −Y**, and the glTF exporter
 * turns Blender −Y into glTF +Z. So a prop arrives standing upright and facing
 * +z, and the placement logic can rotate all four the same way — see
 * `faceAlong`/`faceAcross` in `lib/world/amenities`. A prop that broke the
 * convention would need a per-asset correction here, which is exactly the kind
 * of exception the next asset copies by mistake.
 *
 * ## Materials are roles
 *
 * The models carry the palette from `tools/blender/omega/materials.py`, but the
 * neighbourhood tints its scenery by season and daylight, and a parked car takes
 * its colour from the placement rather than from the file. So only geometry
 * comes from the GLB: every mesh is reassigned a scene material chosen by
 * `propMaterialRole`, exactly as the plants are.
 */

/** The props the world generator can place. */
export type PropId = 'lamp-post' | 'bench' | 'litter-bin' | 'car'

export interface PropDef {
  /** File in `public/models/props/`, without the `.glb`. */
  file: PropId
  /**
   * Size the model was built at, in metres, as `tools/blender/props.json`
   * measured it: `[x, y, z]` in **Blender** axes — z is the height.
   */
  size: readonly [number, number, number]
}

/**
 * Every prop, keyed by the id the builder registers it under.
 *
 * Props are placed at **life size** — unlike the plants, there is no procedural
 * predecessor whose proportions have to be matched, because a 4.1 m lamp post is
 * simply a 4.1 m lamp post. The sizes are recorded anyway: they are what the
 * placement logic reserves space for (a parking bay has to hold a 4.44 m car),
 * and a test pins them against the build manifest so a rebuilt model cannot
 * silently outgrow its bay.
 */
export const PROPS: Record<PropId, PropDef> = {
  'lamp-post': { file: 'lamp-post', size: [0.2473, 1.12, 4.1289] },
  bench: { file: 'bench', size: [1.7, 0.6124, 0.9412] },
  'litter-bin': { file: 'litter-bin', size: [0.4387, 0.45, 0.99] },
  car: { file: 'car', size: [1.84, 4.44, 1.448] },
}

/** Base-aware URL (works under the GitHub Pages sub-path). */
export function propUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/props/${file}.glb`
}

/**
 * Which scene material a built model's own material stands in for.
 *
 * The names come from the Blender palette and are matched rather than looked up
 * exactly, because a glTF exporter is free to suffix a material (`car_body.001`)
 * when two blocks collide. An unrecognised name falls to `dark`: a prop whose
 * body came out anthracite is a prop, whereas one that came out glass would be
 * a hole in the street.
 */
export type PropMaterialRole = 'body' | 'glass' | 'metal' | 'lens' | 'wood' | 'dark'

export function propMaterialRole(materialName: string): PropMaterialRole {
  const n = materialName.toLowerCase()
  if (n.includes('glass')) return 'glass'
  if (n.includes('lens') || n.includes('lamp')) return 'lens'
  if (n.includes('body')) return 'body'
  if (n.includes('steel') || n.includes('metal') || n.includes('chrome')) return 'metal'
  if (n.includes('oak') || n.includes('walnut') || n.includes('wood')) return 'wood'
  return 'dark'
}
