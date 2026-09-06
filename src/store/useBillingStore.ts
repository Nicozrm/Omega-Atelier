/**
 * useBillingStore — der Tarif, wie ihn der Server sieht.
 *
 * Genau eine Quelle: die Postgres-Funktion `public.current_tier()`. Sie liest
 * `subscriptions`, in die ausschliesslich der Zahlungs-Webhook mit der
 * Service-Rolle schreibt — kein Client hat dort ein INSERT-Recht. Deshalb ist
 * die Antwort eine Aussage und keine Notiz, die sich der Browser selbst
 * geschrieben hat.
 *
 * ── Warum ein eigener Store und kein Feld im Auth-Store ─────────────────
 * Weil beides unterschiedlich oft und aus unterschiedlichen Gründen veraltet.
 * Die Sitzung ändert sich beim An- und Abmelden; der Tarif ändert sich, wenn
 * eine Zahlung durchgeht — und das kann Sekunden nach der Rückkehr vom
 * Anbieter passieren, ohne dass die Sitzung davon etwas merkt. Getrennt zu
 * halten heisst: `refresh()` nach dem Checkout, ohne die Anmeldung anzufassen.
 *
 * ── Warum „unbekannt" nicht „free" ist ──────────────────────────────────
 * `tier` startet als `null` und nicht als `'free'`. Solange die Antwort
 * unterwegs ist, weiss die App es nicht — und `loaded` sagt das auch. Ein
 * Zahlender, dem beim Laden für eine Sekunde alle bezahlten Funktionen
 * gesperrt erscheinen, hält das für einen Fehler; die UI kann diesen Zustand
 * nur überbrücken, wenn sie ihn unterscheiden kann.
 */

import { create } from 'zustand'
import { supabase, supabaseReady } from '@/lib/supabase'
import type { Tier } from '@/lib/entitlements'

/** Das laufende Abo, wie es `my_subscription()` liefert. */
export interface SubscriptionInfo {
  tier: Tier
  status: 'trialing' | 'active' | 'past_due'
  interval: 'monthly' | 'yearly'
  seats: number
  currency: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  trialEndsAt: string | null
}

interface BillingState {
  /** `null` = noch nicht beantwortet. Niemals als „free" missverstehen. */
  tier: Tier | null
  subscription: SubscriptionInfo | null
  loading: boolean
  /** Wurde mindestens einmal geantwortet? */
  loaded: boolean

  refresh: () => Promise<void>
  /** Beim Abmelden — der Tarif des Vorgängers darf nicht stehen bleiben. */
  clear: () => void
  /** Kündigung zum Periodenende (oder Rücknahme). */
  setCancelAtPeriodEnd: (cancel: boolean) => Promise<{ error?: string }>
}

interface SubscriptionRow {
  tier: string
  status: string
  interval: string
  seats: number
  currency: string
  current_period_end: string
  cancel_at_period_end: boolean
  trial_ends_at: string | null
}

export const useBillingStore = create<BillingState>((set, get) => ({
  tier: null,
  subscription: null,
  loading: false,
  loaded: false,

  refresh: async () => {
    if (!supabaseReady) {
      // Ohne Cloud gibt es keinen Server, der etwas behaupten könnte. `free`
      // ist hier die richtige Antwort und `loaded` sagt, dass sie feststeht.
      set({ tier: 'free', subscription: null, loaded: true, loading: false })
      return
    }
    set({ loading: true })
    try {
      const [{ data: tierData, error: tierError }, { data: subData }] = await Promise.all([
        supabase.rpc('current_tier'),
        supabase.rpc('my_subscription'),
      ])

      if (tierError) {
        // Netzfehler dürfen niemanden hochstufen — und auch niemanden
        // herabstufen, dessen Tarif schon bekannt war.
        set({ loading: false, loaded: get().loaded })
        return
      }

      const tier = normalizeTier(typeof tierData === 'string' ? tierData : null)
      const row = (Array.isArray(subData) ? subData[0] : subData) as SubscriptionRow | null | undefined

      set({
        tier,
        subscription: row ? fromRow(row) : null,
        loading: false,
        loaded: true,
      })
    } catch {
      set({ loading: false })
    }
  },

  clear: () => set({ tier: null, subscription: null, loaded: false, loading: false }),

  setCancelAtPeriodEnd: async (cancel) => {
    if (!supabaseReady) return { error: 'Cloud nicht verbunden' }
    const { error } = await supabase.rpc('cancel_my_subscription', { p_cancel: cancel })
    if (error) return { error: error.message }
    await get().refresh()
    return {}
  },
}))

function normalizeTier(value: string | null): Tier {
  return value === 'pro' || value === 'max' ? value : 'free'
}

function fromRow(row: SubscriptionRow): SubscriptionInfo {
  return {
    tier: normalizeTier(row.tier),
    status: row.status === 'trialing' || row.status === 'past_due' ? row.status : 'active',
    interval: row.interval === 'yearly' ? 'yearly' : 'monthly',
    seats: row.seats,
    currency: row.currency,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    trialEndsAt: row.trial_ends_at,
  }
}
