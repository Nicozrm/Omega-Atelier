/**
 * analysisEngine.ts — the MapAnalysisEngine.
 *
 * Orchestrates the modular pipeline
 *
 *   MapProvider → SatelliteImage → Property → Building → Roof
 *              → Vegetation → Terrain → Confidence → DetectedScene
 *
 * Every detector is a swappable {@link DetectorModule}; the engine merges any
 * caller-supplied modules over the {@link defaultPipeline}. The run is async and
 * cancelable (via `AbortSignal`), reports granular progress, and inserts a
 * configurable per-phase delay so the UI can play its cinematic without blocking
 * — in tests the delay is 0, so a full analysis resolves in microseconds.
 */

import type {
  AnalysisContext,
  AnalysisProgress,
  BuildingFeature,
  DetectedScene,
  DetectorModule,
  GeoPoint,
  MapView,
  PhaseId,
  PropertyFeature,
  RoofFeature,
  SatelliteImage,
  TerrainProfile,
  VegetationFeature,
} from './types'
import { SeededRng } from './rng'
import { defaultMapProvider, type MapProvider } from './mapProvider'
import { PropertyDetector } from './propertyDetector'
import { BuildingRecognizer } from './buildingDetector'
import { RoofDetector } from './roofDetector'
import { TerrainRecognizer, type TerrainInput } from './terrainDetector'
import { VegetationRecognizer, type VegetationInput } from './vegetationDetector'
import { computeConfidence } from './confidenceEngine'

export interface DetectorPipeline {
  property: DetectorModule<SatelliteImage, PropertyFeature>
  building: DetectorModule<PropertyFeature, BuildingFeature>
  roof: DetectorModule<BuildingFeature, RoofFeature>
  vegetation: DetectorModule<VegetationInput, VegetationFeature>
  terrain: DetectorModule<TerrainInput, TerrainProfile>
}

/** The stock detector pipeline — every module can be overridden per run. */
export const defaultPipeline: DetectorPipeline = {
  property: PropertyDetector,
  building: BuildingRecognizer,
  roof: RoofDetector,
  vegetation: VegetationRecognizer,
  terrain: TerrainRecognizer,
}

export const PHASE_LABEL: Record<PhaseId, string> = {
  satellite: 'Satellitenbild geladen',
  property: 'Grundstück erkannt',
  building: 'Gebäude erkannt',
  roof: 'Dach vermessen',
  vegetation: 'Vegetation erkannt',
  terrain: 'Gelände erkannt',
  scene: 'Szene aufgebaut',
  project: 'Digital Twin wird erstellt',
}

/** Execution order of the analysis phases (detection only). */
export const ANALYSIS_PHASES: PhaseId[] = [
  'satellite',
  'property',
  'building',
  'roof',
  'vegetation',
  'terrain',
]

export interface ChecklistItem {
  id: string
  label: string
  phases: PhaseId[]
}

/** The five progress checkpoints shown in the wizard's analysis step. */
export const ANALYSIS_CHECKLIST: ChecklistItem[] = [
  { id: 'property', label: 'Grundstück erkannt', phases: ['satellite', 'property'] },
  { id: 'building', label: 'Gebäude & Dach erkannt', phases: ['building', 'roof'] },
  { id: 'vegetation', label: 'Vegetation erkannt', phases: ['vegetation'] },
  { id: 'terrain', label: 'Gelände erkannt', phases: ['terrain'] },
  { id: 'twin', label: 'Digital Twin wird erstellt', phases: ['scene', 'project'] },
]

export interface AnalysisInput {
  view: MapView
  tap: GeoPoint
  /** Optional user-drawn parcel override (reserved — geometry still derives from the tap). */
  polygon?: GeoPoint[]
}

export interface AnalyzeOptions {
  provider?: MapProvider
  pipeline?: Partial<DetectorPipeline>
  onProgress?: (p: AnalysisProgress) => void
  signal?: AbortSignal
  /** Minimum ms each phase occupies (cinematic pacing). Default 0. */
  phaseDelayMs?: number
}

/** Thrown when a run is aborted via its `AbortSignal`. */
export class AnalysisCanceledError extends Error {
  constructor(message = 'Analyse abgebrochen') {
    super(message)
    this.name = 'AnalysisCanceledError'
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AnalysisCanceledError())
    }
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new AnalysisCanceledError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AnalysisCanceledError()
}

/**
 * Run the detection pipeline for one tap and resolve to a {@link DetectedScene}.
 * Rejects with {@link AnalysisCanceledError} if the signal aborts.
 */
export async function runAnalysis(input: AnalysisInput, opts: AnalyzeOptions = {}): Promise<DetectedScene> {
  const provider = opts.provider ?? defaultMapProvider
  const pipeline: DetectorPipeline = { ...defaultPipeline, ...opts.pipeline }
  const delay = opts.phaseDelayMs ?? 0
  const { signal, onProgress } = opts

  const total = ANALYSIS_PHASES.length
  let index = 0
  const emit = (phase: PhaseId, confidence?: number, detail?: string) => {
    index += 1
    onProgress?.({ phase, index, total, label: PHASE_LABEL[phase], confidence, detail })
  }

  throwIfAborted(signal)

  // 1. Satellite capture
  const image = provider.capture(input.tap, input.view)
  const rng = new SeededRng(image.seed)
  const ctx: AnalysisContext = { rng, image }
  emit('satellite', undefined, provider.label)
  await sleep(delay, signal)
  throwIfAborted(signal)

  // 2. Property
  const property = pipeline.property.run(image, ctx)
  emit('property', property.confidence)
  await sleep(delay, signal)
  throwIfAborted(signal)

  // 3. Building
  const building = pipeline.building.run(property, ctx)
  emit('building', building.confidence)
  await sleep(delay, signal)
  throwIfAborted(signal)

  // 4. Roof
  const roof = pipeline.roof.run(building, ctx)
  emit('roof', roof.confidence)
  await sleep(delay, signal)
  throwIfAborted(signal)

  // 5. Vegetation
  const vegetation = pipeline.vegetation.run({ property, building }, ctx)
  emit('vegetation')
  await sleep(delay, signal)
  throwIfAborted(signal)

  // 6. Terrain
  const terrain = pipeline.terrain.run({ property, building }, ctx)
  emit('terrain', terrain.confidence)
  await sleep(delay, signal)
  throwIfAborted(signal)

  const confidence = computeConfidence({ property, building, roof, terrain, vegetation, rng })

  return {
    origin: image.center,
    image,
    property,
    building,
    roof,
    terrain,
    vegetation,
    confidence,
    meta: { seed: image.seed, provider: provider.id, analyzedAt: new Date().toISOString() },
  }
}

/**
 * MapAnalysisEngine — a thin, configurable wrapper around {@link runAnalysis}
 * that carries a provider + pipeline so callers can hold one engine instance.
 */
export class MapAnalysisEngine {
  readonly provider: MapProvider
  readonly pipeline: DetectorPipeline

  constructor(config: { provider?: MapProvider; pipeline?: Partial<DetectorPipeline> } = {}) {
    this.provider = config.provider ?? defaultMapProvider
    this.pipeline = { ...defaultPipeline, ...config.pipeline }
  }

  analyze(input: AnalysisInput, opts: Omit<AnalyzeOptions, 'provider' | 'pipeline'> = {}): Promise<DetectedScene> {
    return runAnalysis(input, { ...opts, provider: this.provider, pipeline: this.pipeline })
  }
}
