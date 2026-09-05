// ══════════════════════════════════════════════════════════════════════════
//  billing-checkout — die Bestellung annehmen und an den Anbieter übergeben.
//
//  Die Function ist die Stelle, an der aus einem ausgefüllten Formular eine
//  Forderung wird. Alles, was Geld kostet, wird deshalb HIER entschieden und
//  nirgends sonst:
//
//    1. Wer bist du?      → JWT prüfen. Ohne Konto kein Abo.
//    2. Was kostet es?    → aus `billing_prices` neu rechnen. Der vom Browser
//                            mitgeschickte Betrag ist ein Vorschlag; weicht er
//                            ab, wird abgelehnt (`amount_mismatch`).
//    3. Gilt der Rabatt?  → Gutschein gegen `promo_codes` prüfen, inklusive
//                            Kontingent. Der Client kennt nur die Konditionen.
//    4. Welche Steuer?    → Satz nach Bestimmungsland; Reverse-Charge nur mit
//                            USt-IdNr., deren Format UND Land passen.
//    5. Schon bestellt?   → Idempotenzschlüssel. Zweiter Aufruf gibt dieselbe
//                            Bestellung zurück, statt eine zweite anzulegen.
//
//  Erst danach entsteht eine Zeile in `orders`, und erst danach spricht die
//  Function mit dem Anbieter.
//
//  ── Was hier NICHT passiert ─────────────────────────────────────────────
//  Freischalten. Eine bezahlte Bestellung wird sie durch den Webhook
//  (`billing-webhook`), nicht durch die Antwort dieser Function. Wer nach dem
//  Redirect zurückkommt, hat vielleicht nur den Zurück-Knopf gedrückt.
//
//  ── Deployment ──────────────────────────────────────────────────────────
//      supabase functions deploy billing-checkout
//
//  Ohne `--no-verify-jwt`: hier ist die JWT-Prüfung genau richtig.
//
//  Secrets (supabase secrets set …):
//      STRIPE_SECRET_KEY        sk_live_… bzw. sk_test_…
//      PAYPAL_CLIENT_ID / PAYPAL_SECRET
//      MOLLIE_API_KEY
//      COINBASE_COMMERCE_KEY
//      VIES_ENABLED             "1" schaltet die USt-IdNr.-Prüfung scharf
//      CHECKOUT_ALLOWED_ORIGINS Kommaliste, z. B. https://omega-atelier.de
//
//  Fehlt der Schlüssel eines Anbieters, wird die betreffende Zahlungsart
//  abgelehnt — nicht heimlich simuliert. Eine Kasse, die „ok" sagt, ohne dass
//  Geld fliesst, ist schlimmer als eine, die ehrlich streikt.
// ══════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// ── CORS ────────────────────────────────────────────────────────────────
// Kein `*`: diese Function trägt Rechte (Service-Rolle) und nimmt eine
// Bestellung entgegen. Erlaubt ist, was in CHECKOUT_ALLOWED_ORIGINS steht.
const ALLOWED = (Deno.env.get('CHECKOUT_ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean)

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED.length === 0 || ALLOWED.includes(origin)) ? origin : ALLOWED[0] ?? ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' },
  })

// ── Steuer ──────────────────────────────────────────────────────────────
// Gespiegelt aus src/lib/billing/vat.ts. Die Kopie ist beabsichtigt: der
// Client braucht die Sätze für die Anzeige, verbindlich sind die hier.
const EU_VAT_RATES: Record<string, number> = {
  AT: 20, BE: 21, BG: 20, CY: 19, CZ: 21, DE: 19, DK: 25, EE: 22,
  ES: 21, FI: 25.5, FR: 20, GR: 24, HR: 25, HU: 27, IE: 23, IT: 22,
  LT: 21, LU: 17, LV: 21, MT: 18, NL: 21, PL: 23, PT: 23, RO: 21,
  SE: 25, SI: 22, SK: 23,
}
const SELLER_COUNTRY = 'DE'

const VAT_ID_PATTERNS: Record<string, RegExp> = {
  AT: /^ATU\d{8}$/, BE: /^BE0\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/,
  CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/, DK: /^DK\d{8}$/, EE: /^EE\d{9}$/,
  EL: /^EL\d{9}$/, GR: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/,
  FR: /^FR[A-Z0-9]{2}\d{9}$/, HR: /^HR\d{11}$/, HU: /^HU\d{8}$/,
  IE: /^IE(\d{7}[A-W]|\d[A-Z*+]\d{5}[A-W]|\d{7}[A-W][AH])$/, IT: /^IT\d{11}$/,
  LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/, LV: /^LV\d{11}$/, MT: /^MT\d{8}$/,
  NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/,
  SE: /^SE\d{12}$/, SI: /^SI\d{8}$/, SK: /^SK\d{10}$/,
}

