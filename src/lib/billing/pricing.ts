/**
 * pricing.ts — aus Tarif, Intervall, Anzahl Plätzen, Land und Gutschein wird
 * ein Beleg (rein).
 *
 * Eine einzige Funktion rechnet, und alle Anzeigen lesen aus ihrem Ergebnis:
 * die Zusammenfassung rechts, der Knopf unten, die Bestätigungsseite und
 * später die Rechnung. Sobald zwei Stellen dieselbe Summe selbst ausrechnen,
 * driften sie auseinander — meist um einen Cent, und immer erst beim Kunden.
 *
 * ── Reihenfolge der Abzüge ───────────────────────────────────────────────
 * Erst Mengenrabatt, dann Gutschein, dann Guthaben aus einem laufenden Abo,
 * **dann** Steuer. Andersherum wäre die Steuer auf einen Betrag berechnet, den
 * niemand zahlt. Jede Zwischensumme wird auf ganze Minor Units gerundet, damit
 * die angezeigten Zeilen sich zur angezeigten Summe addieren — ein Beleg, bei
 * dem das nicht aufgeht, ist kaputt, auch wenn die Gesamtsumme stimmt.
 */

import type { Tier } from '@/lib/entitlements'
import {
  applyPercent, unitPrice, volumePercent,
  type BillingInterval, type CurrencyCode,
} from './catalog'
import { formatRate, resolveVat, type VatDecision } from './vat'

/** Ein eingelöster Gutschein. Herkunft: Server-Prüfung, siehe `promo.ts`. */
export interface PromoCode {
  code: string
  /** Anzeigename, z. B. „Launch 2026 — 20 % im ersten Jahr". */
  label: string
  /** Prozentualer Nachlass (1–100). Mit `amountOff` exklusiv. */
  percentOff?: number
  /** Fester Nachlass in Minor Units. Gilt nur in `currency`. */
  amountOff?: number
  currency?: CurrencyCode
  /** Nur für dieses Intervall gültig. */
  interval?: BillingInterval
  /** Nur für diese Tarife gültig. */
  tiers?: readonly Tier[]
  /** Über wie viele Abrechnungsperioden der Nachlass läuft (0 = dauerhaft). */
  periods?: number
}

export interface QuoteInput {
  tier: Tier
  interval: BillingInterval
  currency: CurrencyCode
  /** Anzahl Arbeitsplätze, mindestens 1. */
  seats: number
  /** Rechnungsland, ISO-3166-1 alpha-2. */
  country: string
  business: boolean
  /** USt-IdNr., falls angegeben — Format prüft `resolveVat`. */
  vatId?: string | null
  promo?: PromoCode | null
  /** Restguthaben aus einem laufenden Abo (Minor Units, brutto → hier netto verrechnet). */
  credit?: number
  /** Testphase in Tagen; > 0 setzt den heute fälligen Betrag auf null. */
  trialDays?: number
}

export interface QuoteLine {
  id: string
  label: string
  /** Vorzeichenbehaftet: Abzüge sind negativ. */
  amount: number
  /** Kleiner Zusatz unter der Zeile. */
  note?: string
}

export interface Quote {
  currency: CurrencyCode
  interval: BillingInterval
  seats: number
  /** Listenpreis je Platz und Periode. */
  unit: number
  /** `unit × seats`, vor allen Abzügen. */
  subtotal: number
  volumePercent: number
  volumeDiscount: number
  promoDiscount: number
  creditApplied: number
  /** Bemessungsgrundlage der Steuer. */
  net: number
  vat: VatDecision
  vatAmount: number
  /** Was der Beleg als Endbetrag ausweist. */
  total: number
  /** Was heute abgebucht wird — bei Testphase null. */
  dueToday: number
  trialDays: number
  /** Netto je Monat, für den Vergleich „x € / Monat" bei Jahreszahlung. */
  perMonth: number
  /** Netto je Platz und Periode nach Rabatten. */
  perSeat: number
  /** Ersparnis gegenüber zwölf Monatsraten (nur bei `yearly`, sonst 0). */
  yearlySavings: number
  /** Die Zeilen für die Zusammenfassung, in Anzeigereihenfolge. */
  lines: QuoteLine[]
}

/** Plätze in den erlaubten Bereich zwingen. */
function clampSeats(seats: number): number {
  return Math.max(1, Math.floor(Number.isFinite(seats) ? seats : 1))
}

/**
 * Gilt der Gutschein für diese Bestellung? Ein nicht passender Code wird
 * *nicht* still ignoriert — `promo.ts` sagt dem Kunden, warum er nicht greift.
 */
export function promoApplies(promo: PromoCode, input: Pick<QuoteInput, 'tier' | 'interval' | 'currency'>): boolean {
  if (promo.interval && promo.interval !== input.interval) return false
  if (promo.tiers && !promo.tiers.includes(input.tier)) return false
  if (promo.amountOff !== undefined && promo.currency && promo.currency !== input.currency) return false
  return true
}

/** Der Nachlass eines Gutscheins auf einen Betrag, gedeckelt auf den Betrag. */
export function promoDiscountOn(promo: PromoCode, base: number): number {
  const raw = promo.percentOff !== undefined
    ? applyPercent(base, promo.percentOff)
    : promo.amountOff ?? 0
  return Math.min(Math.max(0, raw), base)
}

