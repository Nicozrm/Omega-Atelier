/**
 * methods.ts — jede Zahlungsart, die OMEGA annimmt, und wann sie angeboten wird.
 *
 * Ein Katalog statt einer Reihe von `if`s im Formular. Ob PayPal erscheint,
 * hängt an sechs Bedingungen (Land, Währung, Betrag, Abo-Fähigkeit, Gerät,
 * Geschäftskunde) — und die gehören an einen Ort, an dem man sie *lesen* kann,
 * nicht verteilt über eine Komponente.
 *
 * ── Die wichtigste Regel dieser Datei ────────────────────────────────────
 * Ein Monatsabo braucht eine Zahlungsart, die **wiederkehrend einziehen** darf.
 * Karte, SEPA-Lastschrift und PayPal können das (Mandat bzw. Billing
 * Agreement). Eine iDEAL-Überweisung kann es nicht: sie ist eine einzelne,
 * vom Kunden freigegebene Zahlung. Solche Verfahren sind deshalb **nur beim
 * Jahresabo** wählbar, wo genau eine Zahlung fällig wird — und dort sind sie
 * ein echter Gewinn, weil ein Niederländer eben mit iDEAL zahlen will.
 *
 * Genau deshalb steht bei jeder Methode `recurring` und nicht ein pauschales
 * „unterstützt Abos". Die UI erklärt den Ausschluss dann im Klartext, statt die
 * Kachel wortlos verschwinden zu lassen.
 *
 * ── Nicht in der Liste ───────────────────────────────────────────────────
 * giropay (Betrieb Ende 2024 eingestellt) und Sofort/Klarna-Direktüberweisung
 * als eigene Kachel — letzteres läuft heute unter „Klarna" und wäre doppelt.
 */

import type { CurrencyCode } from './catalog'

/** Der Anbieter, über den die Zahlung technisch läuft. */
export type ProviderId = 'stripe' | 'paypal' | 'mollie' | 'klarna' | 'coinbase' | 'omega'

export interface ProviderSpec {
  id: ProviderId
  label: string
  /** Wo die Zahlung landet — für die Datenschutz-Zeile im Checkout. */
  home: string
  /** Link auf die Datenschutzerklärung des Anbieters. */
  privacy: string
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  stripe: { id: 'stripe', label: 'Stripe', home: 'Irland / USA', privacy: 'https://stripe.com/de/privacy' },
  paypal: { id: 'paypal', label: 'PayPal', home: 'Luxemburg', privacy: 'https://www.paypal.com/de/legalhub/privacy-full' },
  mollie: { id: 'mollie', label: 'Mollie', home: 'Niederlande', privacy: 'https://www.mollie.com/de/privacy' },
  klarna: { id: 'klarna', label: 'Klarna', home: 'Schweden', privacy: 'https://www.klarna.com/de/datenschutzerklaerung/' },
  coinbase: { id: 'coinbase', label: 'Coinbase Commerce', home: 'USA', privacy: 'https://www.coinbase.com/legal/privacy' },
  omega: { id: 'omega', label: 'OMEGA Atelier', home: 'Deutschland', privacy: '/datenschutz' },
}

/** Kachelgruppen im Checkout, in Anzeigereihenfolge. */
export type MethodGroup = 'wallet' | 'card' | 'bank' | 'later' | 'local' | 'business' | 'crypto'

export const GROUP_LABEL: Record<MethodGroup, string> = {
  wallet: 'Schnell bezahlen',
  card: 'Karte',
  bank: 'Bank & Lastschrift',
  later: 'Später bezahlen',
  local: 'Landesüblich',
  business: 'Für Unternehmen',
  crypto: 'Krypto',
}

export const GROUP_HINT: Record<MethodGroup, string> = {
  wallet: 'Ein Tipp, fertig — biometrisch bestätigt, keine Kartennummer im Formular.',
  card: 'Visa, Mastercard, American Express. Weltweit, sofort aktiv.',
  bank: 'Vom Konto abgebucht oder überwiesen.',
  later: 'Erst nutzen, dann zahlen.',
  local: 'Das Verfahren, das in deinem Land jeder kennt.',
  business: 'Rechnung, Sammelbeleg, Zahlungsziel.',
  crypto: 'On-Chain bezahlen. Kurs wird beim Anbieter für 15 Minuten fixiert.',
}

/** Zusatzformular, das die Methode innerhalb der App braucht. */
export type MethodForm = 'card' | 'sepa' | 'invoice' | 'none'

/** Gerätefähigkeit, ohne die eine Wallet-Kachel sinnlos wäre. */
export type MethodCapability = 'apple-pay' | 'google-pay'

