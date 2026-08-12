/**
 * IntegrationStatus — the connector card's honest status line.
 *
 * Replaces the "✓ Verbunden" that every live card used to print the moment a
 * transport handshake succeeded. What is rendered here is derived from
 * `deriveIntegrationState`, which separates the handshake from the device
 * discovery and from the capabilities that were actually found — so an
 * integration that is authenticated but empty says exactly that, and offers the
 * one action that can change it.
 */

import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { PHASE_LABEL, PHASE_TONE, type IntegrationState } from '@/twin/integrationState'

const TONE_COLOR = {
  neutral: 'var(--muted)',
  progress: '#e0a23c',
  warn: '#e0a23c',
  ok: '#3fb27f',
  error: '#d8635f',
} as const

/** Status pill: phase name plus the device count once there is one. */
export function IntegrationBadge({ state }: { state: IntegrationState }) {
  const tone = PHASE_TONE[state.phase]
  const color = TONE_COLOR[tone]
  const Icon =
    tone === 'progress' ? Loader2
    : tone === 'ok' ? CheckCircle2
    : tone === 'warn' ? AlertTriangle
    : tone === 'error' ? AlertCircle
    : Unplug

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color }}>
      <Icon size={12} className={tone === 'progress' ? 'animate-spin' : undefined} />
      {PHASE_LABEL[state.phase]}
      {state.phase === 'ready' && (
        <span className="text-[color:var(--muted)]">
          · {state.deviceCount} {state.deviceCount === 1 ? 'Gerät' : 'Geräte'}
        </span>
      )}
    </span>
  )
}

/**
 * The explanation under the badge, plus the re-check action.
 *
 * `Prüfen` re-runs the connector's own device discovery. It is offered only
 * where it can actually help — an authenticated session — never as a decorative
 * button on a connection that has not been established.
 */
export function IntegrationNotice({ state, busy, onRecheck, recheckLabel }: {
  state: IntegrationState
  busy?: boolean
  onRecheck?: () => void
  /** Defaults to "Prüfen"; the empty states read better as "Erneut prüfen". */
  recheckLabel?: string
}) {
  const showRecheck = Boolean(onRecheck) && state.canRecheck
  const tone = PHASE_TONE[state.phase]

  // Nothing to explain and nothing to offer.
  if (!state.message && !showRecheck && state.unsupportedCount === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {state.message && (
        <div
          className="flex items-start gap-1.5 text-[11px] leading-snug"
          style={{ color: tone === 'error' ? '#d8635f' : tone === 'warn' ? '#e0a23c' : 'var(--muted)' }}
        >
          {tone === 'error'
            ? <AlertCircle size={12} className="mt-0.5 shrink-0" />
            : tone === 'warn' ? <AlertTriangle size={12} className="mt-0.5 shrink-0" /> : null}
          <span>{state.message}</span>
        </div>
      )}

      {/* Devices that arrived but carry no capability we understand. They are
          in the twin — hiding them is what made a discovery look empty. */}
      {state.unsupportedCount > 0 && (
        <div className="text-[10px] leading-snug text-[color:var(--muted)]">
          {state.unsupportedCount} {state.unsupportedCount === 1 ? 'Gerät liefert' : 'Geräte liefern'} keine
          bekannten Datenpunkte und {state.unsupportedCount === 1 ? 'erscheint' : 'erscheinen'} ohne Bedienelemente.
        </div>
      )}

      {showRecheck && (
        <div>
          <button
            onClick={onRecheck}
            disabled={busy}
            className="btn btn-sm btn-outline inline-flex items-center gap-1.5"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {recheckLabel ?? (state.phase === 'no-devices' || state.phase === 'error' ? 'Erneut prüfen' : 'Prüfen')}
          </button>
        </div>
      )}
    </div>
  )
}
