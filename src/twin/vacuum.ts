/**
 * vacuum.ts — robot-vacuum domain logic for the Digital Twin.
 *
 * Pure geometry + a pure run state machine, renderer-free and fully testable:
 *
 *  - `planCoveragePath` turns a room polygon into the classic boustrophedon
 *    (serpentine) coverage path a LiDAR robot drives — the signature look of
 *    a robot-vacuum map. Scanline/polygon intersection with even-odd pairing,
 *    lanes connected in alternating direction.
 *  - `createVacuumRun` advances a robot along that path in real time:
 *    position, cleaned stroke, cleaned area (driven length × swath width),
 *    battery drain while driving, recharge on the dock, transit legs (dock →
 *    path start, resume point) and the return-to-dock leg.
 *
 * The UI issues real connector commands (Vacuum activity) and *renders* this
 * run; with a live Tuya/Matter connection the same commands address the real
 * robot and this module keeps providing the map presentation.
 */

export interface VacPoint { x: number; y: number }

/** Total polyline length in cm. */
export function pathLength(pts: VacPoint[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return len
}

/** Point at distance `d` (cm) along the polyline (clamped to its ends). */
export function pointAt(pts: VacPoint[], d: number): VacPoint {
  if (pts.length === 0) return { x: 0, y: 0 }
  if (d <= 0) return { ...pts[0] }
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (d <= seg && seg > 0) {
      const t = d / seg
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    d -= seg
  }
  return { ...pts[pts.length - 1] }
}

/** Signed polygon area (shoelace), cm². */
export function polygonAreaCm2(poly: VacPoint[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return Math.abs(a / 2)
}

/** Polygon centroid (vertex mean — sufficient for label anchors). */
export function polygonCenter(poly: VacPoint[]): VacPoint {
  if (poly.length === 0) return { x: 0, y: 0 }
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

/** Even-odd point-in-polygon (plan cm coordinates). */
export function insidePolygon(p: VacPoint, poly: VacPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Sorted x-intersections of the horizontal scanline `y` with the polygon. */
function scanline(poly: VacPoint[], y: number): number[] {
  const xs: number[] = []
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
  }
  return xs.sort((p, q) => p - q)
}

/**
 * Boustrophedon coverage path for a polygon: horizontal lanes `laneCm` apart,
 * inset by `marginCm` from every edge, driven in alternating direction. Spans
 * of L-shaped rooms are linked in lane order — the short connecting move is
 * exactly the travel stroke a real robot paints.
 */
export function planCoveragePath(polygon: VacPoint[], laneCm = 26, marginCm = 16): VacPoint[] {
  if (polygon.length < 3) return []
  const ys = polygon.map((p) => p.y)
  const y0 = Math.min(...ys) + marginCm
  const y1 = Math.max(...ys) - marginCm
  if (y1 <= y0) return []
  const path: VacPoint[] = []
  let dir = 1
  for (let y = y0; y <= y1 + 1e-6; y += laneCm) {
    const xs = scanline(polygon, y)
    const spans: Array<[number, number]> = []
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = xs[i] + marginCm, b = xs[i + 1] - marginCm
      if (b > a) spans.push([a, b])
    }
    if (spans.length === 0) continue
    if (dir < 0) spans.reverse()
    for (const [a, b] of spans) {
      const from = dir > 0 ? a : b
      const to = dir > 0 ? b : a
      path.push({ x: from, y }, { x: to, y })
    }
    dir = -dir
  }
  return path
}

/**
 * Coverage plan across several rooms: nearest-room-first from `start` (greedy
 * over room centroids — the order a real robot announces), rooms' serpentine
 * paths concatenated. The seams between rooms become plain travel moves.
 */
export function planRooms(rooms: VacPoint[][], start: VacPoint, laneCm = 26, marginCm = 16): VacPoint[] {
  const remaining = rooms
    .map((poly) => ({ poly, center: polygonCenter(poly) }))
    .filter((r) => r.poly.length >= 3)
  const path: VacPoint[] = []
  let cursor = { ...start }
  while (remaining.length > 0) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].center.x - cursor.x, remaining[i].center.y - cursor.y)
      if (d < bestD) { bestD = d; best = i }
    }
    const [room] = remaining.splice(best, 1)
    const leg = planCoveragePath(room.poly, laneCm, marginCm)
    if (leg.length > 0) {
      path.push(...leg)
      cursor = leg[leg.length - 1]
    }
  }
  return path
}

export type VacuumActivity = 'idle' | 'cleaning' | 'returning' | 'docked'

export interface VacuumRunState {
  activity: VacuumActivity
  /** Robot position (plan cm). */
  position: VacPoint
  /** Cleaned stroke — the driven part of the planned path (transit/return legs excluded). */
  trail: VacPoint[]
  /** m² actually covered (driven length × swath width). */
  cleanedAreaM2: number
  batteryPercent: number
  /** Seconds spent on the job (driving; docked idling excluded). */
  durationS: number
  /** 0…1 share of the planned path already driven. */
  progress: number
}

