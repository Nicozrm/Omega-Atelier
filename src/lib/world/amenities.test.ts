import { describe, it, expect } from 'vitest'
import { streetFurniture, type FurnitureKind, type StreetFurniture } from './amenities'
import { buildStreetNetwork, type StreetSegment } from './streetNetwork'

/**
 * Street furniture is judged by whether it is *plausible*, not by whether it
 * exists. A bin in the middle of the carriageway and a car parked across the
 * junction are both "placed"; neither survives being looked at.
 *
 * These tests therefore check the rules a planner would check: distance from the
 * kerb, distance from the junction, which way a thing faces, and whether the
 * same seed still produces the same street.
 */

const network = buildStreetNetwork({
  style: 'suburb',
  centre: { x: 0, z: 0 },
  rings: 2,
  seed: 4711,
})
const furniture = streetFurniture(network, 'suburb', 4711)

const of = (kind: FurnitureKind) => furniture.filter((f) => f.kind === kind)

/** Signed distance from the segment's centre line, positive to the right. */
function lateral(seg: StreetSegment, f: StreetFurniture): number {
  const dx = f.at.x - seg.a.x, dz = f.at.z - seg.a.z
  return dx * seg.dir.z + dz * -seg.dir.x
}

/** Distance along the segment from `a`, in metres. */
function along(seg: StreetSegment, f: StreetFurniture): number {
  return (f.at.x - seg.a.x) * seg.dir.x + (f.at.z - seg.a.z) * seg.dir.z
}

/** The segment a piece of furniture belongs to: the one it is nearest. */
function nearestSegment(f: StreetFurniture): StreetSegment {
  let best = network.segments[0]
  let bestD = Infinity
  for (const seg of network.segments) {
    const t = Math.max(0, Math.min(seg.lengthM, along(seg, f)))
    const px = seg.a.x + seg.dir.x * t, pz = seg.a.z + seg.dir.z * t
    const d = Math.hypot(f.at.x - px, f.at.z - pz)
    if (d < bestD) { bestD = d; best = seg }
  }
  return best
}

describe('streetFurniture is deterministic', () => {
  it('produces the same street for the same seed', () => {
    const again = streetFurniture(network, 'suburb', 4711)
    expect(again).toEqual(furniture)
  })

  it('produces a different one for a different seed', () => {
    const other = streetFurniture(network, 'suburb', 4712)
    expect(other).not.toEqual(furniture)
  })
})

describe('parked cars', () => {
  const cars = of('parkedCar')

  it('parks some, but nothing like all of them', () => {
    expect(cars.length).toBeGreaterThan(0)
    // A kerb solid with cars is as wrong as an empty one. Bays are 6 m and
    // occupancy is well under half, so this is a generous ceiling.
    const kerbMetres = network.segments.reduce((n, s) => n + s.lengthM, 0)
    expect(cars.length).toBeLessThan(kerbMetres / 6)
  })

  it('stands on the carriageway, not on the pavement', () => {
    for (const c of cars) {
      const seg = nearestSegment(c)
      const d = Math.abs(lateral(seg, c))
      // Inside the kerb line…
      expect(d, c.kind).toBeLessThan(seg.widthM / 2)
      // …and not straddling the centre line.
      expect(d).toBeGreaterThan(seg.widthM / 4)
    }
  })

  it('keeps clear of the junctions', () => {
    for (const c of cars) {
      const seg = nearestSegment(c)
      const t = along(seg, c)
      // Sightlines at the corner. 9 m of clearance, minus half a bay for the
      // car's own centre offset.
      expect(t, 'from a').toBeGreaterThan(6)
      expect(seg.lengthM - t, 'from b').toBeGreaterThan(6)
    }
  })

  it('points along the street it is parked on', () => {
    for (const c of cars) {
      const seg = nearestSegment(c)
      // The model faces +z, so its facing vector is (sin, cos) of the rotation.
      const fx = Math.sin(c.rotationY), fz = Math.cos(c.rotationY)
      const dot = fx * seg.dir.x + fz * seg.dir.z
      // Parallel to the street, either way down it — never across it.
      expect(Math.abs(dot), `${c.at.x},${c.at.z}`).toBeGreaterThan(0.99)
    }
  })

  it('faces with the flow on each kerb', () => {
    for (const c of cars) {
      const seg = nearestSegment(c)
      const right = lateral(seg, c) > 0
      const dot = Math.sin(c.rotationY) * seg.dir.x + Math.cos(c.rotationY) * seg.dir.z
      // Right of travel drives with `dir`, left of it drives against.
      expect(right ? dot : -dot).toBeGreaterThan(0.99)
    }
  })

  it('offers a body colour the renderer can index', () => {
    for (const c of cars) {
      expect(c.variant).toBeTypeOf('number')
      expect(c.variant! >= 0 && c.variant! <= 5).toBe(true)
    }
  })
})

