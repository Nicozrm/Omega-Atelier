/**
 * vat.ts — Umsatzsteuer, USt-IdNr. und Reverse-Charge (rein).
 *
 * Digitale Leistungen an Verbraucher werden seit 2015 im **Land des Kunden**
 * versteuert (One-Stop-Shop), nicht am Sitz des Verkäufers. Ein Kunde in
 * Ungarn zahlt also 27 %, einer in Luxemburg 17 %, für dasselbe Abo. Deshalb
 * hängt der Satz hier am Bestimmungsland und nicht an einer Konstanten.
 *
 * Bei Geschäftskunden mit gültiger USt-IdNr. aus einem *anderen* EU-Land kehrt
 * sich die Steuerschuld um (Reverse-Charge, Art. 196 MwStSystRL): der Verkäufer
 * weist 0 % aus, der Käufer versteuert im eigenen Land. Für Geschäftskunden im
 * **Inland** gilt das nicht — dort wird ganz normal ausgewiesen.
 *
 * Die Formatprüfung hier ist genau das: eine Formatprüfung. Sie ersetzt die
 * Abfrage beim VIES-Dienst der EU nicht, denn nur die sagt, ob die Nummer auch
 * *existiert* und dem Namen gehört. Ein Tippfehler wird sofort im Formular
 * sichtbar; die verbindliche Bestätigung holt der Server (siehe
 * `supabase/functions/billing-checkout`), bevor er 0 % ausweist.
 */

import { SELLER_COUNTRY } from './catalog'

/**
 * Normalsätze der 27 EU-Mitgliedstaaten (Stand 2026). Ermässigte Sätze spielen
 * für Software keine Rolle — digitale Dienstleistungen laufen überall über den
 * Normalsatz.
 */
export const EU_VAT_RATES: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22,
  ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22,
  LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21,
  SE: 25, SI: 22, SK: 23,
}

/** Ist das Land Mitglied der EU (und damit im OSS-Verfahren)? */
export function isEuCountry(country: string): boolean {
  return country.toUpperCase() in EU_VAT_RATES
}

/**
 * Formatmuster der USt-IdNr. je Mitgliedstaat.
 * Quelle: Anhang der VIES-Spezifikation. Griechenland führt seine Nummern
 * fachlich unter `EL`, das Land selbst heisst aber `GR` — beide Schreibweisen
 * kommen in Formularen vor, deshalb stehen beide hier.
 */
const VAT_ID_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/,
  BE: /^BE0\d{9}$/,
  BG: /^BG\d{9,10}$/,
  CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/,
  DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/,
  EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/,
  GR: /^EL\d{9}$/,
  ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
  FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/,
  HU: /^HU\d{8}$/,
  IE: /^IE(\d{7}[A-W]|\d[A-Z*+]\d{5}[A-W]|\d{7}[A-W][AH])$/,
  IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/,
  LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/,
  MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/,
  PL: /^PL\d{10}$/,
  PT: /^PT\d{9}$/,
  RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/,
  SK: /^SK\d{10}$/,
}

/** Leerzeichen, Punkte und Bindestriche raus, alles gross. */
export function normalizeVatId(raw: string): string {
  return raw.replace(/[\s.\-/]/g, '').toUpperCase()
}

export interface VatIdCheck {
  valid: boolean
  /** Das Länderkürzel aus der Nummer (`EL` wird zu `GR` vereinheitlicht). */
  country: string | null
  normalized: string
  /** Warum ungültig — direkt anzeigbar. */
  reason?: string
}

/**
 * Prüft eine USt-IdNr. gegen das Format ihres Landes.
 *
 * Gibt zusätzlich das Land zurück, weil der Checkout es gegen die Rechnungs-
 * adresse hält: eine französische Nummer zu einer deutschen Adresse ist kein
 * Tippfehler, sondern ein Fall, den ein Mensch anschauen muss.
 */
export function validateVatId(raw: string): VatIdCheck {
  const normalized = normalizeVatId(raw)
  if (normalized.length < 4) {
    return { valid: false, country: null, normalized, reason: 'Zu kurz für eine USt-IdNr.' }
  }
  const prefix = normalized.slice(0, 2)
  const pattern = VAT_ID_PATTERNS[prefix]
  if (!pattern) {
    return { valid: false, country: null, normalized, reason: `${prefix} ist kein EU-Länderkürzel.` }
  }
  const country = prefix === 'EL' ? 'GR' : prefix
  if (!pattern.test(normalized)) {
    return { valid: false, country, normalized, reason: `Das Format passt nicht zu ${country}.` }
  }
  return { valid: true, country, normalized }
}

export interface VatContext {
  /** Rechnungsland, ISO-3166-1 alpha-2. */
  country: string
  /** Geschäftskunde (Firmenname/USt-IdNr. angegeben)? */
  business: boolean
  /** Eine *geprüfte* USt-IdNr. — Format ok und Land passend. */
  vatId?: string | null
}

export interface VatDecision {
  /** Steuersatz in Prozent. */
  rate: number
  /** Steuerschuldnerschaft kehrt sich um. */
  reverseCharge: boolean
  /** Ein Satz für Beleg und Zusammenfassung. */
  note: string
}

/**
 * Welcher Steuersatz gilt — und warum.
 *
 * Die Begründung kommt mit zurück, weil sie auf den Beleg gehört: „0 % USt.
 * — Reverse-Charge" ohne Erklärung ist für den Käufer ein Fehler, mit
 * Erklärung eine Rechnung, die sein Steuerberater akzeptiert.
 */
export function resolveVat(ctx: VatContext): VatDecision {
  const country = ctx.country.toUpperCase()

  if (!isEuCountry(country)) {
    return {
      rate: 0,
      reverseCharge: false,
      note: 'Nicht steuerbarer Umsatz — Leistungsort ausserhalb der EU.',
    }
  }

  const rate = EU_VAT_RATES[country]

  if (country === SELLER_COUNTRY) {
    // Inland: auch Geschäftskunden bekommen die Steuer ausgewiesen.
    return { rate, reverseCharge: false, note: `${formatRate(rate)} USt. (Inland)` }
  }

  const check = ctx.vatId ? validateVatId(ctx.vatId) : null
  if (ctx.business && check?.valid && check.country === country) {
    return {
      rate: 0,
      reverseCharge: true,
      note: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse-Charge).',
    }
  }

  return { rate, reverseCharge: false, note: `${formatRate(rate)} USt. (${country})` }
}

/** „19 %" bzw. „25,5 %" — ohne überflüssige Null hinter dem Komma. */
export function formatRate(rate: number): string {
  const text = Number.isInteger(rate) ? String(rate) : rate.toFixed(1).replace('.', ',')
  return `${text} %`
}
