/**
 * vegetationDetector.ts — the VegetationRecognizer.
 *
 * Populates the garden: a back lawn, boundary/front hedges, scattered trees and
 * shrubs, and — on some lots — a pool. Placement happens in the street-relative
 * front frame and every candidate is tested against a keep-out set built from
 * the building parts, so nothing lands on the house. Deterministic per lot.
 */

import type {
  AnalysisContext,
  BuildingFeature,
  DetectorModule,
  HedgeItem,
  LawnItem,
  LocalPoint,
  LocalPolygon,
  PlantItem,
  PoolItem,
  PropertyFeature,
  VegetationFeature,
} from './types'
import { polygonAreaSqm } from './geo'
import { clamp, frameOf, mapAB, rectAB, type StreetSide } from './layout'

interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function bboxOf(poly: LocalPolygon): BBox {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function expand(b: BBox, by: number): BBox {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by }
}

function inBBox(p: LocalPoint, b: BBox): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

/** Front-frame depth-from-street `b` of a local point. */
function bOf(streetSide: StreetSide, W: number, D: number, p: LocalPoint): number {
  switch (streetSide) {
    case 'south':
      return D - p.y
    case 'north':
      return p.y
    case 'east':
      return W - p.x
    case 'west':
      return p.x
  }
}

export interface VegetationInput {
  property: PropertyFeature
  building: BuildingFeature
}

export function detectVegetation(input: VegetationInput, ctx: AnalysisContext): VegetationFeature {
  const { property, building } = input
  const rng = ctx.rng.fork(0x56454745) // 'VEGE'
  const { widthM: W, depthM: D, streetSide } = property
  const { alongLen: L, depthLen: Dp } = frameOf(streetSide, W, D)

  const keepOut = building.parts.map((p) => expand(bboxOf(p.polygon), 1))
  const isClear = (p: LocalPoint) => keepOut.every((b) => !inBBox(p, b))

  // How far back the house reaches (front frame).
  const houseBackB = Math.max(...building.footprint.map((pt) => bOf(streetSide, W, D, pt)))
  const gardenB0 = Math.min(Dp - 1, houseBackB + 0.8)
  const gardenB1 = Dp - 0.8

  // ── Lawn: the back garden band ──
  const lawns: LawnItem[] = []
  if (gardenB1 - gardenB0 > 2 && L > 4) {
    const polygon = rectAB(streetSide, W, D, 1, gardenB0, L - 1, gardenB1)
    lawns.push({ polygon, areaSqm: Math.round(polygonAreaSqm(polygon)) })
  }

  // ── Pool: sometimes, in the back garden ──
  const pools: PoolItem[] = []
  if (gardenB1 - gardenB0 > 5 && L > 8 && rng.bool(0.26)) {
    const pw = clamp(rng.range(5, 8), 4, L - 3)
    const pd = clamp(rng.range(3, 4.5), 2.5, gardenB1 - gardenB0 - 1)
    const aMin = clamp(L / 2 + rng.range(-2, 2) - pw / 2, 1.5, L - 1.5 - pw)
    const bMin = clamp(gardenB0 + rng.range(0.5, 2), gardenB0, gardenB1 - pd)
    const polygon = rectAB(streetSide, W, D, aMin, bMin, aMin + pw, bMin + pd)
    pools.push({ polygon, areaSqm: Math.round(polygonAreaSqm(polygon)), confidence: 0.7 + rng.range(0, 0.18) })
  }
  const poolBoxes = pools.map((p) => expand(bboxOf(p.polygon), 0.8))
  const clearOfPools = (p: LocalPoint) => poolBoxes.every((b) => !inBBox(p, b))

  // ── Hedges: a street-front hedge, plus a side boundary hedge ──
  const hedges: HedgeItem[] = []
  hedges.push({
    path: [mapAB(streetSide, W, D, 0.6, 0.6), mapAB(streetSide, W, D, L - 0.6, 0.6)],
    heightM: rng.range(0.8, 1.6),
    confidence: 0.7 + rng.range(0, 0.16),
  })
  if (rng.bool(0.6)) {
    const side = rng.bool() ? 0.6 : L - 0.6
    hedges.push({
      path: [mapAB(streetSide, W, D, side, 1), mapAB(streetSide, W, D, side, Dp - 1)],
      heightM: rng.range(1, 1.8),
      confidence: 0.62 + rng.range(0, 0.16),
    })
  }

  // ── Trees & shrubs ──
  const plants: PlantItem[] = []
  const placedCircles: { x: number; y: number; r: number }[] = []
  const farEnough = (p: LocalPoint, r: number) =>
    placedCircles.every((c) => Math.hypot(c.x - p.x, c.y - p.y) > c.r + r + 0.8)

  const treeCount = rng.int(3, 6)
  let attempts = 0
  while (plants.filter((p) => p.kind === 'tree').length < treeCount && attempts < 60) {
    attempts++
    // Bias trees into the back garden, occasionally the front yard.
    const b = rng.bool(0.75) ? rng.range(gardenB0, gardenB1) : rng.range(0.8, Math.max(1, houseBackB - 2))
    const a = rng.range(1, L - 1)
    const pt = mapAB(streetSide, W, D, a, b)
    const radiusM = rng.range(2, 4)
    if (isClear(pt) && clearOfPools(pt) && farEnough(pt, radiusM)) {
      plants.push({ at: pt, radiusM: Math.round(radiusM * 10) / 10, kind: 'tree', confidence: 0.72 + rng.range(0, 0.16) })
      placedCircles.push({ x: pt.x, y: pt.y, r: radiusM })
    }
  }

  const shrubCount = rng.int(2, 5)
  attempts = 0
  while (plants.filter((p) => p.kind === 'shrub').length < shrubCount && attempts < 60) {
    attempts++
    const b = rng.range(0.8, Dp - 0.8)
    const a = rng.bool() ? rng.range(1, 3) : rng.range(L - 3, L - 1) // hug the side boundaries
    const pt = mapAB(streetSide, W, D, a, b)
    const radiusM = rng.range(0.5, 1.1)
    if (isClear(pt) && clearOfPools(pt) && farEnough(pt, radiusM)) {
      plants.push({ at: pt, radiusM: Math.round(radiusM * 10) / 10, kind: 'shrub', confidence: 0.6 + rng.range(0, 0.18) })
      placedCircles.push({ x: pt.x, y: pt.y, r: radiusM })
    }
  }

  return { plants, hedges, lawns, pools }
}

export const VegetationRecognizer: DetectorModule<VegetationInput, VegetationFeature> = {
  id: 'vegetation-recognizer',
  label: 'Vegetation',
  run: detectVegetation,
}