export interface PaymentMethodSpec {
  id: string
  label: string
  provider: ProviderId
  group: MethodGroup
  /** Ein Satz, der erklärt, was passiert, wenn man tippt. */
  blurb: string
  /**
   * Länder, in denen die Methode angeboten wird. Leer = überall dort, wo der
   * Anbieter aktiv ist.
   */
  countries: readonly string[]
  currencies: readonly CurrencyCode[]
  /** Darf ohne erneute Freigabe wiederkehrend einziehen? */
  recurring: boolean
  /** Untergrenze in Minor Units (Anbieter-Mindestbetrag). */
  min?: number
  /** Obergrenze in Minor Units. */
  max?: number
  /** Verlässt die App zum Anbieter und kommt zurück. */
  redirect: boolean
  /** Ohne diese Gerätefähigkeit wird die Kachel gar nicht erst gezeigt. */
  capability?: MethodCapability
  form: MethodForm
  /** Nur für Geschäftskunden. */
  businessOnly?: boolean
  /** Kurzer Aufkleber auf der Kachel. */
  badge?: string
  /** Markenfarbe der Kachel (Akzentkante + Monogramm). */
  accent: string
  /** Wann die Zahlung als eingegangen gilt — ehrliche Erwartung statt „sofort". */
  settlement: 'instant' | 'hours' | 'days' | 'terms'
}

/**
 * Die Methoden selbst. Reihenfolge = Vorschlagsreihenfolge innerhalb der
 * Gruppe; die Gruppenreihenfolge macht `groupMethods` anhand von `GROUP_ORDER`.
 */
