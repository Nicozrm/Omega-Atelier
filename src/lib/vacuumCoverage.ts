/**
 * vacuumCoverage — pure geometry for the LIDAR vacuum-map mode.
 *
 * Turns the plan's room polygons (cm) into a realistic robot cleaning route:
 * a boustrophedon (back-and-forth lane) fill per room, rooms chained
 * nearest-neighbour from the dock, with straight travel segments between them.
 * No rendering, no React — just points, so it can be unit-tested and reused.
 */

export interface Pt { x: number; y: number }

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j]
    if ((pi.y > p.y) !== (pj.y > p.y) && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside
    }
  }
  return inside
}

export function bbox(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  return { minX, minY, maxX, maxY }
}

export function centroid(poly: Pt[]): Pt {
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

export function polygonArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

export function pathLength(pts: Pt[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** X spans where a horizontal line at `y` lies inside the polygon (sorted). */
function scanlineSpans(poly: Pt[], y: number): Array<[number, number]> {
  const xs: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > y) !== (b.y > y)) {
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
  }
  xs.sort((m, n) => m - n)
  const spans: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]])
  return spans
}

/**
 * Boustrophedon coverage path for one room polygon.
 * @param laneSpacing distance between lanes (cm) — the cleaning-head width.
 * @param inset       keep-away from walls (cm).
 */
export function coveragePath(poly: Pt[], laneSpacing = 26, inset = 16): Pt[] {
  const { minY, maxY } = bbox(poly)
  const out: Pt[] = []
  let flip = false
  for (let y = minY + inset; y <= maxY - inset + 0.001; y += laneSpacing) {
    const spans = scanlineSpans(poly, y)
    const ordered = flip ? [...spans].reverse() : spans
    for (const span of ordered) {
      let [x0, x1] = span
      x0 += inset; x1 -= inset
      if (x1 <= x0) continue
      out.push(flip ? { x: x1, y } : { x: x0, y }, flip ? { x: x0, y } : { x: x1, y })
    }
    flip = !flip
  }
  return out
}

export interface RouteRoom { id: string; name: string; poly: Pt[] }
export interface RouteSegment { roomId: string; name: string; points: Pt[]; area: number }

/** Order rooms nearest-neighbour from a start point (by centroid). */
export function orderRooms(rooms: RouteRoom[], start: Pt): RouteRoom[] {
  const left = rooms.map((r) => ({ r, c: centroid(r.poly) }))
  const route: RouteRoom[] = []
  let cur = start
  while (left.length) {
    let bi = 0, bd = Infinity
    left.forEach((e, i) => { const d = (e.c.x - cur.x) ** 2 + (e.c.y - cur.y) ** 2; if (d < bd) { bd = d; bi = i } })
    const [chosen] = left.splice(bi, 1)
    route.push(chosen.r)
    cur = chosen.c
  }
  return route
}

/**
 * Full cleaning route from the dock across the given rooms. Each segment holds
 * that room's coverage points; segments are ordered nearest-neighbour and the
 * renderer stitches them with straight travel moves.
 */
export function buildRoute(rooms: RouteRoom[], dock: Pt, laneSpacing = 26, inset = 16): RouteSegment[] {
  return orderRooms(rooms, dock).map((r) => ({
    roomId: r.id,
    name: r.name,
    area: polygonArea(r.poly),
    points: coveragePath(r.poly, laneSpacing, inset),
  })).filter((s) => s.points.length > 0)
}

/** Flatten route segments into one continuous polyline (cm), dock → … → end. */
export function flattenRoute(dock: Pt, segments: RouteSegment[]): Pt[] {
  const pts: Pt[] = [dock]
  for (const seg of segments) for (const p of seg.points) pts.push(p)
  return pts
}

/** Resample a polyline to a fixed step (cm) for smooth motion + trail. */
export function resample(pts: Pt[], step = 4): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen === 0) continue
    let d = step - carry
    while (d < segLen) {
      const t = d / segLen
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      d += step
    }
    carry = segLen - (d - step)
  }
  out.push(pts[pts.length - 1])
  return out
}
