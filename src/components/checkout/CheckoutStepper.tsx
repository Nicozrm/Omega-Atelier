/**
 * CheckoutStepper.tsx — wo bin ich, wie viel kommt noch.
 *
 * Die Leiste beantwortet die einzige Frage, die jeder in einem mehrstufigen
 * Formular stellt: *wie lange noch?* Eine unbeantwortete Frage ist an der Kasse
 * teuer — wer die Länge nicht abschätzen kann, rechnet mit dem Schlimmsten.
 *
 * Erledigte Schritte sind anklickbar, kommende nicht. Das ist keine Gängelung:
 * Schritt drei ohne Adresse zeigt keine Zahlungsarten, weil die vom Land
 * abhängen. Der Knopf ist deshalb `disabled` **und** trägt eine Erklärung im
 * `title` — abgeblendet ohne Grund ist die frustrierendste Form von Nein.
 *
 * Auf schmalen Displays bleibt nur der aktuelle Schritt mit „2 von 4" und ein
 * Fortschrittsbalken: vier Beschriftungen nebeneinander werden dort zu vier
 * abgeschnittenen Silben.
 */

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CHECKOUT_STEPS, STEP_META, canJumpTo, isStepComplete, progressPercent,
  type CheckoutForm, type CheckoutStep,
} from '@/lib/billing'

interface Props {
  current: CheckoutStep
  form: CheckoutForm
  onJump: (step: CheckoutStep) => void
  now?: Date
}

export function CheckoutStepper({ current, form, onJump, now = new Date() }: Props) {
  const currentIndex = CHECKOUT_STEPS.indexOf(current)

  return (
    <div>
      {/* ── Breit: alle vier Schritte ────────────────────────────────── */}
      <nav aria-label="Bestellschritte" className="hidden sm:block">
        <ol className="flex items-center gap-1">
          {CHECKOUT_STEPS.map((step, i) => {
            const meta = STEP_META[step]
            const done = i < currentIndex && isStepComplete(step, form, now)
            const reachable = canJumpTo(step, current, form, now)
            const isCurrent = step === current
            return (
              <li key={step} className="flex min-w-0 flex-1 items-center gap-1">
                <button
                  type="button"
                  onClick={() => reachable && onJump(step)}
                  disabled={!reachable}
                  aria-current={isCurrent ? 'step' : undefined}
                  data-done={done || undefined}
                  title={reachable ? undefined : 'Erst die Schritte davor ausfüllen'}
                  className="co-step min-w-0"
                >
                  <span className="co-step-num" aria-hidden="true">
                    {done ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span className="min-w-0 truncate text-[0.8125rem] font-medium">
                    {meta.label}
                    {/* Für Screenreader die vollständige Aussage — „Tarif"
                        allein sagt nicht, ob er erledigt ist. */}
                    <span className="sr-only">
                      {done ? ' — erledigt' : isCurrent ? ' — aktueller Schritt' : ' — noch offen'}
                    </span>
                  </span>
                </button>
                {i < CHECKOUT_STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-px min-w-4 flex-1 transition-colors duration-500',
                      i < currentIndex ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--border-strong)]',
                    )}
                  />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* ── Schmal: Balken plus „2 von 4" ────────────────────────────── */}
      <div className="sm:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[0.9375rem] font-medium">{STEP_META[current].label}</span>
          <span className="text-[0.78125rem] tabular-nums text-[color:var(--muted)]">
            Schritt {currentIndex + 1} von {CHECKOUT_STEPS.length}
          </span>
        </div>
        <div
          className="mt-2 h-1 overflow-hidden rounded-full bg-[color:var(--surface-3)]"
          role="progressbar"
          aria-valuenow={currentIndex + 1}
          aria-valuemin={1}
          aria-valuemax={CHECKOUT_STEPS.length}
          aria-label="Fortschritt der Bestellung"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent),var(--accent-bright))] transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${Math.max(8, progressPercent(current))}%` }}
          />
        </div>
      </div>
    </div>
  )
}
