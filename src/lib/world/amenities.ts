/**
 * amenities.ts — the things a neighbourhood needs besides houses.
 *
 * Real estates are not uniform fields of detached homes: there is a small local
 * centre where the collector road passes, a supermarket with a car park and a
 * trolley shelter, a bakery that opens early, a park with a playground, and a
 * bus stop within walking distance of every door. This module decides where all
 * of that goes, using the same planning logic a layout would: retail faces the
 * through road, green space sits inside a block away from traffic, and stops
 * are spaced along the collector rather than scattered.
 *
 * Pure placement — sizes and positions in metres, no meshes.
 */

import { cityStyleSpec, type AmenityKind, type CityStyle } from './cityStyle'
import { SeededRng, hashInts } from '@/lib/composer/rng'
import {
  alongSegment,
  type Block,
  type StreetNetwork,
  type StreetSegment,
  type Vec2,
} from './streetNetwork'
import type { PlotUse } from './plots'

export interface ParkingLot {
  /** Centre of the lot. */
  at: Vec2
  rotationY: number
  /** Bays run in rows; each row is a double-loaded aisle. */
  rows: number
  baysPerRow: number
  bayWidthM: number
  bayDepthM: number
  aisleM: number
  /** Trolley shelters, offset from the lot centre. */
  trolleyShelters: Vec2[]
  /** EV charging bays, offset from the lot centre. */
  chargers: Vec2[]
  /** Which bays are occupied — a bitfield-ish list of indices. */
  occupied: number[]
}

export interface Amenity {
  id: string
  kind: AmenityKind
  at: Vec2
  rotationY: number
  widthM: number
  depthM: number
  heightM: number
  /** Shop sign / stop name shown on the building. */
  label: string
  /** Only supermarkets and fuel stations carry a lot. */
  parking?: ParkingLot
}

export interface PlaygroundSpec {
  at: Vec2
  radiusM: number
  /** Equipment offsets from the centre. */
  items: { kind: 'swing' | 'slide' | 'sandpit' | 'climb' | 'seesaw' | 'bench'; at: Vec2; rotationY: number }[]
}

export interface ParkSpec {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** Gravel path polyline through the park. */
  path: Vec2[]
  pond?: { at: Vec2; radiusM: number }
  playground?: PlaygroundSpec
  /** Free-standing trees, offsets in world metres. */
  trees: { at: Vec2; scale: number }[]
  benches: { at: Vec2; rotationY: number }[]
}

export type FurnitureKind =
  | 'lamp' | 'busStop' | 'hydrant' | 'litterBin' | 'bench' | 'signpost'
  | 'bollard' | 'manhole' | 'drain' | 'cabinet' | 'bikeStand' | 'crossing'
  | 'parkedCar'

export interface StreetFurniture {
  kind: FurnitureKind
  at: Vec2
  rotationY: number
  /** Bus stop names, street names — rendered as a small plate where it matters. */
  label?: string
  /** Opaque variant index — the renderer picks a body colour from it. */
  variant?: number
}

/** Kerbside parking bay length: a car plus room to get out of it. */
const PARKING_BAY_M = 6.0
/** No parking within this distance of a junction. */
const JUNCTION_CLEARANCE_M = 9.0

/*
 * ## Which way a thing faces
 *
 * Rotation used to be decorative here, because everything at the kerb was drawn
 * from boxes and cylinders and most of it was symmetric: a bollard has no front,
 * and neither has a pole with a lump on top. The built models do — a lamp has an
 * arm, a bench has a back, a car has a bonnet — so the two helpers below replace
 * the `seg.horizontal ? 0 : π/2` shorthand that was standing in for them.
 *
 * Both derive from `seg.dir`, so they hold for a segment pointing any of the
 * four ways rather than only for the two the shorthand happened to get right.
 * The lateral convention is `alongSegment`'s: `+side` is the **right of travel**,
 * the direction `(dir.z, −dir.x)`.
 */

