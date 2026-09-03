/**
 * streetNetwork.ts — the road graph the surrounding world is built on.
 *
 * The old neighbourhood was a stack of parallel lines: houses on a rigid 5×5
 * lattice with a road drawn between each row. Nothing connected to anything, so
 * nothing could move along it and no block ever read as a block.
 *
 * Here the streets come first, as a real **graph**: a collector road
 * (Sammelstraße) carrying the through traffic, quiet residential streets
 * hanging off it, and cross streets tying the whole thing together. Everything
 * else in the world is derived from that graph — blocks are the faces between
 * streets, plots are subdivisions of a block's frontage, and vehicles and
 * pedestrians route along the very same edges the asphalt is drawn from.
 *
 * Pure data: metres, `x` east / `z` south, matching the 3D scene's ground
 * plane. No THREE, no React.
 */

import { cityStyleSpec, type CityStyle } from './cityStyle'

export interface Vec2 {
  x: number
  z: number
}

export type StreetKind = 'collector' | 'residential' | 'lane'

export interface StreetNode {
  id: string
  at: Vec2
  /** Ids of the segments meeting here. */
  edges: string[]
  /** Junctions on the collector are built as a roundabout when marked. */
  roundabout: boolean
  /** Signalised crossing — only ever on the collector. */
  crossing: boolean
}

export interface StreetSegment {
  id: string
  from: string
  to: string
  a: Vec2
  b: Vec2
  kind: StreetKind
  /** Carriageway width. */
  widthM: number
  /** Pavement width per side; 0 = none. */
  sidewalkM: number
  /** Unit vector from `a` to `b`. */
  dir: Vec2
  lengthM: number
  /** True when the segment runs along x (east–west). */
  horizontal: boolean
}

/** A city block: the face enclosed by four street segments. */
export interface Block {
  id: string
  /** Block interior bounds (already inset by carriageway + pavement). */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** Grid indices, so the caller can find the block holding the plan. */
  gi: number
  gj: number
  /** Which streets bound it — north/south are the long frontages. */
  northStreet: string
  southStreet: string
  westStreet: string
  eastStreet: string
}

export interface StreetNetwork {
  nodes: Map<string, StreetNode>
  segments: StreetSegment[]
  blocks: Block[]
  /** Half-extent of the generated world, metres, measured from the centre. */
  extentM: number
  centre: Vec2
}

