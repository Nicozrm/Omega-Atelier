import { describe, it, expect } from 'vitest'
import { composeProject } from './compose'
import { AnalysisCanceledError, type AnalysisInput } from './analysisEngine'
import { coercePlan } from '@/lib/planSchema'
import type { AnalysisProgress, PhaseId } from './types'

const BERLIN = { lat: 52.52, lng: 13.405 }
const INPUT: AnalysisInput = { view: { center: BERLIN, zoom: 18 }, tap: BERLIN }

describe('composeProject', () => {
  it('produces a scene, draft and editable project in one call', async () => {
    const { scene, draft, project } = await composeProject(INPUT)
    expect(scene.confidence.overall).toBeGreaterThan(0)
    expect(draft.floors.length).toBeGreaterThanOrEqual(1)
    expect(coercePlan(project)).not.toBeNull()
  })

  it('is deterministic', async () => {
    const a = await composeProject(INPUT)
    const b = await composeProject(INPUT)
    expect(a.project.floors.length).toBe(b.project.floors.length)
    expect(a.scene.meta.seed).toBe(b.scene.meta.seed)
  })

  it('reports progress all the way through scene and project phases', async () => {
    const phases: PhaseId[] = []
    let lastTotal = 0
    await composeProject(INPUT, {
      onProgress: (p: AnalysisProgress) => {
        phases.push(p.phase)
        lastTotal = p.total
      },
    })
    expect(phases).toContain('scene')
    expect(phases).toContain('project')
    expect(phases[phases.length - 1]).toBe('project')
    expect(lastTotal).toBe(8)
  })

  it('can be canceled during the analysis', async () => {
    const ac = new AbortController()
    const p = composeProject(INPUT, { signal: ac.signal, phaseDelayMs: 500 })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AnalysisCanceledError)
  })
})
