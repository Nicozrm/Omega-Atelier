// ══════════════════════════════════════════════════════════════════════════
//  billing-webhook — der Anbieter meldet, was mit dem Geld passiert ist.
//
//  Das hier ist die einzige Stelle im ganzen System, die ein Abo freischaltet.
//  Weder der Browser noch die Rückkehr-URL nach dem Redirect dürfen das: wer
//  nach der Zahlung zurückkommt, kann auch nur den Zurück-Knopf gedrückt haben,
//  und `?success=true` ist eine Zeichenkette, die jeder tippen kann.
//
//  ── Drei Regeln ─────────────────────────────────────────────────────────
//
//  1. **Signatur zuerst.** Vor der Prüfung wird nichts geparst, nichts
//     geschrieben, nichts geloggt. Der Endpunkt ist öffentlich erreichbar —
//     ohne Signaturprüfung wäre er ein Formular zum Verschenken von Abos.
//
//  2. **Zweimal ist normal.** Jeder Anbieter garantiert „mindestens einmal".
//     `payment_events.provider_event_id` ist eindeutig; ein bereits
//     verarbeitetes Ereignis wird mit 200 quittiert und sonst ignoriert.
//     Antwortet man mit einem Fehler, versucht es der Anbieter tagelang weiter.
//
//  3. **Erst protokollieren, dann handeln.** Die Rohfassung landet in
//     `payment_events`, bevor daraus ein Abo wird. Wenn später jemand fragt,
//     warum ein Konto Max hat, steht die Antwort dort — unverändert und nicht
//     von unserem Code interpretiert.
//
//  ── Deployment ──────────────────────────────────────────────────────────
//      supabase functions deploy billing-webhook --no-verify-jwt
//
//  `--no-verify-jwt` ist hier Pflicht und kein Leichtsinn: Stripe schickt
//  keinen Supabase-JWT, sondern seine eigene Signatur. Die Authentifizierung
//  macht `verifyStripeSignature`, nicht die Plattform.
//
//  Secrets:
//      STRIPE_WEBHOOK_SECRET   whsec_… (Dashboard → Developers → Webhooks)
//      SUPABASE_SERVICE_ROLE_KEY
// ══════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const encoder = new TextEncoder()

