/**
 * snapEngine.ts — where a drawn point actually lands.
 *
 * ## The problem it solves
 *
 * The editor used to snap one way: round the cursor to the grid. That works
 * exactly as long as everything in the plan is already *on* the grid, and
 * nothing in this product guarantees that. The AI Home Composer generates
 * plans from real geometry, so its walls sit at whatever coordinates the
 * building has. Resized rooms, imported plans and any wall drawn with snapping
 * switched off all land off-grid too. From then on the grid is not a shared
 * lattice, it is a second lattice — and a wall drawn "onto" an existing corner
 * misses it by a few centimetres.
 *
 * Those few centimetres are not cosmetic. A gap where two walls should meet is
 * what breaks room detection, leaves a slit of daylight in the 3D view, and
 * makes the wall join render as two stubs instead of a corner.
 *
 * ## The model
 *
 * A set of **candidates**, resolved by *kind* rather than by distance. That
 * ordering is the whole design: a wall endpoint 8 cm from the cursor beats a
 * grid intersection 1 cm from it, because "meet that corner" is what the user
 * meant and "land on a round number" is only ever a fallback. Distance decides
 * *within* a kind, never between kinds.
 *
 *   endpoint → midpoint → on-segment → extension → axis → angle → grid
 *
 *  - **endpoint** — an existing wall's corner. The one that matters most: it is
 *    the only snap that guarantees a watertight join.
 *  - **midpoint** — the centre of a wall, for centring a doorway or a partition.
 *  - **on-segment** — the perpendicular foot on a wall, so a new wall starts
 *    flush against an existing face instead of near it.
 *  - **extension** — the wall's own line continued past its ends, which is how
 *    you draw a wall collinear with one already there.
 *  - **axis** — shares an x or a y with an existing corner. Hitting both at once
 *    infers an intersection that exists in the drawing but not in the geometry,
 *    which is how rectangular rooms get closed exactly.
 *  - **angle** — the direction from the segment's origin, rounded to a step.
 *  - **grid** — the old behaviour, still the floor.
 *
 * ## Two rules worth stating
 *
 * **Tolerance is a screen distance, expressed in world units.** The caller
 * divides a pixel radius by the zoom before calling, so the magnet feels the
 * same at every zoom level instead of swallowing whole rooms when zoomed out.
 *
 * **A lock is a lock.** When the user holds the angle-lock modifier they have
 * asked for a specific direction, so the constrained ray wins outright and the
 * geometry snaps are not consulted. Everything else is an assist and defers to
 * a real piece of geometry.
 *
 * Pure: no React, no canvas, no store. Every branch here is a unit test.
 */

import type { Point } from '@/types'

/** Which candidate produced the result. `'none'` = the raw cursor, unchanged. */
export type SnapKind =
  | 'endpoint' | 'midpoint' | 'segment' | 'extension'
  | 'axis' | 'angle' | 'grid' | 'none'

/** A line the view should draw to explain *why* the point moved where it did. */
export interface SnapGuide {
  kind: 'axis' | 'extension' | 'angle'
  a: Point
  b: Point
}

export interface SnapResult {
  /** Where the point landed. */
  point: Point
  kind: SnapKind
  /**
   * The geometry the snap latched onto — an endpoint, a midpoint, the foot of
   * the projection. Absent for grid/angle/none. The view draws a marker here.
   */
  anchor?: Point
  /** Explanatory lines, already in world coordinates. Often empty. */
  guides: SnapGuide[]
}

/** Just enough of a `Wall` to snap to — keeps the engine free of the plan model. */
export interface SnapSegment {
  a: Point
  b: Point
}

export interface SnapOptions {
  /** Walls to snap against. Order is irrelevant; ties break on distance. */
  segments: readonly SnapSegment[]
  /** Snap radius in **world units (cm)**. Derived from a pixel radius / zoom. */
  tolerance: number
  /** Grid step in cm. `0` disables the grid fallback. */
  gridStep: number
  /** Snap to the grid at all (`settings.snap`). */
  grid: boolean
  /** Snap to geometry at all (`settings.magnet`). */
  magnet: boolean
  /**
   * The point the segment being drawn starts from. Enables the angle candidate
   * and the angle lock; absent when placing a standalone point.
   */
  origin?: Point
  /** The user is holding the constrain modifier (Shift). */
  angleLock?: boolean
  /** Allowed directions when locked or assisting, in degrees. */
  angleStep?: number
  /** Exclude a wall from consideration — the one currently being dragged. */
  ignore?: (segment: SnapSegment, index: number) => boolean
}

