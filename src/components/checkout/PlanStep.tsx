/**
 * PlanStep.tsx — Tarif, Intervall, Arbeitsplätze.
 *
 * Der erste Schritt entscheidet über alles Weitere: das Intervall bestimmt,
 * welche Zahlungsarten in Schritt drei überhaupt erscheinen (siehe
 * `methods.ts`), und die Anzahl der Plätze über den Mengenrabatt. Deshalb steht
 * beides hier vorne und nicht als Nachgedanke neben der Summe.
 *
 * Der Intervall-Umschalter zeigt die Ersparnis in Euro, nicht in Prozent.
 * „Spare 17 %" muss man umrechnen, „spare 18 €" nicht — und es ist derselbe
 * Betrag.
 */

import { Check, Sparkles, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PLANS, type Tier } from '@/lib/entitlements'
import {
  MAX_SELF_SERVE_SEATS, TRIAL_DAYS, formatMoney, quote, unitPrice,
  type BillingInterval, type CheckoutForm, type CurrencyCode, type FieldErrors,
} from '@/lib/billing'
import { CheckField, SeatStepper } from './Field'
import { RadioGroup } from './RadioGroup'

interface Props {
  form: CheckoutForm
  errors: FieldErrors
  onChange: (patch: Partial<CheckoutForm>) => void
  /** Darf zum gewählten Zahlverfahren überhaupt getestet werden? */
  trialOffered: boolean
}

const PAID_TIERS: Exclude<Tier, 'free'>[] = ['pro', 'max']

export function PlanStep({ form, errors, onChange, trialOffered }: Props) {
  return (
    <div className="space-y-8">
      {/* ── Intervall ───────────────────────────────────────────────── */}
      <IntervalToggle
        value={form.interval}
        tier={form.tier}
        currency={form.currency}
        seats={form.seats}
        onChange={(interval) => onChange({ interval })}
      />

      {/* ── Tarif ───────────────────────────────────────────────────── */}
      <fieldset>
        <legend className="label-xs mb-3">Tarif</legend>
        <RadioGroup
          label="Tarif"
          describedBy={errors.tier ? 'plan-tier-error' : undefined}
          className="grid gap-3 md:grid-cols-2"
        >
          {PAID_TIERS.map((tier) => (
            <TierCard
              key={tier}
              tier={tier}
              selected={form.tier === tier}
              interval={form.interval}
              currency={form.currency}
              onSelect={() => onChange({ tier })}
            />
          ))}
        </RadioGroup>
        {errors.tier && (
          <p id="plan-tier-error" role="alert" className="co-error mt-2">{errors.tier}</p>
        )}
      </fieldset>

      {/* ── Arbeitsplätze ───────────────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-2">
        <SeatStepper
          label="Arbeitsplätze"
          value={form.seats}
          min={1}
          max={MAX_SELF_SERVE_SEATS}
          error={errors.seats}
          onChange={(seats) => onChange({ seats })}
          hint={
            form.seats >= 5
              ? `Mengenrabatt greift — ab 5 · 10 · 25 · 50 Plätzen wird es günstiger.`
              : 'Ab fünf Plätzen wird es je Platz günstiger.'
          }
        />
        <div className="hidden items-end pb-1 md:flex">
          <p className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[color:var(--muted)]">
            <Users size={14} className="mt-[2px] shrink-0" aria-hidden="true" />
            Jeder Platz ist ein eigener Zugang mit eigenen Plänen. Verteilen und
            entziehen kannst du sie später jederzeit in den Einstellungen.
          </p>
        </div>
      </div>

      {/* ── Testphase ───────────────────────────────────────────────── */}
      {TRIAL_DAYS > 0 && (
        <CheckField
          checked={form.trial && trialOffered}
          onChange={(trial) => onChange({ trial })}
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-[color:var(--accent-bright)]" aria-hidden="true" />
              {TRIAL_DAYS} Tage kostenlos testen
            </span>
          }
          description={
            trialOffered
              ? 'Heute wird nichts abgebucht. Kündigst du innerhalb der Testphase, entstehen keine Kosten.'
              : 'Steht erst zur Verfügung, wenn du eine Zahlungsart wählst, von der wir automatisch abbuchen dürfen — Karte, SEPA oder PayPal.'
          }
        />
      )}
    </div>
  )
}

