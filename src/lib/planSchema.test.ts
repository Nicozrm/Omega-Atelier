import { describe, it, expect } from 'vitest'
import { coercePlan, parsePlanJSON, CURRENT_SCHEMA_VERSION } from '@/lib/planSchema'
import { createBlankPlan } from '@/data/templates'

/** A known-good v2 document to mutate in tests. */
const valid = () => createBlankPlan('Fixture')

describe('coercePlan — rejection of non-plans', () => {
  it('rejects null / primitives / arrays', () => {
    expect(coercePlan(null)).toBeNull()
    expect(coercePlan(undefined)).toBeNull()
    expect(coercePlan(42)).toBeNull()
    expect(coercePlan('plan')).toBeNull()
    expect(coercePlan([])).toBeNull()
  })

  it('rejects an object with no usable floors', () => {
    expect(coercePlan({ schemaVersion: 2, floors: [] })).toBeNull()
    expect(coercePlan({ schemaVersion: 2, floors: 'nope' })).toBeNull()
    expect(coercePlan({ schemaVersion: 2 })).toBeNull()
    // floors present but each one structurally junk
    expect(coercePlan({ floors: [null, 5, 'x'] })).toBeNull()
  })
})

describe('coercePlan — valid documents pass through', () => {
  it('accepts a freshly created plan and keeps its identity', () => {
    const v = valid()
    const out = coercePlan(v)!
    expect(out).not.toBeNull()
    expect(out.id).toBe(v.id)
    expect(out.title).toBe('Fixture')
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.floors).toHaveLength(1)
    expect(out.activeFloorId).toBe(v.activeFloorId)
  })

  it('preserves unknown-but-harmless fields (forward-compat)', () => {
    const v = { ...valid(), tags: ['penthouse'], customFutureField: { a: 1 } }
    const out = coercePlan(v)! as typeof v
    expect(out.tags).toEqual(['penthouse'])
    expect(out.customFutureField).toEqual({ a: 1 })
  })
})

