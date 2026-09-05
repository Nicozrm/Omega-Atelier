/**
 * catalog.ts — was verkauft wird, in welcher Währung, zu welchem Preis.
 *
 * Rein: keine Netzwerkaufrufe, kein React, keine Zeitzone. Alle Beträge sind
 * **Minor Units** (Cent/Rappen/Pence) als Ganzzahl. Fliesskomma-Euro sind in
 * einer Kasse ein Fehler, der sich erst beim Runden zeigt: 0.1 + 0.2 ist auch
 * hier nicht 0.3, und ein Cent Differenz zwischen Zwischensumme und Beleg
 * kostet einen Support-Fall.
 *
 * Der Preis pro Währung steht ausgeschrieben und wird **nicht** aus dem
 * Euro-Preis umgerechnet. Ein Wechselkurs zur Laufzeit macht aus 9,00 € je
 * nach Tag 8,37 £ oder 8,41 £ — Preisschilder, die zwischen zwei Ladevorgängen
 * springen. Jeder Markt bekommt deshalb seinen eigenen, gerundeten Punkt.
 */

import { PLANS, type Tier } from '@/lib/entitlements'

/** Abrechnungsintervall. */
export type BillingInterval = 'monthly' | 'yearly'

/** Unterstützte Abrechnungswährungen. */
export type CurrencyCode = 'EUR' | 'CHF' | 'GBP' | 'USD'

export interface CurrencySpec {
  code: CurrencyCode
  symbol: string
  /** Locale für `Intl.NumberFormat`. */
  locale: string
  /** Länder (ISO-3166-1 alpha-2), die standardmässig in dieser Währung zahlen. */
  countries: readonly string[]
}

export const CURRENCIES: Record<CurrencyCode, CurrencySpec> = {
  EUR: { code: 'EUR', symbol: '€', locale: 'de-DE', countries: ['DE', 'AT', 'NL', 'BE', 'FR', 'IT', 'ES', 'PT', 'IE', 'FI', 'LU', 'GR', 'SK', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'HR'] },
  CHF: { code: 'CHF', symbol: 'CHF', locale: 'de-CH', countries: ['CH', 'LI'] },
  GBP: { code: 'GBP', symbol: '£', locale: 'en-GB', countries: ['GB'] },
  USD: { code: 'USD', symbol: '$', locale: 'en-US', countries: ['US', 'CA', 'AU', 'NZ', 'SG'] },
}

/** Die Währung, in der ein Land standardmässig abgerechnet wird. */
export function currencyForCountry(country: string): CurrencyCode {
  const cc = country.toUpperCase()
  for (const spec of Object.values(CURRENCIES)) {
    if (spec.countries.includes(cc)) return spec.code
  }
  // Alles Übrige rechnet in Euro ab — der Sitz des Verkäufers.
  return 'EUR'
}

export interface PricePoint {
  /** Preis je Arbeitsplatz und Monat, in Minor Units. */
  monthly: number
  /** Preis je Arbeitsplatz und Jahr, in Minor Units. */
  yearly: number
}

/**
 * Das Preisbuch. Jahrespreis = zehn Monatsraten: zwei Monate geschenkt.
 * Free steht mit Null drin, damit jede Rechenstrecke auch für Free läuft und
 * die UI keinen Sonderfall braucht.
 */
export const PRICE_BOOK: Record<Tier, Record<CurrencyCode, PricePoint>> = {
  free: {
    EUR: { monthly: 0, yearly: 0 },
    CHF: { monthly: 0, yearly: 0 },
    GBP: { monthly: 0, yearly: 0 },
    USD: { monthly: 0, yearly: 0 },
  },
  pro: {
    EUR: { monthly: 900, yearly: 9000 },
    CHF: { monthly: 950, yearly: 9500 },
    GBP: { monthly: 800, yearly: 8000 },
    USD: { monthly: 1000, yearly: 10000 },
  },
  max: {
    EUR: { monthly: 1900, yearly: 19000 },
    CHF: { monthly: 1950, yearly: 19500 },
    GBP: { monthly: 1700, yearly: 17000 },
    USD: { monthly: 2000, yearly: 20000 },
  },
}

