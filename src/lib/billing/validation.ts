/**
 * validation.ts — Prüfungen, die im Browser stattfinden dürfen (rein).
 *
 * Die Grenze verläuft hier scharf: geprüft wird nur, was *ohne Netz und ohne
 * Geheimnis* entscheidbar ist — Prüfziffern, Formate, Ablaufdaten. Ob die
 * Karte gedeckt ist, ob das Konto existiert, ob die USt-IdNr. vergeben wurde:
 * das weiss nur der Anbieter, und wer es im Client behauptet, lügt bloss
 * schneller.
 *
 * Der Gewinn ist trotzdem gross. Ein vertippter IBAN scheitert an der
 * Mod-97-Prüfung, bevor irgendjemand auf „Kostenpflichtig bestellen" tippt —
 * und der Kunde sieht den Fehler an dem Feld, in dem er entstanden ist, statt
 * als roten Balken nach dem Absenden.
 */

/** Alle Leerzeichen und Trenner raus, alles gross. */
function compact(value: string): string {
  return value.replace(/[\s\-.]/g, '').toUpperCase()
}

// ═══════════════════════════ E-Mail ════════════════════════════════════════

/**
 * E-Mail-Prüfung, absichtlich grosszügig.
 *
 * RFC 5322 vollständig zu prüfen ist ein Regex von 6 kB, der `a@b` erlaubt und
 * gültige Adressen mit Unicode ablehnt — beides falsch herum. Verlangt wird
 * hier das, woran ein Tippfehler wirklich scheitert: ein `@`, links etwas,
 * rechts ein Punkt mit mindestens zwei Zeichen dahinter, keine Leerzeichen.
 */
export function isEmail(value: string): boolean {
  const v = value.trim()
  if (v.length > 254 || /\s/.test(v)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)*\.[A-Za-z]{2,}$/.test(v)
}

// ═══════════════════════════ Karte ═════════════════════════════════════════

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'discover' | 'diners' | 'jcb' | 'unionpay' | 'unknown'

export interface CardBrandSpec {
  brand: CardBrand
  label: string
  /** Erlaubte Längen der Kartennummer. */
  lengths: readonly number[]
  /** Länge des Prüfcodes. */
  cvcLength: number
  /** Gruppierung für die Anzeige, z. B. [4,4,4,4]. */
  gaps: readonly number[]
}

const BRANDS: readonly (CardBrandSpec & { test: RegExp })[] = [
  { brand: 'visa', label: 'Visa', lengths: [13, 16, 19], cvcLength: 3, gaps: [4, 4, 4, 4], test: /^4/ },
  { brand: 'mastercard', label: 'Mastercard', lengths: [16], cvcLength: 3, gaps: [4, 4, 4, 4], test: /^(5[1-5]|2[2-7])/ },
  { brand: 'amex', label: 'American Express', lengths: [15], cvcLength: 4, gaps: [4, 6, 5], test: /^3[47]/ },
  { brand: 'diners', label: 'Diners Club', lengths: [14, 16, 19], cvcLength: 3, gaps: [4, 6, 4], test: /^3(0[0-5]|[689])/ },
  { brand: 'discover', label: 'Discover', lengths: [16, 19], cvcLength: 3, gaps: [4, 4, 4, 4], test: /^(6011|64[4-9]|65)/ },
  { brand: 'jcb', label: 'JCB', lengths: [16, 17, 18, 19], cvcLength: 3, gaps: [4, 4, 4, 4], test: /^35(2[89]|[3-8])/ },
  { brand: 'unionpay', label: 'UnionPay', lengths: [16, 17, 18, 19], cvcLength: 3, gaps: [4, 4, 4, 4], test: /^62/ },
]

const UNKNOWN_BRAND: CardBrandSpec = {
  brand: 'unknown', label: 'Karte', lengths: [12, 13, 14, 15, 16, 17, 18, 19], cvcLength: 3, gaps: [4, 4, 4, 4],
}