describe('coercePlan — migration', () => {
  it('treats a missing schemaVersion as legacy and upgrades it', () => {
    const { schemaVersion: _omit, ...legacy } = valid()
    const out = coercePlan(legacy)!
    expect(out).not.toBeNull()
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('upgrades an explicit v1 document to current', () => {
    const out = coercePlan({ ...valid(), schemaVersion: 1 })!
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('loads a newer-versioned but structurally-sound doc, stamping current', () => {
    const out = coercePlan({ ...valid(), schemaVersion: 99 })!
    expect(out).not.toBeNull()
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('coercePlan — structural repair', () => {
  it('fills missing floor arrays with empty arrays', () => {
    const v = valid()
    // strip the floor down to just an id
    const broken = { ...v, floors: [{ id: v.floors[0].id }], activeFloorId: v.floors[0].id }
    const out = coercePlan(broken)!
    const f = out.floors[0]
    expect(f.walls).toEqual([])
    expect(f.rooms).toEqual([])
    expect(f.devices).toEqual([])
    expect(f.furniture).toEqual([])
    expect(f.labels).toEqual([])
    expect(f.extent.width).toBeGreaterThan(0)
    expect(f.layers.walls).toBe(true)
  })

  it('generates a floor id when missing', () => {
    const broken = { floors: [{ name: 'Floor' }] }
    const out = coercePlan(broken)!
    expect(out.floors[0].id).toBeTruthy()
    // activeFloorId repaired to point at the (now id-bearing) floor
    expect(out.activeFloorId).toBe(out.floors[0].id)
  })

  it('drops structurally-invalid walls/devices but keeps valid ones', () => {
    const v = valid()
    const fid = v.floors[0].id
    const broken = {
      ...v,
      activeFloorId: fid,
      floors: [{
        id: fid,
        walls: [
          { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, thickness: 14 }, // valid
          { a: { x: 0, y: 0 } },                                    // missing b → dropped
          'garbage',                                                // dropped
        ],
        devices: [
          { deviceId: 'hue', position: { x: 1, y: 1 } }, // valid
          { position: { x: 2, y: 2 } },                  // no deviceId → dropped
        ],
      }],
    }
    const out = coercePlan(broken)!
    expect(out.floors[0].walls).toHaveLength(1)
    expect(out.floors[0].devices).toHaveLength(1)
    expect(out.floors[0].devices[0].deviceId).toBe('hue')
    // generated id for the wall that lacked one
    expect(out.floors[0].walls[0].id).toBeTruthy()
  })

  it('keeps valid furniture and labels, dropping malformed ones', () => {
    const v = valid()
    const fid = v.floors[0].id
    const broken = {
      ...v,
      activeFloorId: fid,
      floors: [{
        id: fid,
        furniture: [
          { furnitureId: 'sofa', position: { x: 5, y: 5 } }, // valid
          { position: { x: 1, y: 1 } },                      // no furnitureId → dropped
          { furnitureId: 'bed' },                            // no position → dropped
        ],
        labels: [
          { position: { x: 0, y: 0 }, text: 'Küche' }, // valid
          { position: { x: 0, y: 0 } },                // no text → dropped
          { text: 'x' },                               // no position → dropped
        ],
      }],
    }
    const out = coercePlan(broken)!
    expect(out.floors[0].furniture).toHaveLength(1)
    expect(out.floors[0].furniture[0].furnitureId).toBe('sofa')
    expect(out.floors[0].furniture[0].id).toBeTruthy()
    expect(out.floors[0].labels).toHaveLength(1)
    expect(out.floors[0].labels[0].text).toBe('Küche')
    expect(out.floors[0].labels[0].id).toBeTruthy()
  })

  it('repairs an invalid floor extent to a positive default', () => {
    const v = valid()
    const fid = v.floors[0].id
    const out = coercePlan({
      ...v,
      activeFloorId: fid,
      floors: [{ id: fid, extent: { width: -1, height: 0 } }],
    })!
    expect(out.floors[0].extent.width).toBeGreaterThan(0)
    expect(out.floors[0].extent.height).toBeGreaterThan(0)
  })

  it('falls back to "auto" for an unknown activeModeKey', () => {
    const v = valid()
    const out = coercePlan({ ...v, activeModeKey: 'bogus' })!
    expect(out.activeModeKey).toBe('auto')
  })

  it('repairs a dangling activeFloorId to the first floor', () => {
    const v = valid()
    const out = coercePlan({ ...v, activeFloorId: 'does-not-exist' })!
    expect(out.activeFloorId).toBe(out.floors[0].id)
  })

  it('fills partial settings with defaults and keeps valid overrides', () => {
    const v = valid()
    const out = coercePlan({ ...v, settings: { theme: 'light', gridSize: -5 } })!
    expect(out.settings.theme).toBe('light')      // kept
    expect(out.settings.gridSize).toBeGreaterThan(0) // invalid → default
    expect(out.settings.unit).toBe('cm')          // missing → default
    expect(typeof out.settings.snap).toBe('boolean')
  })

  it('restores canonical modes when missing or empty', () => {
    const v = valid()
    const out = coercePlan({ ...v, modes: [] })!
    expect(out.modes.length).toBeGreaterThan(0)
  })

  it('always stamps createdAt/updatedAt', () => {
    const v = valid()
    const { createdAt: _c, updatedAt: _u, ...rest } = v
    const out = coercePlan(rest)!
    expect(out.createdAt).toBeTruthy()
    expect(out.updatedAt).toBeTruthy()
  })
})

describe('parsePlanJSON', () => {
  it('returns null for null / invalid JSON', () => {
    expect(parsePlanJSON(null)).toBeNull()
    expect(parsePlanJSON('{ not json')).toBeNull()
    expect(parsePlanJSON('"a string"')).toBeNull()
  })

  it('parses and coerces a serialized valid plan', () => {
    const v = valid()
    const out = parsePlanJSON(JSON.stringify(v))!
    expect(out).not.toBeNull()
    expect(out.id).toBe(v.id)
    expect(out.floors).toHaveLength(1)
  })

  it('migrates a serialized legacy plan instead of discarding it', () => {
    const { schemaVersion: _omit, ...legacy } = valid()
    const out = parsePlanJSON(JSON.stringify(legacy))!
    expect(out).not.toBeNull()
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})
