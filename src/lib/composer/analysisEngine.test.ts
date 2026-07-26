import { describe, it, expect, vi } from 'vitest'
import {
  runAnalysis,
  MapAnalysisEngine,
  AnalysisCanceledError,
  ANALYSIS_PHASES,
  ANALYSIS_CHECKLIST,
  defaultPipeline,
  type AnalysisInput,
} from './analysisEngine'
import type { AnalysisProgress, DetectorModule, PhaseId, PropertyFeature, SatelliteImage } from './types'

const BERLIN = { lat: 52.52, lng: 13.405 }
const INPUT: AnalysisInput = { view: { center: BERLIN, zoom: 18 }, tap: BERLIN }

describe('runAnalysis', () => {
  it('resolves to a deterministic scene', async () => {
    const a = await runAnalysis(INPUT)
    const b = await runAnalysis(INPUT)
    expect(a.building.footprint).toEqual(b.building.footprint)
    expect(a.confidence.overall).toBe(b.confidence.overall)
    expect(a.meta.seed).toBe(b.meta.seed)
  })

  it('assembles a full scene', async () => {
    const scene = await runAnalysis(INPUT)
    expect(scene.property.polygon).toHaveLength(4)
    expect(scene.building.parts.some((p) => p.kind === 'main')).toBe(true)
    expect(scene.roof.shape).toBeTruthy()
    expect(scene.vegetation.hedges.length).toBeGreaterThan(0)
    expect(scene.confidence.overall).toBeGreaterThan(0)
  })

  it('reports progress for every phase, in order', async () => {
    const phases: PhaseId[] = []
    let lastIndex = 0
    await runAnalysis(INPUT, {
      onProgress: (p: AnalysisProgress) => {
        phases.push(p.phase)
        expect(p.index).toBe(lastIndex + 1)
        expect(p.total).toBe(ANALYSIS_PHASES.length)
        lastIndex = p.index
      },
    })
    expect(phases).toEqual(ANALYSIS_PHASES)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(runAnalysis(INPUT, { signal: ac.signal })).rejects.toBeInstanceOf(AnalysisCanceledError)
  })

  it('rejects when aborted during a phase delay', async () => {
    const ac = new AbortController()
    const p = runAnalysis(INPUT, { signal: ac.signal, phaseDelayMs: 1000 })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisCanceledError)
  })

  it('honours a swapped-in detector module', async () => {
    const marker: PropertyFeature = {
      polygon: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 16 },
        { x: 0, y: 16 },
      ],
      areaSqm: 192,
      widthM: 12,
      depthM: 16,
      orientationDeg: 0,
      streetSide: 'south',
      confidence: 0.123,
    }
    const runSpy = vi.fn(() => marker)
    const custom: DetectorModule<SatelliteImage, PropertyFeature> = {
      id: 'stub-property',
      label: 'Stub',
      run: runSpy,
    }
    const scene = await runAnalysis(INPUT, { pipeline: { property: custom } })
    expect(runSpy).toHaveBeenCalledOnce()
    expect(scene.property.confidence).toBe(0.123)
    expect(scene.property.widthM).toBe(12)
  })
})

describe('MapAnalysisEngine', () => {
  it('wraps runAnalysis with its own provider and pipeline', async () => {
    const engine = new MapAnalysisEngine()
    const scene = await engine.analyze(INPUT)
    expect(scene.meta.provider).toBe('offline')
    expect(engine.pipeline.property).toBe(defaultPipeline.property)
  })
})

describe('ANALYSIS_CHECKLIST', () => {
  it('covers all phases across its five checkpoints', () => {
    const covered = new Set<PhaseId>()
    for (const item of ANALYSIS_CHECKLIST) item.phases.forEach((p) => covered.add(p))
    for (const phase of [...ANALYSIS_PHASES, 'scene', 'project'] as PhaseId[]) {
      expect(covered.has(phase)).toBe(true)
    }
    expect(ANALYSIS_CHECKLIST).toHaveLength(5)
  })
})
