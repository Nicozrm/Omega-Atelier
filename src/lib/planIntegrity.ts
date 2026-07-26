import type { Floor, PlacedFurniture, PlanDocument } from '@/types'

/**
 * planIntegrity.ts — the renderer-neutral **plan-integrity domain**.
 *
 * A single source of truth for "does this floor plan hold up without tolerance":
 * no furniture visually *stacking* into other furniture, no door or window wider
 * than the wall it sits in, nothing spilling outside the building envelope. Pure
 * geometry — no THREE, no React, no rendering — so the 2D editor, the 3D view and
 * the template authoring all judge a plan by the same rules.
 *
 * The judgement the checker gets right is *intent*. Two objects sharing floor
 * coordinates are only a defect when the overlap is a real clip, not a designed
 * layering:
 *   - **footprint** — a rug lies *under* the sofa, a pendant hangs *over* the
 *     table, a picture sits *on* the wall. Only floor-standing (`solid`) pieces
 *     are checked at all.
 *   - **layering** — a dining chair tucks *under* its table, a coffee table sits
 *     in an L-sofa's opening. Those category pairings are expected and allowed.
 *   - **pools** — nothing floating in the water: any solid piece overlapping a
 *     pool is always a defect, regardless of the layering allow-list.
 *
 * Calibrated against the hand-authored demo apartment (a plan considered correct)
 * so it raises real stacking without false alarms on good layouts.
 */

// ── Footprint classification ────────────────────────────────
export type Footprint = 'solid' | 'flat' | 'mounted'

/** Ceiling-hung pieces (occupy no floor) not caught by the thin-panel rule. */
const CEILING_MOUNTED = new Set(['pendant-lamp', 'ceiling-panel', 'gym-rings', 'branch-lights'])
/** Floor coverings — they lie under other furniture and never collide. */
const FLAT_IDS = new Set(['fur-rug', 'bath-mat'])

/**
 * Where a piece lives relative to the floor:
 *  - `flat`    — floor covering (rug/mat): under everything, never collides.
 *  - `mounted` — wall/ceiling-mounted (picture, mirror, pendant, screen …):
 *                above the floor, never collides with floor-standing furniture.
 *  - `solid`   — floor-standing furniture: must not stack into another `solid`.
 *
 * Wall panels are detected generically (thin along one edge) so the rule keeps
 * working as the catalog grows, not just for a hard-coded id list.
 */
export function furnitureFootprint(id: string, size: readonly [number, number]): Footprint {
  if (/^rug-/.test(id) || FLAT_IDS.has(id)) return 'flat'
  if (CEILING_MOUNTED.has(id)) return 'mounted'
  if (Math.min(size[0], size[1]) <= 12) return 'mounted' // thin panel hung on a wall
  return 'solid'
}

/** A pool is an object you never place furniture *inside* — treated specially. */
export function isPool(id: string): boolean {
  return /^pool/.test(id)
}

/**
 * Category pairs whose overlap is an intended layering, not a clip — a dining
 * chair under its table, a coffee table in an L-sofa's opening, a nightstand
 * against the bed. Keyed as sorted `"catA|catB"`. Pool overlaps are never
 * excused by this list.
 */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}
const INTENDED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['chair', 'table'], ['chair', 'kitchen'], ['chair', 'storage'], ['chair', 'sofa'], ['chair', 'outdoor'],
  ['sofa', 'table'], ['sofa', 'storage'], ['sofa', 'outdoor'], ['sofa', 'sofa'], ['bed', 'storage'],
]
export const INTENDED_LAYERING: ReadonlySet<string> = new Set(INTENDED_PAIRS.map(([a, b]) => pairKey(a, b)))

// ── Oriented-bounding-box geometry ─────────────────────────
type Vec = readonly [number, number]

/** The four world-space corners of a centre-anchored, rotated box. */
export function obbCorners(cx: number, cy: number, w: number, h: number, rotationDeg: number): Vec[] {
  const r = (rotationDeg * Math.PI) / 180
  const c = Math.cos(r), s = Math.sin(r), hw = w / 2, hh = h / 2
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as Vec[]).map(
    ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Vec,
  )
}

function edgeAxes(poly: Vec[]): Vec[] {
  const axes: Vec[] = []
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    const ex = q[0] - p[0], ey = q[1] - p[1], len = Math.hypot(ex, ey) || 1
    axes.push([-ey / len, ex / len])
  }
  return axes
}

