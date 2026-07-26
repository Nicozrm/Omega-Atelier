/**
 * compose.ts — end-to-end orchestration: tap → editable Omega project.
 *
 * Runs the detection engine, then the SceneBuilder and ProjectGenerator,
 * reporting the two trailing phases ('scene', 'project') so the wizard's
 * checklist completes all the way to "Digital Twin wird erstellt". Cancelable
 * and deterministic like the engine it wraps.
 */

import type { PlanDocument } from '@/types'
import type { DetectedScene, PhaseId } from './types'
import {
  AnalysisCanceledError,
  PHASE_LABEL,
  runAnalysis,
  type AnalysisInput,
  type AnalyzeOptions,
} from './analysisEngine'
import { buildScene, type OmegaSceneDraft } from './sceneBuilder'
import { draftToProject } from './projectGenerator'

export interface ComposeResult {
  scene: DetectedScene
  draft: OmegaSceneDraft
  project: PlanDocument
}

/** Total phases across detection + scene + project. */
const TAIL_PHASES: PhaseId[] = ['scene', 'project']

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new AnalysisCanceledError())
        return
      }
      signal.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new AnalysisCanceledError())
      }, { once: true })
    }
  })
}

/**
 * Analyse a tapped location and build the full editable project. Progress is
 * reported for every phase including the trailing scene/project build.
 */
export async function composeProject(input: AnalysisInput, opts: AnalyzeOptions = {}): Promise<ComposeResult> {
  const { onProgress, signal } = opts
  const delay = opts.phaseDelayMs ?? 0

  // Detection reports phases 1..N; the scene/project phases extend that count.
  const scene = await runAnalysis(input, opts)
  const detectionTotal = 6 // ANALYSIS_PHASES.length — kept in sync via the engine
  const total = detectionTotal + TAIL_PHASES.length

  if (signal?.aborted) throw new AnalysisCanceledError()
  const draft = buildScene(scene)
  onProgress?.({ phase: 'scene', index: detectionTotal + 1, total, label: PHASE_LABEL.scene })
  await sleep(delay, signal)

  if (signal?.aborted) throw new AnalysisCanceledError()
  const project = draftToProject(draft)
  onProgress?.({ phase: 'project', index: total, total, label: PHASE_LABEL.project, confidence: scene.confidence.overall })
  await sleep(delay, signal)

  return { scene, draft, project }
}