export const PAYMENT_METHODS: readonly PaymentMethodSpec[] = [
  // ── Wallets ────────────────────────────────────────────────────────────
  {
    id: 'apple-pay', label: 'Apple Pay', provider: 'stripe', group: 'wallet',
    blurb: 'Mit Face ID oder Touch ID bestätigen — die Karte bleibt im Gerät.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: true,
    redirect: false, capability: 'apple-pay', form: 'none', accent: '#F1ECE1',
    settlement: 'instant', badge: 'Am schnellsten',
  },
  {
    id: 'google-pay', label: 'Google Pay', provider: 'stripe', group: 'wallet',
    blurb: 'Karte aus dem Google-Konto, Freigabe direkt im Browser.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: true,
    redirect: false, capability: 'google-pay', form: 'none', accent: '#5BB8FF',
    settlement: 'instant',
  },
  {
    id: 'paypal', label: 'PayPal', provider: 'paypal', group: 'wallet',
    blurb: 'Anmelden, Abo-Vereinbarung bestätigen, zurück zu OMEGA.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: true,
    redirect: true, form: 'none', accent: '#5BB8FF', settlement: 'instant',
    badge: 'Käuferschutz',
  },
  {
    id: 'link', label: 'Link', provider: 'stripe', group: 'wallet',
    blurb: 'Stripes gespeicherte Karte — ein Code per SMS statt 16 Ziffern.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: true,
    redirect: false, form: 'none', accent: '#2EE59D', settlement: 'instant',
  },
  {
    id: 'revolut-pay', label: 'Revolut Pay', provider: 'stripe', group: 'wallet',
    blurb: 'Aus dem Revolut-Guthaben, Freigabe in der App.',
    countries: ['DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'PT', 'IE', 'PL', 'GB', 'SE', 'FI', 'DK', 'LT', 'LV', 'EE', 'RO', 'GR', 'CZ', 'HU', 'BG', 'HR', 'SI', 'SK', 'CY', 'MT', 'LU'],
    currencies: ['EUR', 'GBP'], recurring: true, redirect: true, form: 'none',
    accent: '#8A7BFF', settlement: 'instant',
  },
  {
    id: 'amazon-pay', label: 'Amazon Pay', provider: 'stripe', group: 'wallet',
    blurb: 'Adresse und Zahlungsmittel aus dem Amazon-Konto übernehmen.',
    countries: ['DE', 'AT', 'GB', 'IT', 'ES', 'FR', 'US'], currencies: ['EUR', 'GBP', 'USD'],
    recurring: true, redirect: true, form: 'none', accent: '#FFB13D', settlement: 'instant',
  },

  // ── Karte ──────────────────────────────────────────────────────────────
  {
    id: 'card', label: 'Kredit- oder Debitkarte', provider: 'stripe', group: 'card',
    blurb: 'Visa, Mastercard, American Express. 3-D Secure, wenn deine Bank es verlangt.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: true,
    redirect: false, form: 'card', accent: '#C7A24E', settlement: 'instant',
  },

  // ── Bank ───────────────────────────────────────────────────────────────
  {
    id: 'sepa-debit', label: 'SEPA-Lastschrift', provider: 'stripe', group: 'bank',
    blurb: 'Einmal Mandat erteilen, danach läuft die Abbuchung von selbst.',
    countries: ['DE', 'AT', 'NL', 'BE', 'FR', 'IT', 'ES', 'PT', 'IE', 'FI', 'LU', 'GR', 'SK', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'HR', 'PL', 'CZ', 'HU', 'RO', 'BG', 'DK', 'SE', 'CH', 'LI', 'NO'],
    currencies: ['EUR'], recurring: true, redirect: false, form: 'sepa',
    accent: '#5BD6C0', settlement: 'days', badge: 'Ohne Karte',
  },
  {
    id: 'bank-transfer', label: 'Überweisung', provider: 'omega', group: 'bank',
    blurb: 'Du bekommst die Kontodaten und einen Verwendungszweck. Freischaltung nach Zahlungseingang.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP'], recurring: false,
    redirect: false, form: 'none', accent: '#8B8478', settlement: 'days',
  },

  // ── Später bezahlen ────────────────────────────────────────────────────
  {
    id: 'klarna', label: 'Klarna', provider: 'klarna', group: 'later',
    blurb: 'In 30 Tagen oder in Raten. Bonitätsprüfung durch Klarna.',
    countries: ['DE', 'AT', 'CH', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'GB', 'ES', 'IT', 'FR', 'PL', 'US'],
    currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: false, min: 100, max: 100000,
    redirect: true, form: 'none', accent: '#FF9EC4', settlement: 'instant',
    badge: 'In 30 Tagen',
  },

  // ── Landesüblich ───────────────────────────────────────────────────────
  {
    id: 'ideal', label: 'iDEAL', provider: 'mollie', group: 'local',
    blurb: 'Über das Online-Banking deiner niederländischen Bank.',
    countries: ['NL'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#C46BFF', settlement: 'instant',
  },
  {
    id: 'bancontact', label: 'Bancontact', provider: 'mollie', group: 'local',
    blurb: 'Die belgische Debitkarte, per App oder Kartenleser bestätigt.',
    countries: ['BE'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#5BB8FF', settlement: 'instant',
  },
  {
    id: 'eps', label: 'EPS-Überweisung', provider: 'mollie', group: 'local',
    blurb: 'Sofortüberweisung über dein österreichisches Bankkonto.',
    countries: ['AT'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#FF5C5C', settlement: 'instant',
  },
  {
    id: 'twint', label: 'TWINT', provider: 'mollie', group: 'local',
    blurb: 'QR-Code scannen, in der TWINT-App freigeben.',
    countries: ['CH', 'LI'], currencies: ['CHF'], recurring: false, redirect: true,
    form: 'none', accent: '#FF4D4D', settlement: 'instant',
  },
  {
    id: 'p24', label: 'Przelewy24', provider: 'mollie', group: 'local',
    blurb: 'Über 160 polnische Banken, direkt aus dem Online-Banking.',
    countries: ['PL'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#FFB13D', settlement: 'instant',
  },
  {
    id: 'blik', label: 'BLIK', provider: 'mollie', group: 'local',
    blurb: 'Sechsstelliger Code aus deiner polnischen Banking-App.',
    countries: ['PL'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#2EE59D', settlement: 'instant',
  },
  {
    id: 'mb-way', label: 'MB WAY', provider: 'mollie', group: 'local',
    blurb: 'Freigabe per Telefonnummer in der portugiesischen MB-WAY-App.',
    countries: ['PT'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#FF5C5C', settlement: 'instant',
  },
  {
    id: 'multibanco', label: 'Multibanco', provider: 'mollie', group: 'local',
    blurb: 'Referenz erzeugen und im Homebanking oder am Automaten zahlen.',
    countries: ['PT'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#5BD6C0', settlement: 'days',
  },
  {
    id: 'satispay', label: 'Satispay', provider: 'mollie', group: 'local',
    blurb: 'Die italienische Bezahl-App, Freigabe per Push.',
    countries: ['IT'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#FF4D4D', settlement: 'instant',
  },
  {
    id: 'swish', label: 'Swish', provider: 'mollie', group: 'local',
    blurb: 'Schwedens Sofortzahlung, per BankID bestätigt.',
    countries: ['SE'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#C46BFF', settlement: 'instant',
  },
  {
    id: 'mobilepay', label: 'MobilePay', provider: 'mollie', group: 'local',
    blurb: 'Die dänisch-finnische Bezahl-App.',
    countries: ['DK', 'FI'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#5BB8FF', settlement: 'instant',
  },
  {
    id: 'vipps', label: 'Vipps', provider: 'mollie', group: 'local',
    blurb: 'Norwegens Bezahl-App, Freigabe per Telefonnummer.',
    countries: ['NO'], currencies: ['EUR'], recurring: false, redirect: true,
    form: 'none', accent: '#FF9EC4', settlement: 'instant',
  },
  {
    id: 'alipay', label: 'Alipay', provider: 'stripe', group: 'local',
    blurb: 'QR-Code mit der Alipay-App scannen, Freigabe direkt dort.',
    countries: ['CN', 'HK', 'SG'], currencies: ['EUR', 'USD'], recurring: false,
    redirect: true, form: 'none', accent: '#5BB8FF', settlement: 'instant',
  },
  {
    id: 'wechat-pay', label: 'WeChat Pay', provider: 'stripe', group: 'local',
    blurb: 'QR-Code mit WeChat scannen und in der App bestätigen.',
    countries: ['CN', 'HK', 'SG'], currencies: ['EUR', 'USD'], recurring: false,
    redirect: true, form: 'none', accent: '#2EE59D', settlement: 'instant',
  },

  // ── Unternehmen ────────────────────────────────────────────────────────
  {
    id: 'invoice', label: 'Rechnung', provider: 'omega', group: 'business',
    blurb: 'Zahlungsziel 14 Tage, Sammelrechnung auf Wunsch. Ab dem Jahresabo.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: false,
    min: 5000, redirect: false, form: 'invoice', businessOnly: true,
    accent: '#E6CC86', settlement: 'terms', badge: 'Zahlungsziel 14 Tage',
  },
  {
    id: 'purchase-order', label: 'Bestellung / Rahmenvertrag', provider: 'omega', group: 'business',
    blurb: 'Für Beschaffung mit Bestellnummer. Wir melden uns innerhalb eines Werktags.',
    countries: [], currencies: ['EUR', 'CHF', 'GBP', 'USD'], recurring: false,
    min: 50000, redirect: false, form: 'invoice', businessOnly: true,
    accent: '#8B8478', settlement: 'terms',
  },

  // ── Krypto ─────────────────────────────────────────────────────────────
  {
    id: 'crypto', label: 'Krypto', provider: 'coinbase', group: 'crypto',
    blurb: 'BTC, ETH, USDC und mehr. Kurs 15 Minuten fixiert, Freischaltung nach Bestätigung.',
    countries: [], currencies: ['EUR', 'USD'], recurring: false, min: 500,
    redirect: true, form: 'none', accent: '#FFB13D', settlement: 'hours',
  },
]

const GROUP_ORDER: readonly MethodGroup[] = ['wallet', 'card', 'bank', 'later', 'local', 'business', 'crypto']

/** Gerätefähigkeiten, die die Wallet-Kacheln gatekeepen. */
export interface DeviceCapabilities {
  applePay: boolean
  googlePay: boolean
}

export interface MethodContext {
  /** Rechnungsland, ISO-3166-1 alpha-2. */
  country: string
  currency: CurrencyCode
  /** Fälliger Gesamtbetrag in Minor Units — entscheidet über Mindest-/Höchstgrenzen. */
  amount: number
  /** Braucht die Bestellung eine wiederkehrende Abbuchung? (Monatsabo) */
  recurring: boolean
  business: boolean
  capabilities: DeviceCapabilities
}

/** Warum eine Methode gerade nicht geht — Text ist für die UI bestimmt. */
export type MethodVerdict =
  | { available: true }
  | { available: false; reason: string; /** Ganz ausblenden statt gesperrt zeigen. */ hide?: boolean }

/**
 * Ist die Methode in diesem Kontext wählbar?
 *
 * Zwei Sorten „nein": Gerät und Land blenden aus (eine Apple-Pay-Kachel auf
 * einem Android-Telefon ist kein Angebot, sondern Rauschen), alles Übrige wird
 * *gezeigt und begründet* — „nur im Jahresabo" ist eine Information, aus der
 * jemand eine Entscheidung machen kann.
 */
export function methodVerdict(m: PaymentMethodSpec, ctx: MethodContext): MethodVerdict {
  const country = ctx.country.toUpperCase()

  if (m.capability === 'apple-pay' && !ctx.capabilities.applePay) {
    return { available: false, reason: 'Nur auf Apple-Geräten mit hinterlegter Karte.', hide: true }
  }
  if (m.capability === 'google-pay' && !ctx.capabilities.googlePay) {
    return { available: false, reason: 'Nur in Chrome bzw. auf Android mit hinterlegter Karte.', hide: true }
  }
  if (m.countries.length > 0 && !m.countries.includes(country)) {
    return { available: false, reason: `In ${country} nicht verfügbar.`, hide: true }
  }
  if (!m.currencies.includes(ctx.currency)) {
    return { available: false, reason: `Rechnet nicht in ${ctx.currency} ab.`, hide: true }
  }
  if (m.businessOnly && !ctx.business) {
    return { available: false, reason: 'Nur für Geschäftskunden — Firmenname eintragen.' }
  }
  if (ctx.recurring && !m.recurring) {
    return { available: false, reason: 'Kann nicht monatlich einziehen — im Jahresabo wählbar.' }
  }
  if (m.min !== undefined && ctx.amount < m.min) {
    return { available: false, reason: `Erst ab einem Bestellwert von ${(m.min / 100).toFixed(0)} ${ctx.currency}.` }
  }
  if (m.max !== undefined && ctx.amount > m.max) {
    return { available: false, reason: `Nur bis ${(m.max / 100).toFixed(0)} ${ctx.currency}.` }
  }
  return { available: true }
}

export interface MethodOffer {
  method: PaymentMethodSpec
  verdict: MethodVerdict
}

export interface MethodGroupOffer {
  group: MethodGroup
  label: string
  hint: string
  offers: MethodOffer[]
}

/**
 * Alle Methoden, die in diesem Kontext überhaupt eine Kachel bekommen —
 * verfügbare zuerst, gesperrte danach, ausgeblendete gar nicht.
 */
export function offeredMethods(ctx: MethodContext): MethodOffer[] {
  return PAYMENT_METHODS
    .map((method) => ({ method, verdict: methodVerdict(method, ctx) }))
    .filter((o) => o.verdict.available || !o.verdict.hide)
    .sort((a, b) => Number(b.verdict.available) - Number(a.verdict.available))
}

/** Dieselbe Liste, nach Gruppen sortiert; leere Gruppen fallen raus. */
export function groupedMethods(ctx: MethodContext): MethodGroupOffer[] {
  const offers = offeredMethods(ctx)
  return GROUP_ORDER
    .map((group) => ({
      group,
      label: GROUP_LABEL[group],
      hint: GROUP_HINT[group],
      offers: offers.filter((o) => o.method.group === group),
    }))
    .filter((g) => g.offers.length > 0)
}

/** Nur die tatsächlich wählbaren. */
export function availableMethods(ctx: MethodContext): PaymentMethodSpec[] {
  return offeredMethods(ctx).filter((o) => o.verdict.available).map((o) => o.method)
}

/** Eine Methode per ID. */
export function findMethod(id: string): PaymentMethodSpec | null {
  return PAYMENT_METHODS.find((m) => m.id === id) ?? null
}

/**
 * Die Methode, die als erste vorgeschlagen wird.
 *
 * Wallets zuerst — sie sind für den Kunden die wenigste Arbeit und brechen am
 * seltensten ab. Danach Karte, dann was das Land hergibt. Ist gar nichts
 * verfügbar (ein Land ohne jede passende Methode), kommt `null` zurück und die
 * UI zeigt den Kontakt-Weg statt einer leeren Liste.
 */
export function suggestMethod(ctx: MethodContext): PaymentMethodSpec | null {
  return availableMethods(ctx)[0] ?? null
}

/**
 * Was das Gerät kann. Beide Prüfungen sind bewusst konservativ: `ApplePaySession`
 * existiert nur in Safari auf Apple-Hardware, und `canMakePayments()` sagt
 * zusätzlich, ob überhaupt eine Karte in der Wallet liegt. Für Google Pay gibt
 * es keine solche synchrone Abfrage — die `PaymentRequest`-API zu prüfen ist
 * das Nächstbeste und schliesst zumindest Browser aus, die es gar nicht können.
 */
export function detectCapabilities(): DeviceCapabilities {
  if (typeof window === 'undefined') return { applePay: false, googlePay: false }
  const w = window as unknown as {
    ApplePaySession?: { canMakePayments?: () => boolean }
    PaymentRequest?: unknown
  }
  let applePay = false
  try {
    applePay = Boolean(w.ApplePaySession?.canMakePayments?.())
  } catch {
    applePay = false
  }
  const googlePay = typeof w.PaymentRequest === 'function' && !applePay
  return { applePay, googlePay }
}
