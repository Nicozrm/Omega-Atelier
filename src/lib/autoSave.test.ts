import { describe, it, expect } from 'vitest'
import { shouldAutoSave } from './autoSave'

/**
 * The reported symptom: "der Account versucht sekündlich zu speichern".
 *
 * The editor's auto-save effect depended on the whole `doc` object, and a
 * successful save replaces that object (it stamps the new `docVersion`). So
 * every save invalidated the effect that had just run it, re-armed the 1.5 s
 * timer and saved again — forever, on a plan nobody was editing.
 *
 * The guard below is what breaks the cycle: a save is only allowed when the
 * document's `updatedAt` — which moves on edits and not on save bookkeeping —
 * differs from the last one written.
 */

const base = {
  updatedAt: '2026-08-12T10:00:00.000Z',
  lastSavedUpdatedAt: null as string | null,
  planRowId: 'row-1' as string | null,
  cloudReady: true,
  signedIn: true,
}

describe('shouldAutoSave', () => {
  it('saves an edit that has not been written yet', () => {
    expect(shouldAutoSave(base)).toBe(true)
  })

  it('does NOT save again when nothing changed since the last write', () => {
    // The loop-breaker. Previously this state re-armed the timer every 1.5 s.
    expect(shouldAutoSave({ ...base, lastSavedUpdatedAt: base.updatedAt })).toBe(false)
  })

  it('saves again after a real edit moves updatedAt', () => {
    expect(shouldAutoSave({
      ...base,
      lastSavedUpdatedAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-12T10:00:07.000Z',
    })).toBe(true)
  })

  it('never fires a chain of writes for one edit', () => {
    // Walk the exact sequence the effect performs: save, then re-evaluate with
    // the document the save produced (same updatedAt, new docVersion).
    let lastSaved: string | null = null
    let writes = 0
    for (let tick = 0; tick < 50; tick++) {
      if (shouldAutoSave({ ...base, lastSavedUpdatedAt: lastSaved })) {
        writes++
        lastSaved = base.updatedAt
      }
    }
    expect(writes).toBe(1)
  })

  it('stays local-only without a cloud row', () => {
    expect(shouldAutoSave({ ...base, planRowId: null })).toBe(false)
  })

  it('does not save when the cloud is not configured', () => {
    expect(shouldAutoSave({ ...base, cloudReady: false })).toBe(false)
  })

  it('does not save when nobody is signed in', () => {
    expect(shouldAutoSave({ ...base, signedIn: false })).toBe(false)
  })

  it('does not save without a document', () => {
    expect(shouldAutoSave({ ...base, updatedAt: null })).toBe(false)
    expect(shouldAutoSave({ ...base, updatedAt: undefined })).toBe(false)
  })
})