/** Rotation that turns a model's front (+z) along the segment. */
function faceAlong(seg: StreetSegment, side: number): number {
  return Math.atan2(seg.dir.x, seg.dir.z) + (side > 0 ? 0 : Math.PI)
}

/**
 * Rotation that turns a model's front (+z) **across** the street, from a thing
 * standing `side` of the centre line back toward the carriageway — which is
 * where a waiting passenger looks and where a street lamp has to reach.
 */
function faceAcross(seg: StreetSegment, side: number): number {
  return Math.atan2(-side * seg.dir.z, side * seg.dir.x)
}

/**
 * Cars parked at the kerb.
 *
 * A residential street with every car on a driveway and none at the kerb reads
 * as a rendering, not as a street. The rules are the ones that actually govern
 * where a car ends up:
 *
 *  - **In bays**, one car length apart, not at arbitrary offsets. Cars queue.
 *  - **Nose to tail along the kerb**, so they face down the street rather than
 *    across it, and on the side they are parked on.
 *  - **Clear of junctions.** Parking up to the corner blocks sightlines, and it
 *    is the first thing that looks wrong when it is missing.
 *  - **Never on the middle of a collector**, where the bus stop is.
 *
 * Occupancy is sparse and seeded, so a street is neither empty nor solid, and
 * the same street looks the same after a reload.
 */
function kerbsideParking(seg: StreetSegment, rng: SeededRng): StreetFurniture[] {
  const out: StreetFurniture[] = []
  const usable = seg.lengthM - 2 * JUNCTION_CLEARANCE_M
  if (usable < PARKING_BAY_M) return out

  const bays = Math.floor(usable / PARKING_BAY_M)
  // Just inside the kerb line, so the car sits on the carriageway edge rather
  // than up on the pavement.
  const lateral = seg.widthM / 2 - 1.1
  const collector = seg.kind === 'collector'
  // A collector carries through traffic and its middle holds the bus stop.
  const occupancy = collector ? 0.22 : 0.42

  for (let i = 0; i < bays; i++) {
    if (!rng.bool(occupancy)) continue
    const distance = JUNCTION_CLEARANCE_M + (i + 0.5) * PARKING_BAY_M
    const t = distance / seg.lengthM
    if (collector && Math.abs(t - 0.5) < 0.12) continue // leave the stop clear
    const side = rng.bool() ? 1 : -1
    out.push({
      kind: 'parkedCar',
      at: alongSegment(seg, t, side * lateral),
      // Nose down the street, and the two kerbs face opposite ways — cars park
      // with the flow, so a row facing both ways is the tell that they were
      // scattered rather than parked.
      rotationY: faceAlong(seg, side),
      variant: rng.int(0, 5),
    })
  }
  return out
}

/**
 * Choose which blocks stop being residential. Exactly one becomes the local
 * centre (always against the collector, so shop traffic never runs through the
 * quiet streets) and one becomes the park (always away from it).
 */
export function assignBlockUse(
  network: StreetNetwork,
  style: CityStyle,
  seed: number,
): Map<string, PlotUse> {
  const use = new Map<string, PlotUse>()
  const spec = cityStyleSpec(style)
  if (network.blocks.length === 0) return use

  const collectorSegments = new Set(
    network.segments.filter((s) => s.kind === 'collector').map((s) => s.id),
  )
  const onCollector = network.blocks.filter(
    (b) => collectorSegments.has(b.northStreet) || collectorSegments.has(b.southStreet),
  )
  const rng = new SeededRng(hashInts(seed, 0x414d4e))

  if (spec.amenities.includes('supermarket') && onCollector.length > 0) {
    // Prefer a block that is off to one side — a centre directly opposite the
    // user's plan would dominate the view from the terrace.
    const sorted = [...onCollector].sort((a, b) => Math.abs(b.gi) - Math.abs(a.gi))
    const pick = sorted[rng.int(0, Math.min(1, sorted.length - 1))]
    use.set(pick.id, 'amenity')
  }

  if (spec.amenities.includes('park')) {
    const inner = network.blocks.filter(
      (b) => use.get(b.id) !== 'amenity' &&
        !collectorSegments.has(b.northStreet) && !collectorSegments.has(b.southStreet) &&
        !(b.gi === 0 && b.gj === 0),
    )
    if (inner.length > 0) use.set(inner[rng.int(0, inner.length - 1)].id, 'green')
  }

  return use
}

