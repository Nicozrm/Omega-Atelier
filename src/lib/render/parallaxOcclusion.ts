/**
 * parallaxOcclusion.ts — real depth in a flat surface.
 *
 * ## Why the brick still looks painted on
 *
 * The facade already carries a proper normal map, and a normal map is a lie
 * about *lighting*: it tells the shader which way the surface faces, so a brick
 * catches light on one edge and shades on the other. That is enough when you
 * look straight at a wall.
 *
 * A facade is almost never looked at straight on. From an oblique angle — the
 * angle every building in this scene is seen from — the thing that makes brick
 * read as brick is not shading, it is **occlusion**: the near edge of a course
 * hides the mortar joint behind it, and the joint disappears entirely before
 * the brick face does. A normal map cannot do that, because it never moves
 * anything. Every texel stays exactly where the flat polygon put it, so the
 * wall keeps announcing that it is a photograph of bricks rather than bricks.
 *
 * ## What this does instead
 *
 * Parallax occlusion mapping marches the view ray through the height field the
 * normal map was derived from, and returns the UV where the ray *first hits*
 * the surface. The lookup then samples colour, normal and roughness at that
 * displaced coordinate. Nothing about the geometry changes — the wall is still
 * two triangles — but every map is now read as though the relief were real:
 *
 *  - joints recede and are progressively hidden as the angle flattens,
 *  - courses shift against each other as the camera moves (motion parallax,
 *    which is the cue the eye actually uses for depth),
 *  - the relief self-shadows in the AO pass because the normals it returns come
 *    from the displaced position.
 *
 * ## Cost, and why the step count is not a constant
 *
 * The march is a loop of texture fetches, and it is needed least where it is
 * cheapest. Head-on, the ray barely moves and one or two steps suffice; at a
 * grazing angle it travels far across the height field and needs many. So the
 * step count ramps with the view angle — see {@link parallaxSteps} — which
 * spends the samples exactly where the artefact would otherwise appear, and
 * makes the average frame far cheaper than a fixed high count.
 *
 * The silhouette is left alone. Real POM can also clip the outline, which needs
 * depth writes and turns every facade into an alpha-tested surface; the payoff
 * is an edge nobody looks at, on a building seen from thirty metres.
 */

/** Fewest march steps, used when looking straight at the surface. */
export const MIN_STEPS = 8
/** Most march steps, used at grazing incidence. */
export const MAX_STEPS = 32

/**
 * How many steps to march for a given view angle.
 *
 * `nDotV` is the cosine between the view ray and the surface normal: 1 is
 * head-on, 0 is edge-on. The ramp is linear in that cosine, which is linear in
 * how far the ray travels across the height field — so the sample count tracks
 * the distance actually being searched rather than the angle in degrees.
 */
export function parallaxSteps(nDotV: number, min = MIN_STEPS, max = MAX_STEPS): number {
  const t = Math.min(1, Math.max(0, Math.abs(nDotV)))
  return Math.round(max + (min - max) * t)
}

/**
 * Relief depth in UV units, per material family.
 *
 * This is the one number that decides whether the effect reads as brick or as a
 * melting wall. It is the depth of the height field expressed as a fraction of
 * the tile — so it has to shrink as the tiling density rises, because a tile
 * repeated ten times across a wall is ten times smaller in world space and its
 * mortar joint is not ten times deeper.
 */
export const PARALLAX_DEPTH = {
  /** Klinker: a mortar joint is genuinely recessed, ~1 cm on a ~24 cm brick. */
  brick: 0.04,
  /** Roof pantiles: the deepest relief out there — a real trough between tiles. */
  roof: 0.05,
  /** Concrete pavers: a narrow, shallow joint. */
  paver: 0.025,
  /** Board cladding: a shadow line between boards, shallower than it looks. */
  board: 0.02,
} as const

export type ParallaxFamily = keyof typeof PARALLAX_DEPTH

/**
 * Depth scaled for how densely the map is tiled across the surface.
 *
 * A wall that repeats the brick map eight times shows bricks an eighth the
 * size, and the parallax offset is measured in the *tile's* UV space, so the
 * raw depth would push the ray eight times too far and smear the courses into
 * each other. Dividing by the repeat keeps the apparent depth constant in world
 * space, which is the only place depth means anything.
 */
export function parallaxDepthFor(family: ParallaxFamily, repeat: number): number {
  const depth = PARALLAX_DEPTH[family]
  return depth / Math.max(1, repeat)
}
