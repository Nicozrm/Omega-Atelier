/**
 * Omega AI Home Composer — domain types.
 *
 * The Composer turns a tap on a satellite map into a realistic, fully-editable
 * Digital Twin of a property. The whole pipeline is **offline-first** and
 * **deterministic**: every result is derived from a seed hashed out of the
 * tapped geo-coordinate, so the same spot always yields the same twin and every
 * module is unit-testable with fixtures — no network, no ML runtime required.
 *
 * Coordinate conventions used across the domain:
 *   • Geo    — WGS84 latitude / longitude in degrees.
 *   • Local  — metres relative to the property's north-west corner, x → east,
 *              y → south (down). This matches the editor's screen/plan axes.
 *   • Plan   — centimetres (the editor's world unit) — produced last, by the
 *              SceneBuilder / ProjectGenerator.
 *
 * These types are renderer- and IO-neutral (no React, no three.js), so they sit
 * safely on every load path and in every test.
 */

import type { ISODateTime } from '@/types'
import type { Provenance } from './provenance'

// ───────────────────────── Geo & map ─────────────────────────

export interface GeoPoint {
  lat: number
  lng: number
}

/** A slippy-map style view: a centre and an integer zoom level. */
export interface MapView {
  center: GeoPoint
  /** Web-mercator zoom (≈0 world … 22 building). The composer uses 16–20. */
  zoom: number
}

/** A geocoding hit — offline gazetteer or a synthesised plausible location. */
export interface GeoResult {
  label: string
  point: GeoPoint
  /** Where the hit came from — a real match or a deterministic estimate. */
  source: 'gazetteer' | 'coordinate' | 'synthetic'
  /** 0..1 how confident the geocoder is in this hit. */
  confidence: number
}

/**
 * A captured "satellite image" — in the offline provider this is not pixels but
 * a deterministic descriptor of the analysed patch. Detectors read the seed and
 * span; the SatelliteImage is the pipeline's first artefact after the provider.
 */
export interface SatelliteImage {
  center: GeoPoint
  /** Edge length of the analysed square, metres. */
  spanMeters: number
  /** Deterministic uint32 seed derived from the centre. */
  seed: number
  /** Ground-sample resolution hint, metres per pixel. */
  metersPerPixel: number
  provider: string
  capturedAt: ISODateTime
}

// ───────────────────────── Local geometry ─────────────────────────

/** A point in local metres (x → east, y → south) from the property NW corner. */
export interface LocalPoint {
  x: number
  y: number
}

export type LocalPolygon = LocalPoint[]

// ───────────────────────── Detected features ─────────────────────────

export interface PropertyFeature {
  /** Parcel boundary, metres, clockwise from NW. */
  polygon: LocalPolygon
  areaSqm: number
  widthM: number
  depthM: number
  /** Parcel long-axis rotation relative to north, degrees. */
  orientationDeg: number
  /** Which edge faces the street ('south' most common in the synthetic world). */
  streetSide: 'north' | 'east' | 'south' | 'west'
  confidence: number
}

export type BuildingPartKind =
  | 'main'
  | 'garage'
  | 'extension'
  | 'conservatory'
  | 'carport'
  | 'balcony'
  | 'terrace'

export interface BuildingPart {
  kind: BuildingPartKind
  polygon: LocalPolygon
  /** Structure height, metres (0 for a flat terrace slab). */
  heightM: number
  confidence: number
}

export interface BuildingFeature {
  /** Main structure footprint, metres. */
  footprint: LocalPolygon
  parts: BuildingPart[]
  /** Eaves/parapet height of the main volume, metres. */
  heightM: number
  stories: number
  areaSqm: number
  confidence: number
  /**
   * Where each fact about this building came from, tracked separately.
   *
   * A single confidence number for "the building" would blur the case that
   * actually occurs: an OSM footprint is *measured* while its storey count is
   * an *assumption* from the regional average. Optional, because the offline
   * detectors synthesise buildings rather than observing them and have nothing
   * honest to put here.
   */
  provenance?: {
    footprint: Provenance
    stories: Provenance
    height: Provenance
  }
}

/**
 * Real-world parcel geometry, in the parcel's own axes.
 *
 * Measured plots are rotated and irregular; siting a house on one needs its
 * true width, depth and orientation rather than the compass-aligned bounding
 * box, which over-states both dimensions on any plot not facing north.
 */
