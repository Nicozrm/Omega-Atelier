/**
 * checkout.ts — der Zustand der Kasse und die Regeln, wann man weiterdarf (rein).
 *
 * Die Seite hält nur `CheckoutForm`; *ob* ein Schritt fertig ist, was fehlt und
 * welches Feld die Meldung bekommt, entscheidet ausschliesslich diese Datei.
 * Damit ist die Kasse ohne Browser testbar — und die Fehlermeldung, die der
 * Kunde sieht, steht im selben Modul wie die Bedingung, die sie auslöst.
 *
 * ── Warum Schritte und nicht ein langes Formular ─────────────────────────
 * Weil ein Kaufabbruch fast immer an *gefühltem* Aufwand scheitert, nicht an
 * echtem. Vier kurze Schritte mit sichtbarem Fortschritt werden zuverlässiger
 * zu Ende gebracht als dieselben Felder in einer Kolonne — und jeder Schritt
 * prüft nur sich selbst, sodass eine unvollständige Adresse nicht das
 * Kartenfeld rot färbt.
 */

import type { Tier } from '@/lib/entitlements'
import { MAX_SELF_SERVE_SEATS, type BillingInterval, type CurrencyCode } from './catalog'
import { findMethod, type PaymentMethodSpec } from './methods'
import { validateVatId } from './vat'
import {
  detectCardBrand, isEmail, isFilled, validateCardNumber, validateCvc,
  validateExpiry, validateIban, validatePostalCode,
} from './validation'

/** Die vier Schritte, in Reihenfolge. */
export const CHECKOUT_STEPS = ['plan', 'account', 'payment', 'review'] as const
export type CheckoutStep = (typeof CHECKOUT_STEPS)[number]

export interface StepMeta {
  id: CheckoutStep
  /** Kurzer Titel in der Schrittleiste. */
  label: string
  /** Was in diesem Schritt passiert — eine Zeile, in der Überschrift. */
  headline: string
  hint: string
}

export const STEP_META: Record<CheckoutStep, StepMeta> = {
  plan: {
    id: 'plan', label: 'Tarif',
    headline: 'Wähle deinen Tarif',
    hint: 'Jederzeit wechselbar. Jahreszahlung spart zwei Monate.',
  },
  account: {
    id: 'account', label: 'Kontakt',
    headline: 'Wohin geht die Rechnung?',
    hint: 'Nur was auf den Beleg muss — nichts davon wird weitergegeben.',
  },
  payment: {
    id: 'payment', label: 'Zahlung',
    headline: 'Wie möchtest du zahlen?',
    hint: 'Alle Verfahren laufen über zertifizierte Anbieter. Keine Kartendaten auf unseren Servern.',
  },
  review: {
    id: 'review', label: 'Prüfen',
    headline: 'Alles richtig?',
    hint: 'Letzter Blick auf Tarif, Adresse und Betrag — danach wird es verbindlich.',
  },
}

export interface CardDetails {
  number: string
  expiry: string
  cvc: string
  holder: string
}

export interface SepaDetails {
  iban: string
  holder: string
  /** SEPA-Mandat erteilt. */
  mandate: boolean
}

export interface InvoiceDetails {
  /** Bestellnummer des Kunden, landet auf der Rechnung. */
  poNumber: string
  /** Abweichende Rechnungs-E-Mail (Buchhaltung). */
  billingEmail: string
}

export interface CheckoutForm {
  // ── Schritt 1 ──
  tier: Tier
  interval: BillingInterval
  seats: number
  currency: CurrencyCode
  trial: boolean

  // ── Schritt 2 ──
  email: string
  fullName: string
  business: boolean
  company: string
  vatId: string
  street: string
  postalCode: string
  city: string
  country: string
  phone: string

  // ── Schritt 3 ──
  methodId: string | null
  card: CardDetails
  sepa: SepaDetails
  invoice: InvoiceDetails

  // ── Schritt 4 ──
  promoCode: string
  acceptTerms: boolean
  /** Verzicht auf das Widerrufsrecht, damit sofort freigeschaltet wird. */
  acceptImmediateStart: boolean
  newsletter: boolean
}

