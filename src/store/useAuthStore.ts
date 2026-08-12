/**
 * Auth store — wraps Supabase auth state for the app.
 * Keeps the current session/user in sync with any auth changes.
 */

import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, supabaseReady } from '@/lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  ready: boolean
  initialized: boolean

  init: () => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>
  signUpWithPassword: (email: string, password: string, name?: string) => Promise<{ error?: string }>
  /**
   * Google ist der einzige OAuth-Anbieter — der Typ hält das fest, statt es
   * dem Aufrufer zu überlassen. Ein Anbieter, der in Supabase nicht
   * eingerichtet ist, führt sonst zu einem Redirect ins Leere statt zu einem
   * Übersetzungsfehler.
   */
  signInWithOAuth: (provider: 'google') => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, _get) => ({
  user: null,
  session: null,
  loading: false,
  ready: supabaseReady,
  initialized: false,

  init: async () => {
    if (!supabaseReady) {
      set({ initialized: true })
      return
    }
    const { data } = await supabase.auth.getSession()
    set({
      session: data.session ?? null,
      user: data.session?.user ?? null,
      initialized: true,
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null })
    })
  },

  signInWithPassword: async (email, password) => {
    if (!supabaseReady) return { error: 'Supabase nicht konfiguriert' }
    set({ loading: true })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    set({ loading: false })
    return error ? { error: error.message } : {}
  },

  signUpWithPassword: async (email, password, name) => {
    if (!supabaseReady) return { error: 'Supabase nicht konfiguriert' }
    set({ loading: true })
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    })
    set({ loading: false })
    return error ? { error: error.message } : {}
  },

  signInWithOAuth: async (provider) => {
    if (!supabaseReady) return
    // Respect the deploy base path (BASE_URL ends with '/'), so the OAuth
    // round-trip returns to e.g. https://host/OmegaAtelier/plans — not /plans,
    // which 404s on GitHub Pages. This exact URL must be allow-listed in
    // Supabase → Authentication → URL Configuration (see docs/AUTH_SETUP.md).
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}plans` },
    })
  },

  signOut: async () => {
    if (!supabaseReady) return
    await supabase.auth.signOut()
    set({ user: null, session: null })
  },
}))

// auto-initialize (once)
let didInit = false
export function ensureAuthInit() {
  if (didInit) return
  didInit = true
  void useAuthStore.getState().init()
}
