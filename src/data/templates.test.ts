import { describe, it, expect } from 'vitest'
import { TEMPLATES, buildOmegaPlan } from './templates'
import { FURNITURE } from './furniture'
import { DEVICES } from './devices'
import { MATERIALS } from './materials'
import { createDemoPlan } from './demoPlan'
import { checkPlanIntegrity } from '@/lib/planIntegrity'

const FURN_IDS = new Set(FURNITURE.map((f) => f.id))
const DEV_IDS = new Set(DEVICES.map((d) => d.id))
const MAT_IDS = new Set(MATERIALS.map((m) => m.id))
const CATEGORY_OF = new Map(FURNITURE.map((f) => [f.id, f.category]))
const categoryOf = (id: string) => CATEGORY_OF.get(id)

describe('templates', () => {
  it('every template builds a well-formed plan with ≥1 floor', () => {
    for (const t of TEMPLATES) {
      const doc = t.build()
      expect(doc.floors.length).toBeGreaterThanOrEqual(1)
      expect(doc.floors.some((f) => f.id === doc.activeFloorId)).toBe(true)
    }
  })

  it('exposes the Omega residence as the flagship template', () => {
    expect(TEMPLATES[0].id).toBe('omega')
  })

  it('every template is furnished with rooms and references only real catalog furniture', () => {
    for (const t of TEMPLATES) {
      const doc = t.build()
      for (const floor of doc.floors) {
        expect(floor.rooms.length, `${t.id} · ${floor.name} rooms`).toBeGreaterThanOrEqual(1)
        for (const f of floor.furniture) expect(FURN_IDS, `${t.id}: furniture ${f.furnitureId}`).toContain(f.furnitureId)
        for (const d of floor.devices) expect(DEV_IDS, `${t.id}: device ${d.deviceId}`).toContain(d.deviceId)
      }
    }
  })

  it('every template is defect-free — no stacking, openings fit, nothing off-plan (zero tolerance)', () => {
    for (const t of TEMPLATES) {
      const issues = checkPlanIntegrity(t.build(), { categoryOf })
      expect(issues, `${t.id}:\n${issues.map((i) => `  ${i.floor}: ${i.message}`).join('\n')}`).toEqual([])
    }
  })
})

describe('Omega residence', () => {
  const doc = buildOmegaPlan()

  it('has four storeys (basement, ground, upper, roof)', () => {
    expect(doc.floors.map((f) => f.index).sort((a, b) => a - b)).toEqual([-1, 0, 1, 2])
  })

  it('references only real catalog furniture / devices / materials', () => {
    for (const floor of doc.floors) {
      for (const f of floor.furniture) expect(FURN_IDS, `furniture ${f.furnitureId}`).toContain(f.furnitureId)
      for (const d of floor.devices) expect(DEV_IDS, `device ${d.deviceId}`).toContain(d.deviceId)
      for (const r of floor.rooms) {
        for (const id of [r.floorMaterialId, r.wallMaterialId, r.ceilingMaterialId]) {
          if (id) expect(MAT_IDS, `material ${id}`).toContain(id)
        }
      }
    }
  })

  it('includes outdoor zones and multiple pools (garden · terrace · rooftop)', () => {
    const outdoor = doc.floors.flatMap((f) => f.rooms).filter((r) => r.zoneType === 'outdoor')
    expect(outdoor.length).toBeGreaterThanOrEqual(2)
    const pools = doc.floors.flatMap((f) => f.furniture).filter((f) => f.furnitureId.startsWith('pool'))
    expect(pools.length).toBeGreaterThanOrEqual(3)
  })

  it('gives every room a closed polygon', () => {
    for (const floor of doc.floors) {
      for (const r of floor.rooms) expect(r.polygon.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('has zero integrity defects on all four storeys — no stacking, no floating-in-pool, doors/windows fit, nothing off-plan', () => {
    const issues = checkPlanIntegrity(doc, { categoryOf })
    expect(issues, issues.map((i) => `${i.floor}: ${i.message}`).join('\n')).toEqual([])
  })
})

describe('demo apartment', () => {
  it('is likewise defect-free (calibration guard: the checker must not false-flag a good plan)', () => {
    const issues = checkPlanIntegrity(createDemoPlan(), { categoryOf })
    expect(issues, issues.map((i) => `${i.floor}: ${i.message}`).join('\n')).toEqual([])
  })
})
