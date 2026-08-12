import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Device } from '@/domain'
import {
  createTwinPersistence, persistableSignature, restoredDevices, coerceTwinState,
  LocalTwinStateStore, TWIN_STATE_VERSION,
  type TwinPersistedState, type TwinStateStore,
} from './twinPersistence'
import { TwinManager } from './twinManager'
import { createBrandConnector } from '@/connectors/brands/brandConnector'
import { createSimulatedBrandClient, BRAND_FLEETS } from '@/connectors/brands/simulatedBrandClient'

const device = (over: Partial<Device> = {}): Device => ({
  id: 'lamp-1',
  connectorId: 'govee',
  name: 'Stehlampe',
  category: 'light',
  capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
  metadata: { model: 'H619A' },
  health: { reachability: 'online', lastSeen: '2026-08-12T10:00:00.000Z' },
  ...over,
})

const state = (over: Partial<TwinPersistedState> = {}): TwinPersistedState => ({
  version: TWIN_STATE_VERSION,
  savedAt: '2026-08-12T10:00:00.000Z',
  bindings: {},
  connectors: [{ id: 'govee', kind: 'govee', label: 'Govee' }],
  devices: [device()],
  ...over,
})

describe('persistableSignature — what counts as a change', () => {
  it('ignores capability values, which change on every poll', () => {
    const off = state()
    const on = state({ devices: [device({ capabilities: [{ kind: 'OnOff', access: 'readWrite', on: true }] })] })
    // A lamp switching on must not trigger a write.
    expect(persistableSignature(on)).toBe(persistableSignature(off))
  })

  it('ignores lastSeen, which changes on every tick', () => {
    const later = state({ devices: [device({ health: { reachability: 'online', lastSeen: '2026-08-12T23:59:00.000Z' } })] })
    expect(persistableSignature(later)).toBe(persistableSignature(state()))
  })

  it('notices a new device', () => {
    const more = state({ devices: [device(), device({ id: 'lamp-2', name: 'Deckenlampe' })] })
    expect(persistableSignature(more)).not.toBe(persistableSignature(state()))
  })

  it('notices a room assignment', () => {
    expect(persistableSignature(state({ bindings: { 'lamp-1': 'room-a' } })))
      .not.toBe(persistableSignature(state()))
  })

  it('notices a renamed device, a new capability kind and a new source', () => {
    expect(persistableSignature(state({ devices: [device({ name: 'Leselampe' })] }))).not.toBe(persistableSignature(state()))
    expect(persistableSignature(state({
      devices: [device({ capabilities: [
        { kind: 'OnOff', access: 'readWrite', on: false },
        { kind: 'Brightness', access: 'readWrite', percent: 50 },
      ] })],
    }))).not.toBe(persistableSignature(state()))
    expect(persistableSignature(state({ connectors: [] }))).not.toBe(persistableSignature(state()))
  })

  it('does not depend on device or connector order', () => {
    const a = state({ devices: [device(), device({ id: 'lamp-2' })] })
    const b = state({ devices: [device({ id: 'lamp-2' }), device()] })
    expect(persistableSignature(a)).toBe(persistableSignature(b))
  })
})

