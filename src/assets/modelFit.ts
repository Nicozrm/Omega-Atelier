/**
 * modelFit.ts — where a real 3D asset sits once it has been fitted.
 *
 * The *scaling* half lives in `modelRegistry.fitScale`, which knows about the
 * per-axis `stretch`/`uniform` modes. This module owns the other half: assets
 * are authored and built standing on the floor, and not everything stands.
 *
 * Pure and renderer-neutral so the arithmetic is unit-testable; the component
 * only adds an offset.
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
