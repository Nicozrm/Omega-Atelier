/**
 * shadowFrustum.ts — how much ground the sun's shadow map has to cover.
 *
 * A directional light's shadow map is an orthographic render: a fixed budget of
 * texels spread evenly over the frustum's footprint. Halving the area covered
 * therefore doubles the shadow resolution at no cost, which makes the frustum's
 * size and placement the single biggest lever on shadow quality.
 *
 * Pure geometry, no THREE types — the renderer just feeds the result into the
 * light's shadow camera.
 */

/** Vertical extent to cover, metres — comfortably above the roof ridge. */
export const SITE_HEIGHT = 9
/** Bounds on the margin around the footprint, metres. */
export const MIN_SITE_MARGIN = 2
export const MAX_SITE_MARGIN = 4

/**
 * Margin around the plan footprint, metres — terrace, fence line and the near
 * half of the parking court.
 *
 * Scales with the plan rather than being fixed, because both ends matter. A
 * fixed 4 m swamps a small apartment: it would make the frustum *larger* than
 * the origin-centred one it replaces, trading away the very sharpness this is
 * meant to buy. And the grounds that need covering — terrace, fences, court —
 * grow with the property, which grows with the house.
 *
 * Capped at 4 m. The parking court's far edge reaches ~5.7 m past the terrace,
 * but a margin wide enough to swallow it costs the house its shadow resolution
 * to gain self-shadowing on background cars. The house wins.
 */
export function siteMargin(widthM: number, heightM: number): number {
  const quarter = 0.25 * Math.max(widthM, heightM)
  return Math.min(MAX_SITE_MARGIN, Math.max(MIN_SITE_MARGIN, quarter))
}

/**
 * Half-extent of the shadow frustum for a plan of `widthM` × `heightM`, in
 * metres. The frustum is a square of side `2 × radius`, centred on the plan.
 *
 * This is the radius of the bounding **sphere** around the site rather than the
 * bounds projected along the current sun direction. A sphere is rotation
 * invariant, so the frustum keeps exactly the same size as the sun swings
 * through the day: shadow texel density never changes, and scrubbing the time
 * slider cannot make shadow edges crawl or shimmer as the map is refitted.
 */
export function shadowRadius(widthM: number, heightM: number): number {
  const margin = siteMargin(widthM, heightM)
  const x = widthM + margin * 2
  const z = heightM + margin * 2
  return 0.5 * Math.hypot(x, z, SITE_HEIGHT)
}

/**
 * Distance to place the light along the sun vector, metres.
 *
 * A directional light shades purely by direction, so this distance is invisible
 * in the shading — it only decides where the shadow camera's depth range sits.
 * Keeping it just clear of the bounding sphere lets `near`/`far` hug the site,
 * which is what buys back the depth precision that keeps the depth bias small
 * and contact points tight.
 */
export function sunDistance(radius: number): number {
  return radius + 10
}

/** World size of one shadow texel, in metres. */
export function shadowTexelSize(radius: number, mapSize: number): number {
  return (2 * radius) / Math.max(1, mapSize)
}

/**
 * Depth and normal bias for the sun's shadow map.
 *
 * Both used to be constants — `bias: -0.0002`, `normalBias: 0.02` — and a
 * constant cannot be right here, because the error they correct is measured in
 * *texels* and a texel is four times wider on `performance` than on `ultra`.
 * With the frustum this scene uses (a ~24 m radius around the plan) one texel is
 * 1.2 cm at 4096² and 4.7 cm at 1024², so the same 2 cm normal offset was under
 * half a texel on the low profile — shadow acne across every sunlit wall — and
 * nearly two texels on the high one, which detaches contact shadows from their
 * casters.
 *
 * Deriving both from the texel size fixes both ends at once:
 *
 *  - **normalBias** pushes the depth lookup along the surface normal, so it has
 *    to clear the worst-case lateral error of the PCF kernel. That is on the
 *    order of one texel; 1.4 gives a margin for the filter width without
 *    visibly lifting the shadow off the floor.
 *  - **bias** is a constant depth offset in normalised units over the shadow
 *    camera's near→far range, which is why it needs that range to be meaningful
 *    at all. Half a texel of depth is enough once the normal offset carries the
 *    slope-dependent part.
 *
 * Clamped at both ends: a tiny frustum must still bias enough to survive depth
 * quantisation, and a huge one must not push shadows off their casters.
 */
export function shadowBiasFor(radius: number, mapSize: number): {
  bias: number
  normalBias: number
  texelSize: number
} {
  const texelSize = shadowTexelSize(radius, mapSize)
  // Depth range of the shadow camera, matching how `SunLight` sets near/far.
  const depthRange = 2 * radius + 2
  return {
    texelSize,
    normalBias: Math.max(0.01, Math.min(0.15, texelSize * 1.4)),
    bias: -Math.max(0.00005, Math.min(0.0015, (texelSize * 0.5) / depthRange)),
  }
}