describe('createTwinPersistence — one save, not a stream', () => {
  let saves: TwinPersistedState[]
  let store: TwinStateStore

  beforeEach(() => {
    vi.useFakeTimers()
    saves = []
    store = {
      load: async () => null,
      save: async (s) => { saves.push(s) },
    }
  })
  afterEach(() => vi.useRealTimers())

  it('writes once for a burst of changes', async () => {
    const p = createTwinPersistence({ store, debounceMs: 1000, minIntervalMs: 0 })
    for (let i = 0; i < 20; i++) {
      p.schedule(state({ devices: [device(), device({ id: `lamp-${i}` })] }))
    }
    await vi.advanceTimersByTimeAsync(1200)
    expect(saves).toHaveLength(1)
  })

  it('does not write when only capability values changed', async () => {
    const p = createTwinPersistence({ store, debounceMs: 100, minIntervalMs: 0 })
    p.schedule(state())
    await vi.advanceTimersByTimeAsync(200)
    expect(saves).toHaveLength(1)

    // Now simulate a polling fleet: same devices, different values, forever.
    for (let i = 0; i < 50; i++) {
      p.schedule(state({ devices: [device({ capabilities: [{ kind: 'OnOff', access: 'readWrite', on: i % 2 === 0 }] })] }))
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(saves).toHaveLength(1)
  })

  it('keeps a floor between two writes', async () => {
    const p = createTwinPersistence({ store, debounceMs: 10, minIntervalMs: 5000 })
    p.schedule(state())
    await vi.advanceTimersByTimeAsync(20)
    expect(saves).toHaveLength(1)

    p.schedule(state({ devices: [device(), device({ id: 'lamp-2' })] }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(saves).toHaveLength(1) // still inside the floor
    await vi.advanceTimersByTimeAsync(5000)
    expect(saves).toHaveLength(2)
  })

  it('flushes on demand — the explicit save', async () => {
    const p = createTwinPersistence({ store, debounceMs: 60_000, minIntervalMs: 60_000 })
    p.schedule(state())
    await p.flush()
    expect(saves).toHaveLength(1)
  })

  it('flushing with nothing pending writes nothing', async () => {
    const p = createTwinPersistence({ store, debounceMs: 10, minIntervalMs: 0 })
    await p.flush()
    expect(saves).toHaveLength(0)
  })

  it('does not re-save a state it just loaded', async () => {
    const p = createTwinPersistence({ store, debounceMs: 10, minIntervalMs: 0 })
    p.prime(state())
    p.schedule(state())
    await vi.advanceTimersByTimeAsync(50)
    expect(saves).toHaveLength(0)
  })

  it('retries after a failed write instead of assuming success', async () => {
    let fail = true
    const flaky: TwinStateStore = {
      load: async () => null,
      save: async (s) => { if (fail) throw new Error('offline'); saves.push(s) },
    }
    const errors: unknown[] = []
    const p = createTwinPersistence({ store: flaky, debounceMs: 10, minIntervalMs: 0, onError: (e) => errors.push(e) })
    p.schedule(state())
    await vi.advanceTimersByTimeAsync(50)
    expect(errors).toHaveLength(1)
    expect(saves).toHaveLength(0)

    fail = false
    p.schedule(state())
    await vi.advanceTimersByTimeAsync(50)
    expect(saves).toHaveLength(1)
  })

  it('stops writing after dispose', async () => {
    const p = createTwinPersistence({ store, debounceMs: 10, minIntervalMs: 0 })
    p.schedule(state())
    p.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(saves).toHaveLength(0)
  })
})

describe('twin state loading', () => {
  it('brings devices back as unknown, not as live', () => {
    const [restored] = restoredDevices(state())
    expect(restored.health.reachability).toBe('unknown')
    expect(restored.name).toBe('Stehlampe')
  })

  it('rejects a payload from another version or shape', () => {
    expect(coerceTwinState(null)).toBeNull()
    expect(coerceTwinState({ version: 99, devices: [], connectors: [] })).toBeNull()
    expect(coerceTwinState({ version: TWIN_STATE_VERSION })).toBeNull()
  })

  it('drops malformed devices instead of the whole state', () => {
    const parsed = coerceTwinState({
      version: TWIN_STATE_VERSION,
      bindings: { 'lamp-1': 'room-a', bad: 3 },
      connectors: [{ id: 'govee', kind: 'govee', label: 'Govee' }, { nope: true }],
      devices: [device(), { id: 'broken' }],
    })
    expect(parsed?.devices).toHaveLength(1)
    expect(parsed?.connectors).toHaveLength(1)
    expect(parsed?.bindings).toEqual({ 'lamp-1': 'room-a' })
  })

  it('round-trips through the local store', async () => {
    const store = new LocalTwinStateStore('omega:test-twin')
    await store.save(state())
    const loaded = await store.load()
    expect(loaded?.devices[0].id).toBe('lamp-1')
    localStorage.removeItem('omega:test-twin')
  })
})

describe('TwinManager — restore and serialize', () => {
  it('keeps devices, room bindings and the source list across a reload', async () => {
    const first = new TwinManager()
    await first.addConnector({
      label: 'Govee', kind: 'govee',
      make: () => createBrandConnector({ id: 'govee', label: 'Govee', client: createSimulatedBrandClient(BRAND_FLEETS.govee, { liveMs: 0 }) }),
    })
    const someDevice = first.view().devices[0]
    first.setBinding(someDevice.id, 'room-kitchen')
    const saved = first.serializeState()
    expect(saved.devices.length).toBeGreaterThan(0)

    // A fresh page load: nothing connected, nothing in memory.
    const second = new TwinManager()
    expect(second.view().devices).toHaveLength(0)
    second.restoreState(saved)

    const view = second.view()
    expect(view.devices.map((d) => d.id)).toEqual(saved.devices.map((d) => d.id))
    expect(view.bindings[someDevice.id]).toBe('room-kitchen')
    expect(view.savedConnectors.map((c) => c.id)).toEqual(['govee'])
    // Nothing has spoken to them since — the UI must not claim otherwise.
    expect(view.devices.every((d) => d.health.reachability === 'unknown')).toBe(true)
  })

  it('never lets a restore overwrite a connector that is live', async () => {
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'Govee', kind: 'govee',
      make: () => createBrandConnector({ id: 'govee', label: 'Govee', client: createSimulatedBrandClient(BRAND_FLEETS.govee, { liveMs: 0 }) }),
    })
    const liveId = manager.view().devices[0].id

    manager.restoreState({
      ...state(),
      devices: [device({ id: liveId, connectorId: 'govee', name: 'Stale name' })],
    })
    expect(manager.view().devices.find((d) => d.id === liveId)?.name).not.toBe('Stale name')
    expect(manager.view().devices.find((d) => d.id === liveId)?.health.reachability).toBe('online')
  })

  it('drops a source and its devices when the user forgets it', () => {
    const manager = new TwinManager()
    manager.restoreState(state())
    expect(manager.view().devices).toHaveLength(1)
    manager.forgetSavedConnector('govee')
    expect(manager.view().devices).toHaveLength(0)
    expect(manager.view().savedConnectors).toHaveLength(0)
  })

  it('does not resurrect a source the user deliberately disconnected', async () => {
    const manager = new TwinManager()
    manager.restoreState(state())
    await manager.addConnector({
      label: 'Govee', kind: 'govee',
      make: () => createBrandConnector({ id: 'govee', label: 'Govee', client: createSimulatedBrandClient(BRAND_FLEETS.govee, { liveMs: 0 }) }),
    })
    await manager.removeConnector('govee')
    expect(manager.serializeState().connectors).toHaveLength(0)
  })

  it('stores no credentials', async () => {
    const manager = new TwinManager()
    manager.restoreState(state())
    const serialized = JSON.stringify(manager.serializeState())
    for (const secret of ['password', 'token', 'secret', 'apiKey']) {
      expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase())
    }
  })
})
