/**
 * buildingDetector.ts — the BuildingRecognizer.
 *
 * From a parcel it lays out a plausible detached home: a main volume set back
 * from the street with a front yard, an optional detached garage or carport near
 * the street, and optional extension / conservatory / balcony / terrace parts.
 * Footprint area, storey count and eaves height are estimated. Everything is
 * derived from the seeded RNG, so a given lot always produces the same house.
 */

import type {
  AnalysisContext,
  BuildingFeature,
  BuildingPart,
  DetectorModule,
  LocalPolygon,
  PropertyFeature,
} from './types'
import { polygonAreaSqm } from './geo'
import { clamp, frameOf, rectAB, type StreetSide } from './layout'

/** Storey → eaves height in metres. */
export function eavesHeight(stories: number): number {
  return Math.round((stories * 2.85 + 0.4) * 10) / 10
}

interface Placed {
  aMin: number
  aMax: number
  bMin: number
  bMax: number
}

function toPart(
  kind: BuildingPart['kind'],
  streetSide: StreetSide,
  W: number,
  D: number,
  box: Placed,
  heightM: number,
  confidence: number,
): BuildingPart {
  return {
    kind,
    polygon: rectAB(streetSide, W, D, box.aMin, box.bMin, box.aMax, box.bMax),
    heightM,
    confidence: Math.round(confidence * 100) / 100,
  }
}

