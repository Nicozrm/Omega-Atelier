/**
 * Image Blaster 3D — settings normalization.
 *
 * Settings snapshots travel through untrusted boundaries (localStorage
 * library, plan documents from the cloud). `normalizeSettings` repairs any
 * value into a complete, in-range `BlasterSettings` so the pipeline never
 * sees NaN, missing fields, or unknown enum values.
 */

import { DEFAULT_SETTINGS } from './types'
import type { BlasterSettings, MeshMode, SegmentSource } from './types'

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback

const MODES: MeshMode[] = ['relief', 'extrude', 'billboard', 'points']
const SOURCES: SegmentSource[] = ['alpha', 'luminance', 'chroma']

export function normalizeSettings(raw: unknown): BlasterSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = (r.depth ?? {}) as Record<string, unknown>
  const m = (r.mesh ?? {}) as Record<string, unknown>
  const mat = (r.material ?? {}) as Record<string, unknown>
  const D = DEFAULT_SETTINGS

  return {
    depth: {
      luminanceWeight: num(d.luminanceWeight, D.depth.luminanceWeight, 0, 1),
      saturationWeight: num(d.saturationWeight, D.depth.saturationWeight, 0, 1),
      verticalWeight: num(d.verticalWeight, D.depth.verticalWeight, 0, 1),
      smoothing: num(d.smoothing, D.depth.smoothing, 0, 8),
      gamma: num(d.gamma, D.depth.gamma, 0.25, 3),
      invert: bool(d.invert, D.depth.invert),
    },
    mesh: {
      mode: MODES.includes(m.mode as MeshMode) ? (m.mode as MeshMode) : D.mesh.mode,
      resolution: num(m.resolution, D.mesh.resolution, 16, 256),
      depthScale: num(m.depthScale, D.mesh.depthScale, 0, 1),
      thickness: num(m.thickness, D.mesh.thickness, 0.005, 1),
      threshold: num(m.threshold, D.mesh.threshold, 0, 1),
      segmentSource: SOURCES.includes(m.segmentSource as SegmentSource)
        ? (m.segmentSource as SegmentSource)
        : D.mesh.segmentSource,
      solidBack: bool(m.solidBack, D.mesh.solidBack),
      pointSize: num(m.pointSize, D.mesh.pointSize, 0.001, 0.05),
    },
    material: {
      metalness: num(mat.metalness, D.material.metalness, 0, 1),
      roughness: num(mat.roughness, D.material.roughness, 0, 1),
      normalStrength: num(mat.normalStrength, D.material.normalStrength, 0, 3),
      roughnessFromImage: bool(mat.roughnessFromImage, D.material.roughnessFromImage),
      doubleSided: bool(mat.doubleSided, D.material.doubleSided),
    },
  }
}
