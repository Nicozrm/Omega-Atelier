/**
 * promo.ts — Gutscheincodes einlösen.
 *
 * Geprüft wird auf dem Server. Ein Rabatt, den der Client selbst gewährt, ist
 * kein Rabatt, sondern ein Formularfeld: wer die Konsole öffnet, schreibt sich
 * 100 % hinein. Die Funktion hier holt deshalb nur die *Auskunft* („diesen Code
 * gibt es, er gibt 20 % auf Jahresabos") und lässt die Rechnung damit sofort
 * stimmen — verbindlich wird sie erst, wenn `billing-checkout` denselben Code
 * noch einmal gegen die Datenbank hält.
 *
 * Ohne Cloud (lokaler Demo-Modus, `supabaseReady === false`) greift eine kleine
 * Demo-Tabelle. Sie darf im Bundle stehen, weil in diesem Modus überhaupt kein
 * Geld fliesst — es gibt nichts zu erschleichen.
 */

import { supabase, supabaseReady } from '@/lib/supabase'
import type { BillingInterval, CurrencyCode } from './catalog'
import { promoApplies, type PromoCode } from './pricing'
import type { Tier } from '@/lib/entitlements'

export type PromoLookup =
  | { status: 'valid'; promo: PromoCode }
  /** Code existiert, passt aber nicht zu dieser Bestellung. */
  | { status: 'not-applicable'; promo: PromoCode; message: string }
  | { status: 'unknown'; message: string }
  | { status: 'expired'; message: string }
  | { status: 'error'; message: string }

/** Nur im Demo-Modus aktiv — siehe Kopfkommentar. */
const DEMO_PROMOS: readonly PromoCode[] = [
  { code: 'ATELIER20', label: 'Atelier-Start — 20 % im ersten Jahr', percentOff: 20, interval: 'yearly', periods: 1 },
  { code: 'TWIN10', label: 'Digital-Twin-Aktion — 10 %', percentOff: 10 },
]

/** Grossbuchstaben, keine Leerzeichen — Gutscheincodes sind nie mehrdeutig. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

interface PromoContext {
  tier: Tier
  interval: BillingInterval
  currency: CurrencyCode
}

/** Zeile, wie sie die Datenbank liefert (siehe Migration `billing`). */
interface PromoRow {
  code: string
  label: string
  percent_off: number | null
  amount_off: number | null
  currency: string | null
  interval: string | null
  tiers: string[] | null
  periods: number | null
}

function fromRow(row: PromoRow): PromoCode {
  return {
    code: row.code,
    label: row.label,
    percentOff: row.percent_off ?? undefined,
    amountOff: row.amount_off ?? undefined,
    currency: (row.currency as CurrencyCode | null) ?? undefined,
    interval: (row.interval as BillingInterval | null) ?? undefined,
    tiers: (row.tiers as Tier[] | null) ?? undefined,
    periods: row.periods ?? undefined,
  }
}

/**
 * Warum ein existierender Code hier nicht greift — als Satz, den man lesen kann.
 * „Ungültig" wäre gelogen: der Code ist gültig, nur nicht für diesen Warenkorb.
 */
function whyNotApplicable(promo: PromoCode, ctx: PromoContext): string {
  if (promo.interval && promo.interval !== ctx.interval) {
    return promo.interval === 'yearly'
      ? 'Dieser Code gilt nur für Jahresabos.'
      : 'Dieser Code gilt nur für Monatsabos.'
  }
  if (promo.tiers && !promo.tiers.includes(ctx.tier)) {
    return `Dieser Code gilt nur für ${promo.tiers.join(' und ')}.`
  }
  if (promo.currency && promo.currency !== ctx.currency) {
    return `Dieser Code rechnet in ${promo.currency} ab.`
  }
  return 'Dieser Code passt nicht zu dieser Bestellung.'
}

/**
 * Code nachschlagen und gegen den Warenkorb halten.
 *
 * Wirft nicht: jeder Fehlerweg endet in einem `status`, den die UI anzeigen
 * kann. Ein Gutscheinfeld, das eine Exception auslöst, nimmt dem Kunden den
 * ganzen Checkout mit.
 */
export async function lookupPromo(rawCode: string, ctx: PromoContext): Promise<PromoLookup> {
  const code = normalizePromoCode(rawCode)
  if (!code) return { status: 'unknown', message: 'Bitte einen Code eingeben.' }

  const promo = supabaseReady ? await lookupRemote(code) : lookupDemo(code)
  if (promo === 'error') return { status: 'error', message: 'Der Code liess sich gerade nicht prüfen. Bitte gleich noch einmal.' }
  if (!promo) return { status: 'unknown', message: 'Diesen Code kennen wir nicht.' }

  if (!promoApplies(promo, ctx)) {
    return { status: 'not-applicable', promo, message: whyNotApplicable(promo, ctx) }
  }
  return { status: 'valid', promo }
}

function lookupDemo(code: string): PromoCode | null {
  return DEMO_PROMOS.find((p) => p.code === code) ?? null
}

async function lookupRemote(code: string): Promise<PromoCode | null | 'error'> {
  try {
    // RPC statt `select`: die Tabelle selbst bleibt für Clients gesperrt, sonst
    // liesse sich die Codeliste abgreifen. Die Funktion beantwortet genau eine
    // Frage und gibt weder Kontingente noch fremde Codes preis.
    const { data, error } = await supabase.rpc('billing_lookup_promo', { p_code: code })
    if (error) return 'error'
    const row = (Array.isArray(data) ? data[0] : data) as PromoRow | null | undefined
    return row ? fromRow(row) : null
  } catch {
    return 'error'
  }
}