/** Ein leeres Formular mit vernünftigen Vorgaben. */
export function emptyForm(overrides: Partial<CheckoutForm> = {}): CheckoutForm {
  return {
    tier: 'pro',
    interval: 'yearly',
    seats: 1,
    currency: 'EUR',
    trial: false,

    email: '',
    fullName: '',
    business: false,
    company: '',
    vatId: '',
    street: '',
    postalCode: '',
    city: '',
    country: 'DE',
    phone: '',

    methodId: null,
    card: { number: '', expiry: '', cvc: '', holder: '' },
    sepa: { iban: '', holder: '', mandate: false },
    invoice: { poNumber: '', billingEmail: '' },

    promoCode: '',
    acceptTerms: false,
    acceptImmediateStart: false,
    newsletter: false,
    ...overrides,
  }
}

/** Feldname → Meldung. Der Feldname ist die `id` des Eingabefelds. */
export type FieldErrors = Record<string, string>

/**
 * Prüft **einen** Schritt.
 *
 * `now` wandert durch bis zur Ablaufdatums-Prüfung: eine Kasse, die im
 * Dezember andere Testergebnisse liefert als im Januar, ist keine.
 */
export function validateStep(step: CheckoutStep, form: CheckoutForm, now: Date = new Date()): FieldErrors {
  switch (step) {
    case 'plan':
      return validatePlanStep(form)
    case 'account':
      return validateAccountStep(form)
    case 'payment':
      return validatePaymentStep(form, now)
    case 'review':
      return validateReviewStep(form)
  }
}

function validatePlanStep(form: CheckoutForm): FieldErrors {
  const errors: FieldErrors = {}
  if (form.tier === 'free') {
    errors.tier = 'Free ist ohne Kasse verfügbar — wähle Pro oder Max.'
  }
  if (!Number.isFinite(form.seats) || form.seats < 1) {
    errors.seats = 'Mindestens ein Arbeitsplatz.'
  } else if (form.seats > MAX_SELF_SERVE_SEATS) {
    errors.seats = `Ab ${MAX_SELF_SERVE_SEATS + 1} Arbeitsplätzen macht der Vertrieb dir ein Angebot.`
  }
  return errors
}

function validateAccountStep(form: CheckoutForm): FieldErrors {
  const errors: FieldErrors = {}
  if (!isEmail(form.email)) errors.email = 'Bitte eine E-Mail-Adresse, an die der Beleg gehen darf.'
  if (!isFilled(form.fullName)) errors.fullName = 'Vor- und Nachname, wie auf dem Zahlungsmittel.'
  if (form.business && !isFilled(form.company)) errors.company = 'Firmenname fehlt.'
  if (!isFilled(form.street, 3)) errors.street = 'Strasse und Hausnummer fehlen.'
  if (!isFilled(form.city)) errors.city = 'Ort fehlt.'

  const postal = validatePostalCode(form.country, form.postalCode)
  if (!postal.valid) errors.postalCode = postal.reason ?? 'Postleitzahl prüfen.'

  // Die USt-IdNr. ist freiwillig. Steht aber eine drin, muss sie stimmen —
  // sonst wiese die Rechnung 0 % aus, und die Nachforderung träfe uns.
  if (form.business && form.vatId.trim()) {
    const check = validateVatId(form.vatId)
    if (!check.valid) {
      errors.vatId = check.reason ?? 'USt-IdNr. prüfen.'
    } else if (check.country && check.country !== form.country.toUpperCase()) {
      errors.vatId = `Die Nummer gehört zu ${check.country}, die Adresse zu ${form.country.toUpperCase()}.`
    }
  }
  return errors
}

function validatePaymentStep(form: CheckoutForm, now: Date): FieldErrors {
  const errors: FieldErrors = {}
  const method = form.methodId ? findMethod(form.methodId) : null
  if (!method) {
    errors.methodId = 'Bitte eine Zahlungsart wählen.'
    return errors
  }

  if (method.form === 'card') {
    const number = validateCardNumber(form.card.number)
    if (!number.valid) errors['card.number'] = number.reason ?? 'Kartennummer prüfen.'

    const expiry = validateExpiry(form.card.expiry, now)
    if (!expiry.valid) errors['card.expiry'] = expiry.reason ?? 'Ablaufdatum prüfen.'

    const cvc = validateCvc(form.card.cvc, detectCardBrand(form.card.number))
    if (!cvc.valid) errors['card.cvc'] = cvc.reason ?? 'Prüfcode prüfen.'

    if (!isFilled(form.card.holder, 3)) errors['card.holder'] = 'Name wie auf der Karte.'
  }

  if (method.form === 'sepa') {
    const iban = validateIban(form.sepa.iban)
    if (!iban.valid) errors['sepa.iban'] = iban.reason ?? 'IBAN prüfen.'
    if (!isFilled(form.sepa.holder, 3)) errors['sepa.holder'] = 'Kontoinhaber fehlt.'
    if (!form.sepa.mandate) errors['sepa.mandate'] = 'Ohne Mandat dürfen wir nicht abbuchen.'
  }

  if (method.form === 'invoice') {
    if (!isFilled(form.company)) errors.company = 'Rechnung gibt es nur an eine Firma.'
    if (form.invoice.billingEmail.trim() && !isEmail(form.invoice.billingEmail)) {
      errors['invoice.billingEmail'] = 'Die Rechnungsadresse ist keine gültige E-Mail.'
    }
  }

  return errors
}

