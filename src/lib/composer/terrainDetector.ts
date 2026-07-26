/**
 * terrainDetector.ts — the TerrainRecognizer.
 *
 * Estimates the lot's slope, downhill aspect and elevation drop, traces a
 * driveway centre-line from the street to the house/garage front, and adds an
 * entrance step run when the ground falls away enough to need one. All derived
 * from the seeded RNG so terrain is stable per lot.
 */

import type {
  AnalysisContext,
  BuildingFeature,
  DetectorModule,
  LocalPolygon,
  PropertyFeature,
  TerrainProfile,
  TerrainStep,
} from './types'
import { frameOf, mapAB } from './layout'

function bboxOf(poly: LocalPolygon) {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

export interface TerrainInput {
  property: PropertyFeature
  building: BuildingFeature
}

export function detectTerrain(input: TerrainInput, ctx: AnalysisContext): TerrainProfile {
  const { property, building } = input
  const rng = ctx.rng.fork(0x54455252) // 'TERR'
  const { widthM: W, depthM: D, streetSide } = property
  const { depthLen: Dp } = frameOf(streetSide, W, D)

  // Slope: most plots are gentle; a minority are real hillsides.
  const slopeDeg = rng.next() < 0.6 ? rng.range(0.3, 3) : rng.range(3, 12)
  const aspectDeg = rng.range(0, 360)
  const elevationDropM = Math.round(Dp * Math.tan((slopeDeg * Math.PI) / 180) * 10) / 10

  // Driveway: from the street edge up to the front of the house, biased toward
  // the garage side if there is one.
  const bbox = bboxOf(building.footprint)
  const houseFrontLocal = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
  const garage = building.parts.find((p) => p.kind === 'garage' || p.kind === 'carport')

  // Compute the along-street position of the driveway target.
  const targetLocal = garage
    ? centroidOf(garage.polygon)
    : houseFrontLocal
  // Street-edge start point directly "below" the target in the front frame.
  const start = streetEdgePoint(streetSide, W, D, targetLocal)
  const mid = lerp(start, targetLocal, 0.55)
  const drivewayPath: LocalPolygon = [start, mid, targetLocal]

  // Entrance steps when there's a meaningful rise between street and door.
  const steps: TerrainStep[] = []
  const doorDrop = Math.abs(elevationDropM) * 0.5
  if (doorDrop > 0.35) {
    const count = Math.max(2, Math.round(doorDrop / 0.17))
    steps.push({
      at: lerp(houseFrontLocal, start, 0.15),
      count,
      riseM: 0.17,
    })
  }

  return {
    slopeDeg: Math.round(slopeDeg * 10) / 10,
    aspectDeg: Math.round(aspectDeg),
    elevationDropM,
    drivewayPath,
    steps,
    confidence: Math.min(0.9, 0.68 + rng.range(0, 0.18)),
  }
}

function centroidOf(poly: LocalPolygon) {
  const n = poly.length || 1
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  }
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** The point on the street edge nearest a local target (b = 0 in the frame). */
function streetEdgePoint(
  streetSide: PropertyFeature['streetSide'],
  W: number,
  D: number,
  target: { x: number; y: number },
): { x: number; y: number } {
  // Recover the along-street coordinate `a` of the target, then map back at b=0.
  const a =
    streetSide === 'south' || streetSide === 'north' ? target.x : target.y
  return mapAB(streetSide, W, D, a, 0)
}

export const TerrainRecognizer: DetectorModule<TerrainInput, TerrainProfile> = {
  id: 'terrain-recognizer',
  label: 'Gelände',
  run: detectTerrain,
}