/**
 * Monatlich oder jährlich.
 *
 * Als echte Radiogruppe und nicht als Schalter: ein Toggle behauptet „an/aus",
 * hier stehen aber zwei gleichrangige Möglichkeiten nebeneinander. Die
 * Pfeiltasten-Bedienung kommt aus `RadioGroup` — `role="radio"` allein bringt
 * kein Verhalten mit, nur eine Ansage.
 */
function IntervalToggle({
  value, tier, currency, seats, onChange,
}: {
  value: BillingInterval
  tier: Tier
  currency: CurrencyCode
  seats: number
  onChange: (i: BillingInterval) => void
}) {
  const yearly = quote({ tier, interval: 'yearly', currency, seats, country: 'DE', business: false })
  const savings = yearly.yearlySavings

  const options: { id: BillingInterval; label: string; sub: string }[] = [
    { id: 'monthly', label: 'Monatlich', sub: 'Volle Flexibilität' },
    { id: 'yearly', label: 'Jährlich', sub: savings > 0 ? `${formatMoney(savings, currency)} sparen` : 'Zwei Monate geschenkt' },
  ]

  return (
    <fieldset>
      <legend className="label-xs mb-3">Abrechnung</legend>
      <RadioGroup label="Abrechnungsintervall" className="grid grid-cols-2 gap-3">
        {options.map((o) => {
          const active = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.id)}
              className="co-tile items-center justify-between !py-3.5"
            >
              <span className="min-w-0">
                <span className="block text-[0.9375rem] font-medium">{o.label}</span>
                <span className={cn(
                  'mt-0.5 block text-[0.78125rem]',
                  o.id === 'yearly' && savings > 0 ? 'text-[color:var(--success)]' : 'text-[color:var(--muted)]',
                )}>
                  {o.sub}
                </span>
              </span>
              <span className="co-dot" aria-hidden="true">
                {active && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}

/** Eine Tarifkarte mit Preis je Platz und den drei stärksten Argumenten. */
function TierCard({
  tier, selected, interval, currency, onSelect,
}: {
  tier: Exclude<Tier, 'free'>
  selected: boolean
  interval: BillingInterval
  currency: CurrencyCode
  onSelect: () => void
}) {
  const spec = PLANS.find((p) => p.tier === tier)
  const price = unitPrice(tier, interval, currency)
  // Beim Jahresabo wird der Monatswert gezeigt: zwei Preise mit
  // unterschiedlichem Bezug nebeneinander lassen sich nicht vergleichen.
  const perMonth = interval === 'yearly' ? Math.round(price / 12) : price

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="co-tile flex-col !gap-0 !p-5"
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span>
          <span className="font-display block text-[1.0625rem] font-semibold">{spec?.name ?? tier}</span>
          <span className="mt-0.5 block text-[0.8125rem] text-[color:var(--muted)]">{spec?.tagline}</span>
        </span>
        <span className="co-dot mt-0.5" aria-hidden="true">
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      </span>

      <span className="mt-4 flex items-baseline gap-1.5">
        <span className="co-amount font-display text-[2rem] font-semibold leading-none">
          {formatMoney(perMonth, currency)}
        </span>
        <span className="text-[0.8125rem] text-[color:var(--muted)]">/ Platz / Monat</span>
      </span>
      {interval === 'yearly' && (
        <span className="mt-1 block text-[0.75rem] text-[color:var(--muted)]">
          {formatMoney(price, currency)} jährlich abgerechnet
        </span>
      )}

      <span className="mt-4 w-full space-y-1.5 border-t border-[color:var(--border)] pt-4">
        {(spec?.points ?? []).slice(0, 4).map((point) => (
          <span key={point} className="flex items-start gap-2 text-left text-[0.8125rem] leading-snug">
            <Check size={13} className="mt-[3px] shrink-0 text-[color:var(--accent-bright)]" aria-hidden="true" />
            <span className={point.startsWith('Alles aus') ? 'text-[color:var(--muted)]' : ''}>{point}</span>
          </span>
        ))}
      </span>
    </button>
  )
}
