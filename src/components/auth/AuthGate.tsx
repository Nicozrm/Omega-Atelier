import { useAuthStore } from '@/store/useAuthStore'
import { supabaseReady } from '@/lib/supabase'

interface Props { children: React.ReactNode }

/**
 * Local-first access gate.
 *
 * The whole app is usable WITHOUT signing in — authentication is optional and
 * only unlocks cloud sync (saving plans to Supabase, cloud plan list). We never
 * redirect to /login. When Supabase is configured we briefly wait for the
 * initial session check so a returning signed-in user doesn't flash the
 * logged-out UI; then we always render the app, with or without a user.
 */
export function AuthGate({ children }: Props) {
  const initialized = useAuthStore((s) => s.initialized)

  if (supabaseReady && !initialized) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse-gold font-display text-2xl text-[color:var(--accent)]">Ω</div>
      </div>
    )
  }

  return <>{children}</>
}
