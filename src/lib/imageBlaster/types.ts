/**
 * Image Blaster 3D — shared pipeline types.
 *
 * The pipeline turns one input image into a textured 3D asset:
 *   analyse → segment → estimate depth → build mesh → texture (PBR maps).
 *
 * All stages operate on a plain {@link PixelGrid} (not the DOM `ImageData`)
 * so the whole pipeline stays pure and unit-testable under jsdom, where
 * canvas 2D contexts are unavailable.
 */

/** Raw RGBA pixels, row-major, 4 bytes per pixel — structurally compatible
 *  with `ImageData`, but constructible without a canvas. */
export interface PixelGrid {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Single-channel float field in [0,1], row-major. */
export interface ScalarField {
  data: Float32Array
  width: number
  height: number
}

/** How the silhouette/subject is isolated before meshing. */
export type SegmentSource = 'alpha' | 'luminance' | 'chroma'

/** Geometry strategy. */
export type MeshMode = 'relief' | 'extrude' | 'billboard' | 'points'

export interface ImageAnalysis {
  width: number
  height: number
  /** Average luminance in [0,1]. */
  luminanceMean: number
  /** RMS contrast in [0,1]. */
  contrast: number
  /** Average saturation in [0,1]. */
  saturationMean: number
  /** Fraction of pixels with alpha < 250 — >0 means a real cutout exists. */
  transparentRatio: number
  /** Fraction of strong edges (Sobel magnitude above threshold). */
  edgeDensity: number
  /** Top dominant colors as CSS hex, most frequent first. */
  dominantColors: string[]
  /** Best-guess mesh mode for this image. */
  suggestedMode: MeshMode
  /** Best-guess segmentation source. */
  suggestedSegment: SegmentSource
}

export interface DepthSettings {
  /** Weight of the brightness→near cue, 0..1. */
  luminanceWeight: number
  /** Weight of the saturation→near cue, 0..1. */
  saturationWeight: number
  /** Weight of the bottom-of-frame→near prior, 0..1. */
  verticalWeight: number
  /** Edge-aware smoothing iterations, 0..8. */
  smoothing: number
  /** Remaps depth contrast, 0.25..3 (1 = linear). */
  gamma: number
  /** Flip near/far. */
  invert: boolean
}

export interface MeshSettings {
  mode: MeshMode
  /** Grid resolution along the longer image edge (relief), 16..256. */
  resolution: number
  /** Relief displacement as a fraction of the longer edge, 0..1. */
  depthScale: number
  /** Extrusion thickness as a fraction of the longer edge (extrude mode). */
  thickness: number
  /** Segmentation threshold 0..1 (extrude/billboard cutout). */
  threshold: number
  /** Which channel drives segmentation. */
  segmentSource: SegmentSource
  /** Give the relief a closed back + skirt so exports are watertight-ish. */
  solidBack: boolean
  /** Point diameter in world units (points mode). */
  pointSize: number
}

export interface MaterialSettings {
  metalness: number
  roughness: number
  /** Normal-map strength multiplier, 0..3. */
  normalStrength: number
  /** Derive a roughness map from inverted luminance. */
  roughnessFromImage: boolean
  doubleSided: boolean
}

export interface BlasterSettings {
  depth: DepthSettings
  mesh: MeshSettings
  material: MaterialSettings
}

/** Raw geometry buffers — consumed by three.js but free of three imports. */
export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export type PipelineStageKey =
  | 'analyse'
  | 'segment'
  | 'depth'
  | 'mesh'
  | 'texture'

export interface PipelineStage {
  key: PipelineStageKey
  label: string
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: 'analyse', label: 'Bildanalyse' },
  { key: 'segment', label: 'Segmentierung' },
  { key: 'depth', label: 'Tiefenschätzung' },
  { key: 'mesh', label: 'Mesh-Generierung' },
  { key: 'texture', label: 'PBR-Texturierung' },
]

export const DEFAULT_SETTINGS: BlasterSettings = {
  depth: {
    luminanceWeight: 0.55,
    saturationWeight: 0.2,
    verticalWeight: 0.25,
    smoothing: 3,
    gamma: 1,
    invert: false,
  },
  mesh: {
    mode: 'relief',
    resolution: 160,
    depthScale: 0.22,
    thickness: 0.12,
    threshold: 0.5,
    segmentSource: 'luminance',
    solidBack: true,
    pointSize: 0.006,
  },
  material: {
    metalness: 0.05,
    roughness: 0.65,
    normalStrength: 1,
    roughnessFromImage: true,
    doubleSided: false,
  },
}
