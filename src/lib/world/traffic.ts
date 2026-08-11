/**
 * traffic.ts — movement over the street graph.
 *
 * Vehicles and people do not wander: they follow routes built from the very
 * same {@link StreetNetwork} the asphalt is drawn from. A route is a polyline
 * along the right-hand lane (or the pavement, for people), with its corners
 * rounded so a car leans into a junction instead of pivoting on the spot.
 *
 * The module is pure and frame-independent: {@link sampleRoute} maps a distance
 * travelled to a position, a heading and an indicator state, so the renderer's
 * only job each frame is to advance a scalar and read the result. That keeps the
 * whole living layer testable, deterministic, and free of per-frame allocation.
 */

import { SeededRng, hashInts } from '@/lib/composer/rng'
import type { StreetNetwork, StreetSegment, Vec2 } from './streetNetwork'

export type VehicleKind =
  | 'car' | 'van' | 'bus' | 'truck' | 'garbage' | 'ambulance' | 'motorbike' | 'bicycle'

export type PersonKind =
  | 'walker' | 'jogger' | 'dogWalker' | 'stroller' | 'courier' | 'child' | 'gardener'

export interface Route {
  points: Vec2[]
  /** Cumulative arc length at each point; last entry is the total length. */
  cumulative: number[]
  lengthM: number
  /** True when the route returns to its start, so traffic can loop seamlessly. */
  closed: boolean
}

export interface RouteSample {
  at: Vec2
  /** Heading in radians, 0 = +x (east), growing toward +z. */
  heading: number
  /** −1 left, 0 straight, +1 right — drives the indicators. */
  turning: -1 | 0 | 1
  /** Curvature magnitude 0…1 in the current corner, for speed shedding. */
  cornerT: number
}

export interface Vehicle {
  id: string
  kind: VehicleKind
  routeIndex: number
  /** Metres per second at cruise. */
  speedMps: number
  /** Starting distance along the route. */
  offsetM: number
  colorIndex: number
  /** Emergency vehicles run their beacons. */
  beacon: boolean
}

export interface Person {
  id: string
  kind: PersonKind
  routeIndex: number
  speedMps: number
  offsetM: number
  /** Walk direction along the route: +1 forward, −1 backward. */
  dir: 1 | -1
  colorIndex: number
}

const TAU = Math.PI * 2

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/** Wrap an angle difference into (−π, π]. */
function wrapAngle(a: number): number {
  let x = a
  while (x <= -Math.PI) x += TAU
  while (x > Math.PI) x -= TAU
  return x
}

/**
 * Round a polyline's corners with a short quadratic fillet. `radius` is clamped
 * per corner so a fillet never eats more than 40 % of either adjacent leg —
 * short segments then simply keep a tighter corner instead of self-intersecting.
 */
function filletCorners(points: Vec2[], radius: number): Vec2[] {
  if (points.length < 3) return points
  const out: Vec2[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const a = points[i - 1]
    const b = points[i + 1]
    const la = dist(a, p)
    const lb = dist(p, b)
    const r = Math.min(radius, la * 0.4, lb * 0.4)
    if (r < 0.2) { out.push(p); continue }
    const ax = p.x + ((a.x - p.x) / la) * r
    const az = p.z + ((a.z - p.z) / la) * r
    const bx = p.x + ((b.x - p.x) / lb) * r
    const bz = p.z + ((b.z - p.z) / lb) * r
    out.push({ x: ax, z: az })
    // Three interior samples approximate the arc closely enough at this scale.
    for (const t of [0.25, 0.5, 0.75]) {
      const mt = 1 - t
      out.push({
        x: mt * mt * ax + 2 * mt * t * p.x + t * t * bx,
        z: mt * mt * az + 2 * mt * t * p.z + t * t * bz,
      })
    }
    out.push({ x: bx, z: bz })
  }
  out.push(points[points.length - 1])
  return out
}

function makeRoute(points: Vec2[], closed: boolean, filletM = 4): Route {
  const pts = filletCorners(points, filletM)
  const cumulative: number[] = [0]
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1] + dist(pts[i - 1], pts[i]))
  return { points: pts, cumulative, lengthM: cumulative[cumulative.length - 1] || 1, closed }
}

/** Lateral offset to the right of travel along a segment, in world metres. */
function offsetPoint(from: Vec2, to: Vec2, at: Vec2, lateral: number): Vec2 {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const l = Math.hypot(dx, dz) || 1
  // Right of travel on the x/z ground plane.
  return { x: at.x + (dz / l) * lateral, z: at.z - (dx / l) * lateral }
}

