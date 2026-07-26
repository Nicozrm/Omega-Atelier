/**
 * sceneBuilder.ts — the SceneBuilder.
 *
 * Turns a metric {@link DetectedScene} into an editor-ready **draft** in
 * centimetres: the parcel as an outdoor zone, exterior walls with windows and a
 * front door, a *plausible* interior floor plan (the aerial can't see inside, so
 * this is a best-effort guess and is flagged as such), the garage, driveway and
 * terrace, plus trees, hedges and a pool. The ProjectGenerator wraps this draft
 * into a real PlanDocument — keeping the two concerns separate keeps both
 * testable.
 */

import type { Point, WallSubtype } from '@/types'
import type {
  ConfidenceReport,
  DetectedScene,
  LocalPoint,
  LocalPolygon,
  RoofShape,
} from './types'
import type { StreetSide } from './layout'
import { formatConfidence } from './confidenceEngine'

export interface DraftWall {
  a: Point
  b: Point
  thickness: number
  subtype?: WallSubtype
  openingWidth?: number
  openingHeight?: number
  openingSill?: number
}

export interface DraftRoom {
  name: string
  polygon: Point[]
  zoneType?: 'indoor' | 'outdoor'
  floorMaterialId?: string
}

export interface DraftFurniture {
  furnitureId: string
  x: number
  y: number
  size: [number, number]
  rotation?: number
  label?: string
}

export interface DraftDevice {
  deviceId: string
  x: number
  y: number
  rotation?: number
  note?: string
}

export interface DraftLabel {
  text: string
  x: number
  y: number
  size?: number
}

export interface DraftFloor {
  name: string
  index: number
  extent: { width: number; height: number }
  walls: DraftWall[]
  rooms: DraftRoom[]
  furniture: DraftFurniture[]
  devices: DraftDevice[]
  labels: DraftLabel[]
}

export interface SceneSummary {
  plotAreaSqm: number
  buildingAreaSqm: number
  stories: number
  roof: RoofShape
  trees: number
  hedges: number
  hasPool: boolean
  hasGarage: boolean
}

export interface OmegaSceneDraft {
  title: string
  description: string
  tags: string[]
  floors: DraftFloor[]
  confidence: ConfidenceReport
  summary: SceneSummary
}

/** Border of open ground around the plot, cm. */
const PAD = 140
const EXT = 28 // exterior wall thickness, cm
const INT = 12 // interior wall thickness, cm
const DOOR_GAP = 92 // interior doorway gap, cm

interface BBoxCm {
  x0: number
  y0: number
  x1: number
  y1: number
}

function round(n: number): number {
  return Math.round(n)
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function bboxOfLocal(poly: LocalPolygon): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** A partition segment with a centred doorway gap → up to two solid segments. */
function withGap(a: Point, b: Point, tCenter: number, thickness: number): DraftWall[] {
  const len = dist(a, b)
  if (len < DOOR_GAP + 40) return [{ a, b, thickness }]
  const g = DOOR_GAP / len
  const t0 = Math.max(0, tCenter - g / 2)
  const t1 = Math.min(1, tCenter + g / 2)
  const p0 = lerp(a, b, t0)
  const p1 = lerp(a, b, t1)
  const out: DraftWall[] = []
  if (t0 > 0.01) out.push({ a, b: p0, thickness })
  if (t1 < 0.99) out.push({ a: p1, b, thickness })
  return out
}

function rectPoly(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: round(x0), y: round(y0) },
    { x: round(x1), y: round(y0) },
    { x: round(x1), y: round(y1) },
    { x: round(x0), y: round(y1) },
  ]
}

/** Map a house-frame coordinate (u along street, v inward) to plan cm. */
function houseAB(streetSide: StreetSide, bb: BBoxCm, u: number, v: number): Point {
  switch (streetSide) {
    case 'south':
      return { x: bb.x0 + u, y: bb.y1 - v }
    case 'north':
      return { x: bb.x0 + u, y: bb.y0 + v }
    case 'east':
      return { x: bb.x1 - v, y: bb.y0 + u }
    case 'west':
      return { x: bb.x0 + v, y: bb.y0 + u }
  }
}