/** Build the local centre on the amenity block: supermarket, car park, parade. */
export function buildCentre(block: Block, style: CityStyle, seed: number): Amenity[] {
  const spec = cityStyleSpec(style)
  const rng = new SeededRng(hashInts(seed, 0x43545245))
  const out: Amenity[] = []

  const w = block.maxX - block.minX
  const d = block.maxZ - block.minZ
  const cx = (block.minX + block.maxX) / 2

  // The store sits at the back of the block, the car park between it and the
  // road — the layout every discounter uses, and the reason the lot reads right.
  const storeW = Math.min(w * 0.46, 34)
  const storeD = Math.min(d * 0.36, 24)
  const storeZ = block.minZ + storeD / 2 + 1

  const lotZ = storeZ + storeD / 2 + 14
  const bayWidthM = 2.5
  const bayDepthM = 5
  const rows = 2
  const baysPerRow = Math.max(6, Math.floor((w - 8) / bayWidthM))
  const occupied: number[] = []
  for (let i = 0; i < rows * baysPerRow; i++) if (rng.bool(0.45)) occupied.push(i)

  out.push({
    id: 'am-supermarket',
    kind: 'supermarket',
    at: { x: cx, z: storeZ },
    rotationY: 0,
    widthM: storeW, depthM: storeD, heightM: 6.4,
    label: 'MARKT',
    parking: {
      at: { x: cx, z: lotZ },
      rotationY: 0,
      rows, baysPerRow, bayWidthM, bayDepthM, aisleM: 6,
      trolleyShelters: [
        { x: -storeW * 0.24, z: -bayDepthM - 1.2 },
        { x: storeW * 0.24, z: -bayDepthM - 1.2 },
      ],
      chargers: [
        { x: -baysPerRow * bayWidthM * 0.5 + 1.5, z: -bayDepthM / 2 },
        { x: -baysPerRow * bayWidthM * 0.5 + 4.2, z: -bayDepthM / 2 },
      ],
      occupied,
    },
  })

  // The parade — small units in a row beside the store, each with its own sign.
  const parade: { kind: AmenityKind; label: string }[] = [
    { kind: 'bakery', label: 'BÄCKEREI' },
    { kind: 'cafe', label: 'CAFÉ' },
    { kind: 'pharmacy', label: 'APOTHEKE' },
    { kind: 'kiosk', label: 'KIOSK' },
  ].filter((p) => spec.amenities.includes(p.kind as AmenityKind)) as { kind: AmenityKind; label: string }[]

  // The parade continues the shop line to one side of the store. Units are
  // narrow and butt against each other, the way a real Ladenzeile does.
  const unitW = 6.4
  const startX = cx - storeW / 2 - 0.4
  parade.forEach((p, i) => {
    const x = startX - unitW * (i + 0.5)
    if (x - unitW / 2 < block.minX) return
    out.push({
      id: `am-${p.kind}`,
      kind: p.kind,
      at: { x, z: storeZ + 2 },
      rotationY: 0,
      widthM: unitW, depthM: storeD * 0.62, heightM: 4.2,
      label: p.label,
    })
  })

  if (spec.amenities.includes('fuel')) {
    out.push({
      id: 'am-fuel',
      kind: 'fuel',
      at: { x: block.maxX - 12, z: block.maxZ - 10 },
      rotationY: 0,
      widthM: 18, depthM: 12, heightM: 5.2,
      label: 'TANKSTELLE',
    })
  }

  return out
}

