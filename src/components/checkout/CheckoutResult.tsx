/**
 * CheckoutResult.tsx — was nach dem Absenden passiert ist.
 *
 * Drei Ausgänge, drei sehr verschiedene Botschaften:
 *
 *   erfolgreich → Bestätigung und genau EIN nächster Schritt
 *   wartend     → die Daten zum Abschreiben, gross und kopierbar
 *   Fehler      → was schiefging, dass nichts belastet wurde, und ein Weg zurück
 *
 * Der Satz „Es wurde nichts belastet" ist der wichtigste im ganzen
 * Fehlerzustand. Die erste Sorge nach einer fehlgeschlagenen Zahlung ist nicht
 * „warum", sondern „ist mein Geld weg" — und wer darauf keine Antwort findet,
 * ruft an oder bestellt sicherheitshalber ein zweites Mal.
 *
 * Der Demo-Modus (kein Supabase konfiguriert) sagt genau das. Eine Kasse, die
 * ohne Zahlung „Danke für deinen Kauf" sagt, ist eine Falle — auch dann, wenn
 * sie nur eine Vorschau sein soll.
 */

import { Link } from 'react-router-dom'
import { useState } from 'react'
import { AlertCircle, ArrowRight, Check, Clock, Copy, FlaskConical, PartyPopper, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { planName, type CheckoutOutcome, type PaymentInstructions } from '@/lib/billing'
import type { Tier } from '@/lib/entitlements'

interface Props {
  outcome: Exclude<CheckoutOutcome, { status: 'redirect' }>
  tier: Tier
  onRetry: () => void
}

export function CheckoutResult({ outcome, tier, onRetry }: Props) {
  if (outcome.status === 'succeeded') {
    return (
      <Shell
        tone="success"
        icon={<PartyPopper size={26} aria-hidden="true" />}
        title={`OMEGA ${planName(tier)} ist freigeschaltet`}
        lead="Alles bereit. Der Beleg liegt schon in deinem Postfach."
      >
        {outcome.simulated && (
          <p className="mb-6 flex items-start gap-2.5 rounded-[var(--radius-lg)] border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_10%,transparent)] p-3.5 text-left text-[0.8125rem] leading-relaxed">
            <FlaskConical size={15} className="mt-[2px] shrink-0 text-[color:var(--warn)]" aria-hidden="true" />
            <span>
              <strong className="font-medium">Demo-Modus.</strong> Diese Umgebung hat keine
              Cloud-Anbindung — es wurde nichts belastet und kein Abo angelegt. Sobald
              Supabase konfiguriert ist, läuft an dieser Stelle die echte Zahlung.
            </span>
          </p>
        )}
        <p className="mb-6 font-mono text-[0.75rem] uppercase tracking-wider text-[color:var(--muted)]">
          Bestellung {outcome.orderId.slice(0, 8)}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/plans" className="btn btn-primary !min-h-11 !px-6">
            Weiter zu deinen Plänen <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link to="/settings" className="btn btn-ghost !min-h-11">Abo verwalten</Link>
        </div>
      </Shell>
    )
  }

  if (outcome.status === 'pending') {
    return (
      <Shell
        tone="wait"
        icon={<Clock size={26} aria-hidden="true" />}
        title={outcome.instructions.headline}
        lead="Deine Bestellung ist angelegt. Sobald die Zahlung da ist, schalten wir automatisch frei."
      >
        <Instructions data={outcome.instructions} />
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/plans" className="btn btn-outline !min-h-11">Zur Übersicht</Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell
      tone="error"
      icon={<AlertCircle size={26} aria-hidden="true" />}
      title="Die Zahlung ging nicht durch"
      lead={outcome.message}
    >
      <p className="mb-6 text-[0.875rem] text-[color:var(--muted)]">
        <strong className="font-medium text-[color:var(--fg)]">Es wurde nichts belastet.</strong>{' '}
        Du kannst es sofort noch einmal versuchen — oder eine andere Zahlungsart wählen.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {outcome.retryable && (
          <button type="button" onClick={onRetry} className="btn btn-primary !min-h-11 !px-6">
            <RotateCcw size={15} aria-hidden="true" /> Zurück zur Kasse
          </button>
        )}
        <Link to="/plans" className="btn btn-ghost !min-h-11">Abbrechen</Link>
      </div>
    </Shell>
  )
}

function Shell({ tone, icon, title, lead, children }: {
  tone: 'success' | 'wait' | 'error'
  icon: React.ReactNode
  title: string
  lead: string
  children: React.ReactNode
}) {
  const ring = {
    success: 'border-[color:var(--success)] text-[color:var(--success)] bg-[color:color-mix(in_srgb,var(--success)_12%,transparent)]',
    wait: 'border-[color:var(--accent)] text-[color:var(--accent-bright)] bg-[rgba(199,162,78,0.12)]',
    error: 'border-[color:var(--danger)] text-[color:var(--danger)] bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)]',
  }[tone]

  return (
    // role="status" statt "alert": der Zustand wird angesagt, sobald er
    // erscheint, unterbricht aber nicht mitten im Satz.
    <div role="status" className="co-step-body mx-auto max-w-xl px-4 py-16 text-center md:py-24">
      <span className={cn('mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border-2', ring)}>
        {icon}
      </span>
      <h1 className="font-display text-[1.75rem] leading-tight md:text-[2.25rem]">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-[0.9375rem] leading-relaxed text-[color:var(--muted)]">{lead}</p>
      <div className="mt-8">{children}</div>
    </div>
  )
}

/** Die Zeilen zum Abschreiben — jede einzeln kopierbar. */
function Instructions({ data }: { data: PaymentInstructions }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border-strong)] bg-[color:var(--surface)] text-left">
      <dl className="divide-y divide-[color:var(--border)]">
        {data.rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 p-3.5">
            <dt className="w-32 shrink-0 text-[0.78125rem] uppercase tracking-wide text-[color:var(--muted)]">
              {row.label}
            </dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-[0.875rem]">{row.value}</dd>
            {row.copyable && <CopyButton value={row.value} label={row.label} />}
          </div>
        ))}
      </dl>
      {data.note && (
        <p className="border-t border-[color:var(--border)] bg-[color:var(--surface-2)] p-3.5 text-[0.8125rem] leading-relaxed text-[color:var(--muted)]">
          {data.note}
        </p>
      )}
    </div>
  )
}

/**
 * Kopieren mit sichtbarer Quittung.
 *
 * Ohne Rückmeldung tippt man zweimal, weil nichts passiert zu sein scheint.
 * Zwei Sekunden Haken genügen — und `navigator.clipboard` kann in unsicheren
 * Kontexten fehlen, deshalb der Zustand nur bei Erfolg.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        } catch { /* ohne Zwischenablage bleibt das Markieren von Hand */ }
      }}
      aria-label={`${label} kopieren`}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--border)] text-[color:var(--muted)] transition-colors hover:border-[color:var(--border-accent)] hover:text-[color:var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
    >
      {done
        ? <Check size={14} className="text-[color:var(--success)]" aria-hidden="true" />
        : <Copy size={14} aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{done ? 'Kopiert' : ''}</span>
    </button>
  )
}