export interface NetworkInput {
  style: CityStyle
  /** Centre of the user's plan in world metres. */
  centre: Vec2
  /** How many block rings to generate around the centre. */
  rings?: number
  /** Deterministic seed. */
  seed: number
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
const len = (v: Vec2): number => Math.hypot(v.x, v.z) || 1
const norm = (v: Vec2): Vec2 => { const l = len(v); return { x: v.x / l, z: v.z / l } }

/**
 * Lay out the network. The result is deterministic for a given seed + style, so
 * the same plan always produces the same neighbourhood.
 *
 * Layout rules, in the order they are applied:
 *  1. Horizontal streets at the style's block depth, one per row.
 *  2. One row — never the plan's own row — is promoted to the collector.
 *  3. Vertical cross streets at the style's block width.
 *  4. The collector's most central junction becomes a roundabout; the two
 *     junctions either side of the plan's own street get crossings.
 */
export function buildStreetNetwork(input: NetworkInput): StreetNetwork {
  const spec = cityStyleSpec(input.style)
  const rings = Math.max(1, input.rings ?? 2)
  const { centre } = input
  const depth = spec.block.depthM
  const width = spec.block.widthM

  // Rows run j = -rings … rings+1; the plan's own block sits between rows 0 and 1.
  const rowZ = (j: number) => centre.z + (j - 0.5) * depth
  const colX = (i: number) => centre.x + (i - 0.5) * width

  const jMin = -rings, jMax = rings + 1
  const iMin = -rings, iMax = rings + 1

  // The collector is the outermost row on the far side of the plan — close
  // enough to see and hear, far enough that the plan's own street stays quiet.
  const collectorRow = jMax

  const nodes = new Map<string, StreetNode>()
  const nodeId = (i: number, j: number) => `n${i}_${j}`
  for (let j = jMin; j <= jMax; j++) {
    for (let i = iMin; i <= iMax; i++) {
      nodes.set(nodeId(i, j), {
        id: nodeId(i, j),
        at: { x: colX(i), z: rowZ(j) },
        edges: [],
        roundabout: false,
        crossing: false,
      })
    }
  }

  const segments: StreetSegment[] = []
  const addSegment = (
    id: string, fromId: string, toId: string, kind: StreetKind, horizontal: boolean,
  ) => {
    const from = nodes.get(fromId)!
    const to = nodes.get(toId)!
    const d = sub(to.at, from.at)
    const metrics = spec.street
    segments.push({
      id, from: fromId, to: toId, a: from.at, b: to.at, kind,
      widthM: kind === 'collector' ? metrics.collectorWidthM : kind === 'lane' ? metrics.residentialWidthM * 0.6 : metrics.residentialWidthM,
      sidewalkM: kind === 'lane' ? 0 : metrics.sidewalkWidthM,
      dir: norm(d), lengthM: len(d), horizontal,
    })
    from.edges.push(id)
    to.edges.push(id)
  }

  // ── Horizontal streets ──
  for (let j = jMin; j <= jMax; j++) {
    const kind: StreetKind = j === collectorRow ? 'collector' : 'residential'
    for (let i = iMin; i < iMax; i++) {
      addSegment(`h${i}_${j}`, nodeId(i, j), nodeId(i + 1, j), kind, true)
    }
  }

  // ── Vertical cross streets ──
  // Not every column is carried through: skipping one keeps a long block in the
  // middle of the estate, which is what real layouts look like (and gives the
  // park block room to breathe).
  const skipColumn = iMin + 1 + (Math.abs(input.seed) % Math.max(1, iMax - iMin - 1))
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j < jMax; j++) {
      // Keep the outer ring of cross streets intact so the graph stays connected.
      const interior = i !== iMin && i !== iMax
      if (interior && i === skipColumn && j !== jMax - 1) continue
      addSegment(`v${i}_${j}`, nodeId(i, j), nodeId(i, j + 1), 'residential', false)
    }
  }

  // ── Junction character ──
  const roundaboutNode = nodes.get(nodeId(0, collectorRow))
  if (roundaboutNode) roundaboutNode.roundabout = true
  for (const i of [0, 1]) {
    const n = nodes.get(nodeId(i, collectorRow))
    if (n && !n.roundabout) n.crossing = true
  }

  // ── Blocks ──
  const blocks: Block[] = []
  for (let j = jMin; j < jMax; j++) {
    for (let i = iMin; i < iMax; i++) {
      const north = rowZ(j)
      const south = rowZ(j + 1)
      const west = colX(i)
      const east = colX(i + 1)
      const northKind: StreetKind = j === collectorRow ? 'collector' : 'residential'
      const southKind: StreetKind = j + 1 === collectorRow ? 'collector' : 'residential'
      const insetN = halfCorridor(spec, northKind)
      const insetS = halfCorridor(spec, southKind)
      const insetW = halfCorridor(spec, 'residential')
      const insetE = halfCorridor(spec, 'residential')
      blocks.push({
        id: `b${i}_${j}`,
        minX: west + insetW, maxX: east - insetE,
        minZ: north + insetN, maxZ: south - insetS,
        gi: i, gj: j,
        northStreet: `h${i}_${j}`, southStreet: `h${i}_${j + 1}`,
        westStreet: `v${i}_${j}`, eastStreet: `v${i + 1}_${j}`,
      })
    }
  }

  const extentM = Math.max((iMax - iMin) * width, (jMax - jMin) * depth) / 2 + width

  return { nodes, segments, blocks, extentM, centre }
}

/** Half the space a street occupies: carriageway + kerb + pavement. */
export function halfCorridor(
  spec: ReturnType<typeof cityStyleSpec>,
  kind: StreetKind,
): number {
  const w = kind === 'collector' ? spec.street.collectorWidthM : spec.street.residentialWidthM
  return w / 2 + spec.street.sidewalkWidthM + 0.35
}

/** The block whose interior contains a world point, if any. */
export function blockAt(network: StreetNetwork, p: Vec2): Block | undefined {
  return network.blocks.find(
    (b) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ,
  )
}

/** Look a segment up by id. */
export function segmentById(network: StreetNetwork, id: string): StreetSegment | undefined {
  return network.segments.find((s) => s.id === id)
}

/**
 * Point on a segment at parameter `t` ∈ [0, 1], offset `lateral` metres to the
 * right of travel. Used for lanes, parking bays, pavements and kerb furniture.
 */
export function alongSegment(seg: StreetSegment, t: number, lateral = 0): Vec2 {
  // Right of travel in a left-handed x/z ground plane: (dz, -dx).
  const rx = seg.dir.z
  const rz = -seg.dir.x
  return {
    x: seg.a.x + (seg.b.x - seg.a.x) * t + rx * lateral,
    z: seg.a.z + (seg.b.z - seg.a.z) * t + rz * lateral,
  }
}
