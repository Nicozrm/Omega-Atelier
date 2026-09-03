/**
 * twinStateStore.ts — where the twin's devices are kept between sessions.
 *
 * Signed in: the user's account row, so the same devices are there on the next
 * machine. Signed out: this browser only. Signed in *and* the cloud write
 * fails — an unmigrated schema, an offline laptop — the local copy still
 * happens, because losing the room assignments to a failed round trip would be
 * worse than a stale copy.
 *
 * Kept separate from `twinPersistence` on purpose: that module is pure and
 * testable, this one is the Supabase edge.
 */

import { supabase, supabaseReady } from '@/lib/supabase'
import {
  coerceTwinState, LocalTwinStateStore,
  type TwinPersistedState, type TwinStateStore,
} from './twinPersistence'

const TABLE = 'twin_state'

/** The account-backed store, with the local copy as its safety net. */
export class AccountTwinStateStore implements TwinStateStore {
  private readonly local = new LocalTwinStateStore()

  constructor(
    private readonly userId: string,
    private readonly onCloudError: (error: unknown) => void = () => {},
  ) {}

  async load(): Promise<TwinPersistedState | null> {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('state')
        .eq('user_id', this.userId)
        .maybeSingle()
      if (error) throw error
      const remote = coerceTwinState(data?.state)
      if (remote) return remote
    } catch (error) {
      this.onCloudError(error)
    }
    // No account row yet (first sign-in on this account, or the table is not
    // migrated): adopt whatever this browser has, so nothing is lost.
    return this.local.load()
  }

  async save(state: TwinPersistedState): Promise<void> {
    await this.local.save(state)
    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: this.userId, state }, { onConflict: 'user_id' })
    if (error) throw error
  }
}

/** Pick the right store for the current session. */
export function createTwinStateStore(
  userId: string | undefined,
  onCloudError?: (error: unknown) => void,
): TwinStateStore {
  if (!userId || !supabaseReady) return new LocalTwinStateStore()
  return new AccountTwinStateStore(userId, onCloudError)
}
