/**
 * modelFit.ts — fit a real 3D asset into the footprint the plan reserved for it.
 *
 * ## Why this is needed at all
 *
 * The planner places furniture by a footprint in centimetres, taken from the
 * catalogue or overridden on the instance. A downloaded asset has its own real
 * dimensions, and the two agree only by accident: measured on this project's
 * first six assets, the potted plant came in at a third of its declared size
 * and the coffee table was turned 90° from the axis convention.
 *
 * The build pipeline squares each asset up against a *reference* footprint, but
 * that is not the end of it — several ids share one file (the three plant sizes),
 * and the user can resize any piece. So the final fit has to happen at draw
 * time, against the footprint of the instance actually being drawn.
 *
 * Pure and renderer-neutral so the arithmetic is unit-testable; the component
 * only multiplies a scale.
 */

/** Model bounding size in metres, `[x, y, z]`. */
export type ModelSize = readonly [number, number, number]

/**
 * Where a piece hangs.
 *
 * The build pipeline seats every asset on the floor, which is right for
 * furniture and wrong for everything mounted. A pendant lamp modelled to sit at
 * y=0 lies on the carpet; a wall mirror leans against the skirting. The
 * procedural meshes these assets replace already knew better — the pendant hangs
 * its shade at 1.75 m under a cord from 2.2 m, the mirror centres at 1.35 m — so
 * the asset path has to know it too.
 */
export type ModelAnchor = 'floor' | 'ceiling' | 'wall'

/** Ceiling height, metres. Matches the 250 cm walls the scene builds. */
export const CEILING_HEIGHT = 2.5
/** Default centre height for wall-mounted pieces, metres. */
export const WALL_MOUNT_HEIGHT = 1.35

/**
 * Uniform scale that fits a model of `size` into a `widthM` × `depthM` footprint.
 *
 * **Uniform, and fitting *inside* the box.** Non-uniform scaling would hit the
 * target exactly and visibly distort the object — a stretched chair reads as
 * broken in a way an undersized one does not. And of the two uniform options,
 * filling the box would let the other axis overflow into neighbouring furniture,
 * so the smaller ratio wins: the piece always stays within the space the plan
 * gave it.
 *
 * Height is deliberately not considered. A footprint says nothing about how tall
 * something is, and scaling a floor lamp down because its base is small would be
 * worse than leaving it at its natural height.
 *
 * @returns the scale factor, or `1` when it cannot be computed (a degenerate
 *   model or a missing footprint) — never `0`, `Infinity` or `NaN`, any of which
 *   would make the asset vanish or blow up.
 */
export function fitScale(size: ModelSize | undefined, widthM: number, depthM: number): number {
  if (!size) return 1
  const [x, , z] = size
  if (!(x > 1e-6) || !(z > 1e-6)) return 1
  if (!(widthM > 1e-6) || !(depthM > 1e-6)) return 1
  const scale = Math.min(widthM / x, depthM / z)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/**
 * Vertical offset (metres) that puts a fitted model where it belongs.
 *
 * Computed from the *fitted* height rather than baked into the asset, because
 * the same asset is fitted differently per instance — a pendant scaled to a
 * smaller footprint hangs shorter, and its cord has to reach the same ceiling.
 *
 * @param size    the model's measured bounding size, metres
 * @param scale   the fit scale from {@link fitScale}
 * @param anchor  how the piece is mounted; `floor` (the default) offsets nothing
 * @param height  ceiling height for `ceiling`, centre height for `wall`
 */
export function anchorOffsetY(
  size: ModelSize | undefined,
  scale: number,
  anchor: ModelAnchor = 'floor',
  height?: number,
): number {
  if (anchor === 'floor' || !size) return 0
  const fittedHeight = size[1] * scale
  if (!Number.isFinite(fittedHeight) || fittedHeight <= 0) return 0
  if (anchor === 'ceiling') {
    // Hang it from the ceiling: its top meets the ceiling, it drops from there.
    return Math.max(0, (height ?? CEILING_HEIGHT) - fittedHeight)
  }
  // Wall: centre the piece at mounting height.
  return Math.max(0, (height ?? WALL_MOUNT_HEIGHT) - fittedHeight / 2)
}