function validateReviewStep(form: CheckoutForm): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.acceptTerms) errors.acceptTerms = 'Ohne AGB und Datenschutz geht es nicht weiter.'
  // § 356 Abs. 5 BGB: Freischaltung vor Ablauf der Widerrufsfrist setzt die
  // ausdrückliche Zustimmung des Kunden voraus. Ohne sie beginnt das Abo erst
  // nach vierzehn Tagen — die Kasse verlangt sie deshalb, statt sie zu
  // unterstellen.
  if (!form.acceptImmediateStart) errors.acceptImmediateStart = 'Bitte bestätigen, damit wir sofort freischalten dürfen.'
  return errors
}

/** Ist der Schritt vollständig? */
export function isStepComplete(step: CheckoutStep, form: CheckoutForm, now: Date = new Date()): boolean {
  return Object.keys(validateStep(step, form, now)).length === 0
}

/**
 * Der erste Schritt, der noch etwas braucht. Wird nach einem Sprung in der
 * Schrittleiste benutzt: zurück darf man immer, vor nur bis hierhin.
 */
export function firstIncompleteStep(form: CheckoutForm, now: Date = new Date()): CheckoutStep {
  return CHECKOUT_STEPS.find((s) => !isStepComplete(s, form, now)) ?? 'review'
}

/**
 * Darf zu `target` gesprungen werden?
 *
 * Zurück immer — Nachschauen darf nie bestraft werden. Vorwärts nur, wenn alle
 * Schritte davor sitzen.
 */
export function canJumpTo(target: CheckoutStep, current: CheckoutStep, form: CheckoutForm, now: Date = new Date()): boolean {
  const ti = CHECKOUT_STEPS.indexOf(target)
  const ci = CHECKOUT_STEPS.indexOf(current)
  if (ti <= ci) return true
  return CHECKOUT_STEPS.slice(0, ti).every((s) => isStepComplete(s, form, now))
}

/** Der Schritt nach diesem, oder `null` am Ende. */
export function nextStep(step: CheckoutStep): CheckoutStep | null {
  return CHECKOUT_STEPS[CHECKOUT_STEPS.indexOf(step) + 1] ?? null
}

/** Der Schritt davor, oder `null` am Anfang. */
export function prevStep(step: CheckoutStep): CheckoutStep | null {
  const i = CHECKOUT_STEPS.indexOf(step)
  return i > 0 ? CHECKOUT_STEPS[i - 1] : null
}

/** Fortschritt in Prozent — für die Leiste über der Kasse. */
export function progressPercent(step: CheckoutStep): number {
  return Math.round((CHECKOUT_STEPS.indexOf(step) / (CHECKOUT_STEPS.length - 1)) * 100)
}

/**
 * Braucht die Bestellung eine wiederkehrende Abbuchung?
 *
 * Nur beim Monatsabo. Das Jahresabo wird einmal bezahlt und öffnet damit die
 * Tür für iDEAL, Klarna, Überweisung und Krypto — siehe `methods.ts`.
 */
export function needsRecurring(form: Pick<CheckoutForm, 'interval'>): boolean {
  return form.interval === 'monthly'
}

/**
 * Darf zu diesem Formular eine Testphase angeboten werden?
 *
 * Nur, wenn danach automatisch abgebucht werden kann. Eine Testphase mit
 * anschliessender Überweisung wäre eine Aufforderung, das Abo zu vergessen —
 * für beide Seiten unangenehm.
 */
export function trialAvailable(method: PaymentMethodSpec | null): boolean {
  return Boolean(method?.recurring)
}