const DEFAULT_ANGLE_STEP = 15

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return dx * dx + dy * dy
}

function roundTo(n: number, step: number): number {
  return step > 0 ? Math.round(n / step) * step : n
}

/**
 * Distinct corners in the plan, for the axis candidate.
 *
 * Deduplicated on a 0.1 cm lattice: a corner where three walls meet is three
 * identical endpoints, and without this the "nearest aligned vertex" search
 * would keep rediscovering the same point and the guide would flicker between
 * coincident anchors.
 */
export function collectVertices(segments: readonly SnapSegment[]): Point[] {
  const seen = new Set<string>()
  const out: Point[] = []
  for (const s of segments) {
    for (const p of [s.a, s.b]) {
      const key = `${Math.round(p.x * 10)}:${Math.round(p.y * 10)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/**
 * Project `p` onto the segment. `t` is the position along it, **unclamped**, so
 * the caller can tell an on-segment hit (0…1) from an extension (outside).
 */
export function projectOnSegment(p: Point, s: SnapSegment): { point: Point; t: number; distance: number } {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y
  const len2 = dx * dx + dy * dy
  // A degenerate wall is a point: every projection lands on it.
  if (len2 === 0) return { point: { ...s.a }, t: 0, distance: Math.hypot(p.x - s.a.x, p.y - s.a.y) }
  const t = ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2
  const point = { x: s.a.x + t * dx, y: s.a.y + t * dy }
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) }
}

/**
 * Constrain a point to the nearest allowed direction from `origin`, and round
 * the distance along that direction to the grid.
 *
 * Both halves matter: the angle alone gives a clean direction at a ragged
 * length, and CAD users expect "3.00 m at 90°", not "2.97 m at 90°".
 */
export function constrainToAngle(
  origin: Point, p: Point, angleStep: number, gridStep: number,
): Point {
  const dx = p.x - origin.x, dy = p.y - origin.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return { ...origin }
  const step = (Math.max(1, angleStep) * Math.PI) / 180
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  // At least one grid step: rounding a 4 cm nudge to 0 would collapse the wall.
  const snapped = gridStep > 0 ? Math.max(gridStep, roundTo(length, gridStep)) : length
  return { x: origin.x + Math.cos(angle) * snapped, y: origin.y + Math.sin(angle) * snapped }
}

/**
 * Resolve where a raw world point should land.
 *
 * Always returns a point — `kind: 'none'` when every candidate is switched off,
 * which is what "snapping disabled" should feel like rather than an error.
 */
export function resolveSnap(raw: Point, opts: SnapOptions): SnapResult {
  const {
    segments, tolerance, gridStep, grid, magnet,
    origin, angleLock = false, angleStep = DEFAULT_ANGLE_STEP, ignore,
  } = opts

  // ── The lock short-circuits everything ──────────────────────────────
  // An explicit constraint is an instruction, not a hint: consulting the
  // geometry snaps here would let a stray corner pull the wall off the very
  // angle the user is holding a key to enforce.
  if (angleLock && origin) {
    const point = constrainToAngle(origin, raw, angleStep, grid ? gridStep : 0)
    return { point, kind: 'angle', guides: [{ kind: 'angle', a: origin, b: point }] }
  }

  const active = ignore ? segments.filter((s, i) => !ignore(s, i)) : segments
  const tol2 = tolerance * tolerance

  if (magnet && tolerance > 0) {
    // ── 1. Endpoints ──────────────────────────────────────────────────
    let endpoint: { p: Point; d2: number } | null = null
    for (const s of active) {
      for (const v of [s.a, s.b]) {
        const d2 = dist2(raw, v)
        if (d2 <= tol2 && (!endpoint || d2 < endpoint.d2)) endpoint = { p: v, d2 }
      }
    }
    if (endpoint) return { point: { ...endpoint.p }, kind: 'endpoint', anchor: { ...endpoint.p }, guides: [] }

    // ── 2. Midpoints ──────────────────────────────────────────────────
    let midpoint: { p: Point; d2: number } | null = null
    for (const s of active) {
      const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
      const d2 = dist2(raw, mid)
      if (d2 <= tol2 && (!midpoint || d2 < midpoint.d2)) midpoint = { p: mid, d2 }
    }
    if (midpoint) return { point: { ...midpoint.p }, kind: 'midpoint', anchor: { ...midpoint.p }, guides: [] }

    // ── 3. On-segment, and 4. extension ───────────────────────────────
    // One pass: the projection tells us which of the two it is. Extensions are
    // bounded to one segment length past each end — an unbounded line from
    // every wall in the plan would carpet the canvas with invisible magnets.
    let onSeg: { p: Point; d2: number } | null = null
    let onExt: { p: Point; d2: number; s: SnapSegment } | null = null
    for (const s of active) {
      const { point, t, distance } = projectOnSegment(raw, s)
      if (distance > tolerance) continue
      const d2 = distance * distance
      if (t >= 0 && t <= 1) {
        if (!onSeg || d2 < onSeg.d2) onSeg = { p: point, d2 }
      } else if (t >= -1 && t <= 2) {
        if (!onExt || d2 < onExt.d2) onExt = { p: point, d2, s }
      }
    }
    if (onSeg) return { point: { ...onSeg.p }, kind: 'segment', anchor: { ...onSeg.p }, guides: [] }
    if (onExt) {
      // The guide runs from the wall's nearer end out to the snapped point, so
      // it reads as "this wall, continued".
      const near = dist2(onExt.p, onExt.s.a) < dist2(onExt.p, onExt.s.b) ? onExt.s.a : onExt.s.b
      return {
        point: { ...onExt.p },
        kind: 'extension',
        anchor: { ...onExt.p },
        guides: [{ kind: 'extension', a: { ...near }, b: { ...onExt.p } }],
      }
    }

    // ── 5. Axis alignment with an existing corner ─────────────────────
    // Kept last among the geometry candidates because it is the only one that
    // does not put the point *on* anything — it lines it up with something.
    let alignX: Point | null = null
    let alignY: Point | null = null
    for (const v of collectVertices(active)) {
      if (Math.abs(v.x - raw.x) <= tolerance && (!alignX || Math.abs(v.x - raw.x) < Math.abs(alignX.x - raw.x))) alignX = v
      if (Math.abs(v.y - raw.y) <= tolerance && (!alignY || Math.abs(v.y - raw.y) < Math.abs(alignY.y - raw.y))) alignY = v
    }
    if (alignX || alignY) {
      const point = { x: alignX ? alignX.x : raw.x, y: alignY ? alignY.y : raw.y }
      const guides: SnapGuide[] = []
      if (alignX) guides.push({ kind: 'axis', a: { ...alignX }, b: { ...point } })
      if (alignY) guides.push({ kind: 'axis', a: { ...alignY }, b: { ...point } })
      return { point, kind: 'axis', guides }
    }
  }

  // ── 6. Angle assist ─────────────────────────────────────────────────
  // Unlocked, so it only fires when the cursor is already within `tolerance` of
  // the ideal ray. Measuring the *perpendicular* offset rather than the angle
  // makes the window tighten as the wall gets longer, which is what keeps a
  // six-metre wall from being nudged half a degree off true.
  if (origin && angleStep > 0) {
    const straight = constrainToAngle(origin, raw, angleStep, 0)
    if (dist2(raw, straight) <= tol2) {
      const point = grid && gridStep > 0
        ? constrainToAngle(origin, raw, angleStep, gridStep)
        : straight
      return { point, kind: 'angle', guides: [{ kind: 'angle', a: { ...origin }, b: point }] }
    }
  }

  // ── 7. Grid ─────────────────────────────────────────────────────────
  if (grid && gridStep > 0) {
    return { point: { x: roundTo(raw.x, gridStep), y: roundTo(raw.y, gridStep) }, kind: 'grid', guides: [] }
  }

  return { point: { ...raw }, kind: 'none', guides: [] }
}

/** Human-readable label for the snap indicator. */
export function snapLabel(kind: SnapKind): string | null {
  switch (kind) {
    case 'endpoint': return 'Eckpunkt'
    case 'midpoint': return 'Mitte'
    case 'segment': return 'Auf Wand'
    case 'extension': return 'Verlängerung'
    case 'axis': return 'Flucht'
    case 'angle': return 'Winkel'
    default: return null
  }
}
