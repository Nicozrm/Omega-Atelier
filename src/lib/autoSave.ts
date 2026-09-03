/**
 * autoSave.ts — when the editor may write the plan to the cloud.
 *
 * ## The bug this exists to stop
 *
 * The editor's auto-save effect listed the whole `doc` object among its
 * dependencies, and `saveToCloud` replaces that object on every successful
 * write (it stamps the incremented `docVersion`). So a save changed the
 * identity of a dependency of the effect that had just performed it: the effect
 * re-ran, armed a new 1.5 s timer, saved again, bumped the version again — and
 * kept doing that for as long as the editor was open, on an untouched plan.
 *
 * A cloud write every 1.5 seconds forever, `docVersion` climbing without a
 * single edit behind it, and the sync indicator never settling.
 *
 * The fix is to compare the thing that actually tracks *edits*. `updatedAt`
 * moves when the user changes something and stays put when only the save
 * bookkeeping changed, so it is both the correct trigger and the correct guard.
 * Keeping that decision in one pure function is what lets a test hold the loop
 * shut rather than trusting a dependency array to stay right.
 */

export interface AutoSaveInput {
  /** `doc.updatedAt` — moves on every real edit. */
  updatedAt: string | null | undefined
  /** The `updatedAt` value of the last write we completed. */
  lastSavedUpdatedAt: string | null
  /** The cloud row this document belongs to; absent ⇒ local-only. */
  planRowId: string | null | undefined
  /** Supabase configured. */
  cloudReady: boolean
  /** A user is signed in. */
  signedIn: boolean
}

/**
 * Should a save be scheduled for this state?
 *
 * `false` for every reason not to: no document, no cloud row, no cloud, not
 * signed in — and, decisively, when nothing has been edited since the last
 * write. That last clause is the loop-breaker.
 */
export function shouldAutoSave(input: AutoSaveInput): boolean {
  if (!input.cloudReady || !input.signedIn) return false
  if (!input.planRowId) return false
  if (!input.updatedAt) return false
  return input.updatedAt !== input.lastSavedUpdatedAt
}