describe('street lamps', () => {
  const lamps = of('lamp')

  it('reaches its arm out over the carriageway', () => {
    for (const l of lamps) {
      const seg = nearestSegment(l)
      const side = Math.sign(lateral(seg, l))
      // Facing (+z turned by rotationY) must point back across the centre line.
      const fx = Math.sin(l.rotationY), fz = Math.cos(l.rotationY)
      const towardRoad = -side * (fx * seg.dir.z + fz * -seg.dir.x)
      expect(towardRoad, `${l.at.x},${l.at.z}`).toBeGreaterThan(0.99)
    }
  })

  it('stands outside the kerb, on the pavement', () => {
    for (const l of lamps) {
      const seg = nearestSegment(l)
      expect(Math.abs(lateral(seg, l))).toBeGreaterThan(seg.widthM / 2)
    }
  })

  it('alternates sides along a segment', () => {
    const seg = network.segments.reduce((a, b) => (b.lengthM > a.lengthM ? b : a))
    const onSeg = lamps
      .filter((l) => nearestSegment(l) === seg)
      .sort((a, b) => along(seg, a) - along(seg, b))
    expect(onSeg.length).toBeGreaterThan(1)
    for (let i = 1; i < onSeg.length; i++) {
      expect(Math.sign(lateral(seg, onSeg[i]))).not.toBe(Math.sign(lateral(seg, onSeg[i - 1])))
    }
  })
})

describe('bus stops come furnished', () => {
  const stops = of('busStop')

  it('has at least one', () => {
    expect(stops.length).toBeGreaterThan(0)
  })

  it('puts a bench and a bin at every shelter', () => {
    for (const stop of stops) {
      const near = (kind: FurnitureKind) => furniture.some((f) =>
        f.kind === kind && Math.hypot(f.at.x - stop.at.x, f.at.z - stop.at.z) < 4)
      expect(near('bench'), 'bench').toBe(true)
      expect(near('litterBin'), 'bin').toBe(true)
    }
  })

  it('turns the shelter toward the carriageway', () => {
    for (const stop of stops) {
      const seg = nearestSegment(stop)
      const side = Math.sign(lateral(seg, stop))
      const fx = Math.sin(stop.rotationY), fz = Math.cos(stop.rotationY)
      const towardRoad = -side * (fx * seg.dir.z + fz * -seg.dir.x)
      expect(towardRoad).toBeGreaterThan(0.99)
    }
  })

  it('seats the bench facing the same way as its shelter', () => {
    for (const stop of stops) {
      const bench = furniture.find((f) =>
        f.kind === 'bench' && Math.hypot(f.at.x - stop.at.x, f.at.z - stop.at.z) < 4)!
      expect(bench.rotationY).toBeCloseTo(stop.rotationY, 6)
    }
  })
})

describe('crossings', () => {
  it('puts a bin where people stop and wait', () => {
    for (const c of of('crossing')) {
      const near = furniture.some((f) =>
        f.kind === 'litterBin' && Math.hypot(f.at.x - c.at.x, f.at.z - c.at.z) < 9)
      expect(near).toBe(true)
    }
  })
})
