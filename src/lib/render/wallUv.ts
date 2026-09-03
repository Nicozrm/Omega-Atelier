/**
 * render/wallUv.ts — constant texel density on walls.
 *
 * ## The defect
 *
 * Every wall is a `BoxGeometry`, and a box's UVs run 0…1 across each face
 * regardless of how large that face is. The wall materials tile their plaster
 * at a fixed `repeat: [2, 2]`, so **every face shows exactly two tiles, whatever
 * its size**. Worked through on a 2.5 m storey:
 *
 *   | face                          | one tile covers  | grain vs. a 4 m wall |
 *   | 6.0 m wall body               | 3.00 × 1.25 m    | stretched 2.4 : 1    |
 *   | 1.2 m pier beside a door      | 0.60 × 1.25 m    | 5× finer, squashed   |
 *   | 0.24 m reveal in the opening  | 0.12 × 1.25 m    | 10× stretched        |
 *
 * All three surfaces meet at one door frame, in the same material, at three
 * different scales and aspect ratios. Plaster whose grain changes size and
 * direction from one surface to the next is the thing that reads as computer
 * graphics no matter how good the lighting is — and in walk mode the reveal is
 * a hand's width from the camera.
 *
 * ## The fix
 *
 * Scale each face's UVs by its real size, so one tile always covers the same
 * number of metres in both directions. The scale rides on the **geometry**, not
 * on the material: geometry is per-wall anyway, whereas a per-wall material (or
 * a per-wall texture clone, which is what `repeat` would need) would break
 * batching across every wall in the plan.
 *
 * Pure arithmetic over a UV array — no THREE types — so the mapping is
 * checkable without a GPU.
 */

/**
 * Metres covered by one texture tile on a wall.
 *
 * Chosen to sit inside the range the fixed `[2, 2]` repeat used to produce
 * (~1.25 m vertically, ~2 m horizontally on a typical wall), so the material
 * keeps the density it was authored at — this change is about making the
 * density *uniform*, not about making the plaster coarser or finer.
 */
export const WALL_TILE_M = 1.6

/**
 * A box face's UV repeat, as [u, v].
 *
 * The order matches `THREE.BoxGeometry`'s own: +X, −X, +Y, −Y, +Z, −Z, four
 * vertices each. Which world axis a face's u and v run along is fixed by that
 * layout — the ±X faces are mapped across depth and height, ±Y across width and
 * depth, ±Z across width and height.
 */
export type FaceUvScale = readonly [number, number]

/** Below this a face is a seam, not a surface; one tile avoids a divide-by-zero look. */
const MIN_SCALE = 0.01

const scale = (size: number, tileM: number): number =>
  Math.max(MIN_SCALE, Math.abs(size) / (tileM > 0 ? tileM : WALL_TILE_M))

export function boxUvScales(
  width: number,
  height: number,
  depth: number,
  tileM: number = WALL_TILE_M,
): FaceUvScale[] {
  const w = scale(width, tileM)
  const h = scale(height, tileM)
  const d = scale(depth, tileM)
  return [
    [d, h], // +X — the reveal on one side of an opening
    [d, h], // −X
    [w, d], // +Y — the sliced top of a cut wall
    [w, d], // −Y
    [w, h], // +Z — the wall face
    [w, h], // −Z — the other wall face
  ]
}

/**
 * Multiply a box's UV array in place, face by face.
 *
 * Takes the raw array rather than a `BufferAttribute` so the arithmetic is
 * testable on its own; the caller hands over `geometry.attributes.uv.array`.
 *
 * A box has 24 vertices — four per face, two components each — so a face owns
 * eight consecutive floats. Anything else is not a box and is left untouched
 * rather than silently mangled.
 */
export function applyBoxUvScales(uv: ArrayLike<number> & { [i: number]: number }, scales: FaceUvScale[]): boolean {
  const FLOATS_PER_FACE = 8
  if (uv.length !== scales.length * FLOATS_PER_FACE) return false
  for (let face = 0; face < scales.length; face++) {
    const [su, sv] = scales[face]
    const base = face * FLOATS_PER_FACE
    for (let v = 0; v < 4; v++) {
      uv[base + v * 2] *= su
      uv[base + v * 2 + 1] *= sv
    }
  }
  return true
}

/**
 * Texel density a face ends up with, in texels per metre.
 *
 * Only used by the tests, but it is the quantity the whole module exists to
 * hold constant, so it is worth being able to state.
 */
export function texelsPerMetre(textureSize: number, tileM: number = WALL_TILE_M): number {
  return textureSize / (tileM > 0 ? tileM : WALL_TILE_M)
}