/**
 * Build driving routes by walking the graph. Each route keeps to the right-hand
 * lane and never immediately doubles back, so the paths read as real journeys
 * through the estate rather than shuttles on one street.
 */
export function buildVehicleRoutes(network: StreetNetwork, count: number, seed: number): Route[] {
  const rng = new SeededRng(hashInts(seed, 0x54524643))
  const byId = new Map(network.segments.map((s) => [s.id, s]))
  const routes: Route[] = []
  if (network.segments.length === 0) return routes

  for (let r = 0; r < count; r++) {
    // Start on a random segment, preferring the collector for the longer runs.
    const preferCollector = r % 3 === 0
    const pool = preferCollector
      ? network.segments.filter((s) => s.kind === 'collector')
      : network.segments
    const first = pool.length > 0 ? pool[rng.int(0, pool.length - 1)] : network.segments[0]

    let currentSeg: StreetSegment = first
    let currentNode = rng.bool() ? first.from : first.to
    let headNode = currentNode === first.from ? first.to : first.from
    const raw: Vec2[] = []

    const laneFor = (s: StreetSegment) => Math.max(1.1, s.widthM * 0.25)

    const pushLeg = (seg: StreetSegment, fromId: string, toId: string) => {
      const a = network.nodes.get(fromId)!.at
      const b = network.nodes.get(toId)!.at
      const lat = laneFor(seg)
      raw.push(offsetPoint(a, b, a, lat))
      raw.push(offsetPoint(a, b, b, lat))
    }

    pushLeg(currentSeg, currentNode, headNode)

    const steps = rng.int(5, 11)
    for (let s = 0; s < steps; s++) {
      const node = network.nodes.get(headNode)
      if (!node) break
      const options = node.edges
        .map((id) => byId.get(id))
        .filter((sg): sg is StreetSegment => !!sg && sg.id !== currentSeg.id)
      if (options.length === 0) break
      const next = options[rng.int(0, options.length - 1)]
      const nextHead = next.from === headNode ? next.to : next.from
      pushLeg(next, headNode, nextHead)
      currentSeg = next
      currentNode = headNode
      headNode = nextHead
    }

    if (raw.length >= 2) routes.push(makeRoute(dedupe(raw), false, 5))
  }
  return routes
}

/**
 * Pavement routes for people. They hug the kerb on one side of a street and
 * chain a few segments together, so a walker crosses the estate rather than
 * pacing a single frontage.
 */
export function buildWalkRoutes(network: StreetNetwork, count: number, seed: number): Route[] {
  const rng = new SeededRng(hashInts(seed, 0x57414c4b))
  const byId = new Map(network.segments.map((s) => [s.id, s]))
  const routes: Route[] = []
  const walkable = network.segments.filter((s) => s.sidewalkM > 0)
  if (walkable.length === 0) return routes

  for (let r = 0; r < count; r++) {
    const first = walkable[rng.int(0, walkable.length - 1)]
    const side = rng.bool() ? 1 : -1
    let currentSeg = first
    let headNode = rng.bool() ? first.to : first.from
    let tailNode = headNode === first.to ? first.from : first.to
    const raw: Vec2[] = []

    const lat = (s: StreetSegment) => side * (s.widthM / 2 + s.sidewalkM * 0.5)
    const pushLeg = (seg: StreetSegment, fromId: string, toId: string) => {
      const a = network.nodes.get(fromId)!.at
      const b = network.nodes.get(toId)!.at
      raw.push(offsetPoint(a, b, a, lat(seg)))
      raw.push(offsetPoint(a, b, b, lat(seg)))
    }
    pushLeg(currentSeg, tailNode, headNode)

    const steps = rng.int(2, 5)
    for (let s = 0; s < steps; s++) {
      const node = network.nodes.get(headNode)
      if (!node) break
      const options = node.edges
        .map((id) => byId.get(id))
        .filter((sg): sg is StreetSegment => !!sg && sg.sidewalkM > 0 && sg.id !== currentSeg.id)
      if (options.length === 0) break
      const next = options[rng.int(0, options.length - 1)]
      const nextHead = next.from === headNode ? next.to : next.from
      pushLeg(next, headNode, nextHead)
      currentSeg = next
      tailNode = headNode
      headNode = nextHead
    }
    if (raw.length >= 2) routes.push(makeRoute(dedupe(raw), false, 2))
  }
  return routes
}

/** Drop consecutive duplicates that the leg-pushing can produce at junctions. */
function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || dist(last, p) > 0.05) out.push(p)
  }
  return out
}

/**
 * Position, heading and indicator state at a distance along a route.
 *
 * Distance is wrapped with a **ping-pong** rather than a modulo: an open route
 * would otherwise teleport a car from its far end back to its start every lap.
 * Closed routes wrap normally.
 */
