import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // We log rather than throw so the UI can still render a helpful error page.
  // In production both vars must be set in Vercel.
  console.warn(
    '[omega] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Cloud features will be disabled.',
  )
}

/**
 * Shared Supabase client. When env vars are missing we still create a stub
 * so the app doesn't crash — all cloud operations will simply return errors.
 */
export const supabase: SupabaseClient = createClient(
  url ?? 'https://missing.supabase.co',
  anonKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  },
)

export const supabaseReady = Boolean(url && anonKey)
