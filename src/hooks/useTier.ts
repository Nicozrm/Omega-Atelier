import { useEffect, useMemo } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import { useBillingStore } from '@/store/useBillingStore'
import {
  resolveTier, hasFeature, isAdmin, tierLabel,
  type FeatureKey, type Tier,
} from '@/lib/entitlements'

/**
 * useTier — der aktive Tarif, sein Anzeigename, das Admin-Kennzeichen und ein
 * Feature-Gate, in einem Hook.
 *
 * Der bezahlte Tarif kommt aus `useBillingStore`, also aus der Postgres-
 * Funktion `current_tier()` — nicht aus `localStorage` und nicht aus dem, was
 * jemand auf der Preisseite angeklickt hat. Entwickler (DEV_EMAILS) sind die
 * eine Ausnahme und lösen immer zu `max` auf.
 *
 * `pending` unterscheidet „noch keine Antwort" von „free". Nur damit kann eine
 * gesperrte Ansicht warten statt kurz das Schloss zu zeigen, das eine Sekunde
 * später verschwindet — und genau dieses Flackern liest sich für einen
 * Zahlenden wie ein Fehler in der Abrechnung.
 */
export function useTier(): {
  tier: Tier
  label: string
  admin: boolean
  /** Der Server hat noch nicht geantwortet. */
  pending: boolean
  can: (f: FeatureKey) => boolean
} {
  const email = useAuthStore((s) => s.user?.email ?? null)
  const authReady = useAuthStore((s) => s.initialized)
  const serverTier = useBillingStore((s) => s.tier)
  const loaded = useBillingStore((s) => s.loaded)
  const refresh = useBillingStore((s) => s.refresh)
  const clear = useBillingStore((s) => s.clear)

  // Der Tarif hängt am Konto: Anmeldung holt ihn, Abmeldung wirft ihn weg.
  // Ohne das Aufräumen behielte der nächste Nutzer am selben Gerät den Tarif
  // des vorigen, bis irgendetwas anderes einen Neuladen auslöst.
  useEffect(() => {
    if (!authReady) return
    if (email) void refresh()
    else clear()
  }, [authReady, email, refresh, clear])

  return useMemo(() => {
    const tier = resolveTier(email, serverTier)
    return {
      tier,
      label: tierLabel(tier),
      admin: isAdmin(email),
      pending: Boolean(email) && !loaded && !isAdmin(email),
      can: (f: FeatureKey) => hasFeature(tier, f),
    }
  }, [email, serverTier, loaded])
}
