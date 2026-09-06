import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const runtimeConfig = typeof window !== 'undefined' ? (window as any).__OMEGA_RUNTIME__ : undefined
const url = runtimeConfig ? runtimeConfig.supabaseUrl : import.meta.env.VITE_SUPABASE_URL
const anonKey = runtimeConfig ? runtimeConfig.supabaseAnonKey : import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    '[omega] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Cloud features will be disabled.',
    )
}

export const supabase: SupabaseClient = createClient(
  url || 'https://missing.supabase.co',
  anonKey || 'missing-anon-key',
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