/**
 * Zeitkonstanter Vergleich.
 *
 * Ein `===` auf Signaturen verrät über die Laufzeit, ab welchem Zeichen zwei
 * Zeichenketten auseinandergehen — mit genug Versuchen lässt sich eine gültige
 * Signatur Zeichen für Zeichen erraten. Dieser Vergleich läuft immer über die
 * volle Länge.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Stripe-Signatur prüfen (`Stripe-Signature: t=…,v1=…`).
 *
 * Signiert wird `"<timestamp>.<rohe Nutzlast>"` mit HMAC-SHA256. Der Zeitstempel
 * gehört zwingend dazu: ohne ihn liesse sich ein früher abgefangenes, gültig
 * signiertes Ereignis beliebig oft erneut einspielen. Fünf Minuten Toleranz
 * sind Stripes eigene Empfehlung.
 */
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=', 2) as [string, string]),
  )
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`))
  return timingSafeEqual(toHex(mac), signature)
}

/** Ende des bezahlten Zeitraums. Monatssprünge werden gekappt (31.01. → 28.02.). */
function periodEnd(from: Date, interval: 'monthly' | 'yearly'): Date {
  const d = new Date(from.getTime())
  const day = d.getDate()
  if (interval === 'yearly') d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1)
  if (d.getDate() !== day) d.setDate(0)
  return d
}

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Nur POST.', { status: 405 })

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const signature = req.headers.get('stripe-signature')
  const raw = await req.text()

  // ── Regel 1: Signatur zuerst ─────────────────────────────────────────
  if (!secret || !signature || !(await verifyStripeSignature(raw, signature, secret))) {
    // Bewusst wortkarg: ein Angreifer soll nicht erfahren, ob das Secret fehlt
    // oder die Signatur nicht passt.
    return new Response('invalid signature', { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(raw) as StripeEvent
  } catch {
    return new Response('invalid payload', { status: 400 })
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const object = event.data?.object ?? {}
  const metadata = (object.metadata ?? {}) as Record<string, string>
  const orderId = metadata.order_id ?? (object.client_reference_id as string | undefined) ?? null

  // ── Regel 3: erst protokollieren ─────────────────────────────────────
  const { error: logError } = await db.from('payment_events').insert({
    provider: 'stripe',
    provider_event_id: event.id,
    event_type: event.type,
    order_id: orderId,
    payload: event as unknown as Record<string, unknown>,
  })

  // ── Regel 2: zweimal ist normal ──────────────────────────────────────
  // 23505 = unique_violation: dieses Ereignis ist schon durch. 200 quittieren,
  // sonst versucht Stripe es tagelang erneut.
  if (logError && (logError as { code?: string }).code === '23505') {
    return new Response('duplicate ignored', { status: 200 })
  }
  if (logError) {
    console.error('[billing-webhook] log failed', logError)
    // 500 ist hier richtig: Stripe soll es erneut senden, damit nichts verloren
    // geht.
    return new Response('log failed', { status: 500 })
  }

  try {
    await handle(event, orderId, db)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[billing-webhook] handler failed', event.type, message)
    await db.from('payment_events').update({ error: message }).eq('provider_event_id', event.id)
    return new Response('handler failed', { status: 500 })
  }

  await db.from('payment_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('provider_event_id', event.id)

  return new Response('ok', { status: 200 })
})

async function handle(
  event: StripeEvent,
  orderId: string | null,
  db: ReturnType<typeof createClient>,
): Promise<void> {
  const object = event.data.object

  switch (event.type) {
    // Bezahlt — die Bestellung wird zum Abo.
    case 'checkout.session.completed':
    case 'invoice.paid': {
      if (!orderId) return
      const { data: order } = await db
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle()
      if (!order || !order.user_id) return
      if (order.status === 'paid') return // schon erledigt

      await db.from('orders').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        provider_ref: (object.subscription as string) ?? (object.id as string) ?? order.provider_ref,
      }).eq('id', orderId)

      const now = new Date()
      const trialEnds = order.trial_days > 0
        ? new Date(now.getTime() + order.trial_days * 86_400_000)
        : null

      // Ein laufendes Abo wird ersetzt, nicht ergänzt: der Teilindex in der
      // Migration lässt ohnehin nur eines zu, und ein Wechsel Pro → Max ist
      // genau das — dasselbe Abo mit anderem Tarif.
      await db.from('subscriptions')
        .update({ status: 'expired' })
        .eq('user_id', order.user_id)
        .in('status', ['trialing', 'active', 'past_due'])

      await db.from('subscriptions').insert({
        user_id: order.user_id,
        tier: order.tier,
        status: trialEnds ? 'trialing' : 'active',
        interval: order.interval,
        seats: order.seats,
        currency: order.currency,
        provider: order.provider,
        provider_ref: (object.subscription as string) ?? null,
        order_id: order.id,
        current_period_start: now.toISOString(),
        current_period_end: (trialEnds ?? periodEnd(now, order.interval as 'monthly' | 'yearly')).toISOString(),
        trial_ends_at: trialEnds?.toISOString() ?? null,
      })

      // Gutschein erst jetzt als eingelöst zählen — nicht beim Anlegen der
      // Bestellung. Sonst verbrauchen abgebrochene Checkouts das Kontingent.
      if (order.promo_code) {
        await db.rpc('billing_redeem_promo', { p_code: order.promo_code })
      }
      return
    }

    // Verlängerung fehlgeschlagen — Zugang bleibt vorerst, Status wandert.
    case 'invoice.payment_failed': {
      const ref = (object.subscription as string) ?? null
      if (!ref) return
      await db.from('subscriptions').update({ status: 'past_due' }).eq('provider_ref', ref)
      return
    }

    // Abo beim Anbieter beendet.
    case 'customer.subscription.deleted': {
      const ref = object.id as string
      await db.from('subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('provider_ref', ref)
      return
    }

    // Verlängert: neuer Zeitraum, Status wieder aktiv.
    case 'customer.subscription.updated': {
      const ref = object.id as string
      const periodEndUnix = object.current_period_end as number | undefined
      const cancelAtEnd = Boolean(object.cancel_at_period_end)
      const stripeStatus = object.status as string | undefined
      await db.from('subscriptions').update({
        status: stripeStatus === 'past_due' ? 'past_due' : stripeStatus === 'trialing' ? 'trialing' : 'active',
        cancel_at_period_end: cancelAtEnd,
        ...(periodEndUnix ? { current_period_end: new Date(periodEndUnix * 1000).toISOString() } : {}),
      }).eq('provider_ref', ref)
      return
    }

    // Rückerstattung: Zugang endet, die Bestellung bleibt als Beleg stehen.
    case 'charge.refunded': {
      if (!orderId) return
      await db.from('orders').update({ status: 'refunded' }).eq('id', orderId)
      const { data: sub } = await db.from('subscriptions').select('id').eq('order_id', orderId).maybeSingle()
      if (sub) await db.from('subscriptions').update({ status: 'expired' }).eq('id', sub.id)
      return
    }

    default:
      // Unbekannte Ereignisse sind kein Fehler — Stripe schickt viele, die uns
      // nichts angehen. Sie stehen protokolliert in `payment_events`.
      return
  }
}
