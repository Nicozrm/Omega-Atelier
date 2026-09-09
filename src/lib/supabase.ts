import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Laufzeit-Konfiguration, die der Container-Entrypoint in `index.html` schreibt. */
interface OmegaRuntimeConfig {
  supabaseUrl?: string
  supabaseAnonKey?: string
}

declare global {
  interface Window {
    __OMEGA_RUNTIME__?: OmegaRuntimeConfig
  }
}

/**
 * Ein Wert, den die Deploy-Substitution nie ersetzt hat.
 *
 * `index.html` liefert die Platzhalter `__OMEGA_SUPABASE_URL__` /
 * `__OMEGA_SUPABASE_ANON_KEY__` wörtlich aus; ersetzt werden sie allein vom
 * Container-Entrypoint (`deploy/25-omega-runtime-env.sh`). Auf GitHub Pages
 * und unter `npm run dev` tut das niemand — und ein unersetzter Platzhalter
 * ist ein *truthy* String. Ohne diese Prüfung hält die App ihn für einen
 * echten Wert: `supabaseReady` wird `true`, und jeder Aufruf geht an einen
 * Host, den es nicht gibt, statt auf die Vite-Variablen zurückzufallen.
 */
export const isPlaceholder = (value?: string): boolean =>
  !value || /^__OMEGA_[A-Z_]+__$/.test(value)

const runtime = typeof window !== 'undefined' ? window.__OMEGA_RUNTIME__ : undefined

/* Feldweise geprüft, nicht am Objekt: eine Konfiguration, die nur die URL
 * setzt, darf für den Schlüssel weiterhin auf die Vite-Variable fallen. */
const url = isPlaceholder(runtime?.supabaseUrl)
  ? import.meta.env.VITE_SUPABASE_URL
  : runtime?.supabaseUrl
const anonKey = isPlaceholder(runtime?.supabaseAnonKey)
  ? import.meta.env.VITE_SUPABASE_ANON_KEY
  : runtime?.supabaseAnonKey

if (!url || !anonKey) {
  // We log rather than throw so the UI can still render a helpful error page.
  // In production both vars must be set as repository secrets for the
  // GitHub Pages workflow (see docs/DEPLOYMENT.md).
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
