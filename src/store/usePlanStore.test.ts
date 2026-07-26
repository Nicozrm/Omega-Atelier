import { describe, it, expect, beforeEach } from 'vitest'
import { usePlanStore } from '@/store/usePlanStore'
import { createBlankPlan } from '@/data/templates'

const DEVICE_ID = 'hue-e27-white-color' // a real light that supports many modes
const get = () => usePlanStore.getState()
const activeFloor = () => {
  const d = get().doc!
  return d.floors.find((f) => f.id === d.activeFloorId)!
}

beforeEach(() => {
  // Clean, deterministic document; loadDocument also clears undo/redo history.
  get().loadDocument(createBlankPlan('Test Plan'))
})

describe('document loading', () => {
  it('loads a blank plan with exactly one floor and empty history', () => {
    expect(get().doc).not.toBeNull()
    expect(get().doc!.floors).toHaveLength(1)
    expect(get().past).toHaveLength(0)
    expect(get().future).toHaveLength(0)
    expect(activeFloor().devices).toHaveLength(0)
  })
})

describe('addDevice + history', () => {
  it('adds a device to the active floor and returns its id', () => {
    const id = get().addDevice(DEVICE_ID, { x: 100, y: 100 })
    expect(id).toBeTruthy()
    expect(activeFloor().devices).toHaveLength(1)
    expect(activeFloor().devices[0].deviceId).toBe(DEVICE_ID)
  })

  it('records an undo step', () => {
    get().addDevice(DEVICE_ID, { x: 100, y: 100 })
    expect(get().past.length).toBeGreaterThan(0)
  })
})

describe('undo / redo', () => {
  it('undo removes the device, redo restores it', () => {
    get().addDevice(DEVICE_ID, { x: 50, y: 50 })
    expect(activeFloor().devices).toHaveLength(1)

    get().undo()
    expect(activeFloor().devices).toHaveLength(0)

    get().redo()
    expect(activeFloor().devices).toHaveLength(1)
  })

  it('undo is a no-op when there is no history', () => {
    expect(() => get().undo()).not.toThrow()
    expect(activeFloor().devices).toHaveLength(0)
  })
})

describe('updateDoc history flag', () => {
  it('does not grow history when history:false', () => {
    const before = get().past.length
    get().updateDoc((d) => {
      d.settings.snap = !d.settings.snap
    }, { history: false })
    expect(get().past.length).toBe(before)
  })

  it('persists the mutated setting', () => {
    const prev = get().doc!.settings.snap
    get().updateDoc((d) => {
      d.settings.snap = !prev
    }, { history: false })
    expect(get().doc!.settings.snap).toBe(!prev)
  })
})

describe('applyMode', () => {
  it('stamps mode state onto a supporting device', () => {
    get().addDevice(DEVICE_ID, { x: 0, y: 0 })
    const result = get().applyMode('film')
    expect(result.applied).toBe(1)
    const dev = activeFloor().devices[0]
    expect(dev.modeState?.film).toBeDefined()
    expect(dev.modeState!.film.on).toBe(true)
    expect(get().doc!.activeModeKey).toBe('film')
  })

  it('returns zero counts when there are no devices', () => {
    const result = get().applyMode('film')
    expect(result).toEqual({ applied: 0, skipped: 0 })
  })
})

describe('addWall + addRoom', () => {
  it('adds a wall and is undoable', () => {
    // A blank floor already carries perimeter walls, so assert relative to start.
    const n0 = activeFloor().walls.length
    get().addWall({ x: 0, y: 0 }, { x: 200, y: 0 })
    expect(activeFloor().walls).toHaveLength(n0 + 1)
    get().undo()
    expect(activeFloor().walls).toHaveLength(n0)
  })

  it('adds a room polygon', () => {
    const r0 = activeFloor().rooms.length
    const poly = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 300 },
      { x: 0, y: 300 },
    ]
    get().addRoom(poly, 'Wohnzimmer')
    expect(activeFloor().rooms).toHaveLength(r0 + 1)
    expect(activeFloor().rooms.at(-1)!.name).toBe('Wohnzimmer')
  })
})

describe('fitToView', () => {
  it('computes a positive, finite zoom for a non-empty floor', () => {
    get().addWall({ x: 0, y: 0 }, { x: 400, y: 0 })
    get().addWall({ x: 0, y: 0 }, { x: 0, y: 300 })
    get().fitToView(800, 600, 40)
    const vp = get().viewport
    expect(vp.zoom).toBeGreaterThan(0)
    expect(Number.isFinite(vp.zoom)).toBe(true)
    expect(Number.isFinite(vp.offsetX)).toBe(true)
    expect(Number.isFinite(vp.offsetY)).toBe(true)
  })
})

describe('setActiveMode', () => {
  it('updates the active mode key', () => {
    get().setActiveMode('night')
    expect(get().doc!.activeModeKey).toBe('night')
  })
})