export function sampleRoute(route: Route, distanceM: number): RouteSample {
  const total = route.lengthM
  let d: number
  let backwards = false
  if (route.closed) {
    d = ((distanceM % total) + total) % total
  } else {
    const cycle = total * 2
    const phase = ((distanceM % cycle) + cycle) % cycle
    backwards = phase > total
    d = backwards ? cycle - phase : phase
  }

  // Locate the leg containing `d`.
  const cum = route.cumulative
  let i = 1
  // Linear scan is fine: routes are short (tens of points) and this runs a few
  // dozen times per frame at most.
  while (i < cum.length - 1 && cum[i] < d) i++
  const p0 = route.points[i - 1]
  const p1 = route.points[i]
  const legLen = Math.max(0.0001, cum[i] - cum[i - 1])
  const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / legLen))
  const at = { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t }

  const dx = backwards ? p0.x - p1.x : p1.x - p0.x
  const dz = backwards ? p0.z - p1.z : p1.z - p0.z
  const heading = Math.atan2(dz, dx)

  // Look ahead ~12 m to decide whether a corner is coming, and which way.
  const aheadIdx = Math.min(route.points.length - 1, i + (backwards ? -3 : 3))
  const q0 = route.points[Math.max(0, Math.min(route.points.length - 2, backwards ? aheadIdx : i))]
  const q1 = route.points[Math.max(1, Math.min(route.points.length - 1, backwards ? aheadIdx + 1 : aheadIdx))]
  const aheadHeading = Math.atan2(
    backwards ? q0.z - q1.z : q1.z - q0.z,
    backwards ? q0.x - q1.x : q1.x - q0.x,
  )
  const delta = wrapAngle(aheadHeading - heading)
  const cornerT = Math.min(1, Math.abs(delta) / (Math.PI / 2))
  const turning: -1 | 0 | 1 = Math.abs(delta) < 0.25 ? 0 : delta > 0 ? 1 : -1

  return { at, heading, turning, cornerT }
}

/** Populate the streets. Mix and counts scale with the render tier. */
export function buildTraffic(routeCount: number, seed: number, density: number): Vehicle[] {
  const rng = new SeededRng(hashInts(seed, 0x56454843))
  const out: Vehicle[] = []
  if (routeCount === 0) return out

  const count = Math.max(1, Math.round(routeCount * density))
  for (let i = 0; i < count; i++) {
    const roll = rng.next()
    const kind: VehicleKind =
      roll < 0.58 ? 'car'
        : roll < 0.7 ? 'van'
          : roll < 0.78 ? 'bicycle'
            : roll < 0.85 ? 'motorbike'
              : roll < 0.91 ? 'bus'
                : roll < 0.96 ? 'truck'
                  : roll < 0.99 ? 'garbage' : 'ambulance'
    const cruise =
      kind === 'bicycle' ? rng.range(3.6, 5.2)
        : kind === 'bus' || kind === 'garbage' || kind === 'truck' ? rng.range(5.5, 8)
          : kind === 'ambulance' ? rng.range(12, 15)
            : rng.range(7, 11)
    out.push({
      id: `veh-${i}`,
      kind,
      routeIndex: i % routeCount,
      speedMps: cruise,
      offsetM: rng.range(0, 400),
      colorIndex: rng.int(0, 5),
      beacon: kind === 'ambulance',
    })
  }
  return out
}

/** Populate the pavements. */
export function buildPedestrians(routeCount: number, seed: number, density: number): Person[] {
  const rng = new SeededRng(hashInts(seed, 0x50454453))
  const out: Person[] = []
  if (routeCount === 0) return out

  const count = Math.max(1, Math.round(routeCount * density))
  for (let i = 0; i < count; i++) {
    const roll = rng.next()
    const kind: PersonKind =
      roll < 0.34 ? 'walker'
        : roll < 0.5 ? 'dogWalker'
          : roll < 0.62 ? 'jogger'
            : roll < 0.74 ? 'stroller'
              : roll < 0.86 ? 'child'
                : roll < 0.95 ? 'courier' : 'gardener'
    const speed =
      kind === 'jogger' ? rng.range(2.6, 3.4)
        : kind === 'child' ? rng.range(1.4, 2.2)
          : kind === 'stroller' ? rng.range(1.0, 1.3)
            : rng.range(1.2, 1.6)
    out.push({
      id: `ped-${i}`,
      kind,
      routeIndex: i % routeCount,
      speedMps: speed,
      offsetM: rng.range(0, 200),
      dir: rng.bool() ? 1 : -1,
      colorIndex: rng.int(0, 7),
    })
  }
  return out
}
