import { describe, it, expect } from 'vitest'
import { deriveSyncStatus, type SyncStatusInput } from './syncStatus'

const base: SyncStatusInput = {
  isSaving: false,
  cloudEnabled: true,
  lastSavedAt: 1_000,
  lastSyncError: null,
  updatedAt: new Date(500).toISOString(), // edited before last save → clean
}

describe('deriveSyncStatus', () => {
  it('reports "saving" while a write is in flight (highest precedence)', () => {
    expect(deriveSyncStatus({ ...base, isSaving: true }).kind).toBe('saving')
    // even with an error queued, saving wins
    expect(deriveSyncStatus({ ...base, isSaving: true, lastSyncError: 'x' }).kind).toBe('saving')
  })

  it('reports "local-only" when cloud is unavailable, regardless of edits', () => {
    const r = deriveSyncStatus({ ...base, cloudEnabled: false, lastSyncError: 'x' })
    expect(r.kind).toBe('local-only')
    expect(r.dirty).toBe(false)
  })

  it('reports "error" when the last sync failed and cloud is available', () => {
    expect(deriveSyncStatus({ ...base, lastSyncError: 'Netzwerkfehler' }).kind).toBe('error')
  })

  it('reports "saved" when local state matches the cloud', () => {
    const r = deriveSyncStatus(base)
    expect(r.kind).toBe('saved')
    expect(r.dirty).toBe(false)
  })

  it('reports "dirty" when edits are newer than the last save', () => {
    const r = deriveSyncStatus({ ...base, updatedAt: new Date(2_000).toISOString() })
    expect(r.kind).toBe('dirty')
    expect(r.dirty).toBe(true)
  })

  it('treats a never-synced plan (cloud on, no lastSavedAt) as dirty', () => {
    expect(deriveSyncStatus({ ...base, lastSavedAt: null }).kind).toBe('dirty')
  })

  it('is not dirty when updatedAt is missing', () => {
    expect(deriveSyncStatus({ ...base, updatedAt: null }).kind).toBe('saved')
  })

  it('is not dirty when updatedAt is unparseable', () => {
    expect(deriveSyncStatus({ ...base, updatedAt: 'not-a-date' }).dirty).toBe(false)
  })

  it('error takes precedence over dirty', () => {
    const r = deriveSyncStatus({
      ...base,
      lastSyncError: 'boom',
      updatedAt: new Date(9_999).toISOString(),
    })
    expect(r.kind).toBe('error')
    expect(r.dirty).toBe(true) // still flagged dirty internally
  })
})