export function detectBuilding(property: PropertyFeature, ctx: AnalysisContext): BuildingFeature {
  const rng = ctx.rng.fork(0x424c4447) // 'BLDG'
  const { widthM: W, depthM: D, streetSide } = property
  const { alongLen: L, depthLen: Dp } = frameOf(streetSide, W, D)

  // Storeys — mostly two, some bungalows, the odd three-storey villa.
  const sr = rng.next()
  const stories = sr < 0.15 ? 1 : sr < 0.85 ? 2 : 3
  const heightM = eavesHeight(stories)

  // Main volume, in the front frame (a along street, b inward from street).
  const frontSetback = clamp(rng.range(4.5, 8), 3, Dp * 0.4)
  const houseDepth = clamp(rng.range(8.5, 12.5), 7, Dp - frontSetback - 5)
  const houseWidth = clamp(rng.range(8.5, 13.5), 7, L - 5)
  const aCenter = clamp(L / 2 + rng.range(-1.2, 1.2), 1.5 + houseWidth / 2, L - 1.5 - houseWidth / 2)
  const house: Placed = {
    aMin: aCenter - houseWidth / 2,
    aMax: aCenter + houseWidth / 2,
    bMin: frontSetback,
    bMax: frontSetback + houseDepth,
  }

  const footprint: LocalPolygon = rectAB(streetSide, W, D, house.aMin, house.bMin, house.aMax, house.bMax)
  const parts: BuildingPart[] = [
    toPart('main', streetSide, W, D, house, heightM, Math.min(0.99, 0.94 + rng.range(0, 0.05))),
  ]

  // Which side of the house has the most free space — garage / extension go there.
  const leftGap = house.aMin - 1.5
  const rightGap = L - 1.5 - house.aMax
  const wideSide: 'left' | 'right' = rightGap >= leftGap ? 'right' : 'left'
  const wideGap = Math.max(leftGap, rightGap)

  // Garage (detached, near the street) or a carport as the lighter alternative.
  const hasGarage = wideGap >= 6.2 && rng.bool(0.7)
  const hasCarport = !hasGarage && wideGap >= 5.8 && rng.bool(0.45)
  if (hasGarage || hasCarport) {
    const gW = clamp(rng.range(5.8, 6.6), 5.5, wideGap)
    const gD = rng.range(5.8, 6.4)
    const aMin = wideSide === 'right' ? house.aMax + Math.min(1.2, rightGap - gW) : house.aMin - Math.min(1.2, leftGap - gW) - gW
    const box: Placed = {
      aMin: clamp(aMin, 1.5, L - 1.5 - gW),
      aMax: clamp(aMin, 1.5, L - 1.5 - gW) + gW,
      bMin: 1.2,
      bMax: 1.2 + gD,
    }
    parts.push(
      hasGarage
        ? toPart('garage', streetSide, W, D, box, 2.8, 0.78 + rng.range(0, 0.12))
        : toPart('carport', streetSide, W, D, box, 2.6, 0.66 + rng.range(0, 0.12)),
    )
  }

  // Extension (Anbau) — a smaller volume grafted onto the free side of the house.
  if (wideGap >= 3.5 && rng.bool(0.4)) {
    const eW = clamp(rng.range(3, 4.5), 2.5, wideGap - 0.3)
    const eDepth = clamp(rng.range(4, houseDepth * 0.7), 3, houseDepth)
    const aMin = wideSide === 'right' ? house.aMax : house.aMin - eW
    const box: Placed = {
      aMin: clamp(aMin, 1.2, L - 1.2 - eW),
      aMax: clamp(aMin, 1.2, L - 1.2 - eW) + eW,
      bMin: house.bMin + rng.range(0, houseDepth - eDepth),
      bMax: 0,
    }
    box.bMax = box.bMin + eDepth
    parts.push(toPart('extension', streetSide, W, D, box, heightM - 2.85, 0.6 + rng.range(0, 0.2)))
  }

  // Garden-side attachments (b beyond the house back).
  const gardenB = house.bMax
  const gardenRoom = Dp - gardenB
  // Terrace slab on the garden side — very common.
  if (gardenRoom >= 3 && rng.bool(0.78)) {
    const tW = clamp(houseWidth * rng.range(0.55, 0.85), 3, houseWidth)
    const tDepth = clamp(rng.range(3, 5), 2.5, gardenRoom - 0.5)
    const aMid = clamp(aCenter + rng.range(-1, 1), house.aMin + tW / 2, house.aMax - tW / 2)
    const box: Placed = { aMin: aMid - tW / 2, aMax: aMid + tW / 2, bMin: gardenB, bMax: gardenB + tDepth }
    parts.push(toPart('terrace', streetSide, W, D, box, 0, 0.7 + rng.range(0, 0.18)))
  }
  // Conservatory (Wintergarten) — glassy, garden-side, one storey.
  if (gardenRoom >= 3 && stories >= 1 && rng.bool(0.3)) {
    const cW = clamp(rng.range(3, 4.5), 2.5, houseWidth * 0.6)
    const cDepth = clamp(rng.range(2.8, 3.6), 2.4, gardenRoom - 0.5)
    const aMin = clamp(house.aMin + rng.range(0, Math.max(0.1, houseWidth - cW)), house.aMin, house.aMax - cW)
    const box: Placed = { aMin, aMax: aMin + cW, bMin: gardenB, bMax: gardenB + cDepth }
    parts.push(toPart('conservatory', streetSide, W, D, box, 2.8, 0.55 + rng.range(0, 0.2)))
  }
  // Balcony — an upper-storey slab overhanging the garden side.
  if (stories >= 2 && rng.bool(0.5)) {
    const bW = clamp(rng.range(2.5, 4), 2, houseWidth * 0.7)
    const aMin = clamp(aCenter - bW / 2, house.aMin, house.aMax - bW)
    const box: Placed = { aMin, aMax: aMin + bW, bMin: gardenB - 0.2, bMax: gardenB + 1.4 }
    parts.push(toPart('balcony', streetSide, W, D, box, heightM - 0.2, 0.62 + rng.range(0, 0.18)))
  }

  const areaSqm = Math.round(polygonAreaSqm(footprint))
  return {
    footprint,
    parts,
    heightM,
    stories,
    areaSqm,
    confidence: Math.min(0.99, 0.9 + rng.range(0, 0.08)),
  }
}

export const BuildingRecognizer: DetectorModule<PropertyFeature, BuildingFeature> = {
  id: 'building-recognizer',
  label: 'Gebäude',
  run: detectBuilding,
}
