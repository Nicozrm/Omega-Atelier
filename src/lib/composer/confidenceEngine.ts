/**
 * confidenceEngine.ts — the ConfidenceEngine.
 *
 * Rolls the per-feature confidences up into one report: a score per canonical
 * object plus a weighted overall. Interior layout is always the least certain
 * value — the aerial can't see inside, so the floor plan is a plausible guess
 * and is scored accordingly, which the UI surfaces so users know what to check.
 */

import type {
  BuildingFeature,
  ConfidenceKey,
  ConfidenceReport,
  PropertyFeature,
  Rng,
  RoofFeature,
  TerrainProfile,
  VegetationFeature,
} from './types'

export interface ConfidenceInput {
  property: PropertyFeature
  building: BuildingFeature
  roof: RoofFeature
  terrain: TerrainProfile
  vegetation: VegetationFeature
  rng: Rng
}

/** Relative weight of each object in the overall score. */
const WEIGHTS: Record<ConfidenceKey, number> = {
  property: 1.4,
  building: 1.6,
  roof: 1.1,
  garage: 0.6,
  terrain: 0.8,
  vegetation: 0.7,
  interior: 1.0,
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Average confidence across a list, or a fallback when empty. */
function meanConfidence(items: { confidence: number }[], fallback: number): number {
  if (items.length === 0) return fallback
  return items.reduce((s, i) => s + i.confidence, 0) / items.length
}

export function computeConfidence(input: ConfidenceInput): ConfidenceReport {
  const { property, building, roof, terrain, vegetation, rng } = input

  const garagePart = building.parts.find((p) => p.kind === 'garage' || p.kind === 'carport')
  const vegItems = [
    ...vegetation.plants,
    ...vegetation.hedges,
    ...vegetation.pools,
  ]

  // Interior is never observed from above — a plausible floor plan scores low.
  const interior = clamp01(0.38 + rng.fork(0x494e5452).range(0, 0.14))

  const byObject: Record<ConfidenceKey, number> = {
    property: round2(clamp01(property.confidence)),
    building: round2(clamp01(building.confidence)),
    roof: round2(clamp01(roof.confidence)),
    garage: round2(clamp01(garagePart ? garagePart.confidence : 0)),
    terrain: round2(clamp01(terrain.confidence)),
    vegetation: round2(clamp01(meanConfidence(vegItems, 0.6))),
    interior: round2(interior),
  }

  // Weighted overall — skip the garage term when there is no garage.
  let sum = 0
  let wsum = 0
  for (const key of Object.keys(byObject) as ConfidenceKey[]) {
    if (key === 'garage' && !garagePart) continue
    const w = WEIGHTS[key]
    sum += byObject[key] * w
    wsum += w
  }

  return {
    overall: round2(wsum > 0 ? sum / wsum : 0),
    byObject,
  }
}

/** Format a 0..1 confidence as a whole-percent string (e.g. "92 %"). */
export function formatConfidence(v: number): string {
  return `${Math.round(clamp01(v) * 100)} %`
}

export const ConfidenceEngine = {
  id: 'confidence-engine',
  compute: computeConfidence,
  format: formatConfidence,
}
