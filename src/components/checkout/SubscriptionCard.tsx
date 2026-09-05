/**
 * SubscriptionCard.tsx — das laufende Abo verwalten.
 *
 * Kündigen muss genauso leicht sein wie abschliessen. Das ist nicht nur
 * Anstand, sondern seit Juli 2022 Gesetz: § 312k BGB verlangt für online
 * geschlossene Dauerverträge eine Kündigungsmöglichkeit, die ohne Umwege,
 * ohne Anruf und ohne Suchen erreichbar ist. Deshalb steht der Knopf hier —
 * in derselben Karte wie der Tarif, nicht in einem Hilfeartikel.
 *
 * Gekündigt wird **zum Periodenende**. Der bezahlte Zeitraum gehört dem Kunden;
 * ihn sofort abzuschneiden hiesse, Geld für nichts behalten zu haben. Solange
 * die Kündigung vorgemerkt ist, bleibt sie zurücknehmbar — ein versehentlicher
 * Klick soll keinen Support-Fall auslösen.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowUpRight, Check, CreditCard, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { useBillingStore } from '@/store/useBillingStore'
import { useUIStore } from '@/store/useUIStore'
import { planName } from '@/lib/billing'
import type { Tier } from '@/lib/entitlements'

const STATUS_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' }> = {
  active: { text: 'Aktiv', tone: 'ok' },
  trialing: { text: 'Testphase', tone: 'ok' },
  past_due: { text: 'Zahlung offen', tone: 'warn' },
}

export function SubscriptionCard({ tier, admin }: { tier: Tier; admin: boolean }) {
  const subscription = useBillingStore((s) => s.subscription)
  const loaded = useBillingStore((s) => s.loaded)
  const setCancel = useBillingStore((s) => s.setCancelAtPeriodEnd)
  const pushToast = useUIStore((s) => s.pushToast)
  const [busy, setBusy] = useState(false)

  const toggleCancel = async (cancel: boolean) => {
    setBusy(true)
    const { error } = await setCancel(cancel)
    setBusy(false)
    if (error) {
      pushToast({ kind: 'error', title: 'Hat nicht geklappt', description: error })
      return
    }
    pushToast({
      kind: 'success',
      title: cancel ? 'Kündigung vorgemerkt' : 'Kündigung zurückgenommen',
      description: cancel
        ? 'Dein Zugang läuft bis zum Ende des bezahlten Zeitraums weiter.'
        : 'Das Abo verlängert sich wieder wie gewohnt.',
    })
  }

  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <section className="surface space-y-4 p-4">
      <div className="flex items-center gap-2">
        <CreditCard size={15} className="icon-optical text-[color:var(--accent)]" aria-hidden="true" />
        <h2 className="font-display text-lg">Abo & Abrechnung</h2>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-base">OMEGA {planName(tier)}</span>
            {admin && (
              <span className="chip !py-0 text-[10px]">Admin</span>
            )}
            {subscription && STATUS_LABEL[subscription.status] && (
              <span className={`rounded-full px-2 py-px text-[10px] font-medium uppercase tracking-wide ${
                STATUS_LABEL[subscription.status].tone === 'ok'
                  ? 'bg-[color:color-mix(in_srgb,var(--success)_16%,transparent)] text-[color:var(--success)]'
                  : 'bg-[color:color-mix(in_srgb,var(--warn)_16%,transparent)] text-[color:var(--warn)]'
              }`}>
                {STATUS_LABEL[subscription.status].text}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {admin
              ? 'Als Produktinhaber hast du alle Funktionen — unabhängig vom Abo.'
              : subscription
                ? <>
                    {subscription.interval === 'yearly' ? 'Jährlich' : 'Monatlich'}
                    {subscription.seats > 1 && ` · ${subscription.seats} Arbeitsplätze`}
                    {' · '}
                    {subscription.cancelAtPeriodEnd
                      ? `endet am ${dateText(subscription.currentPeriodEnd)}`
                      : `verlängert sich am ${dateText(subscription.currentPeriodEnd)}`}
                  </>
                : loaded
                  ? 'Kein bezahltes Abo — der Free-Tarif läuft unbegrenzt weiter.'
                  : 'Wird geladen…'}
          </p>
        </div>

        {!subscription && loaded && !admin && (
          <Link to="/checkout?plan=pro&interval=yearly" className="btn btn-primary btn-sm shrink-0">
            <Sparkles size={13} aria-hidden="true" /> Upgrade
          </Link>
        )}
        {subscription && subscription.tier === 'pro' && (
          <Link to="/checkout?plan=max&interval=yearly" className="btn btn-outline btn-sm shrink-0">
            Auf Max wechseln <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        )}
      </div>

      {subscription?.status === 'past_due' && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--warn)] bg-[color:color-mix(in_srgb,var(--warn)_8%,transparent)] p-3 text-xs leading-relaxed">
          <AlertCircle size={13} className="mt-[2px] shrink-0 text-[color:var(--warn)]" aria-hidden="true" />
          <span>
            Die letzte Abbuchung ist nicht durchgegangen. Dein Zugang bleibt vorerst offen —
            bitte hinterlege im Checkout ein anderes Zahlungsmittel.
          </span>
        </p>
      )}

      {subscription && (
        <div className="flex flex-wrap items-center gap-3">
          {subscription.cancelAtPeriodEnd ? (
            <button
              type="button"
              onClick={() => void toggleCancel(false)}
              disabled={busy}
              className="btn btn-outline btn-sm"
            >
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RotateCcw size={13} aria-hidden="true" />}
              Kündigung zurücknehmen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void toggleCancel(true)}
              disabled={busy}
              className="btn btn-ghost btn-sm !text-[color:var(--muted)]"
            >
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
              Abo kündigen
            </button>
          )}
          <span className="text-xs text-[color:var(--muted)]">
            {subscription.cancelAtPeriodEnd
              ? 'Bis dahin ändert sich nichts.'
              : 'Zum Ende des bezahlten Zeitraums, ohne Rückfragen.'}
          </span>
        </div>
      )}

      {!subscription && loaded && !admin && (
        <ul className="space-y-1.5 text-xs text-[color:var(--muted)]">
          {['Auto-Möblieren, Sonnenstudie und Insights', 'AI Composer und Live-Connectoren in Max', '14 Tage kostenlos, jederzeit kündbar'].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <Check size={12} className="mt-[3px] shrink-0 text-[color:var(--accent-bright)]" aria-hidden="true" />
              {t}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
