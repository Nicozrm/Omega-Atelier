/**
 * ReviewStep.tsx — der letzte Blick, der Gutschein und die Einwilligungen.
 *
 * Die Zusammenfassung wiederholt Adresse und Zahlungsart nicht aus Höflichkeit,
 * sondern weil ein Tippfehler in der IBAN hier noch nichts kostet und zehn
 * Sekunden später eine Rücklastschrift. Jede Zeile hat deshalb ein „Ändern",
 * das genau zu dem Schritt zurückspringt, aus dem sie stammt — zurück und
 * wieder vor, ohne dass etwas verloren geht.
 *
 * ── Die beiden Häkchen ───────────────────────────────────────────────────
 * AGB und Widerrufsverzicht sind bewusst **nicht** vorangekreuzt und werden
 * auch nicht zu einem Satz zusammengefasst. Eine vorangekreuzte Einwilligung
 * ist keine (EuGH C-673/17), und wer sofort freigeschaltet werden will, muss
 * das ausdrücklich sagen — § 356 Abs. 5 BGB verlangt genau das, sonst läuft
 * die Widerrufsfrist vierzehn Tage lang neben einem laufenden Abo her.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Pencil, Tag, X } from 'lucide-react'
import {
  findMethod, formatMoney, lookupPromo, maskIban, planName, normalizePromoCode,
  type CheckoutForm, type CheckoutStep, type FieldErrors, type PromoCode, type Quote,
} from '@/lib/billing'
import { MethodMark } from './MethodMark'
import { CheckField } from './Field'

interface Props {
  form: CheckoutForm
  errors: FieldErrors
  quote: Quote
  onChange: (patch: Partial<CheckoutForm>) => void
  onJump: (step: CheckoutStep) => void
  promo: PromoCode | null
  onPromo: (promo: PromoCode | null, code: string) => void
}

export function ReviewStep({ form, errors, quote, onChange, onJump, promo, onPromo }: Props) {
  const method = form.methodId ? findMethod(form.methodId) : null

  return (
    <div className="space-y-8">
      {/* ── Was, wohin, womit ───────────────────────────────────────── */}
      <dl className="divide-y divide-[color:var(--border)] overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border-strong)] bg-[color:var(--surface)]">
        <ReviewRow label="Tarif" onEdit={() => onJump('plan')}>
          <span className="font-medium">OMEGA {planName(form.tier)}</span>
          <span className="text-[color:var(--muted)]">
            {' · '}{form.interval === 'yearly' ? 'jährlich' : 'monatlich'}
            {form.seats > 1 && ` · ${form.seats} Arbeitsplätze`}
            {quote.trialDays > 0 && ` · ${quote.trialDays} Tage Testphase`}
          </span>
        </ReviewRow>

        <ReviewRow label="Rechnung an" onEdit={() => onJump('account')}>
          <span className="block">{form.business && form.company ? form.company : form.fullName}</span>
          <span className="block text-[color:var(--muted)]">
            {form.street}, {form.postalCode} {form.city}, {form.country}
          </span>
          <span className="block text-[color:var(--muted)]">{form.email}</span>
          {form.business && form.vatId && (
            <span className="block text-[color:var(--muted)]">USt-IdNr. {form.vatId}</span>
          )}
        </ReviewRow>

        <ReviewRow label="Zahlung" onEdit={() => onJump('payment')}>
          {method ? (
            <span className="flex items-center gap-2.5">
              <MethodMark method={method} size="sm" />
              <span>
                <span className="block font-medium">{method.label}</span>
                <span className="block text-[0.8125rem] text-[color:var(--muted)]">
                  {method.form === 'card' && form.card.number
                    ? `•••• ${form.card.number.replace(/\D/g, '').slice(-4)} · gültig bis ${form.card.expiry}`
                    : method.form === 'sepa' && form.sepa.iban
                      ? maskIban(form.sepa.iban)
                      : method.blurb}
                </span>
              </span>
            </span>
          ) : (
            <span className="text-[color:var(--warn)]">Noch keine Zahlungsart gewählt</span>
          )}
        </ReviewRow>
      </dl>

      {/* ── Gutschein ───────────────────────────────────────────────── */}
      <PromoField form={form} promo={promo} onPromo={onPromo} />

      {/* ── Einwilligungen ──────────────────────────────────────────── */}
      <div className="space-y-3">
        <CheckField
          checked={form.acceptTerms}
          onChange={(acceptTerms) => onChange({ acceptTerms })}
          error={errors.acceptTerms}
          title={
            <>
              Ich akzeptiere die{' '}
              <Link to="/agb" target="_blank" className="underline underline-offset-2 hover:text-[color:var(--accent-bright)]">AGB</Link>
              {' '}und die{' '}
              <Link to="/datenschutz" target="_blank" className="underline underline-offset-2 hover:text-[color:var(--accent-bright)]">Datenschutzerklärung</Link>.
            </>
          }
        />

        <CheckField
          checked={form.acceptImmediateStart}
          onChange={(acceptImmediateStart) => onChange({ acceptImmediateStart })}
          error={errors.acceptImmediateStart}
          title="Sofort freischalten"
          description="Ich verlange ausdrücklich, dass ihr vor Ablauf der Widerrufsfrist beginnt. Mir ist bekannt, dass mein Widerrufsrecht mit vollständiger Vertragserfüllung erlischt."
        />

        <CheckField
          checked={form.newsletter}
          onChange={(newsletter) => onChange({ newsletter })}
          title="Produktneuigkeiten per E-Mail"
          description="Ein paar Mal im Jahr, wenn es wirklich etwas Neues gibt. Abmeldung mit einem Klick, kein Verkauf deiner Adresse."
        />
      </div>
    </div>
  )
}