interface RoomFurniSpec {
  id: string
  /** Fractions within the room rect (0..1). */
  fx: number
  fy: number
  size: [number, number]
  rot?: number
  label?: string
}
interface QuadSpec {
  name: string
  furni: RoomFurniSpec[]
}

interface InteriorResult {
  walls: DraftWall[]
  rooms: DraftRoom[]
  furniture: DraftFurniture[]
  labels: DraftLabel[]
}

/**
 * Build a four-room interior inside a footprint bbox. `program` names the
 * [front-left, front-right, back-left, back-right] quadrants (front = street
 * side) and lists furniture placed at fractional positions inside each room.
 */
function buildInterior(
  streetSide: StreetSide,
  bb: BBoxCm,
  program: [QuadSpec, QuadSpec, QuadSpec, QuadSpec],
  floorMaterialId: string,
): InteriorResult {
  const along = streetSide === 'south' || streetSide === 'north' ? bb.x1 - bb.x0 : bb.y1 - bb.y0
  const depth = streetSide === 'south' || streetSide === 'north' ? bb.y1 - bb.y0 : bb.x1 - bb.x0
  const inset = EXT / 2 + 2
  const uMin = inset
  const uMax = along - inset
  const vMin = inset
  const vMax = depth - inset
  const uSplit = uMin + (uMax - uMin) * 0.54
  const vSplit = vMin + (vMax - vMin) * 0.5

  const P = (u: number, v: number) => houseAB(streetSide, bb, u, v)

  const walls: DraftWall[] = []
  // Depth divider (front | back), doorway near centre.
  walls.push(...withGap(P(uMin, vSplit), P(uMax, vSplit), 0.5, INT))
  // Front partition (front-left | front-right).
  walls.push(...withGap(P(uSplit, vMin), P(uSplit, vSplit), 0.5, INT))
  // Back partition (back-left | back-right).
  walls.push(...withGap(P(uSplit, vSplit), P(uSplit, vMax), 0.5, INT))

  const quads: { spec: QuadSpec; u0: number; u1: number; v0: number; v1: number }[] = [
    { spec: program[0], u0: uMin, u1: uSplit, v0: vMin, v1: vSplit }, // front-left
    { spec: program[1], u0: uSplit, u1: uMax, v0: vMin, v1: vSplit }, // front-right
    { spec: program[2], u0: uMin, u1: uSplit, v0: vSplit, v1: vMax }, // back-left
    { spec: program[3], u0: uSplit, u1: uMax, v0: vSplit, v1: vMax }, // back-right
  ]

  const rooms: DraftRoom[] = []
  const furniture: DraftFurniture[] = []
  const labels: DraftLabel[] = []

  for (const q of quads) {
    const corners = [P(q.u0, q.v0), P(q.u1, q.v0), P(q.u1, q.v1), P(q.u0, q.v1)]
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    const rx0 = Math.min(...xs)
    const ry0 = Math.min(...ys)
    const rx1 = Math.max(...xs)
    const ry1 = Math.max(...ys)
    rooms.push({ name: q.spec.name, polygon: rectPoly(rx0, ry0, rx1, ry1), zoneType: 'indoor', floorMaterialId })
    labels.push({ text: q.spec.name, x: round((rx0 + rx1) / 2), y: round((ry0 + ry1) / 2), size: 13 })
    for (const f of q.spec.furni) {
      furniture.push({
        furnitureId: f.id,
        x: round(rx0 + (rx1 - rx0) * f.fx),
        y: round(ry0 + (ry1 - ry0) * f.fy),
        size: f.size,
        rotation: f.rot ?? 0,
        label: f.label,
      })
    }
  }

  return { walls, rooms, furniture, labels }
}

