/**
 * shadow2d.ts — 2D light occlusion for the plan's light pools (pure geometry).
 *
 * A light pool should stop at walls and spill through doorways, like real
 * light. The classic cheap trick: for every solid wall near a light, the wall
 * segment casts a shadow quad — the segment itself plus its two endpoints
 * projected away from the light past the pool's radius. The renderer erases
 * those quads out of the pool's gradient (destination-out), which reads as
 * true occlusion. Pure math here, canvas work stays in the component.
 */

export interface Pt { x: number; y: number }

/** Project `p` away from `light` so it ends up `reach` away from the light.
 *  Returns null when p coincides with the light (no direction). */
export function projectFrom(light: Pt, p: Pt, reach: number): Pt | null {
  const dx = p.x - light.x
  const dy = p.y - light.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-6) return null
  const s = reach / d
  return { x: light.x + dx * s, y: light.y + dy * s }
}

/** Shortest distance from a point to a segment. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

/**
 * The shadow quad cast by segment [a, b] as seen from `light`:
 * [a, b, b projected to `reach`, a projected to `reach`].
 * Returns null when the segment cannot shadow the pool — it lies fully outside
 * `radius`, is degenerate, or the light sits (numerically) on an endpoint.
 */
export function shadowQuad(light: Pt, a: Pt, b: Pt, radius: number, reach: number): [Pt, Pt, Pt, Pt] | null {
  if (distToSegment(light, a, b) > radius) return null
  const pa = projectFrom(light, a, reach)
  const pb = projectFrom(light, b, reach)
  if (!pa || !pb) return null
  return [a, b, pb, pa]
}