/** Lay out the park block: paths, a pond, a playground and loose trees. */
export function buildPark(block: Block, style: CityStyle, seed: number): ParkSpec {
  const rng = new SeededRng(hashInts(seed, 0x5041524b))
  const cx = (block.minX + block.maxX) / 2
  const cz = (block.minZ + block.maxZ) / 2
  const w = block.maxX - block.minX
  const d = block.maxZ - block.minZ

  // A gentle S through the park rather than a straight line — paths people
  // actually walk are never straight.
  const path: Vec2[] = [
    { x: block.minX + 1, z: cz + d * 0.18 },
    { x: cx - w * 0.2, z: cz - d * 0.1 },
    { x: cx + w * 0.12, z: cz + d * 0.14 },
    { x: block.maxX - 1, z: cz - d * 0.16 },
  ]

  const playground: PlaygroundSpec = {
    at: { x: cx + w * 0.24, z: cz + d * 0.2 },
    radiusM: Math.min(9, Math.min(w, d) * 0.3),
    items: [
      { kind: 'swing', at: { x: -2.6, z: -1.4 }, rotationY: 0 },
      { kind: 'slide', at: { x: 2.2, z: -1.8 }, rotationY: rng.range(-0.4, 0.4) },
      { kind: 'sandpit', at: { x: 0.4, z: 2.2 }, rotationY: 0 },
      { kind: 'climb', at: { x: -2.9, z: 2.4 }, rotationY: rng.range(-0.5, 0.5) },
      { kind: 'seesaw', at: { x: 3.4, z: 2.6 }, rotationY: rng.range(-0.3, 0.3) },
      { kind: 'bench', at: { x: 0, z: -3.6 }, rotationY: 0 },
    ],
  }

  const trees: ParkSpec['trees'] = []
  for (let i = 0; i < 16; i++) {
    const x = rng.range(block.minX + 2, block.maxX - 2)
    const z = rng.range(block.minZ + 2, block.maxZ - 2)
    // Keep the lawn in front of the playground clear.
    if (Math.hypot(x - playground.at.x, z - playground.at.z) < playground.radiusM + 2) continue
    trees.push({ at: { x, z }, scale: rng.range(1.0, 1.9) })
  }

  const benches: ParkSpec['benches'] = []
  for (let i = 1; i < path.length - 1; i++) {
    benches.push({ at: { x: path[i].x + rng.range(-1.5, 1.5), z: path[i].z + 1.6 }, rotationY: rng.range(-0.5, 0.5) })
  }

  return {
    minX: block.minX, maxX: block.maxX, minZ: block.minZ, maxZ: block.maxZ,
    path,
    pond: Math.min(w, d) > 26 ? { at: { x: cx - w * 0.2, z: cz - d * 0.16 }, radiusM: Math.min(8, Math.min(w, d) * 0.22) } : undefined,
    playground,
    trees,
    benches,
  }
}

/**
 * Street furniture along every segment: lamp columns at a regular spacing,
 * drains at the kerb, manholes in the carriageway, plus bus stops, litter bins
 * and cabinets where they belong.
 */
