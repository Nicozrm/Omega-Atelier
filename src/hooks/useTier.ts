import { useMemo } from 'react'
import { useAuthStore } from '@/store/useAuthStore'
import {
  resolveTier, hasFeature, isAdmin, tierLabel,
  type FeatureKey, type Tier,
} from '@/lib/entitlements'

/**
 * useTier — the active plan, its display label, admin flag and a feature gate,
 * in one hook. Developers (DEV_EMAILS) always resolve to `max`; everyone else
 * gets the plan chosen on the landing page (default free). `admin` is surfaced
 * so the UI can show the always-visible plan/Admin badges.
 */
export function useTier(): {
  tier: Tier
  label: string
  admin: boolean
  can: (f: FeatureKey) => boolean
} {
  const email = useAuthStore((s) => s.user?.email ?? null)
  return useMemo(() => {
    const tier = resolveTier(email)
    return { tier, label: tierLabel(tier), admin: isAdmin(email), can: (f: FeatureKey) => hasFeature(tier, f) }
  }, [email])
}
