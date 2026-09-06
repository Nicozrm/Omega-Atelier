/**
 * session.ts — die Bestellung an den Zahlungsanbieter übergeben.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  Die eine Regel, die diese Datei durchsetzt: die Kartennummer verlässt den
 *  Browser NICHT in Richtung unserer Server.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Das Kartenformular im Checkout prüft Marke, Luhn-Prüfziffer und Ablaufdatum,
 * damit ein Tippfehler sofort sichtbar wird — genau das tut auch ein
 * eingebettetes Anbieter-Feld. Was danach folgt, ist der Unterschied:
 * `buildIntent` schreibt aus der Karte ausschliesslich Marke, letzte vier
 * Ziffern und Ablaufmonat in die Nutzlast. PAN und Prüfcode bleiben im
 * Komponenten-Zustand und werden nie serialisiert; die eigentliche Belastung
 * passiert beim Anbieter, zu dem wir weiterleiten.
 *
 * Der Grund ist nicht Vorsicht, sondern Geltungsbereich: sobald eine
 * Kartennummer auch nur durch unseren Prozess *läuft*, fällt das gesamte
 * System unter PCI-DSS — mit Audit, Netzsegmentierung und Protokollpflichten.
 * Ein Feld, das niemals sendet, hält diesen Geltungsbereich bei null. Der Test
 * `session.test.ts` liest die fertige Nutzlast als Text und sucht die Nummer
 * darin; er soll fehlschlagen, sobald jemand das hier aufweicht.
 *
 * Die IBAN ist der bewusste Gegenfall: für ein SEPA-Mandat *ist* der Händler
 * die richtige Stelle. Sie geht verschlüsselt an die Edge Function, die sie an
 * den Anbieter weiterreicht; in unserer Datenbank landet nur die maskierte
 * Form.
 */

import { supabase, supabaseReady } from '@/lib/supabase'
import type { Tier } from '@/lib/entitlements'
import type { BillingInterval, CurrencyCode } from './catalog'
import type { CheckoutForm } from './checkout'
import { findMethod } from './methods'
import type { Quote } from './pricing'
import { detectCardBrand, normalizeIban } from './validation'
import { normalizeVatId } from './vat'

