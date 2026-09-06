/**
 * Checkout.tsx — die Kasse.
 *
 * Hält den Formularzustand und den aktuellen Schritt; jede Regel darüber, was
 * gültig ist und was etwas kostet, kommt aus `lib/billing` (rein und
 * getestet). Diese Datei ordnet an, bewegt den Fokus und schickt ab.
 *
 * ── Eigene Hülle statt Topbar ────────────────────────────────────────────
 * Die App-Navigation fehlt hier bewusst. Jeder Ausgang aus einer Kasse ist ein
 * möglicher Abbruch, und die Topbar bietet acht davon. Es bleiben: das
 * Logo (zurück zur Startseite) und ein deutlicher Weg zurück zu den Tarifen.
 * Das ist keine Falle, sondern Fokus — der Kunde kommt jederzeit raus, aber
 * nicht aus Versehen.
 *
 * ── Fehler erscheinen erst, wenn man weitergeht ─────────────────────────
 * Nicht beim Tippen. „Keine gültige E-Mail" nach dem dritten Zeichen ist
 * korrekt und trotzdem übergriffig — der Satz ist ja noch nicht zu Ende. Erst
 * der Versuch weiterzugehen macht das Formular streng, danach verschwindet
 * jede Meldung sofort, sobald ihr Feld stimmt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2, Lock, ShieldCheck, Undo2 } from 'lucide-react'
import { OmegaMark } from '@/components/layout/OmegaMark'
import { CheckoutStepper } from '@/components/checkout/CheckoutStepper'
import { PlanStep } from '@/components/checkout/PlanStep'
import { AccountStep } from '@/components/checkout/AccountStep'
import { PaymentStep } from '@/components/checkout/PaymentStep'
import { ReviewStep, submitLabel } from '@/components/checkout/ReviewStep'
import { OrderSummary, OrderSummaryBar } from '@/components/checkout/OrderSummary'
import { CheckoutResult } from '@/components/checkout/CheckoutResult'
import { useAuthStore } from '@/store/useAuthStore'
import { useBillingStore } from '@/store/useBillingStore'
import { useUIStore } from '@/store/useUIStore'
import {
  CHECKOUT_STEPS, STEP_META, TRIAL_DAYS, buildIntent, currencyForCountry,
  detectCapabilities, emptyForm, fetchOrderOutcome, findMethod, guessCountry,
  nextStep, parseInterval, parseTier, prevStep, quote, submitCheckout, trialAvailable,
  validateStep,
  type CheckoutForm, type CheckoutOutcome, type CheckoutStep, type FieldErrors,
  type PromoCode,
} from '@/lib/billing'

type Phase =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'done'; outcome: Exclude<CheckoutOutcome, { status: 'redirect' }> }

export function CheckoutPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const pushToast = useUIStore((s) => s.pushToast)

  // Gerätefähigkeiten einmal beim Mounten: ob Apple Pay geht, ändert sich
  // innerhalb einer Sitzung nicht, und die Abfrage bei jedem Render würde die
  // Methodenliste bei jedem Tastendruck neu bauen.
  const capabilities = useMemo(() => detectCapabilities(), [])

  const [form, setForm] = useState<CheckoutForm>(() => {
    const country = guessCountry(typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [])
    return emptyForm({
      // Die Preiskarten der Landing-Page verlinken mit ?plan=…&interval=…
      tier: parseTier(params.get('plan')) ?? 'pro',
      interval: parseInterval(params.get('interval')) ?? 'yearly',
      country,
      currency: currencyForCountry(country),
      email: '',
    })
  })

  const [step, setStep] = useState<CheckoutStep>('plan')
  const [touched, setTouched] = useState<Set<CheckoutStep>>(new Set())
  const [promo, setPromo] = useState<PromoCode | null>(null)
  const returningOrder = params.get('order')
  const [phase, setPhase] = useState<Phase>(
    // Kommt der Besucher mit `?order=` vom Anbieter zurück, wird nicht die
    // Kasse gezeigt, sondern gefragt, was aus der Bestellung geworden ist.
    returningOrder ? { kind: 'submitting' } : { kind: 'form' },
  )
  const refreshEntitlement = useBillingStore((s) => s.refresh)

  const headingRef = useRef<HTMLHeadingElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Beim ersten Rendern wird der Fokus nicht verschoben — sonst springt er beim
  // Laden der Seite weg von dort, wo der Browser ihn hingelegt hat.
  const mounted = useRef(false)

  // Die E-Mail des angemeldeten Kontos gewinnt: das Abo hängt an diesem Konto,
  // und ein zweiter Bezeichner daneben wäre eine Fehlerquelle ohne Nutzen.
  useEffect(() => {
    if (user?.email) setForm((f) => (f.email === user.email ? f : { ...f, email: user.email! }))
  }, [user?.email])

  /**
   * Rückkehr vom Anbieter.
   *
   * Die URL wird nicht geglaubt — sie löst nur die Frage an die Datenbank aus.
   * Steht die Bestellung dort auf `paid`, wird zusätzlich der Tarif neu
   * geholt: sonst zeigte die App noch minutenlang „Free", obwohl das Abo
   * längst läuft.
   */
  useEffect(() => {
    if (!returningOrder) return
    let cancelled = false
    void (async () => {
      const outcome = await fetchOrderOutcome(returningOrder)
      if (cancelled) return
      if (outcome.status === 'redirect') return
      setPhase({ kind: 'done', outcome })
      if (outcome.status === 'succeeded') void refreshEntitlement()
    })()
    return () => { cancelled = true }
  }, [returningOrder, refreshEntitlement])

  const method = form.methodId ? findMethod(form.methodId) : null
  const canTrial = trialAvailable(method)

  const priced = useMemo(() => quote({
    tier: form.tier,
    interval: form.interval,
    currency: form.currency,
    seats: form.seats,
    country: form.country,
    business: form.business,
    vatId: form.vatId,
    promo,
    trialDays: form.trial && canTrial ? TRIAL_DAYS : 0,
  }), [form, promo, canTrial])

  // Nur die Meldungen des aktuellen Schritts, und nur wenn er schon einmal
  // abgeschickt wurde.
  const errors: FieldErrors = useMemo(
    () => (touched.has(step) ? validateStep(step, form) : {}),
    [touched, step, form],
  )

  const patch = useCallback((p: Partial<CheckoutForm>) => setForm((f) => ({ ...f, ...p })), [])

  /**
   * Schrittwechsel. Der Fokus wandert auf die neue Überschrift — ohne das
   * bleibt er beim Weiter-Knopf, und wer mit der Tastatur oder einem
   * Screenreader arbeitet, steht nach dem Wechsel am Ende einer Seite, die er
   * nie gesehen hat.
   */
  const goTo = useCallback((target: CheckoutStep) => {
    setStep(target)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    headingRef.current?.focus()
  }, [step])

  const goNext = () => {
    setTouched((t) => new Set(t).add(step))
    const found = validateStep(step, form)
    if (Object.keys(found).length > 0) {
      // Zum ersten fehlerhaften Feld springen. Eine Meldung, die
      // ausserhalb des Sichtfelds steht, ist keine Meldung.
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      first?.focus()
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    const next = nextStep(step)
    if (next) goTo(next)
  }

  const goBack = () => {
    const back = prevStep(step)
    if (back) goTo(back)
    else navigate('/#preise')
  }

  const submit = async () => {
    setTouched(new Set(CHECKOUT_STEPS))
    // Vor dem Absenden noch einmal alle Schritte: zwischen „Adresse ausgefüllt"
    // und „bestellen" kann das Land gewechselt und die Zahlungsart damit
    // ungültig geworden sein.
    for (const s of CHECKOUT_STEPS) {
      const found = validateStep(s, form)
      if (Object.keys(found).length > 0) { goTo(s); return }
    }

    if (!user) {
      // Nach der Anmeldung wieder hierher — mit demselben Tarif.
      navigate(`/login?next=${encodeURIComponent(`/checkout?plan=${form.tier}&interval=${form.interval}`)}`)
      return
    }

    setPhase({ kind: 'submitting' })
    const base = `${window.location.origin}${import.meta.env.BASE_URL}`
    const outcome = await submitCheckout(
      buildIntent(form, priced, {
        returnUrl: `${base}checkout/done`,
        cancelUrl: `${base}checkout`,
      }),
    )

    if (outcome.status === 'redirect') {
      // Der Anbieter übernimmt. Kein State-Update mehr danach — die Seite ist
      // gleich weg.
      window.location.assign(outcome.url)
      return
    }
    setPhase({ kind: 'done', outcome })
    if (outcome.status === 'error') {
      pushToast({ kind: 'error', title: 'Zahlung fehlgeschlagen', description: outcome.message })
    }
  }

  // ── Ergebnisseite ──────────────────────────────────────────────────
  if (phase.kind === 'done') {
    return (
      <Frame>
        <CheckoutResult
          outcome={phase.outcome}
          tier={form.tier}
          onRetry={() => { setPhase({ kind: 'form' }); goTo('payment') }}
        />
      </Frame>
    )
  }

  const meta = STEP_META[step]
  const busy = phase.kind === 'submitting'
  const isLast = step === 'review'

  const primaryAction = (
    <button
      type="submit"
      disabled={busy}
      className="btn btn-primary w-full !min-h-12 !text-[0.9375rem]"
    >
      {busy
        ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Wird gesendet…</>
        : isLast
          ? <><Lock size={15} aria-hidden="true" /> {submitLabel(priced)}</>
          : <>Weiter <ArrowRight size={15} aria-hidden="true" /></>}
    </button>
  )

  return (
    <Frame scrollRef={scrollRef}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (isLast) void submit(); else goNext() }}
        className="mx-auto w-full max-w-6xl px-4 pb-40 pt-6 md:px-8 md:pb-16 md:pt-10"
        noValidate
      >
        <CheckoutStepper current={step} form={form} onJump={goTo} />

        <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {/* ── Der Schritt ─────────────────────────────────────────── */}
          <div className="min-w-0">
            <header className="mb-7">
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="font-display text-[1.625rem] leading-tight outline-none md:text-[2rem]"
              >
                {meta.headline}
              </h1>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[color:var(--muted)]">
                {meta.hint}
              </p>
            </header>

            <div key={step} className="co-step-body">
              {step === 'plan' && (
                <PlanStep form={form} errors={errors} onChange={patch} trialOffered={canTrial} />
              )}
              {step === 'account' && (
                <AccountStep form={form} errors={errors} onChange={patch} lockedEmail={user?.email ?? null} />
              )}
              {step === 'payment' && (
                <PaymentStep form={form} errors={errors} quote={priced} capabilities={capabilities} onChange={patch} />
              )}
              {step === 'review' && (
                <ReviewStep
                  form={form}
                  errors={errors}
                  quote={priced}
                  onChange={patch}
                  onJump={goTo}
                  promo={promo}
                  onPromo={(p, code) => { setPromo(p); patch({ promoCode: code }) }}
                />
              )}
            </div>

            {/* ── Navigation (breit) ────────────────────────────────── */}
            <div className="mt-10 hidden items-center justify-between gap-4 border-t border-[color:var(--border)] pt-6 lg:flex">
              <button type="button" onClick={goBack} className="btn btn-ghost !min-h-11">
                <ArrowLeft size={15} aria-hidden="true" />
                {step === 'plan' ? 'Zurück zu den Tarifen' : `Zurück zu ${STEP_META[prevStep(step)!].label}`}
              </button>
              {!isLast && <div className="w-48">{primaryAction}</div>}
            </div>

            {isLast && (
              <p className="mt-6 hidden text-[0.75rem] leading-relaxed text-[color:var(--muted)] lg:block">
                Mit dem Klick auf „Kostenpflichtig bestellen" schliesst du einen kostenpflichtigen
                Vertrag. Alle Preise inkl. gesetzlicher Umsatzsteuer, sofern ausgewiesen.
              </p>
            )}
          </div>

          {/* ── Zusammenfassung (breit) ─────────────────────────────── */}
          <aside className="hidden lg:block">
            <div className="sticky top-6">
              <OrderSummary
                quote={priced}
                tier={form.tier}
                interval={form.interval}
                promoLabel={promo?.label}
                onRemovePromo={promo ? () => { setPromo(null); patch({ promoCode: '' }) } : undefined}
                action={isLast ? primaryAction : undefined}
              />
              <p className="co-trust mt-4 justify-center">
                <ShieldCheck size={12} aria-hidden="true" />
                14 Tage Widerrufsrecht · monatlich kündbar
              </p>
            </div>
          </aside>
        </div>

        {/* ── Leiste (schmal) ──────────────────────────────────────── */}
        <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
          <OrderSummaryBar
            quote={priced}
            tier={form.tier}
            interval={form.interval}
            action={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  aria-label="Einen Schritt zurück"
                  className="btn btn-ghost !min-h-11 !px-3"
                >
                  <Undo2 size={16} aria-hidden="true" />
                </button>
                <div className="w-[10.5rem]">{primaryAction}</div>
              </div>
            }
          />
        </div>
      </form>
    </Frame>
  )
}

/**
 * Die Hülle: eigener Scroll-Container (html/body sind global auf
 * `overflow: hidden`), ein Sprunglink für die Tastatur und eine Kopfzeile,
 * die genau zwei Wege anbietet.
 */
function Frame({ children, scrollRef }: {
  children: React.ReactNode
  scrollRef?: React.RefObject<HTMLDivElement>
}) {
  return (
    <div ref={scrollRef} className="omega-noise omega-scroll h-screen overflow-y-auto">
      <a
        href="#checkout-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-sm)] focus:bg-[color:var(--accent)] focus:px-4 focus:py-2 focus:text-[color:var(--accent-contrast)]"
      >
        Zum Formular springen
      </a>

      <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-[color:var(--bg)]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-[var(--radius-sm)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
          >
            <OmegaMark size={26} />
            <span className="font-display text-[0.9375rem] font-semibold tracking-tight">OMEGA Atelier</span>
          </Link>
          <span className="co-trust">
            <Lock size={12} aria-hidden="true" />
            <span className="hidden sm:inline">Gesicherte Bestellung</span>
          </span>
        </div>
      </header>

      <main id="checkout-main">{children}</main>
    </div>
  )
}