export interface VacuumRunOptions {
  path: VacPoint[]
  dock: VacPoint
  /** Where the robot physically is at run creation. Default: the dock. */
  startPosition?: VacPoint
  batteryPercent?: number
  /** Driving speed, cm/s. Robot-vacuum class ≈ 30. */
  speedCmS?: number
  /**
   * Effective cleaned width per driven cm — the lane spacing of the plan (the
   * lanes tile the room, so driven × swath ≈ room area on completion, exactly
   * the "Reinigungsfläche" a robot app reports).
   */
  swathCm?: number
  /** Battery drain, %/s while driving; recharge is 4× that on the dock. */
  drainPerS?: number
}

export interface VacuumRun {
  state(): VacuumRunState
  /** Begin (or resume) driving the planned path. */
  start(): void
  pause(): void
  /** Abandon the plan and head straight home. */
  returnToDock(): void
  /** Adjust pace mid-run (suction level, mop mode …). */
  setPace(pace: { speedCmS?: number; drainPerS?: number }): void
  /** Advance the simulation by `dtS` seconds. Returns the new state. */
  step(dtS: number): VacuumRunState
}

/** Battery floor below which a run refuses to start / heads home. */
const BATTERY_RESERVE = 2

export function createVacuumRun(opts: VacuumRunOptions): VacuumRun {
  const path = opts.path
  const dock = opts.dock
  const swath = opts.swathCm ?? 26
  let speed = opts.speedCmS ?? 30
  let drain = opts.drainPerS ?? 0.022
  const total = pathLength(path)

  let activity: VacuumActivity = 'docked'
  let driven = 0
  let battery = Math.max(0, Math.min(100, opts.batteryPercent ?? 84))
  let duration = 0
  let position: VacPoint = { ...(opts.startPosition ?? dock) }
  /** Plain travel leg toward the resume point (dock → path start, …). */
  let transit: { from: VacPoint; to: VacPoint; driven: number } | null = null
  /** Return leg (position → dock) progress. */
  let returnLeg: { from: VacPoint; driven: number } | null = null

  const trail = (): VacPoint[] => {
    const t: VacPoint[] = []
    let left = driven
    for (let i = 1; i < path.length && left > 0; i++) {
      const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
      if (t.length === 0) t.push({ ...path[0] })
      if (left >= seg) { t.push({ ...path[i] }); left -= seg }
      else { t.push(pointAt([path[i - 1], path[i]], left)); left = 0 }
    }
    return t
  }

  const state = (): VacuumRunState => ({
    activity,
    position: { ...position },
    trail: trail(),
    cleanedAreaM2: Math.round(((driven * swath) / 10_000) * 10) / 10, // cm² → m², 0.1 steps
    batteryPercent: Math.round(battery * 10) / 10,
    durationS: Math.round(duration),
    progress: total > 0 ? Math.min(1, driven / total) : 0,
  })

  const headHome = (): void => {
    activity = 'returning'
    transit = null
    returnLeg = { from: { ...position }, driven: 0 }
  }

  return {
    state,
    start(): void {
      if (path.length < 2 || battery <= BATTERY_RESERVE || activity === 'cleaning') return
      const resume = pointAt(path, Math.min(driven, total))
      const gap = Math.hypot(position.x - resume.x, position.y - resume.y)
      transit = gap > 1 ? { from: { ...position }, to: resume, driven: 0 } : null
      returnLeg = null
      activity = 'cleaning'
    },
    pause(): void {
      if (activity === 'cleaning' || activity === 'returning') activity = 'idle'
    },
    returnToDock(): void {
      if (activity !== 'docked') headHome()
    },
    setPace(pace: { speedCmS?: number; drainPerS?: number }): void {
      if (pace.speedCmS !== undefined) speed = Math.max(1, pace.speedCmS)
      if (pace.drainPerS !== undefined) drain = Math.max(0, pace.drainPerS)
    },
    step(dtS: number): VacuumRunState {
      if (activity === 'cleaning') {
        duration += dtS
        battery = Math.max(0, battery - drain * dtS)
        if (transit) {
          // Travel move toward the resume point — drives, but does not clean.
          const to = transit.to
          const legLen = Math.hypot(to.x - transit.from.x, to.y - transit.from.y)
          transit.driven = Math.min(transit.driven + speed * 1.15 * dtS, legLen)
          position = pointAt([transit.from, to], transit.driven)
          if (transit.driven >= legLen) { position = { ...to }; transit = null }
        } else {
          driven = Math.min(driven + speed * dtS, total)
          position = pointAt(path, driven)
        }
        if (driven >= total || battery <= BATTERY_RESERVE) headHome()
      } else if (activity === 'returning' && returnLeg) {
        const leg = [returnLeg.from, dock]
        const legLen = pathLength(leg)
        returnLeg.driven = Math.min(returnLeg.driven + speed * 1.4 * dtS, legLen)
        duration += dtS
        battery = Math.max(0, battery - drain * 0.5 * dtS)
        position = pointAt(leg, returnLeg.driven)
        if (returnLeg.driven >= legLen) {
          activity = 'docked'
          position = { ...dock }
          returnLeg = null
        }
      } else if (activity === 'docked') {
        battery = Math.min(100, battery + drain * 4 * dtS)
      }
      return state()
    },
  }
}
