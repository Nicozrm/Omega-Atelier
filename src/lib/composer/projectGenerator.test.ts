import { describe, it, expect } from 'vitest'
import { generateProject, draftToProject } from './projectGenerator'
import { buildScene } from './sceneBuilder'
import { runAnalysis, type AnalysisInput } from './analysisEngine'
import { coercePlan } from '@/lib/planSchema'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'

const BERLIN = { lat: 52.52, lng: 13.405 }
const INPUT: AnalysisInput = { view: { center: BERLIN, zoom: 18 }, tap: BERLIN }

const FURNITURE_IDS = new Set(FURNITURE.map((f) => f.id))
const DEVICE_IDS = new Set(DEVICES.map((d) => d.id))

describe('generateProject', () => {
  it('builds a schema-2 PlanDocument with a valid active floor', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    expect(project.schemaVersion).toBe(2)
    expect(project.floors.length).toBeGreaterThanOrEqual(1)
    expect(project.floors.some((f) => f.id === project.activeFloorId)).toBe(true)
    expect(project.modes.length).toBeGreaterThan(0)
    expect(project.settings.unit).toBe('cm')
  })

  it('anchors the plan at its real-world capture point (doc.geo)', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    expect(project.geo?.lat).toBeCloseTo(BERLIN.lat, 3)
    expect(project.geo?.lng).toBeCloseTo(BERLIN.lng, 3)
    // …and the anchor survives the plan-schema gate (cloud round-trip).
    expect(coercePlan(project)?.geo).toEqual(project.geo)
  })

  it('survives the plan-schema gate unchanged in floor count', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    const coerced = coercePlan(project)
    expect(coerced).not.toBeNull()
    expect(coerced!.floors.length).toBe(project.floors.length)
    expect(coerced!.title).toBe(project.title)
  })

  it('only ships catalog-known furniture and device ids', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    for (const floor of project.floors) {
      for (const f of floor.furniture) expect(FURNITURE_IDS.has(f.furnitureId)).toBe(true)
      for (const d of floor.devices) expect(DEVICE_IDS.has(d.deviceId)).toBe(true)
    }
  })

  it('gives every element a unique id (fully editable)', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    const ids: string[] = []
    for (const floor of project.floors) {
      ids.push(floor.id)
      floor.walls.forEach((w) => ids.push(w.id))
      floor.rooms.forEach((r) => ids.push(r.id))
      floor.furniture.forEach((f) => ids.push(f.id))
      floor.devices.forEach((d) => ids.push(d.id))
      floor.labels.forEach((l) => ids.push(l.id))
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('enables every layer so the twin is visible immediately', async () => {
    const project = generateProject(await runAnalysis(INPUT))
    for (const floor of project.floors) {
      expect(floor.layers).toEqual({ walls: true, furniture: true, devices: true, labels: true })
    }
  })

  it('honours an explicit title', async () => {
    const draft = buildScene(await runAnalysis(INPUT))
    const project = draftToProject(draft, 'Mein Zuhause')
    expect(project.title).toBe('Mein Zuhause')
  })
})