/** Kartenmarke aus den ersten Ziffern — schon ab der zweiten Eingabe stabil. */
export function detectCardBrand(number: string): CardBrandSpec {
  const digits = number.replace(/\D/g, '')
  if (!digits) return UNKNOWN_BRAND
  const hit = BRANDS.find((b) => b.test.test(digits))
  if (!hit) return UNKNOWN_BRAND
  const { test: _test, ...spec } = hit
  return spec
}

/**
 * Luhn-Prüfsumme. Fängt jede einzelne falsche Ziffer und fast jeden
 * Zahlendreher — der Grund, warum Kartennummern überhaupt eine Prüfziffer
 * haben.
 */
export function luhn(number: string): boolean {
  const digits = number.replace(/\D/g, '')
  if (digits.length < 12) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Kartennummer mit den markentypischen Lücken — 4-4-4-4, bei Amex 4-6-5. */
export function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '')
  const { gaps, lengths } = detectCardBrand(digits)
  const max = Math.max(...lengths)
  const trimmed = digits.slice(0, max)
  const parts: string[] = []
  let idx = 0
  for (const gap of gaps) {
    if (idx >= trimmed.length) break
    parts.push(trimmed.slice(idx, idx + gap))
    idx += gap
  }
  if (idx < trimmed.length) parts.push(trimmed.slice(idx))
  return parts.join(' ')
}

/** Nummer vollständig prüfen: Länge zur Marke plus Luhn. */
export function validateCardNumber(value: string): { valid: boolean; reason?: string; spec: CardBrandSpec } {
  const digits = value.replace(/\D/g, '')
  const spec = detectCardBrand(digits)
  if (digits.length === 0) return { valid: false, reason: 'Kartennummer fehlt.', spec }
  if (!spec.lengths.includes(digits.length)) {
    return { valid: false, reason: `${spec.label} hat ${spec.lengths.join(' oder ')} Stellen.`, spec }
  }
  if (!luhn(digits)) return { valid: false, reason: 'Prüfziffer stimmt nicht — vertippt?', spec }
  return { valid: true, spec }
}

/**
 * Ablaufdatum aus „MM/JJ" oder „MM/JJJJ".
 *
 * Eine Karte ist bis zum **Ende** ihres Ablaufmonats gültig, nicht bis zum
 * Ersten. Verglichen wird deshalb gegen den ersten Tag des Folgemonats.
 * `now` kommt als Argument, damit der Test nicht im Dezember anders ausgeht.
 */
export function validateExpiry(value: string, now: Date = new Date()): { valid: boolean; reason?: string } {
  const m = /^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/.exec(value.trim())
  if (!m) return { valid: false, reason: 'Format MM/JJ.' }
  const month = Number(m[1])
  if (month < 1 || month > 12) return { valid: false, reason: 'Monat liegt zwischen 01 und 12.' }
  const rawYear = Number(m[2])
  const year = m[2].length === 2 ? 2000 + rawYear : rawYear
  const expiresAfter = new Date(year, month, 1)
  if (expiresAfter <= now) return { valid: false, reason: 'Die Karte ist abgelaufen.' }
  if (year > now.getFullYear() + 20) return { valid: false, reason: 'Jahr liegt zu weit in der Zukunft.' }
  return { valid: true }
}

/** Ablaufdatum beim Tippen zu „MM/JJ" formen. */
export function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

/** Prüfcode: drei Stellen, bei American Express vier. */
export function validateCvc(value: string, spec: CardBrandSpec): { valid: boolean; reason?: string } {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== spec.cvcLength) {
    return { valid: false, reason: `${spec.label}: ${spec.cvcLength} Stellen.` }
  }
  return { valid: true }
}

// ═══════════════════════════ IBAN ══════════════════════════════════════════

/** Vorgeschriebene IBAN-Länge je Land (SEPA-Raum plus die üblichen Nachbarn). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28,
  IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  VA: 22,
}

/**
 * Mod-97-10 nach ISO 7064.
 *
 * Die Zahl hat bis zu 34 Zeichen, wird also nach der Buchstabenersetzung
 * deutlich grösser als `Number.MAX_SAFE_INTEGER`. Deshalb stückweise: Rest
 * mitschleppen, immer nur ein paar Ziffern anhängen. `BigInt` ginge auch, ist
 * aber langsamer und hier nicht nötig.
 */