function ReviewRow({ label, onEdit, children }: {
  label: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-4 p-4 md:p-5">
      <dt className="w-24 shrink-0 pt-0.5 text-[0.78125rem] uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[0.875rem] leading-relaxed">{children}</dd>
      <button
        type="button"
        onClick={onEdit}
        className="flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[0.8125rem] text-[color:var(--accent-bright)] transition-colors hover:bg-[rgba(199,162,78,0.10)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
      >
        <Pencil size={12} aria-hidden="true" />
        <span>Ändern</span>
        <span className="sr-only"> — {label}</span>
      </button>
    </div>
  )
}

/**
 * Gutscheinfeld.
 *
 * Zugeklappt, bis jemand darauf tippt. Ein offenes Feld mit der Aufschrift
 * „Gutscheincode" erzeugt bei jedem, der keinen hat, das Gefühl, zu viel zu
 * zahlen — und schickt ihn in einem neuen Tab auf die Suche, aus der er
 * oft nicht zurückkommt.
 */
function PromoField({ form, promo, onPromo }: {
  form: CheckoutForm
  promo: PromoCode | null
  onPromo: (promo: PromoCode | null, code: string) => void
}) {
  const [open, setOpen] = useState(Boolean(form.promoCode))
  const [code, setCode] = useState(form.promoCode)
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'error'; message?: string }>({ kind: 'idle' })

  const redeem = async () => {
    const normalized = normalizePromoCode(code)
    if (!normalized) return
    setState({ kind: 'busy' })
    const result = await lookupPromo(normalized, {
      tier: form.tier, interval: form.interval, currency: form.currency,
    })
    if (result.status === 'valid') {
      onPromo(result.promo, normalized)
      setState({ kind: 'idle' })
    } else {
      onPromo(null, '')
      setState({ kind: 'error', message: result.message })
    }
  }

  if (promo) {
    return (
      <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[color:var(--success)] bg-[color:color-mix(in_srgb,var(--success)_8%,transparent)] p-3.5">
        <Tag size={15} className="shrink-0 text-[color:var(--success)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[0.875rem]">
          <span className="block font-medium">{promo.label}</span>
          <span className="block font-mono text-[0.75rem] uppercase text-[color:var(--muted)]">{promo.code}</span>
        </span>
        <button
          type="button"
          onClick={() => { onPromo(null, ''); setCode(''); setState({ kind: 'idle' }) }}
          className="flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[0.8125rem] text-[color:var(--muted)] transition-colors hover:text-[color:var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        >
          <X size={12} aria-hidden="true" /> Entfernen
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[0.875rem] text-[color:var(--accent-bright)] transition-colors hover:text-[color:var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
      >
        <Tag size={14} aria-hidden="true" /> Ich habe einen Gutscheincode
      </button>
    )
  }

  return (
    <div>
      <label htmlFor="promo-code" className="co-label">Gutscheincode</label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="promo-code"
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setState({ kind: 'idle' }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void redeem() } }}
          aria-invalid={state.kind === 'error' || undefined}
          aria-describedby={state.kind === 'error' ? 'promo-error' : undefined}
          placeholder="ATELIER20"
          autoComplete="off"
          spellCheck={false}
          className="co-input font-mono uppercase tracking-wider"
        />
        <button
          type="button"
          onClick={() => void redeem()}
          disabled={state.kind === 'busy' || !code.trim()}
          className="btn btn-outline shrink-0 !min-h-12 !px-5"
        >
          {state.kind === 'busy'
            ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Prüfen</>
            : <><Check size={14} aria-hidden="true" /> Einlösen</>}
        </button>
      </div>
      {state.kind === 'error' && (
        <p id="promo-error" role="alert" className="co-error mt-1.5">{state.message}</p>
      )}
    </div>
  )
}

/** Der Betrag im Kaufknopf — als eigene Funktion, weil ihn zwei Stellen zeigen. */
export function submitLabel(quote: Quote): string {
  if (quote.trialDays > 0) return `Testphase starten · heute ${formatMoney(0, quote.currency)}`
  return `Kostenpflichtig bestellen · ${formatMoney(quote.total, quote.currency, { forceDecimals: true })}`
}
