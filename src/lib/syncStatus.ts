/**
 * deriveSyncStatus — pure mapping from raw store/auth signals to a single,
 * user-facing synchronisation status. Kept free of React and Supabase so it can
 * be unit-tested in isolation and reused anywhere.
 *
 * Precedence is deliberate:
 *   1. saving      — a write is in flight (most transient, shown first)
 *   2. local-only  — no cloud configured or not signed in → the plan lives only
 *                    in localStorage. This is the Offline-First state, not an
 *                    error: the app is fully usable without a backend.
 *   3. error       — the last cloud sync failed (and cloud is available)
 *   4. dirty       — local edits exist that are newer than the last sync
 *   5. saved       — local state is in sync with the cloud
 */

export type SyncStatusKind = 'saving' | 'saved' | 'dirty' | 'local-only' | 'error'

export interface SyncStatusInput {
  isSaving: boolean
  /** supabase configured AND a user is signed in. */
  cloudEnabled: boolean
  lastSavedAt: number | null
  lastSyncError: string | null
  /** `doc.updatedAt` (ISO string) or null when there is no document. */
  updatedAt: string | null
}

export interface SyncStatusResult {
  kind: SyncStatusKind
  /** True when local edits have not yet reached the cloud. */
  dirty: boolean
}

function isDirty(input: SyncStatusInput): boolean {
  if (!input.cloudEnabled) return false
  // Never synced in this session but cloud is available → unsaved.
  if (input.lastSavedAt == null) return true
  if (input.updatedAt == null) return false
  const editedAt = Date.parse(input.updatedAt)
  if (Number.isNaN(editedAt)) return false
  return editedAt > input.lastSavedAt
}

export function deriveSyncStatus(input: SyncStatusInput): SyncStatusResult {
  const dirty = isDirty(input)

  if (input.isSaving) return { kind: 'saving', dirty }
  if (!input.cloudEnabled) return { kind: 'local-only', dirty: false }
  if (input.lastSyncError) return { kind: 'error', dirty }
  if (dirty) return { kind: 'dirty', dirty: true }
  return { kind: 'saved', dirty: false }
}