/** Exterior shell: four walls, a front door on the street edge, windows elsewhere. */
function buildShell(streetSide: StreetSide, bb: BBoxCm, withDoor: boolean): DraftWall[] {
  const tl = { x: bb.x0, y: bb.y0 }
  const tr = { x: bb.x1, y: bb.y0 }
  const br = { x: bb.x1, y: bb.y1 }
  const bl = { x: bb.x0, y: bb.y1 }
  const win = (): Partial<DraftWall> => ({ subtype: 'window', openingWidth: 120, openingHeight: 130, openingSill: 90 })
  const door = (): Partial<DraftWall> => ({ subtype: 'door', openingWidth: 110 })
  const edge = (a: Point, b: Point, isStreet: boolean): DraftWall => ({
    a,
    b,
    thickness: EXT,
    ...(isStreet && withDoor ? door() : win()),
  })
  return [
    edge(tl, tr, streetSide === 'north'),
    edge(tr, br, streetSide === 'east'),
    edge(br, bl, streetSide === 'south'),
    edge(bl, tl, streetSide === 'west'),
  ]
}

export function buildScene(scene: DetectedScene): OmegaSceneDraft {
  const { property, building, roof, terrain, vegetation, confidence } = scene
  const streetSide = property.streetSide

  const toCm = (p: LocalPoint): Point => ({ x: round(p.x * 100 + PAD), y: round(p.y * 100 + PAD) })
  const extent = {
    width: round(property.widthM * 100 + PAD * 2),
    height: round(property.depthM * 100 + PAD * 2),
  }

  // House bbox in cm.
  const fb = bboxOfLocal(building.footprint)
  const houseBB: BBoxCm = {
    x0: round(fb.minX * 100 + PAD),
    y0: round(fb.minY * 100 + PAD),
    x1: round(fb.maxX * 100 + PAD),
    y1: round(fb.maxY * 100 + PAD),
  }

  // ── Ground floor ──
  const ground: DraftFloor = {
    name: 'Erdgeschoss',
    index: 0,
    extent,
    walls: [],
    rooms: [],
    furniture: [],
    devices: [],
    labels: [],
  }

  // Plot as one outdoor zone (the green lawn base — outdoor rendering handles it).
  ground.rooms.push({
    name: 'Grundstück',
    polygon: property.polygon.map(toCm),
    zoneType: 'outdoor',
  })
  ground.labels.push({
    text: `Grundstück · ${property.areaSqm} m²`,
    x: round((PAD + property.widthM * 100 + PAD) / 2),
    y: round(PAD * 0.6),
    size: 15,
  })

  // Driveway as an outdoor path (street → house/garage).
  if (terrain.drivewayPath.length >= 2) {
    const a = toCm(terrain.drivewayPath[0])
    const b = toCm(terrain.drivewayPath[terrain.drivewayPath.length - 1])
    const half = 150
    const dvx0 = Math.min(a.x, b.x) - half
    const dvy0 = Math.min(a.y, b.y) - half
    const dvx1 = Math.max(a.x, b.x) + half
    const dvy1 = Math.max(a.y, b.y) + half
    ground.rooms.push({
      name: 'Einfahrt',
      polygon: rectPoly(dvx0, dvy0, dvx1, dvy1),
      zoneType: 'outdoor',
      floorMaterialId: 'floor-concrete',
    })
  }

  // Terrace (from the building part) as an outdoor zone with a lounge set.
  const terracePart = building.parts.find((p) => p.kind === 'terrace')
  if (terracePart) {
    const poly = terracePart.polygon.map(toCm)
    ground.rooms.push({ name: 'Terrasse', polygon: poly, zoneType: 'outdoor', floorMaterialId: 'floor-slate' })
    const cx = round(poly.reduce((s, p) => s + p.x, 0) / poly.length)
    const cy = round(poly.reduce((s, p) => s + p.y, 0) / poly.length)
    ground.furniture.push({ furnitureId: 'outdoor-table', x: cx, y: cy, size: [180, 90], rotation: 0 })
    ground.labels.push({ text: 'Terrasse', x: cx, y: cy, size: 12 })
  }

  // Exterior shell + plausible interior.
  ground.walls.push(...buildShell(streetSide, houseBB, true))
  const interior = buildInterior(
    streetSide,
    houseBB,
    [
      { name: 'Wohnzimmer', furni: [
        { id: 'sofa-3seat', fx: 0.5, fy: 0.68, size: [220, 95] },
        { id: 'table-coffee', fx: 0.5, fy: 0.42, size: [110, 60] },
      ] },
      { name: 'Küche', furni: [
        { id: 'kitchen-row', fx: 0.5, fy: 0.18, size: [300, 60] },
        { id: 'fridge', fx: 0.82, fy: 0.5, size: [60, 65] },
      ] },
      { name: 'Schlafzimmer', furni: [
        { id: 'bed-180', fx: 0.5, fy: 0.55, size: [185, 210] },
        { id: 'wardrobe-200', fx: 0.5, fy: 0.9, size: [200, 60] },
      ] },
      { name: 'Bad', furni: [
        { id: 'bathtub', fx: 0.3, fy: 0.3, size: [170, 80] },
        { id: 'toilet', fx: 0.8, fy: 0.75, size: [40, 70] },
      ] },
    ],
    'floor-oak-parquet',
  )
  ground.walls.push(...interior.walls)
  ground.rooms.push(...interior.rooms)
  ground.furniture.push(...interior.furniture)
  ground.labels.push(...interior.labels)

  // A handful of smart devices seeded through the ground floor.
  const houseCx = round((houseBB.x0 + houseBB.x1) / 2)
  const houseCy = round((houseBB.y0 + houseBB.y1) / 2)
  ground.devices.push(
    { deviceId: 'nuki-smart-lock-4', x: houseCx, y: streetSide === 'south' ? houseBB.y1 - 10 : houseBB.y0 + 10, note: 'Haustür' },
    { deviceId: 'hue-motion', x: houseCx, y: houseCy },
    { deviceId: 'hue-e27-white-color', x: round(houseBB.x0 + (houseBB.x1 - houseBB.x0) * 0.3), y: houseCy, note: 'Deckenlicht' },
    { deviceId: 'eve-thermo', x: round(houseBB.x0 + 20), y: houseCy },
    { deviceId: 'bosch-twinguard', x: houseCx, y: round(houseBB.y0 + (houseBB.y1 - houseBB.y0) * 0.3), note: 'Rauchmelder' },
  )

  // Garage as a small structure.
  const garagePart = building.parts.find((p) => p.kind === 'garage' || p.kind === 'carport')
  if (garagePart) {
    const gb = bboxOfLocal(garagePart.polygon)
    const gBB: BBoxCm = {
      x0: round(gb.minX * 100 + PAD),
      y0: round(gb.minY * 100 + PAD),
      x1: round(gb.maxX * 100 + PAD),
      y1: round(gb.maxY * 100 + PAD),
    }
    ground.walls.push(...buildShell(streetSide, gBB, garagePart.kind === 'garage'))
    ground.rooms.push({
      name: garagePart.kind === 'garage' ? 'Garage' : 'Carport',
      polygon: rectPoly(gBB.x0, gBB.y0, gBB.x1, gBB.y1),
      zoneType: 'indoor',
      floorMaterialId: 'floor-concrete',
    })
    ground.labels.push({
      text: garagePart.kind === 'garage' ? 'Garage' : 'Carport',
      x: round((gBB.x0 + gBB.x1) / 2),
      y: round((gBB.y0 + gBB.y1) / 2),
      size: 12,
    })
  }

  // Vegetation → editable furniture.
  let treeCount = 0
  for (const plant of vegetation.plants) {
    const at = toCm(plant.at)
    if (plant.kind === 'tree') {
      treeCount++
      const s = Math.max(80, Math.min(500, round(plant.radiusM * 180)))
      ground.furniture.push({ furnitureId: 'plant-large', x: at.x, y: at.y, size: [s, s], label: 'Baum' })
    } else {
      const s = Math.max(40, Math.min(140, round(plant.radiusM * 120)))
      ground.furniture.push({ furnitureId: 'plant', x: at.x, y: at.y, size: [s, s], label: 'Strauch' })
    }
  }
  // Hedges → rows of shrubs along the centre-line.
  for (const hedge of vegetation.hedges) {
    if (hedge.path.length < 2) continue
    const a = toCm(hedge.path[0])
    const b = toCm(hedge.path[hedge.path.length - 1])
    const len = dist(a, b)
    const steps = Math.max(2, Math.min(14, Math.round(len / 120)))
    for (let i = 0; i <= steps; i++) {
      const p = lerp(a, b, i / steps)
      ground.furniture.push({ furnitureId: 'plant', x: round(p.x), y: round(p.y), size: [70, 70], label: 'Hecke' })
    }
  }
  // Pool.
  let hasPool = false
  for (const pool of vegetation.pools) {
    hasPool = true
    const pb = bboxOfLocal(pool.polygon)
    const w = round((pb.maxX - pb.minX) * 100)
    const h = round((pb.maxY - pb.minY) * 100)
    const cx = round(((pb.minX + pb.maxX) / 2) * 100 + PAD)
    const cy = round(((pb.minY + pb.maxY) / 2) * 100 + PAD)
    ground.furniture.push({ furnitureId: 'pool-small', x: cx, y: cy, size: [Math.max(200, w), Math.max(150, h)], label: 'Pool' })
  }

  // Roof + terrain notes (informational, editable text).
  ground.labels.push({
    text: `Dach: ${roofLabel(roof.shape)} · ${roof.pitchDeg}°`,
    x: houseCx,
    y: round(houseBB.y0 - 40),
    size: 11,
  })
  if (terrain.slopeDeg >= 3) {
    ground.labels.push({ text: `Hanglage ${terrain.slopeDeg}° · Δ${terrain.elevationDropM} m`, x: houseCx, y: round(houseBB.y1 + 40), size: 11 })
  }
  // Interior uncertainty marker.
  ground.labels.push({
    text: `Grundriss geschätzt · ${formatConfidence(confidence.byObject.interior)}`,
    x: houseCx,
    y: houseCy,
    size: 10,
  })

  const floors: DraftFloor[] = [ground]

  // ── Upper floor when the building has more than one storey ──
  if (building.stories >= 2) {
    const upper: DraftFloor = {
      name: '1. Obergeschoss',
      index: 1,
      extent,
      walls: buildShell(streetSide, houseBB, false),
      rooms: [],
      furniture: [],
      devices: [],
      labels: [],
    }
    const up = buildInterior(
      streetSide,
      houseBB,
      [
        { name: 'Schlafzimmer', furni: [{ id: 'bed-180', fx: 0.5, fy: 0.6, size: [185, 210] }] },
        { name: 'Kinderzimmer', furni: [{ id: 'bed-140', fx: 0.5, fy: 0.55, size: [145, 200] }] },
        { name: 'Arbeitszimmer', furni: [{ id: 'desk-160', fx: 0.5, fy: 0.4, size: [160, 80] }] },
        { name: 'Bad', furni: [{ id: 'shower', fx: 0.3, fy: 0.3, size: [90, 90] }, { id: 'toilet', fx: 0.8, fy: 0.75, size: [40, 70] }] },
      ],
      'floor-oak-parquet',
    )
    upper.walls.push(...up.walls)
    upper.rooms.push(...up.rooms)
    upper.furniture.push(...up.furniture)
    upper.labels.push(...up.labels)
    upper.devices.push(
      { deviceId: 'hue-motion', x: houseCx, y: houseCy },
      { deviceId: 'eve-thermo', x: round(houseBB.x0 + 20), y: houseCy },
    )
    floors.push(upper)
  }

  const summary: SceneSummary = {
    plotAreaSqm: property.areaSqm,
    buildingAreaSqm: building.areaSqm,
    stories: building.stories,
    roof: roof.shape,
    trees: treeCount,
    hedges: vegetation.hedges.length,
    hasPool,
    hasGarage: !!garagePart,
  }

  return {
    title: 'AI Home Composer — Digital Twin',
    description: `Automatisch aus Satellitenkarte erzeugt · ${building.stories} Etage(n) · ${property.areaSqm} m² Grundstück · Gesamt-Konfidenz ${formatConfidence(confidence.overall)}.`,
    tags: ['ai-composer', 'digital-twin', streetSide],
    floors,
    confidence,
    summary,
  }
}

function roofLabel(shape: RoofShape): string {
  switch (shape) {
    case 'gable':
      return 'Satteldach'
    case 'hip':
      return 'Walmdach'
    case 'flat':
      return 'Flachdach'
    case 'pent':
      return 'Pultdach'
  }
}