export function streetFurniture(
  network: StreetNetwork,
  style: CityStyle,
  seed: number,
): StreetFurniture[] {
  const spec = cityStyleSpec(style)
  const out: StreetFurniture[] = []
  const rng = new SeededRng(hashInts(seed, 0x464e5254))

  const stopNames = ['Am Anger', 'Lindenweg', 'Schulstraße', 'Marktplatz', 'Ahornring']
  let stopIndex = 0
  let busSpacing = 0

  for (const seg of network.segments) {
    const collector = seg.kind === 'collector'
    const lampSpacing = collector ? 26 : 32
    const lampCount = Math.max(1, Math.floor(seg.lengthM / lampSpacing))
    const kerb = seg.widthM / 2 + spec.street.sidewalkWidthM * 0.55

    for (let i = 0; i < lampCount; i++) {
      const t = (i + 0.5) / lampCount
      // Alternate sides so the light falls evenly across the carriageway.
      const side = i % 2 === 0 ? 1 : -1
      out.push({
        // The column stands at the kerb and its arm reaches out over the
        // carriageway — that overhang is what makes a street lamp read as one
        // rather than as a bollard, and it is why the rotation matters now.
        kind: 'lamp',
        at: alongSegment(seg, t, side * kerb),
        rotationY: faceAcross(seg, side),
      })
    }

    // Drains sit at the kerb line, manholes in the carriageway.
    const drains = Math.max(1, Math.floor(seg.lengthM / 22))
    for (let i = 0; i < drains; i++) {
      const t = (i + 0.35) / drains
      out.push({ kind: 'drain', at: alongSegment(seg, t, seg.widthM / 2 - 0.3), rotationY: 0 })
      out.push({ kind: 'drain', at: alongSegment(seg, t, -(seg.widthM / 2 - 0.3)), rotationY: 0 })
      if (rng.bool(0.5)) out.push({ kind: 'manhole', at: alongSegment(seg, t + 0.12, rng.range(-1.2, 1.2)), rotationY: 0 })
    }

    if (collector) {
      // Bus stops every ~300 m of collector, alternating sides.
      busSpacing += seg.lengthM
      if (busSpacing > 150) {
        busSpacing = 0
        const side = stopIndex % 2 === 0 ? 1 : -1
        const stopLateral = side * (seg.widthM / 2 + spec.street.sidewalkWidthM * 0.9)
        // Toward the carriageway. This was `side > 0 ? π : 0`, which happens to
        // point a shelter the right way on a street running along +x and the
        // wrong way on one running along +z — invisible while the shelter was a
        // symmetric box, obvious the moment a bench with a back stands under it.
        const facing = faceAcross(seg, side)
        out.push({
          kind: 'busStop',
          at: alongSegment(seg, 0.5, stopLateral),
          rotationY: facing,
          label: stopNames[stopIndex % stopNames.length],
        })
        /*
         * A shelter with nowhere to sit and nowhere to put a wrapper is not a
         * bus stop. Both belong *to* the stop rather than scattered at random,
         * and both face the carriageway the way someone waiting would.
         */
        const alongM = 2.4 / Math.max(seg.lengthM, 1)
        out.push({
          kind: 'bench',
          at: alongSegment(seg, 0.5, stopLateral - side * 0.35),
          rotationY: facing,
        })
        out.push({
          kind: 'litterBin',
          at: alongSegment(seg, 0.5 + alongM, stopLateral - side * 0.2),
          rotationY: facing,
        })
        stopIndex++
      }
      if (rng.bool(0.4)) {
        out.push({ kind: 'hydrant', at: alongSegment(seg, rng.range(0.2, 0.8), kerb + 0.4), rotationY: 0 })
      }
      if (rng.bool(0.5)) {
        out.push({ kind: 'cabinet', at: alongSegment(seg, rng.range(0.15, 0.85), -(kerb + 0.7)), rotationY: seg.horizontal ? 0 : Math.PI / 2 })
      }
    } else if (rng.bool(0.35)) {
      out.push({ kind: 'litterBin', at: alongSegment(seg, rng.range(0.2, 0.8), kerb + 0.2), rotationY: 0 })
    }

    if (rng.bool(0.25)) {
      out.push({
        kind: 'signpost',
        at: alongSegment(seg, rng.bool() ? 0.06 : 0.94, kerb + 0.3),
        rotationY: seg.horizontal ? 0 : Math.PI / 2,
      })
    }

    out.push(...kerbsideParking(seg, rng))
  }

  // Zebra crossings and bollards at the junctions flagged during layout.
  for (const node of network.nodes.values()) {
    if (node.crossing) {
      out.push({ kind: 'crossing', at: node.at, rotationY: 0 })
      for (const s of [-1, 1]) {
        out.push({ kind: 'bollard', at: { x: node.at.x + s * 5, z: node.at.z + 5.2 }, rotationY: 0 })
      }
      // Where people stop and wait, litter collects.
      out.push({ kind: 'litterBin', at: { x: node.at.x + 6.2, z: node.at.z + 5.2 }, rotationY: 0 })
    }
  }

  return out
}
