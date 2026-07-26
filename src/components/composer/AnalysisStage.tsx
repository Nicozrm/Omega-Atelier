import { useMemo } from 'react'
import { Check, Loader2, X, RotateCw, AlertTriangle } from 'lucide-react'
import { useComposerStore } from '@/store/useComposerStore'
import { ANALYSIS_CHECKLIST, formatConfidence, type ConfidenceKey, type PhaseId } from '@/lib/composer'

/** Deterministic particle field so the cinematic feels alive but stays calm. */
const PARTICLES = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${(i % 7) * 0.4}s`,
  dur: `${2.4 + (i % 5) * 0.5}s`,
}))

function Ring({ pct }: { pct: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  const dash = c * Math.min(1, Math.max(0, pct))
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="6" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="var(--accent-bright)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        style={{ transition: 'stroke-dasharray 500ms var(--ease-out-quart)' }}
      />
    </svg>
  )
}

export function AnalysisStage() {
  const status = useComposerStore((s) => s.status)
  const progress = useComposerStore((s) => s.progress)
  const completed = useComposerStore((s) => s.completedPhases)
  const error = useComposerStore((s) => s.error)
  const result = useComposerStore((s) => s.result)
  const cancel = useComposerStore((s) => s.cancelAnalysis)
  const retry = useComposerStore((s) => s.retryAnalysis)
  const setStep = useComposerStore((s) => s.setStep)

  const pct = status === 'done' ? 1 : progress ? progress.index / progress.total : 0

  const completedSet = useMemo(() => new Set<PhaseId>(completed), [completed])
  const itemState = (phases: PhaseId[]): 'done' | 'active' | 'pending' => {
    if (phases.every((p) => completedSet.has(p))) return 'done'
    if (progress && phases.includes(progress.phase)) return 'active'
    // The first not-yet-done checklist item counts as active while running.
    return 'pending'
  }

  // Confidence values to surface live (or from the final report).
  const conf = result?.scene.confidence.byObject

  const failed = status === 'error' || status === 'canceled'

  return (
    <div className="flex flex-col gap-6">
      {/* Scanner stage */}
      <div className="relative h-52 overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[#0d100b]">
        <div className="composer-glow" aria-hidden />
        <div className="composer-scan" aria-hidden />
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="composer-particle"
            style={{ left: p.left, bottom: '10%', animationDelay: p.delay, animationDuration: p.dur }}
            aria-hidden
          />
        ))}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <div className="relative flex items-center justify-center">
            <Ring pct={pct} />
            <div className="absolute flex flex-col items-center">
              <span className="font-display text-2xl tabular-nums text-[color:var(--fg)]">{Math.round(pct * 100)}%</span>
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
                {status === 'done' ? 'fertig' : status === 'canceled' ? 'abgebrochen' : status === 'error' ? 'Fehler' : 'Analyse'}
              </span>
            </div>
          </div>
          {progress && !failed && (
            <div className="mt-1 text-sm text-[color:var(--accent-bright)] animate-fade-in">{progress.label}</div>
          )}
        </div>
      </div>

      {/* Checklist */}
      <ul className="space-y-2">
        {ANALYSIS_CHECKLIST.map((item) => {
          const st = failed ? 'pending' : itemState(item.phases)
          const confKey = CHECK_CONF[item.id]
          const confVal = confKey && conf ? conf[confKey] : undefined
          return (
            <li
              key={item.id}
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border px-3.5 py-2.5 transition-colors ${
                st === 'done'
                  ? 'border-[color:var(--border)] bg-[color:var(--surface-2)]'
                  : st === 'active'
                    ? 'border-[color:var(--border-accent)] bg-[rgba(199,162,78,0.08)]'
                    : 'border-[color:var(--border)] opacity-60'
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
                {st === 'done' ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--accent-contrast)] animate-pop-in">
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : st === 'active' ? (
                  <Loader2 size={18} className="animate-spin text-[color:var(--accent-bright)]" />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--surface-3)]" />
                )}
              </span>
              <span className={`flex-1 text-sm ${st === 'pending' ? 'text-[color:var(--muted)]' : 'text-[color:var(--fg)]'}`}>
                {item.label}
              </span>
              {confVal !== undefined && st === 'done' && (
                <span className="text-xs tabular-nums text-[color:var(--muted)]">{formatConfidence(confVal)}</span>
              )}
            </li>
          )
        })}
      </ul>

      {/* Controls */}
      {status === 'running' && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-[color:var(--muted)]">Offline-Analyse · läuft asynchron · jederzeit abbrechbar</p>
          <button onClick={cancel} className="btn btn-ghost btn-sm">
            <X size={14} /> Abbrechen
          </button>
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-center">
          <AlertTriangle size={20} style={{ color: 'var(--color-omega-warn)' }} />
          <p className="text-sm text-[color:var(--fg)]">
            {status === 'canceled' ? 'Analyse abgebrochen.' : error ?? 'Analyse fehlgeschlagen.'}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="btn btn-ghost btn-sm">Zurück zur Karte</button>
            <button onClick={() => void retry()} className="btn btn-primary btn-sm">
              <RotateCw size={14} /> Erneut versuchen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Maps a checklist item to the confidence key it should display when done. */
const CHECK_CONF: Record<string, ConfidenceKey> = {
  property: 'property',
  building: 'building',
  vegetation: 'vegetation',
  terrain: 'terrain',
}
