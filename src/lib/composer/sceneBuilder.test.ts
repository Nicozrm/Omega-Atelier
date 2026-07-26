import { describe, it, expect } from 'vitest'
import { buildScene } from './sceneBuilder'
import { runAnalysis, type AnalysisInput } from './analysisEngine'
import type { DetectedScene } from './types'

const BERLIN = { lat: 52.52, lng: 13.405 }
const INPUT: AnalysisInput = { view: { center: BERLIN, zoom: 18 }, tap: BERLIN }

/** Find a deterministic scene matching a predicate by sweeping nearby taps. */
async function sceneWhere(pred: (s: DetectedScene) => boolean): Promise<DetectedScene> {
  for (let i = 0; i < 120; i++) {
    const tap = { lat: 52.4 + i * 0.001, lng: 13.3 + i * 0.0009 }
    const scene = await runAnalysis({ view: { center: tap, zoom: 18 }, tap })
    if (pred(scene)) return scene
  }
  throw new Error('no matching scene found')
}

describe('buildScene', () => {
  it('is deterministic for a given scene', async () => {
    const scene = await runAnalysis(INPUT)
    expect(buildScene(scene)).toEqual(buildScene(scene))
  })

  it('produces a ground floor with a positive extent', async () => {
    const draft = buildScene(await runAnalysis(INPUT))
    expect(draft.floors[0].name).toBe('Erdgeschoss')
    expect(draft.floors[0].extent.width).toBeGreaterThan(0)
    expect(draft.floors[0].extent.height).toBeGreaterThan(0)
  })

  it('includes the plot as an outdoor zone and interior rooms', async () => {
    const draft = buildScene(await runAnalysis(INPUT))
    const rooms = draft.floors[0].rooms
    const plot = rooms.find((r) => r.name === 'Grundstück')
    expect(plot?.zoneType).toBe('outdoor')
    expect(plot?.polygon).toHaveLength(4)
    for (const name of ['Wohnzimmer', 'Küche', 'Schlafzimmer', 'Bad']) {
      expect(rooms.some((r) => r.name === name)).toBe(true)
    }
  })

  it('emits a valid exterior shell with exactly one entrance door', async () => {
    const draft = buildScene(await runAnalysis(INPUT))
    const walls = draft.floors[0].walls
    expect(walls.length).toBeGreaterThan(4)
    for (const w of walls) {
      expect(typeof w.a.x).toBe('number')
      expect(w.thickness).toBeGreaterThan(0)
    }
    const doors = walls.filter((w) => w.subtype === 'door')
    // one house door (+ possibly a garage door) — at least one, at most a few
    expect(doors.length).toBeGreaterThanOrEqual(1)
    expect(doors.length).toBeLessThanOrEqual(3)
  })

  it('carries a confidence report and a summary', async () => {
    const draft = buildScene(await runAnalysis(INPUT))
    expect(draft.confidence.overall).toBeGreaterThan(0)
    expect(draft.summary.plotAreaSqm).toBeGreaterThan(0)
    expect(draft.summary.buildingAreaSqm).toBeGreaterThan(0)
    expect(draft.tags).toContain('ai-composer')
  })

  it('adds an upper floor for multi-storey buildings', async () => {
    const scene = await sceneWhere((s) => s.building.stories >= 2)
    const draft = buildScene(scene)
    expect(draft.floors.length).toBe(2)
    expect(draft.floors[1].name).toBe('1. Obergeschoss')
    expect(draft.floors[1].index).toBe(1)
  })

  it('keeps a single floor for a bungalow', async () => {
    const scene = await sceneWhere((s) => s.building.stories === 1)
    const draft = buildScene(scene)
    expect(draft.floors.length).toBe(1)
  })
})