export interface ParcelInput {
  /** Outline in local metres, bounding box anchored at (0, 0). */
  polygon: LocalPolygon
  /** True area by the shoelace formula — not the bounding box's. */
  areaSqm: number
  /** Extent along the parcel's own axes. */
  widthM: number
  depthM: number
  /** Rotation of those axes against north, degrees. */
  orientationDeg: number
}

export type RoofShape = 'gable' | 'hip' | 'flat' | 'pent'

export interface RoofFeature {
  shape: RoofShape
  /** Slope of the roof planes, degrees (0 for flat). */
  pitchDeg: number
  ridgeHeightM: number
  eavesHeightM: number
  /** Ridge orientation relative to north, degrees. */
  orientationDeg: number
  confidence: number
}

export interface TerrainStep {
  at: LocalPoint
  count: number
  /** Rise per step, metres. */
  riseM: number
}

export interface TerrainProfile {
  /** Overall ground slope, degrees. */
  slopeDeg: number
  /** Downhill direction relative to north, degrees. */
  aspectDeg: number
  /** Elevation drop across the property, metres. */
  elevationDropM: number
  /** Driveway centre-line from the street to the garage/entrance, metres. */
  drivewayPath: LocalPolygon
  steps: TerrainStep[]
  confidence: number
}

export type PlantKind = 'tree' | 'shrub'

export interface PlantItem {
  at: LocalPoint
  /** Canopy radius, metres. */
  radiusM: number
  kind: PlantKind
  confidence: number
}

export interface HedgeItem {
  /** Hedge centre-line, metres. */
  path: LocalPolygon
  heightM: number
  confidence: number
}

export interface LawnItem {
  polygon: LocalPolygon
  areaSqm: number
}

export interface PoolItem {
  polygon: LocalPolygon
  areaSqm: number
  confidence: number
}

export interface VegetationFeature {
  plants: PlantItem[]
  hedges: HedgeItem[]
  lawns: LawnItem[]
  pools: PoolItem[]
}

// ───────────────────────── Confidence ─────────────────────────

/** The canonical objects a confidence score is reported for. */
export type ConfidenceKey =
  | 'property'
  | 'building'
  | 'roof'
  | 'garage'
  | 'terrain'
  | 'vegetation'
  | 'interior'

export interface ConfidenceReport {
  /** Weighted overall confidence, 0..1. */
  overall: number
  byObject: Record<ConfidenceKey, number>
}

// ───────────────────────── Analysed scene ─────────────────────────

export interface DetectedScene {
  origin: GeoPoint
  image: SatelliteImage
  property: PropertyFeature
  building: BuildingFeature
  roof: RoofFeature
  terrain: TerrainProfile
  vegetation: VegetationFeature
  confidence: ConfidenceReport
  meta: {
    seed: number
    provider: string
    analyzedAt: ISODateTime
  }
}

// ───────────────────────── Pipeline plumbing ─────────────────────────

/**
 * A single, swappable analysis module. Every detector implements this so the
 * engine's pipeline can be reconfigured or mocked without touching the engine —
 * the "jedes Modul muss austauschbar sein" requirement.
 */
export interface DetectorModule<I, O> {
  readonly id: string
  readonly label: string
  run(input: I, ctx: AnalysisContext): O
}

/** Shared, read-only context handed to every detector module. */
export interface AnalysisContext {
  rng: Rng
  image: SatelliteImage
}

/** Re-exported here to keep the pipeline contract in one file. */
export interface Rng {
  next(): number
  range(min: number, max: number): number
  int(min: number, max: number): number
  bool(p?: number): boolean
  pick<T>(items: readonly T[]): T
  gaussian(mean: number, sd: number): number
  fork(salt: number): Rng
}

// ───────────────────────── Progress / async ─────────────────────────

export type PhaseId =
  | 'satellite'
  | 'property'
  | 'building'
  | 'roof'
  | 'terrain'
  | 'vegetation'
  | 'scene'
  | 'project'

export interface AnalysisProgress {
  phase: PhaseId
  /** 1-based position in the run. */
  index: number
  total: number
  label: string
  detail?: string
  /** Confidence of the object produced by this phase, when meaningful. */
  confidence?: number
}

export type AnalysisStatus = 'idle' | 'running' | 'done' | 'error' | 'canceled'
