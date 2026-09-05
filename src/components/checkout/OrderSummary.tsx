/**
 * OrderSummary.tsx — was gekauft wird und was es kostet.
 *
 * Steht auf dem Desktop rechts und bleibt beim Scrollen stehen; auf dem Telefon
 * sitzt sie als aufklappbare Leiste am unteren Rand. Beides aus demselben
 * Grund: **die Summe darf nie aus dem Blick geraten.** Ein Kunde, der zum
 * Nachsehen scrollen muss, was er gerade bestellt, wird misstrauisch — und
 * Misstrauen an der Kasse endet im Abbruch.
 *
 * Jede Zeile stammt aus `quote()`. Die Komponente rechnet nichts; sie ordnet
 * an. Sobald hier eine eigene Multiplikation stünde, gäbe es zwei Wahrheiten
 * über denselben Betrag.
 */

import { useState } from 'react'
import { Check, ChevronDown, Info, Lock, Sparkles, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  formatMoney, planName, nextChargeDate,
  type BillingInterval, type Quote,
} from '@/lib/billing'
import type { Tier } from '@/lib/entitlements'

interface Props {
  quote: Quote
  tier: Tier
  interval: BillingInterval
  /** Eingelöster Gutschein — zum Entfernen. */
  promoLabel?: string | null
  onRemovePromo?: () => void
  /** Der Kaufknopf, damit er auf dem Telefon in der Leiste steckt. */
  action?: React.ReactNode
  now?: Date
}

/** Ein Vorteil des Tarifs, kurz — drei genügen, der Rest steht auf der Preisseite. */
const HIGHLIGHTS: Record<Exclude<Tier, 'free'>, string[]> = {
  pro: ['Auto-Möblieren & Etagen-Stack', 'Sonnenstudie mit echten Schatten', 'Cloud-Versionen & Teilen'],
  max: ['Alles aus Pro', 'AI Composer & Bau-Studio', 'Live-Connectoren & Sprachsteuerung'],
}