function projectExtent(poly: Vec[], axis: Vec): [number, number] {
  let min = Infinity, max = -Infinity
  for (const p of poly) {
    const d = p[0] * axis[0] + p[1] * axis[1]
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/**
 * Penetration depth (cm) of two oriented boxes via the Separating-Axis Theorem.
 * 0 when they are apart or merely touching; a positive value is the smallest
 * overlap across all candidate axes, i.e. how deep one clips into the other.
 */
export function obbPenetration(a: Vec[], b: Vec[]): number {
  let min = Infinity
  for (const axis of [...edgeAxes(a), ...edgeAxes(b)]) {
    const [amin, amax] = projectExtent(a, axis)
    const [bmin, bmax] = projectExtent(b, axis)
    const overlap = Math.min(amax, bmax) - Math.max(amin, bmin)
    if (overlap <= 0) return 0 // a separating axis exists → no penetration
    if (overlap < min) min = overlap
  }
  return min
}

// ── Issues ─────────────────────────────────────────────────
export type IntegrityKind = 'furniture-overlap' | 'furniture-in-pool' | 'opening-overflow' | 'furniture-out-of-bounds'

export interface IntegrityIssue {
  kind: IntegrityKind
  floor: string
  message: string
  /** Overlap depth or overflow amount, cm (where meaningful). */
  amount?: number
}

export interface IntegrityOptions {
  /**
   * Solid pieces may touch; only penetration deeper than this (cm) is a defect.
   * Default 3 cm absorbs authoring round-off without hiding real stacking.
   */
  overlapTolerance?: number
  /** Minimum reveal (cm) required on each side of a door/window. Default 6. */
  jamb?: number
  /** How far (cm) a solid piece may extend past the floor extent. Default 6. */
  boundsTolerance?: number
  /** Catalog category of a furniture id — drives the intended-layering allow-list. */
  categoryOf?: (furnitureId: string) => string | undefined
  /** Resolve a piece's footprint size when it carries none (defaults to `f.size`). */
  sizeOf?: (f: PlacedFurniture) => readonly [number, number] | undefined
}

function sizeFor(f: PlacedFurniture, opts: IntegrityOptions): readonly [number, number] | undefined {
  return f.size ?? opts.sizeOf?.(f)
}

/** Check one floor for stacking, oversized openings and out-of-envelope pieces. */
export function checkFloorIntegrity(floor: Floor, opts: IntegrityOptions = {}): IntegrityIssue[] {
  const tol = opts.overlapTolerance ?? 3
  const jamb = opts.jamb ?? 6
  const bounds = opts.boundsTolerance ?? 6
  const catOf = opts.categoryOf ?? (() => undefined)
  const issues: IntegrityIssue[] = []

  const solids = floor.furniture
    .map((f) => ({ f, size: sizeFor(f, opts) }))
    .filter((x): x is { f: PlacedFurniture; size: readonly [number, number] } =>
      !!x.size && furnitureFootprint(x.f.furnitureId, x.size) === 'solid')
  const boxes = solids.map(({ f, size }) => obbCorners(f.position.x, f.position.y, size[0], size[1], f.rotation ?? 0))

  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const depth = obbPenetration(boxes[i], boxes[j])
      if (depth <= tol) continue
      const a = solids[i].f, b = solids[j].f
      const aPool = isPool(a.furnitureId), bPool = isPool(b.furnitureId)
      if (aPool || bPool) {
        // Nothing floats in the pool — never excused by the layering list.
        if (aPool !== bPool) {
          const piece = aPool ? b : a, pool = aPool ? a : b
          issues.push({
            kind: 'furniture-in-pool', floor: floor.name, amount: depth,
            message: `${piece.furnitureId} @(${piece.position.x},${piece.position.y}) sits ${depth.toFixed(0)}cm inside ${pool.furnitureId} @(${pool.position.x},${pool.position.y})`,
          })
        } else {
          issues.push({
            kind: 'furniture-overlap', floor: floor.name, amount: depth,
            message: `${a.furnitureId} overlaps ${b.furnitureId} by ${depth.toFixed(0)}cm`,
          })
        }
        continue
      }
      const ca = catOf(a.furnitureId), cb = catOf(b.furnitureId)
      if (ca && cb && INTENDED_LAYERING.has(pairKey(ca, cb))) continue // designed layering
      issues.push({
        kind: 'furniture-overlap', floor: floor.name, amount: depth,
        message: `${a.furnitureId} @(${a.position.x},${a.position.y}) stacks into ${b.furnitureId} @(${b.position.x},${b.position.y}) by ${depth.toFixed(0)}cm`,
      })
    }
  }

  // Out-of-envelope solids.
  for (let i = 0; i < solids.length; i++) {
    const c = boxes[i]
    const minX = Math.min(...c.map((p) => p[0])), maxX = Math.max(...c.map((p) => p[0]))
    const minY = Math.min(...c.map((p) => p[1])), maxY = Math.max(...c.map((p) => p[1]))
    if (minX < -bounds || minY < -bounds || maxX > floor.extent.width + bounds || maxY > floor.extent.height + bounds) {
      issues.push({
        kind: 'furniture-out-of-bounds', floor: floor.name,
        message: `${solids[i].f.furnitureId} @(${solids[i].f.position.x},${solids[i].f.position.y}) extends outside the ${floor.extent.width}×${floor.extent.height} floor`,
      })
    }
  }

  // Openings that don't fit their wall.
  for (const w of floor.walls) {
    if (w.subtype !== 'door' && w.subtype !== 'window') continue
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
    const ow = w.openingWidth ?? 0
    const maxOpening = len - 2 * jamb
    if (ow > maxOpening) {
      issues.push({
        kind: 'opening-overflow', floor: floor.name, amount: ow - maxOpening,
        message: `${w.subtype} opening ${ow}cm leaves <${jamb}cm reveal on a ${len.toFixed(0)}cm wall (@${w.a.x},${w.a.y}→${w.b.x},${w.b.y})`,
      })
    }
  }

  return issues
}

/** Check every floor of a plan. */
export function checkPlanIntegrity(doc: PlanDocument, opts: IntegrityOptions = {}): IntegrityIssue[] {
  return doc.floors.flatMap((f) => checkFloorIntegrity(f, opts))
}