/** Anzeigedaten einer Karte — alles, was unser Server je zu sehen bekommt. */
export interface CardFingerprint {
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

export interface CheckoutIntent {
  /** Idempotenzschlüssel: derselbe Schlüssel = dieselbe Bestellung, nie zwei. */
  idempotencyKey: string
  tier: Tier
  interval: BillingInterval
  seats: number
  currency: CurrencyCode
  methodId: string
  provider: string
  trialDays: number
  promoCode: string | null
  customer: {
    email: string
    fullName: string
    business: boolean
    company: string | null
    vatId: string | null
    phone: string | null
  }
  address: {
    street: string
    postalCode: string
    city: string
    country: string
  }
  /**
   * Was der Client ausgerechnet hat — **nur zum Abgleich**. Der Server rechnet
   * neu und lehnt ab, wenn die Summen auseinandergehen: ein Preis aus dem
   * Browser ist ein Vorschlag, keine Tatsache.
   */
  expected: {
    net: number
    vatAmount: number
    total: number
    dueToday: number
    vatRate: number
    reverseCharge: boolean
  }
  card?: CardFingerprint
  sepa?: { iban: string; holder: string; mandateAccepted: true }
  invoice?: { poNumber: string | null; billingEmail: string | null }
  consent: {
    terms: true
    immediateStart: boolean
    newsletter: boolean
  }
  /** Wohin der Anbieter zurückschickt. */
  returnUrl: string
  cancelUrl: string
}

/** Vier Ziffern eines Ablaufdatums „MM/JJ" zu Monat und vollem Jahr. */
function parseExpiry(value: string): { month: number; year: number } {
  const digits = value.replace(/\D/g, '')
  const month = Number(digits.slice(0, 2))
  const yy = Number(digits.slice(2, 4))
  return { month, year: 2000 + yy }
}

/**
 * Zufälliger, kollisionsfreier Schlüssel. `crypto.randomUUID` gibt es in jedem
 * Zielbrowser; der Fallback deckt nur Testumgebungen ohne WebCrypto ab.
 */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export interface IntentContext {
  returnUrl: string
  cancelUrl: string
  idempotencyKey?: string
}

/**
 * Aus Formular + Beleg wird die Nutzlast für die Edge Function — rein und
 * ohne Seiteneffekt, damit ein Test sie Zeichen für Zeichen prüfen kann.
 */
export function buildIntent(form: CheckoutForm, priced: Quote, ctx: IntentContext): CheckoutIntent {
  const method = form.methodId ? findMethod(form.methodId) : null
  if (!method) throw new Error('Keine Zahlungsart gewählt')

  const intent: CheckoutIntent = {
    idempotencyKey: ctx.idempotencyKey ?? newIdempotencyKey(),
    tier: form.tier,
    interval: form.interval,
    seats: priced.seats,
    currency: priced.currency,
    methodId: method.id,
    provider: method.provider,
    trialDays: priced.trialDays,
    promoCode: form.promoCode.trim() ? form.promoCode.trim().toUpperCase() : null,
    customer: {
      email: form.email.trim().toLowerCase(),
      fullName: form.fullName.trim(),
      business: form.business,
      company: form.business && form.company.trim() ? form.company.trim() : null,
      vatId: form.business && form.vatId.trim() ? normalizeVatId(form.vatId) : null,
      phone: form.phone.trim() || null,
    },
    address: {
      street: form.street.trim(),
      postalCode: form.postalCode.trim(),
      city: form.city.trim(),
      country: form.country.toUpperCase(),
    },
    expected: {
      net: priced.net,
      vatAmount: priced.vatAmount,
      total: priced.total,
      dueToday: priced.dueToday,
      vatRate: priced.vat.rate,
      reverseCharge: priced.vat.reverseCharge,
    },
    consent: {
      terms: true,
      immediateStart: form.acceptImmediateStart,
      newsletter: form.newsletter,
    },
    returnUrl: ctx.returnUrl,
    cancelUrl: ctx.cancelUrl,
  }

  if (method.form === 'card') {
    // Hier und nur hier wird aus der Karte etwas Übertragbares: vier Ziffern,
    // Marke, Ablauf. Alles andere bleibt liegen.
    const digits = form.card.number.replace(/\D/g, '')
    const { month, year } = parseExpiry(form.card.expiry)
    intent.card = {
      brand: detectCardBrand(digits).brand,
      last4: digits.slice(-4),
      expMonth: month,
      expYear: year,
    }
  }

  if (method.form === 'sepa') {
    intent.sepa = {
      iban: normalizeIban(form.sepa.iban),
      holder: form.sepa.holder.trim(),
      mandateAccepted: true,
    }
  }

  if (method.form === 'invoice') {
    intent.invoice = {
      poNumber: form.invoice.poNumber.trim() || null,
      billingEmail: form.invoice.billingEmail.trim().toLowerCase() || null,
    }
  }

  return intent
}

export type CheckoutOutcome =
  /** Weiter zum Anbieter — dort wird bestätigt. */
  | { status: 'redirect'; url: string; orderId: string }
  /** Fertig, Abo läuft. */
  | { status: 'succeeded'; orderId: string; simulated?: boolean }
  /** Angenommen, aber noch nicht bezahlt (Überweisung, Rechnung, Krypto). */
  | { status: 'pending'; orderId: string; instructions: PaymentInstructions }
  | { status: 'error'; message: string; retryable: boolean }

/** Was der Kunde tun muss, damit die Zahlung ankommt. */
export interface PaymentInstructions {
  headline: string
  /** Beschriftete Zeilen zum Abschreiben — IBAN, Verwendungszweck, Betrag. */
  rows: { label: string; value: string; copyable?: boolean }[]
  note?: string
}

/**
 * Bestellung abschicken.
 *
 * Ohne konfigurierte Cloud läuft der Checkout im **Demo-Modus**: es wird nichts
 * belastet, und das Ergebnis sagt das auch (`simulated: true`), damit die UI es
 * anzeigen kann. Ein Demo-Modus, der wie ein Kauf aussieht, ist eine Falle.
 */
export async function submitCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome> {
  if (!supabaseReady) {
    return {
      status: 'succeeded',
      orderId: intent.idempotencyKey,
      simulated: true,
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('billing-checkout', { body: intent })
    if (error) {
      return { status: 'error', message: humanError(error.message), retryable: true }
    }
    const outcome = data as CheckoutOutcome | null
    if (!outcome || !('status' in outcome)) {
      return { status: 'error', message: 'Unerwartete Antwort der Zahlungsstelle.', retryable: true }
    }
    return outcome
  } catch (err) {
    return {
      status: 'error',
      message: humanError(err instanceof Error ? err.message : String(err)),
      retryable: true,
    }
  }
}

/**
 * Den Stand einer Bestellung nachsehen — für die Rückkehr vom Anbieter.
 *
 * `/checkout/done?order=…` ist nur eine URL. Sie beweist nichts: der Kunde kann
 * sie sich merken, weiterschicken oder vom Zurück-Knopf dorthin geraten. Also
 * wird nicht ihr Vorhandensein gefeiert, sondern die Datenbank gefragt — und
 * die kennt nur, was der Webhook eingetragen hat.
 *
 * `pending` ist dabei kein Fehler, sondern der Normalfall in den ersten
 * Sekunden: der Kunde ist oft schneller zurück als der Webhook. Die UI zeigt
 * darum „läuft noch", nicht „fehlgeschlagen".
 */
export async function fetchOrderOutcome(orderId: string): Promise<CheckoutOutcome> {
  if (!supabaseReady) {
    return { status: 'error', message: 'Ohne Cloud-Anbindung lässt sich keine Bestellung nachschlagen.', retryable: false }
  }
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, failure_reason, total_amount, currency')
      .eq('id', orderId)
      .maybeSingle()

    if (error || !data) {
      return { status: 'error', message: 'Diese Bestellung finden wir nicht.', retryable: false }
    }
    if (data.status === 'paid') return { status: 'succeeded', orderId: data.id }
    if (data.status === 'failed' || data.status === 'cancelled') {
      return {
        status: 'error',
        message: humanError(data.failure_reason ?? ''),
        retryable: true,
      }
    }
    // pending / processing: der Webhook ist noch unterwegs.
    return {
      status: 'pending',
      orderId: data.id,
      instructions: {
        headline: 'Wir bestätigen deine Zahlung',
        rows: [
          { label: 'Bestellung', value: data.id.slice(0, 8).toUpperCase(), copyable: true },
          { label: 'Betrag', value: `${(data.total_amount / 100).toFixed(2)} ${data.currency}`, copyable: false },
        ],
        note: 'Das dauert normalerweise wenige Sekunden. Die Freischaltung läuft automatisch — du bekommst eine E-Mail, sobald sie durch ist.',
      },
    }
  } catch {
    return { status: 'error', message: 'Der Status liess sich nicht abrufen.', retryable: true }
  }
}

/**
 * Anbieterfehler in einen Satz übersetzen, mit dem jemand etwas anfangen kann.
 * „card_declined" ist für uns eine Information und für den Kunden ein Rätsel.
 */
export function humanError(raw: string): string {
  const key = raw.toLowerCase()
  if (key.includes('card_declined') || key.includes('declined')) {
    return 'Deine Bank hat die Zahlung abgelehnt. Eine andere Karte oder Zahlungsart hilft meistens sofort.'
  }
  if (key.includes('insufficient')) return 'Das Konto ist nicht ausreichend gedeckt.'
  if (key.includes('expired')) return 'Die Karte ist abgelaufen.'
  if (key.includes('amount_mismatch')) {
    return 'Der Betrag hat sich geändert, während du getippt hast. Bitte die Zusammenfassung noch einmal ansehen.'
  }
  if (key.includes('vat') || key.includes('vies')) {
    return 'Die USt-IdNr. liess sich beim EU-Dienst nicht bestätigen. Ohne Bestätigung müssen wir die Steuer ausweisen.'
  }
  if (key.includes('promo') || key.includes('coupon')) return 'Der Gutscheincode ist nicht mehr gültig.'
  if (key.includes('network') || key.includes('fetch')) {
    return 'Keine Verbindung zur Zahlungsstelle. Es wurde nichts belastet.'
  }
  return 'Die Zahlung liess sich nicht abschliessen. Es wurde nichts belastet.'
}

/**
 * Überweisungsdaten für den Wartezustand. Der Verwendungszweck enthält die
 * Bestell-ID — ohne sie liegt das Geld auf dem Konto und niemand weiss, wozu.
 */
export function transferInstructions(orderId: string, amountText: string): PaymentInstructions {
  return {
    headline: 'Überweise den Betrag, dann schalten wir frei',
    rows: [
      { label: 'Empfänger', value: 'OMEGA Atelier', copyable: true },
      { label: 'IBAN', value: 'DE00 0000 0000 0000 0000 00', copyable: true },
      { label: 'BIC', value: 'OMEGADEFFXXX', copyable: true },
      { label: 'Verwendungszweck', value: `OMEGA-${orderId.slice(0, 8).toUpperCase()}`, copyable: true },
      { label: 'Betrag', value: amountText, copyable: true },
    ],
    note: 'Die Freischaltung erfolgt automatisch, sobald die Zahlung eingegangen ist — in der Regel am nächsten Bankarbeitstag.',
  }
}