/** Listenpreis je Arbeitsplatz für Tarif + Intervall, in Minor Units. */
export function unitPrice(tier: Tier, interval: BillingInterval, currency: CurrencyCode): number {
  return PRICE_BOOK[tier][currency][interval]
}

/**
 * Mengenrabatt-Staffel für Teams. Greift ab fünf Arbeitsplätzen und wird auf
 * die Zwischensumme angewandt — nicht auf den Einzelpreis, sonst schleppt sich
 * ein Rundungsfehler durch jede Position.
 */
export const VOLUME_TIERS: readonly { minSeats: number; percentOff: number }[] = [
  { minSeats: 50, percentOff: 20 },
  { minSeats: 25, percentOff: 15 },
  { minSeats: 10, percentOff: 10 },
  { minSeats: 5, percentOff: 5 },
]

/** Rabattsatz in Prozent für eine Anzahl Arbeitsplätze (0 = keiner). */
export function volumePercent(seats: number): number {
  return VOLUME_TIERS.find((t) => seats >= t.minSeats)?.percentOff ?? 0
}

/** Obergrenze der Selbstbedienung — darüber übernimmt der Vertrieb. */
export const MAX_SELF_SERVE_SEATS = 250

/** Kostenlose Testphase in Tagen (0 = keine). */
export const TRIAL_DAYS = 14

/**
 * Sitz des Verkäufers. Bestimmt, wann Reverse-Charge greift und welche
 * Umsatzsteuer bei rein inländischen Bestellungen anfällt.
 */
export const SELLER_COUNTRY = 'DE'

/** Anzeigename eines Tarifs (spiegelt die Landing-Page). */
export function planName(tier: Tier): string {
  return PLANS.find((p) => p.tier === tier)?.name ?? tier
}

/** Der Tarif zu einem String — oder `null`, wenn es ihn nicht gibt. */
export function parseTier(value: string | null | undefined): Tier | null {
  return value === 'free' || value === 'pro' || value === 'max' ? value : null
}

/** Das Intervall zu einem String — oder `null`. */
export function parseInterval(value: string | null | undefined): BillingInterval | null {
  return value === 'monthly' || value === 'yearly' ? value : null
}

/** Die Währung zu einem String — oder `null`. */
export function parseCurrency(value: string | null | undefined): CurrencyCode | null {
  const up = value?.toUpperCase()
  return up === 'EUR' || up === 'CHF' || up === 'GBP' || up === 'USD' ? up : null
}

/**
 * Minor Units als Preis formatieren.
 *
 * Glatte Beträge erscheinen ohne Nachkommastellen („9 €" statt „9,00 €") —
 * Preisschilder lesen sich so ruhiger. Sobald ein Betrag Cent enthält (Steuer,
 * anteilige Beträge, Rabatte), werden beide Stellen gezeigt, denn dort ist die
 * Genauigkeit die Aussage.
 */
export function formatMoney(minor: number, currency: CurrencyCode, opts?: { forceDecimals?: boolean }): string {
  const spec = CURRENCIES[currency]
  const hasCents = minor % 100 !== 0
  const digits = opts?.forceDecimals || hasCents ? 2 : 0
  return new Intl.NumberFormat(spec.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(minor / 100)
}

/**
 * Prozentsatz auf einen Betrag, kaufmännisch gerundet auf ganze Minor Units.
 * Eine einzige Stelle für diese Rundung, damit Rabatt, Steuer und Anteil nie
 * unterschiedlich runden.
 */
export function applyPercent(minor: number, percent: number): number {
  return Math.round((minor * percent) / 100)
}