export function OrderSummary({ quote, tier, interval, promoLabel, onRemovePromo, action, now = new Date() }: Props) {
  const paid = tier !== 'free'
  const charge = nextChargeDate(now, interval, quote.trialDays)
  const dateText = charge.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="co-summary p-5 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="label-xs">Deine Bestellung</div>
          <h2 className="font-display mt-1 text-xl leading-tight">
            OMEGA {planName(tier)}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-[color:var(--muted)]">
            {interval === 'yearly' ? 'Jahresabo' : 'Monatsabo'}
            {quote.seats > 1 && ` · ${quote.seats} Arbeitsplätze`}
          </p>
        </div>
        {quote.yearlySavings > 0 && (
          <span className="chip shrink-0 !border-[color:var(--accent)] !bg-[rgba(199,162,78,0.16)]">
            −{formatMoney(quote.yearlySavings, quote.currency)}
          </span>
        )}
      </div>

      {paid && (
        <ul className="mt-4 space-y-1.5 border-t border-[color:var(--border)] pt-4">
          {HIGHLIGHTS[tier as Exclude<Tier, 'free'>].map((h) => (
            <li key={h} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-[color:var(--muted-strong)]">
              <Check size={13} className="mt-[3px] shrink-0 text-[color:var(--accent-bright)]" aria-hidden="true" />
              {h}
            </li>
          ))}
        </ul>
      )}

      {/* ── Die Zeilen ─────────────────────────────────────────────── */}
      <dl className="mt-5 space-y-2.5 border-t border-[color:var(--border)] pt-5">
        {quote.lines.map((line) => {
          const isDiscount = line.amount < 0
          return (
            <div key={line.id} className="co-summary-row">
              <dt className="min-w-0 text-[color:var(--muted-strong)]">
                <span className={cn('flex items-center gap-1.5', isDiscount && 'text-[color:var(--success)]')}>
                  {line.id === 'promo' && <Tag size={12} aria-hidden="true" />}
                  <span className="truncate">{line.label}</span>
                  {line.id === 'promo' && onRemovePromo && (
                    <button
                      type="button"
                      onClick={onRemovePromo}
                      aria-label={`Gutschein ${promoLabel ?? ''} entfernen`}
                      className="ml-0.5 rounded p-0.5 text-[color:var(--muted)] transition-colors hover:text-[color:var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </span>
                {line.note && (
                  <span className="mt-0.5 block text-[0.75rem] leading-snug text-[color:var(--muted)]">{line.note}</span>
                )}
              </dt>
              <dd className={cn('co-amount shrink-0 tabular-nums', isDiscount ? 'text-[color:var(--success)]' : 'text-[color:var(--fg)]')}>
                {isDiscount ? '−' : ''}{formatMoney(Math.abs(line.amount), quote.currency, { forceDecimals: true })}
              </dd>
            </div>
          )
        })}
      </dl>

      {/* ── Die Summe ─────────────────────────────────────────────── */}
      <div className="mt-5 border-t border-[color:var(--border-strong)] pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.9375rem] font-medium">
            {quote.trialDays > 0 ? 'Heute fällig' : 'Gesamt'}
          </span>
          {/* Der Betrag ist die eine Zahl, auf die es ankommt — entsprechend
              gross, und als Live-Region, damit ein Screenreader die Änderung
              ansagt, wenn Intervall oder Anzahl wechselt. */}
          <span
            aria-live="polite"
            className="co-amount font-display text-[1.75rem] font-semibold leading-none text-[color:var(--fg-strong)]"
          >
            {formatMoney(quote.dueToday, quote.currency, { forceDecimals: quote.dueToday > 0 })}
          </span>
        </div>

        {quote.trialDays > 0 ? (
          <p className="mt-2.5 flex items-start gap-1.5 text-[0.78125rem] leading-relaxed text-[color:var(--muted)]">
            <Sparkles size={12} className="mt-[2px] shrink-0 text-[color:var(--accent-bright)]" aria-hidden="true" />
            <span>
              {quote.trialDays} Tage kostenlos. Ab dem {dateText} dann{' '}
              {formatMoney(quote.total, quote.currency, { forceDecimals: true })} je {interval === 'yearly' ? 'Jahr' : 'Monat'}.
              Kündigung bis dahin kostet nichts.
            </span>
          </p>
        ) : (
          <p className="mt-2.5 text-[0.78125rem] leading-relaxed text-[color:var(--muted)]">
            {interval === 'yearly'
              ? `Verlängert sich am ${dateText} um ein Jahr.`
              : `Nächste Abbuchung am ${dateText}.`}{' '}
            Jederzeit kündbar.
          </p>
        )}

        {quote.vat.reverseCharge && (
          <p className="mt-2 flex items-start gap-1.5 rounded-[var(--radius-md)] bg-[color:var(--surface-2)] p-2.5 text-[0.75rem] leading-relaxed text-[color:var(--muted-strong)]">
            <Info size={12} className="mt-[2px] shrink-0" aria-hidden="true" />
            <span>{quote.vat.note}</span>
          </p>
        )}
      </div>

      {action && <div className="mt-5">{action}</div>}

      <p className="co-trust mt-4 justify-center">
        <Lock size={12} aria-hidden="true" />
        Verschlüsselte Übertragung · keine Kartendaten auf unseren Servern
      </p>
    </div>
  )
}

/**
 * Die Telefon-Fassung: eine Leiste am unteren Rand, die den Betrag immer zeigt
 * und die Zeilen auf Tippen aufklappt.
 *
 * Nicht dieselbe Komponente in klein. Am unteren Rand steht ein Daumen, kein
 * Blick — deshalb trägt die Leiste den Betrag und den Knopf, und alles
 * Erklärende liegt eine Bewegung darunter statt permanent im Weg.
 */
export function OrderSummaryBar({ quote, tier, interval, action, now = new Date() }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-[color:var(--border-strong)] bg-[color:var(--bg-elevated)]/95 backdrop-blur-xl">
      {open && (
        <div className="omega-scroll max-h-[55vh] overflow-y-auto border-b border-[color:var(--border)] p-4">
          <OrderSummary quote={quote} tier={tier} interval={interval} now={now} />
        </div>
      )}
      <div className="flex items-center gap-3 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors hover:bg-[color:var(--surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        >
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn('shrink-0 text-[color:var(--muted)] transition-transform', open && 'rotate-180')}
          />
          <span className="min-w-0">
            <span className="block truncate text-[0.75rem] text-[color:var(--muted)]">
              OMEGA {planName(tier)} · {interval === 'yearly' ? 'jährlich' : 'monatlich'}
            </span>
            <span className="co-amount block text-[1.0625rem] font-semibold leading-tight">
              {formatMoney(quote.dueToday, quote.currency, { forceDecimals: quote.dueToday > 0 })}
            </span>
          </span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}
