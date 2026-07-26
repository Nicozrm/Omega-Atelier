import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Shared, mutable mock state for the Supabase client. Declared via vi.hoisted so
 * it exists before the (hoisted) vi.mock factory runs and remains referenceable
 * from the tests.
 */
const h = vi.hoisted(() => ({
  state: {
    ready: true as boolean,
    user: { id: 'user-1' } as { id: string } | null,
    readResult: { data: null as unknown, error: null as unknown },
    writeError: null as unknown,
    insertResult: { data: { id: 'new-row' } as { id: string } | null, error: null as unknown },
  },
}))

vi.mock('@/lib/supabase', () => {
  const { state } = h
  type Builder = {
    select: () => Builder
    insert: () => Builder
    update: () => Builder
    eq: () => Builder
    maybeSingle: () => Promise<unknown>
    single: () => Promise<unknown>
    then: (resolve: (v: { error: unknown }) => void) => void
  }
  const builder = {} as Builder
  Object.assign(builder, {
    select: () => builder,
    insert: () => builder,
    update: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(state.readResult),
    single: () => Promise.resolve(state.insertResult),
    // Makes `await supabase.from(...).update(...).eq(...)` resolve to a write result.
    then: (resolve: (v: { error: unknown }) => void) => resolve({ error: state.writeError }),
  })
  return {
    get supabaseReady() { return state.ready },
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: state.user } }) },
      from: () => builder,
    },
  }
})

import { usePlanStore } from '@/store/usePlanStore'
import { createBlankPlan } from '@/data/templates'

const get = () => usePlanStore.getState()
const DEVICE_ID = 'hue-e27-white-color'

beforeEach(() => {
  h.state.ready = true
  h.state.user = { id: 'user-1' }
  h.state.readResult = { data: null, error: null }
  h.state.writeError = null
  h.state.insertResult = { data: { id: 'new-row' }, error: null }
  get().loadDocument(createBlankPlan('Test'))
  usePlanStore.setState({ isSaving: false, lastSavedAt: null, lastSyncError: null })
})

describe('saveToCloud — guards', () => {
  it('returns null when there is no document', async () => {
    usePlanStore.setState({ doc: null })
    expect(await get().saveToCloud()).toBeNull()
  })

  it('returns null when Supabase is not configured', async () => {
    h.state.ready = false
    expect(await get().saveToCloud()).toBeNull()
  })

  it('records an error and returns null when not signed in', async () => {
    h.state.user = null
    const res = await get().saveToCloud()
    expect(res).toBeNull()
    expect(get().lastSyncError).toBeTruthy()
    expect(get().isSaving).toBe(false)
  })
})

describe('saveToCloud — insert (new plan)', () => {
  it('inserts, returns the new row id, stamps version 1 and marks saved', async () => {
    const id = await get().saveToCloud()
    expect(id).toBe('new-row')
    expect(get().doc!.docVersion).toBe(1)
    expect(get().lastSavedAt).not.toBeNull()
    expect(get().lastSyncError).toBeNull()
    expect(get().isSaving).toBe(false)
  })

  it('returns null and records the error when the insert fails', async () => {
    h.state.insertResult = { data: null, error: new Error('insert boom') }
    const res = await get().saveToCloud()
    expect(res).toBeNull()
    expect(String(get().lastSyncError)).toContain('insert boom')
    expect(get().isSaving).toBe(false)
  })
})

describe('saveToCloud — update (existing plan)', () => {
  it('updates and increments the version when there is no conflict', async () => {
    h.state.readResult = { data: { doc: { docVersion: 3 } }, error: null }
    usePlanStore.setState({ doc: { ...get().doc!, docVersion: 3 } })
    const res = await get().saveToCloud('row-1')
    expect(res).toBe('row-1')
    expect(get().doc!.docVersion).toBe(4)
    expect(get().lastSavedAt).not.toBeNull()
  })

  it('returns a conflict descriptor when the remote version is newer', async () => {
    h.state.readResult = { data: { doc: { docVersion: 9 } }, error: null }
    usePlanStore.setState({ doc: { ...get().doc!, docVersion: 2 } })
    const res = await get().saveToCloud('row-1')
    expect(res).toEqual({ conflict: true, remoteVersion: 9 })
    expect(get().isSaving).toBe(false)
    expect(get().lastSavedAt).toBeNull() // not marked saved on conflict
  })

  it('returns null and records the error when the version read fails', async () => {
    h.state.readResult = { data: null, error: new Error('read boom') }
    const res = await get().saveToCloud('row-1')
    expect(res).toBeNull()
    expect(String(get().lastSyncError)).toContain('read boom')
  })
})

describe('reloadFromCloud', () => {
  it('replaces the doc and clears history on a valid payload', async () => {
    const remote = createBlankPlan('Remote')
    h.state.readResult = { data: { doc: remote }, error: null }
    get().addDevice(DEVICE_ID, { x: 0, y: 0 }) // create undo history
    expect(get().past.length).toBeGreaterThan(0)

    const ok = await get().reloadFromCloud('row-1')
    expect(ok).toBe(true)
    expect(get().doc!.title).toBe('Remote')
    expect(get().past).toHaveLength(0)
    expect(get().future).toHaveLength(0)
    expect(get().loadedFromCloud).toBe(true)
  })

  it('rejects an invalid remote payload instead of clobbering local state', async () => {
    h.state.readResult = { data: { doc: { totally: 'invalid' } }, error: null }
    const before = get().doc
    const ok = await get().reloadFromCloud('row-1')
    expect(ok).toBe(false)
    expect(get().doc).toBe(before) // unchanged
  })

  it('returns false on a read error', async () => {
    h.state.readResult = { data: null, error: new Error('x') }
    expect(await get().reloadFromCloud('row-1')).toBe(false)
  })

  it('returns false when Supabase is not configured', async () => {
    h.state.ready = false
    expect(await get().reloadFromCloud('row-1')).toBe(false)
  })
})
