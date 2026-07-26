/**
 * propertyDetector.ts — the first detector: satellite patch → property parcel.
 *
 * Reads the synthetic parcel that the tap snapped to and emits an axis-aligned
 * parcel rectangle in the local metric frame (NW corner at the origin). The
 * geometry is kept orthogonal on purpose — the generated plan should drop into
 * the editor clean and square; the parcel's real orientation is preserved as
 * metadata for the roof/terrain modules and the labels.
 */

import type {
  AnalysisContext,
  DetectorModule,
  PropertyFeature,
  SatelliteImage,
} from './types'
import { polygonAreaSqm } from './geo'
import { parcelAt } from './world'

export function rect(x0: number, y0: number, x1: number, y1: number) {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]
}

export function detectProperty(image: SatelliteImage, ctx: AnalysisContext): PropertyFeature {
  const parcel = parcelAt(image.center)
  const rng = ctx.rng.fork(0x50524f50) // 'PROP'

  const widthM = Math.round(parcel.widthM * 10) / 10
  const depthM = Math.round(parcel.depthM * 10) / 10
  const polygon = rect(0, 0, widthM, depthM)

  // The synthetic world lays streets along the south edge; occasionally a
  // corner lot fronts east/west. Kept deterministic via the parcel seed.
  const streetSide = rng.next() < 0.82 ? 'south' : rng.pick(['east', 'west'] as const)

  return {
    polygon,
    areaSqm: Math.round(polygonAreaSqm(polygon)),
    widthM,
    depthM,
    orientationDeg: Math.round(parcel.orientationDeg * 10) / 10,
    streetSide,
    // Parcel boundaries are the most reliable thing in aerial analysis.
    confidence: Math.min(0.99, 0.9 + rng.range(0, 0.08)),
  }
}

export const PropertyDetector: DetectorModule<SatelliteImage, PropertyFeature> = {
  id: 'property-detector',
  label: 'Grundstück',
  run: detectProperty,
}