/**
 * Der Beleg. Reine Funktion — dieselbe Eingabe ergibt immer dieselbe Ausgabe,
 * auch morgen, auch in einer anderen Zeitzone.
 */
export function quote(input: QuoteInput): Quote {
  const seats = clampSeats(input.seats)
  const unit = unitPrice(input.tier, input.interval, input.currency)
  const subtotal = unit * seats

  const volPercent = volumePercent(seats)
  const volumeDiscount = applyPercent(subtotal, volPercent)
  const afterVolume = subtotal - volumeDiscount

  const promo = input.promo && promoApplies(input.promo, input) ? input.promo : null
  const promoDiscount = promo ? promoDiscountOn(promo, afterVolume) : 0
  const afterPromo = afterVolume - promoDiscount

  const creditApplied = Math.min(Math.max(0, input.credit ?? 0), afterPromo)
  const net = afterPromo - creditApplied

  const vat = resolveVat({ country: input.country, business: input.business, vatId: input.vatId })
  const vatAmount = applyPercent(net, vat.rate)
  const total = net + vatAmount

  const trialDays = Math.max(0, Math.floor(input.trialDays ?? 0))
  const dueToday = trialDays > 0 ? 0 : total

  const months = input.interval === 'yearly' ? 12 : 1
  const perMonth = Math.round(net / months)
  const perSeat = Math.round(net / seats)

  // Was zwölf Monatsraten gekostet hätten — mit demselben Mengenrabatt, sonst
  // wäre die „Ersparnis" geschönt.
  const monthlyList = unitPrice(input.tier, 'monthly', input.currency) * seats * 12
  const monthlyComparable = monthlyList - applyPercent(monthlyList, volPercent)
  const yearlySavings = input.interval === 'yearly' ? Math.max(0, monthlyComparable - afterVolume) : 0

  const periodLabel = input.interval === 'yearly' ? 'Jahr' : 'Monat'
  const lines: QuoteLine[] = [
    {
      id: 'subtotal',
      label: seats > 1 ? `${seats} Arbeitsplätze × ${periodLabel}` : `Abo je ${periodLabel}`,
      amount: subtotal,
    },
  ]
  if (volumeDiscount > 0) {
    lines.push({
      id: 'volume',
      label: `Mengenrabatt ${volPercent} %`,
      amount: -volumeDiscount,
      note: `ab ${seats >= 50 ? 50 : seats >= 25 ? 25 : seats >= 10 ? 10 : 5} Arbeitsplätzen`,
    })
  }
  if (promoDiscount > 0 && promo) {
    lines.push({
      id: 'promo',
      label: promo.label,
      amount: -promoDiscount,
      note: promo.periods ? `für ${promo.periods} Abrechnungsperioden` : undefined,
    })
  }
  if (creditApplied > 0) {
    lines.push({ id: 'credit', label: 'Guthaben aus deinem laufenden Abo', amount: -creditApplied })
  }
  lines.push({
    id: 'vat',
    label: vat.reverseCharge
      ? 'Umsatzsteuer (Reverse-Charge)'
      : vat.rate > 0 ? `Umsatzsteuer ${formatRate(vat.rate)}` : 'Umsatzsteuer',
    amount: vatAmount,
    note: vat.note,
  })

  return {
    currency: input.currency,
    interval: input.interval,
    seats,
    unit,
    subtotal,
    volumePercent: volPercent,
    volumeDiscount,
    promoDiscount,
    creditApplied,
    net,
    vat,
    vatAmount,
    total,
    dueToday,
    trialDays,
    perMonth,
    perSeat,
    yearlySavings,
    lines,
  }
}

/**
 * Wann die nächste Abbuchung fällig wird.
 *
 * Nimmt `now` als Argument statt `new Date()` zu rufen — eine Kasse, deren
 * Rechenergebnis von der Uhr abhängt, lässt sich nicht testen. Monatssprünge
 * werden auf den letzten Tag gekappt: der 31. Januar plus einen Monat ist der
 * 28. Februar, nicht der 3. März.
 */
export function nextChargeDate(now: Date, interval: BillingInterval, trialDays = 0): Date {
  const d = new Date(now.getTime())
  if (trialDays > 0) {
    d.setDate(d.getDate() + trialDays)
    return d
  }
  const day = d.getDate()
  if (interval === 'yearly') {
    d.setFullYear(d.getFullYear() + 1)
  } else {
    d.setMonth(d.getMonth() + 1)
  }
  // setMonth rollt über: aus dem 31.01. + 1 Monat wird der 03.03.
  if (d.getDate() !== day) d.setDate(0)
  return d
}

/**
 * Anteiliges Guthaben eines laufenden Abos beim Wechsel.
 *
 * Verbrauchte Tage bleiben bezahlt, der Rest wird gutgeschrieben — abgerundet,
 * damit das Guthaben nie grösser wird als das, was tatsächlich noch offen ist.
 */
export function prorationCredit(paidAmount: number, periodDays: number, remainingDays: number): number {
  if (periodDays <= 0) return 0
  const remaining = Math.min(Math.max(0, remainingDays), periodDays)
  return Math.floor((paidAmount * remaining) / periodDays)
}
