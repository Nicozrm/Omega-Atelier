/**
 * boxProjectUV.ts — texture coordinates for geometry that never had any.
 *
 * ## Why this exists
 *
 * The furniture generated in `tools/blender` ships with `POSITION` and `NORMAL`
 * and nothing else. That was a deliberate trade — those assets are 15–110 KB
 * precisely because they carry no maps and no UVs, and their surface interest
 * comes from bevels catching the light. It is also the reason they still read
 * as low-poly next to a photoscan: flat colour is flat colour, however good the
 * silhouette.
 *
 * Photographic PBR maps are already in the repo and already loaded
 * (`lib/photoTextures`). The only thing standing between them and this geometry
 * is that a texture needs coordinates.
 *
 * ## Box projection
 *
 * Generated furniture is overwhelmingly axis-aligned slabs — a wardrobe, a
 * desk, a bed frame — so the classic answer applies: project each vertex along
 * whichever axis its normal points down, and take the other two coordinates as
 * `uv`. No unwrapping, no seam layout, no per-asset authoring, and grain runs
 * the right way on every face of a box.
 *
 * Two properties matter more than elegance here:
 *
 *  - **World-scaled.** `metresPerTile` means a texture tiles at the same
 *    physical size on a 2 m wardrobe and a 45 cm nightstand, so the two read as
 *    the same oak rather than as two different woods.
 *  - **Sign-corrected.** Projecting a back face with the same handedness as the
 *    front mirrors the grain on it. Flipping one axis with the normal's sign
 *    keeps the pattern running consistently around the piece.
 *
 * What it does *not* do is handle organic shapes: a chair with swept, blended
 * normals gets a visible seam where the dominant axis flips. That is fine for
 * what it is used on, and it is the reason photoscans keep their authored UVs
 * instead of going through this.
 */

/** Axis a normal points down, as an index into `[x, y, z]`. */
function dominantAxis(nx: number, ny: number, nz: number): 0 | 1 | 2 {
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  if (ax >= ay && ax >= az) return 0
  return ay >= az ? 1 : 2
}

/**
 * Box-project a mesh into texture coordinates.
 *
 * @param position  flat `[x, y, z, …]` vertex positions, in metres
 * @param normal    flat `[x, y, z, …]` vertex normals, same vertex count
 * @param metresPerTile  world size of one texture repeat; larger tiles the
 *   texture less often. Must be positive — a non-positive value falls back to 1
 *   rather than producing infinities.
 * @returns flat `[u, v, …]`, two entries per vertex
 */
export function boxProjectUV(
  position: ArrayLike<number>,
  normal: ArrayLike<number>,
  metresPerTile = 1,
): Float32Array {
  const count = Math.floor(position.length / 3)
  const uv = new Float32Array(count * 2)
  const scale = metresPerTile > 0 && Number.isFinite(metresPerTile) ? 1 / metresPerTile : 1

  for (let i = 0; i < count; i++) {
    const px = position[i * 3]
    const py = position[i * 3 + 1]
    const pz = position[i * 3 + 2]

    // A missing or degenerate normal would otherwise pick an arbitrary axis and
    // scatter the vertex somewhere unrelated to its neighbours.
    const nx = normal[i * 3] ?? 0
    const ny = normal[i * 3 + 1] ?? 0
    const nz = normal[i * 3 + 2] ?? 0
    const axis = Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)
      ? dominantAxis(nx, ny, nz)
      : 1

    let u: number
    let v: number
    if (axis === 0) {
      // Facing ±X: the face lies in the Z/Y plane.
      u = nx >= 0 ? -pz : pz
      v = py
    } else if (axis === 1) {
      // Facing ±Y: the face lies in the X/Z plane.
      u = px
      v = ny >= 0 ? pz : -pz
    } else {
      // Facing ±Z: the face lies in the X/Y plane.
      u = nz >= 0 ? px : -px
      v = py
    }

    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }
  return uv
}