function mod97(input: string): number {
  let rest = 0
  for (const ch of input) {
    rest = (rest * 10 + (ch.charCodeAt(0) - 48)) % 97
  }
  return rest
}

export function normalizeIban(value: string): string {
  return compact(value)
}

export interface IbanCheck {
  valid: boolean
  normalized: string
  country: string | null
  reason?: string
}

/** IBAN prüfen: Land bekannt, Länge korrekt, Prüfsumme 1. */
export function validateIban(value: string): IbanCheck {
  const iban = normalizeIban(value)
  if (iban.length < 5) return { valid: false, normalized: iban, country: null, reason: 'IBAN ist zu kurz.' }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return { valid: false, normalized: iban, country: null, reason: 'IBAN beginnt mit zwei Buchstaben und zwei Ziffern.' }
  }
  const country = iban.slice(0, 2)
  const expected = IBAN_LENGTHS[country]
  if (!expected) {
    return { valid: false, normalized: iban, country, reason: `${country} ist kein SEPA-Land.` }
  }
  if (iban.length !== expected) {
    return { valid: false, normalized: iban, country, reason: `Eine ${country}-IBAN hat ${expected} Stellen — hier sind es ${iban.length}.` }
  }
  // Die ersten vier Zeichen wandern ans Ende, Buchstaben werden zu Zahlen
  // (A = 10 … Z = 35).
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  if (mod97(numeric) !== 1) {
    return { valid: false, normalized: iban, country, reason: 'Prüfziffer stimmt nicht — bitte noch einmal vergleichen.' }
  }
  return { valid: true, normalized: iban, country }
}

/** IBAN in Vierergruppen — so steht sie auf jedem Kontoauszug. */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, '$1 ').trim()
}

/**
 * IBAN für die Anzeige maskieren: Land, Prüfziffern und die letzten vier
 * Stellen bleiben stehen. Genug zum Wiedererkennen, zu wenig zum Missbrauchen.
 */
export function maskIban(value: string): string {
  const iban = normalizeIban(value)
  if (iban.length < 8) return iban
  return `${iban.slice(0, 4)} ${'•'.repeat(4)} ${'•'.repeat(4)} ${iban.slice(-4)}`
}

// ═══════════════════════════ Adresse ═══════════════════════════════════════

/**
 * Postleitzahlen der Länder, in denen wir nennenswert verkaufen. Fehlt ein
 * Land, wird nur auf „nicht leer" geprüft — eine erfundene Regel wäre
 * schlimmer als keine, weil sie gültige Adressen abweist.
 */
const POSTAL_PATTERNS: Record<string, RegExp> = {
  DE: /^\d{5}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  LI: /^\d{4}$/,
  NL: /^\d{4}\s?[A-Za-z]{2}$/,
  BE: /^\d{4}$/,
  FR: /^\d{5}$/,
  IT: /^\d{5}$/,
  ES: /^\d{5}$/,
  PT: /^\d{4}-\d{3}$/,
  PL: /^\d{2}-\d{3}$/,
  CZ: /^\d{3}\s?\d{2}$/,
  SK: /^\d{3}\s?\d{2}$/,
  DK: /^\d{4}$/,
  SE: /^\d{3}\s?\d{2}$/,
  NO: /^\d{4}$/,
  FI: /^\d{5}$/,
  GB: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/,
  IE: /^[A-Za-z]\d{2}\s?[A-Za-z\d]{4}$/,
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/,
}

export function validatePostalCode(country: string, value: string): { valid: boolean; reason?: string } {
  const v = value.trim()
  if (!v) return { valid: false, reason: 'Postleitzahl fehlt.' }
  const pattern = POSTAL_PATTERNS[country.toUpperCase()]
  if (!pattern) return { valid: true }
  if (!pattern.test(v)) return { valid: false, reason: `Passt nicht zum Format in ${country.toUpperCase()}.` }
  return { valid: true }
}

/** Nicht leer nach dem Trimmen, und lang genug, um etwas zu bedeuten. */
export function isFilled(value: string, minLength = 2): boolean {
  return value.trim().length >= minLength
}