const VOLUME_TIERS = [
  { minSeats: 50, percentOff: 20 },
  { minSeats: 25, percentOff: 15 },
  { minSeats: 10, percentOff: 10 },
  { minSeats: 5, percentOff: 5 },
]

const pct = (minor: number, percent: number) => Math.round((minor * percent) / 100)

interface VatOutcome { rate: number; reverseCharge: boolean }

/**
 * Steuersatz bestimmen. `vatVerified` kommt aus der VIES-Abfrage weiter unten
 * — ohne Bestätigung gibt es kein Reverse-Charge, egal wie gültig das Format
 * aussieht. Die Steuer schuldet sonst der Verkäufer.
 */
function resolveVat(country: string, business: boolean, vatId: string | null, vatVerified: boolean): VatOutcome {
  const cc = country.toUpperCase()
  if (!(cc in EU_VAT_RATES)) return { rate: 0, reverseCharge: false }
  if (cc === SELLER_COUNTRY) return { rate: EU_VAT_RATES[cc], reverseCharge: false }
  if (business && vatId && vatVerified && vatIdCountry(vatId) === cc) {
    return { rate: 0, reverseCharge: true }
  }
  return { rate: EU_VAT_RATES[cc], reverseCharge: false }
}

function vatIdCountry(raw: string): string | null {
  const v = raw.replace(/[\s.\-/]/g, '').toUpperCase()
  const prefix = v.slice(0, 2)
  const pattern = VAT_ID_PATTERNS[prefix]
  if (!pattern || !pattern.test(v)) return null
  return prefix === 'EL' ? 'GR' : prefix
}

/**
 * USt-IdNr. beim VIES-Dienst der EU bestätigen.
 *
 * Nur das Format zu prüfen und dann 0 % auszuweisen wäre teuer: bei einer
 * erfundenen Nummer bleibt die Steuer beim Verkäufer hängen. Antwortet VIES
 * nicht (der Dienst hat regelmässig Ausfälle), gilt die Nummer als
 * unbestätigt — dann wird die Steuer ausgewiesen. Lieber ein Kunde, der
 * nachfragt, als eine Nachzahlung.
 */
