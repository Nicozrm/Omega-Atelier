/**
 * useTwinPersistence — mounts the twin's storage for the current session.
 *
 * Mounted once, app-wide: the devices have to survive a reload whether or not
 * the Digital Twin overlay happens to be open, because the floorplan, the
 * inspector and the 3D view all read the same twin.
 *
 * The cadence is the point. Twin changes are sampled on a fixed tick rather
 * than reacted to, and what is sampled is a fingerprint of the twin's
 * *identity* — so a fleet of polling lamps produces exactly zero writes, and a
 * newly discovered device produces exactly one.
 */

import { useEffect } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { twinManager } from './twinManager'
import { createTwinPersistence, type TwinPersistence } from './twinPersistence'
import { createTwinStateStore } from './twinStateStore'

/** How often the twin is sampled for a change worth storing. */
const SAMPLE_MS = 2000

let active: TwinPersistence | undefined

/**
 * Write any pending twin change out now.
 *
 * Called when the user saves. Everything else is on the timer — this is the
 * one path that says "now", and it is a no-op when nothing changed.
 */
export async function flushTwinState(): Promise<void> {
  await active?.flush()
}

export function useTwinPersistence(): void {
  const userId = useAuthStore((s) => s.user?.id)
  const initialized = useAuthStore((s) => s.initialized)

  useEffect(() => {
    // Waiting for auth to resolve avoids loading the anonymous state first and
    // then the account state on top of it.
    if (!initialized) return

    const manager = twinManager()
    const store = createTwinStateStore(userId, (error) => {
      console.warn('[omega] twin state cloud sync failed', error)
    })
    const persistence = createTwinPersistence({ store })
    active = persistence

    let cancelled = false
    void store.load().then((state) => {
      if (cancelled || !state) return
      manager.restoreState(state)
      // The freshly loaded state is by definition already stored.
      persistence.prime(manager.serializeState())
    })

    let dirty = false
    const unsubscribe = manager.subscribe(() => { dirty = true })
    const sampler = setInterval(() => {
      if (!dirty) return
      dirty = false
      persistence.schedule(manager.serializeState())
    }, SAMPLE_MS)

    // A closing tab is the one moment where waiting for the debounce loses data.
    const onHide = () => { void persistence.flush() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') onHide() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      clearInterval(sampler)
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      void persistence.flush().finally(() => persistence.dispose())
      if (active === persistence) active = undefined
    }
  }, [userId, initialized])
}