async function verifyVatId(vatId: string): Promise<boolean> {
  if (Deno.env.get('VIES_ENABLED') !== '1') return false
  const v = vatId.replace(/[\s.\-/]/g, '').toUpperCase()
  const cc = v.slice(0, 2)
  const number = v.slice(2)
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${number}`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!res.ok) return false
    const body = await res.json() as { isValid?: boolean }
    return body.isValid === true
  } catch {
    return false
  }
}

// ── Anfrage ─────────────────────────────────────────────────────────────
interface Intent {
  idempotencyKey: string
  tier: 'pro' | 'max'
  interval: 'monthly' | 'yearly'
  seats: number
  currency: string
  methodId: string
  provider: string
  trialDays: number
  promoCode: string | null
  customer: {
    email: string; fullName: string; business: boolean
    company: string | null; vatId: string | null; phone: string | null
  }
  address: { street: string; postalCode: string; city: string; country: string }
  expected: {
    net: number; vatAmount: number; total: number; dueToday: number
    vatRate: number; reverseCharge: boolean
  }
  card?: { brand: string; last4: string; expMonth: number; expYear: number }
  sepa?: { iban: string; holder: string; mandateAccepted: boolean }
  invoice?: { poNumber: string | null; billingEmail: string | null }
  consent: { terms: boolean; immediateStart: boolean; newsletter: boolean }
  returnUrl: string
  cancelUrl: string
}

/**
 * Grobprüfung der Nutzlast, bevor irgendetwas gerechnet wird. Nicht wegen
 * Angreifern (die scheitern später an der Preisprüfung), sondern damit eine
 * kaputte Anfrage eine benennbare Antwort bekommt statt eines 500ers.
 */
function validShape(i: unknown): i is Intent {
  const x = i as Intent
  return Boolean(
    x && typeof x === 'object' &&
    typeof x.idempotencyKey === 'string' && x.idempotencyKey.length >= 8 &&
    (x.tier === 'pro' || x.tier === 'max') &&
    (x.interval === 'monthly' || x.interval === 'yearly') &&
    Number.isInteger(x.seats) && x.seats >= 1 && x.seats <= 250 &&
    typeof x.currency === 'string' && x.currency.length === 3 &&
    typeof x.methodId === 'string' &&
    x.customer && typeof x.customer.email === 'string' &&
    x.address && typeof x.address.country === 'string' && x.address.country.length === 2 &&
    x.expected && typeof x.expected.total === 'number' &&
    x.consent && x.consent.terms === true,
  )
}

/** Kartennummern dürfen die Function nicht einmal erreichen. */
function containsPan(payload: string): boolean {
  return /"(number|pan|cardNumber|cvc|cvv)"\s*:/i.test(payload)
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json({ status: 'error', message: 'Nur POST.', retryable: false }, 405, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // ── 1 · Wer bist du ──────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: auth } = await anon.auth.getUser()
  const user = auth?.user
  if (!user) {
    return json({ status: 'error', message: 'Bitte melde dich an, bevor du bestellst.', retryable: false }, 401, origin)
  }

  const raw = await req.text()
  if (containsPan(raw)) {
    // Nicht nur ablehnen: das ist ein Programmierfehler auf unserer Seite und
    // gehört ins Log, nicht in eine stille 400.
    console.error('[billing-checkout] Nutzlast enthielt Kartenfelder — Client prüfen')
    return json({ status: 'error', message: 'Ungültige Nutzlast.', retryable: false }, 400, origin)
  }

  let intent: unknown
  try {
    intent = JSON.parse(raw)
  } catch {
    return json({ status: 'error', message: 'Ungültiges JSON.', retryable: false }, 400, origin)
  }
  if (!validShape(intent)) {
    return json({ status: 'error', message: 'Unvollständige Bestellung.', retryable: false }, 400, origin)
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── 2 · Schon bestellt? ──────────────────────────────────────────────
  // Vor jeder Rechnung: ein zweiter Klick darf keine zweite Bestellung machen.
  const { data: existing } = await db
    .from('orders')
    .select('id, status, provider_ref')
    .eq('idempotency_key', intent.idempotencyKey)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'paid') {
      return json({ status: 'succeeded', orderId: existing.id }, 200, origin)
    }
    if (existing.provider_ref?.startsWith('http')) {
      return json({ status: 'redirect', url: existing.provider_ref, orderId: existing.id }, 200, origin)
    }
    return json({ status: 'error', message: 'Diese Bestellung läuft bereits.', retryable: false }, 409, origin)
  }

  // ── 3 · Was kostet es ────────────────────────────────────────────────
  const { data: price, error: priceError } = await db
    .from('billing_prices')
    .select('unit_amount')
    .eq('tier', intent.tier)
    .eq('interval', intent.interval)
    .eq('currency', intent.currency)
    .eq('active', true)
    .maybeSingle()

  if (priceError || !price) {
    return json({ status: 'error', message: 'Für diese Kombination gibt es keinen Preis.', retryable: false }, 400, origin)
  }

  const subtotal = price.unit_amount * intent.seats
  const volumePercent = VOLUME_TIERS.find((t) => intent.seats >= t.minSeats)?.percentOff ?? 0
  const afterVolume = subtotal - pct(subtotal, volumePercent)

  // ── 4 · Gutschein ────────────────────────────────────────────────────
  let promoDiscount = 0
  let promoCode: string | null = null
  if (intent.promoCode) {
    const { data: promo } = await db
      .from('promo_codes')
      .select('*')
      .eq('code', intent.promoCode.toUpperCase())
      .eq('active', true)
      .maybeSingle()

    const usable = promo
      && (!promo.starts_at || new Date(promo.starts_at) <= new Date())
      && (!promo.expires_at || new Date(promo.expires_at) > new Date())
      && (promo.max_redemptions === null || promo.redemptions < promo.max_redemptions)
      && (!promo.interval || promo.interval === intent.interval)
      && (!promo.tiers || promo.tiers.includes(intent.tier))
      && (!promo.currency || promo.currency === intent.currency)

    if (!usable) {
      return json({ status: 'error', message: 'promo_invalid', retryable: false }, 400, origin)
    }
    promoDiscount = promo.percent_off
      ? pct(afterVolume, promo.percent_off)
      : Math.min(promo.amount_off ?? 0, afterVolume)
    promoCode = promo.code
  }

  const net = Math.max(0, afterVolume - promoDiscount)

  // ── 5 · Steuer ───────────────────────────────────────────────────────
  const vatId = intent.customer.business ? intent.customer.vatId : null
  const vatVerified = vatId ? await verifyVatId(vatId) : false
  const vat = resolveVat(intent.address.country, intent.customer.business, vatId, vatVerified)
  const vatAmount = pct(net, vat.rate)
  const total = net + vatAmount

  // Der Browser hat gerechnet, wir haben gerechnet. Gehen die Zahlen
  // auseinander, wird nicht der eine oder andere Wert genommen, sondern
  // angehalten: der Kunde soll den Betrag sehen, den er bestätigt.
  if (intent.expected.total !== total) {
    console.warn('[billing-checkout] amount_mismatch', {
      client: intent.expected.total, server: total, user: user.id,
    })
    return json({ status: 'error', message: 'amount_mismatch', retryable: true }, 409, origin)
  }

  // ── 6 · Bestellung anlegen ───────────────────────────────────────────
  const methodLabel = intent.card
    ? `${intent.card.brand} •••• ${intent.card.last4}`
    : intent.sepa
      ? `SEPA ${intent.sepa.iban.slice(0, 4)} •••• ${intent.sepa.iban.slice(-4)}`
      : intent.methodId

  const { data: order, error: orderError } = await db
    .from('orders')
    .insert({
      user_id: user.id,
      idempotency_key: intent.idempotencyKey,
      email: intent.customer.email,
      tier: intent.tier,
      interval: intent.interval,
      seats: intent.seats,
      currency: intent.currency,
      net_amount: net,
      vat_amount: vatAmount,
      total_amount: total,
      vat_rate: vat.rate,
      reverse_charge: vat.reverseCharge,
      method_id: intent.methodId,
      provider: intent.provider,
      promo_code: promoCode,
      trial_days: intent.trialDays,
      status: 'pending',
      method_label: methodLabel,
      billing_snapshot: {
        address: intent.address,
        company: intent.customer.company,
        vatId,
        vatVerified,
        volumePercent,
        promoDiscount,
        consent: intent.consent,
        poNumber: intent.invoice?.poNumber ?? null,
      },
    })
    .select('id')
    .single()

  if (orderError || !order) {
    console.error('[billing-checkout] insert failed', orderError)
    return json({ status: 'error', message: 'Bestellung liess sich nicht anlegen.', retryable: true }, 500, origin)
  }

  // Rechnungsadresse fortschreiben, damit die nächste Bestellung vorausgefüllt
  // ist. Schlägt das fehl, ist die Bestellung trotzdem gültig — deshalb ohne
  // Abbruch.
  await db.from('billing_customers').upsert({
    user_id: user.id,
    email: intent.customer.email,
    full_name: intent.customer.fullName,
    business: intent.customer.business,
    company: intent.customer.company,
    vat_id: vatId,
    vat_verified: vatVerified,
    street: intent.address.street,
    postal_code: intent.address.postalCode,
    city: intent.address.city,
    country: intent.address.country,
    phone: intent.customer.phone,
  })

  // ── 7 · Übergabe an den Anbieter ─────────────────────────────────────
  try {
    const outcome = await handoff(intent, order.id, total, db)
    if (outcome.status === 'redirect' || outcome.status === 'pending') {
      await db.from('orders')
        .update({ status: 'processing', provider_ref: outcome.status === 'redirect' ? outcome.url : null })
        .eq('id', order.id)
    }
    return json(outcome, 200, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db.from('orders').update({ status: 'failed', failure_reason: message }).eq('id', order.id)
    console.error('[billing-checkout] handoff failed', message)
    return json({ status: 'error', message, retryable: true }, 502, origin)
  }
})

type Outcome =
  | { status: 'redirect'; url: string; orderId: string }
  | { status: 'pending'; orderId: string; instructions: { headline: string; rows: { label: string; value: string; copyable?: boolean }[]; note?: string } }

/**
 * Die eigentliche Anbieter-Anbindung.
 *
 * Jeder Zweig ist bewusst klein: eine Session anlegen, die Weiterleitungs-URL
 * zurückgeben, fertig. Der Rest — Bestätigung, Rückbuchung, Verlängerung —
 * läuft über den Webhook, weil nur dort der Anbieter selbst spricht.
 *
 * Fehlt ein Schlüssel, wirft der Zweig. Der Aufrufer setzt die Bestellung dann
 * auf `failed` und der Kunde bekommt eine ehrliche Fehlermeldung, statt einer
 * Freischaltung ohne Zahlung.
 */
async function handoff(
  intent: Intent,
  orderId: string,
  total: number,
  db: ReturnType<typeof createClient>,
): Promise<Outcome> {
  // Verfahren, bei denen kein Anbieter beteiligt ist: wir warten auf das Geld.
  if (intent.methodId === 'bank-transfer' || intent.methodId === 'invoice' || intent.methodId === 'purchase-order') {
    const reference = `OMEGA-${orderId.slice(0, 8).toUpperCase()}`
    await db.from('orders').update({ provider_ref: reference }).eq('id', orderId)
    return {
      status: 'pending',
      orderId,
      instructions: {
        headline: intent.methodId === 'bank-transfer'
          ? 'Überweise den Betrag, dann schalten wir frei'
          : 'Die Rechnung ist unterwegs',
        rows: [
          { label: 'Empfänger', value: 'OMEGA Atelier', copyable: true },
          { label: 'Verwendungszweck', value: reference, copyable: true },
          { label: 'Betrag', value: `${(total / 100).toFixed(2)} ${intent.currency}`, copyable: true },
        ],
        note: intent.methodId === 'bank-transfer'
          ? 'Die Freischaltung läuft automatisch, sobald die Zahlung eingegangen ist.'
          : 'Zahlungsziel 14 Tage. Der Zugang ist ab sofort aktiv.',
      },
    }
  }

  switch (intent.provider) {
    case 'stripe':
      return stripeSession(intent, orderId, total)
    case 'paypal':
    case 'mollie':
    case 'klarna':
    case 'coinbase':
      // Gleiche Form, andere API. Solange der Schlüssel fehlt, ist die Antwort
      // ein Fehler — nicht eine erfundene Erfolgsmeldung.
      throw new Error(`${intent.provider}_not_configured`)
    default:
      throw new Error('unknown_provider')
  }
}

/**
 * Stripe Checkout Session.
 *
 * `payment_method_types` bekommt genau die eine gewählte Methode: der Kunde hat
 * sich bei uns entschieden und soll beim Anbieter nicht noch einmal vor
 * derselben Frage stehen. `mode` folgt dem Intervall — ein Monatsabo ist eine
 * Subscription, ein Jahresabo eine einmalige Zahlung mit eigener Verlängerung.
 */
async function stripeSession(intent: Intent, orderId: string, total: number): Promise<Outcome> {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('stripe_not_configured')

  const methodMap: Record<string, string> = {
    'card': 'card', 'apple-pay': 'card', 'google-pay': 'card', 'link': 'link',
    'sepa-debit': 'sepa_debit', 'revolut-pay': 'revolut_pay', 'amazon-pay': 'amazon_pay',
    'alipay': 'alipay', 'wechat-pay': 'wechat_pay',
  }
  const stripeMethod = methodMap[intent.methodId] ?? 'card'

  const body = new URLSearchParams()
  body.set('mode', intent.interval === 'monthly' ? 'subscription' : 'payment')
  body.set('success_url', `${intent.returnUrl}?order=${orderId}`)
  body.set('cancel_url', intent.cancelUrl)
  body.set('client_reference_id', orderId)
  body.set('customer_email', intent.customer.email)
  body.set('payment_method_types[0]', stripeMethod)
  body.set('locale', 'de')
  body.set('line_items[0][quantity]', String(intent.seats))
  body.set('line_items[0][price_data][currency]', intent.currency.toLowerCase())
  body.set('line_items[0][price_data][unit_amount]', String(Math.round(total / intent.seats)))
  body.set('line_items[0][price_data][product_data][name]', `OMEGA Atelier ${intent.tier === 'max' ? 'Max' : 'Pro'}`)
  if (intent.interval === 'monthly') {
    body.set('line_items[0][price_data][recurring][interval]', 'month')
    if (intent.trialDays > 0) {
      body.set('subscription_data[trial_period_days]', String(intent.trialDays))
    }
  }
  // Ohne diese Zuordnung weiss der Webhook später nicht, welche Bestellung er
  // gerade bestätigt bekommt.
  body.set('metadata[order_id]', orderId)

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Stripes eigener Idempotenzschutz — derselbe Schlüssel wie unserer,
      // damit ein Neuversuch auch dort keine zweite Session erzeugt.
      'Idempotency-Key': intent.idempotencyKey,
    },
    body,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message ?? 'stripe_error')
  return { status: 'redirect', url: data.url as string, orderId }
}
