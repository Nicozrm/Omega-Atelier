import { useId, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, Search, Navigation, Sparkles, Check, ArrowRight, RotateCcw,
  Home, Layers, Trees, Waves, Car, Mountain, ScanLine,
} from 'lucide-react'
import { useComposerStore, type ComposerStep } from '@/store/useComposerStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useModalA11y } from '@/ui/useModalA11y'
import { formatConfidence, type ConfidenceKey, type RoofShape } from '@/lib/composer'
import { MapComposer } from './MapComposer'
import { AnalysisStage } from './AnalysisStage'

const STEPS: { n: ComposerStep; label: string }[] = [
  { n: 1, label: 'Standort' },
  { n: 2, label: 'Karte' },
  { n: 3, label: 'Analyse' },
  { n: 4, label: 'Fertig' },
]

const STEP_TITLE: Record<ComposerStep, string> = {
  1: 'Standort wählen',
  2: 'Grundstück antippen',
  3: 'Omega analysiert',
  4: 'Digital Twin erzeugt',
}

function StepDots({ step }: { step: ComposerStep }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1.5">
          <div
            className={`flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] transition-colors ${
              step === s.n
                ? 'bg-[rgba(199,162,78,0.16)] text-[color:var(--fg)]'
                : step > s.n
                  ? 'text-[color:var(--accent-bright)]'
                  : 'text-[color:var(--muted)]'
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${
                step > s.n
                  ? 'bg-[color:var(--accent)] text-[color:var(--accent-contrast)]'
                  : step === s.n
                    ? 'border border-[color:var(--border-accent)]'
                    : 'border border-[color:var(--border)]'
              }`}
            >
              {step > s.n ? <Check size={10} strokeWidth={3} /> : s.n}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </div>
          {i < STEPS.length - 1 && <span className="h-px w-3 bg-[color:var(--border)]" aria-hidden />}
        </div>
      ))}
    </div>
  )
}

function LocationStep() {
  const query = useComposerStore((s) => s.query)
  const setQuery = useComposerStore((s) => s.setQuery)
  const search = useComposerStore((s) => s.search)
  const searching = useComposerStore((s) => s.searching)
  const results = useComposerStore((s) => s.results)
  const chooseResult = useComposerStore((s) => s.chooseResult)
  const locateMe = useComposerStore((s) => s.locateMe)
  const locating = useComposerStore((s) => s.locating)
  const locationError = useComposerStore((s) => s.locationError)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-2">
      <p className="text-center text-sm text-[color:var(--muted)]">
        Such deine Adresse oder nutze deinen Standort — aus der Satellitenkarte wird in Sekunden ein
        realistischer Digital Twin deines Grundstücks.
      </p>

      {/* Address search */}
      <div>
        <label className="mb-1.5 block text-xs uppercase tracking-wider text-[color:var(--muted)]">Adresse suchen</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
              placeholder="Musterstraße 1, Berlin"
              className="input w-full !pl-9"
            />
          </div>
          <button onClick={() => void search()} className="btn btn-primary" disabled={searching}>
            {searching ? '…' : 'Suchen'}
          </button>
        </div>

        {results.length > 0 && (
          <ul className="mt-2 space-y-1 animate-fade-in">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  onClick={() => chooseResult(r)}
                  className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-left text-sm transition-colors hover:border-[color:var(--border-accent)]"
                >
                  <span className="min-w-0 truncate text-[color:var(--fg)]">{r.label}</span>
                  <ArrowRight size={14} className="shrink-0 text-[color:var(--accent-bright)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-[color:var(--muted)]">
        <span className="h-px flex-1 bg-[color:var(--border)]" /> oder <span className="h-px flex-1 bg-[color:var(--border)]" />
      </div>

      {/* Current location */}
      <button
        onClick={() => void locateMe()}
        disabled={locating}
        className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-left transition-colors hover:border-[color:var(--border-accent)]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(199,162,78,0.14)]">
          <Navigation size={16} className={`text-[color:var(--accent-bright)] ${locating ? 'animate-pulse' : ''}`} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-[color:var(--fg)]">{locating ? 'Standort wird ermittelt…' : 'Aktuellen Standort verwenden'}</span>
          <span className="block text-xs text-[color:var(--muted)]">GPS · öffnet die Karte an deiner Position</span>
        </span>
      </button>
      {locationError && <p className="text-xs text-[color:var(--color-omega-danger)]">{locationError}</p>}
    </div>
  )
}

const ROOF_LABEL: Record<RoofShape, string> = {
  gable: 'Satteldach',
  hip: 'Walmdach',
  flat: 'Flachdach',
  pent: 'Pultdach',
}

function confTone(v: number): string {
  if (v >= 0.8) return 'var(--color-omega-success)'
  if (v >= 0.55) return 'var(--accent-bright)'
  return 'var(--color-omega-warn)'
}

function ConfBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-[color:var(--muted)]">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(value * 100)}%`, background: confTone(value), transition: 'width 700ms var(--ease-out-quart)' }}
        />
      </div>
      <span className="w-12 shrink-0 text-right tabular-nums text-[color:var(--fg)]">{formatConfidence(value)}</span>
    </div>
  )
}

function DoneStep() {
  const navigate = useNavigate()
  const result = useComposerStore((s) => s.result)
  const reset = useComposerStore((s) => s.reset)
  const closeComposer = useComposerStore((s) => s.closeComposer)
  const consumeProject = useComposerStore((s) => s.consumeProject)
  const loadDocument = usePlanStore((s) => s.loadDocument)

  if (!result) return null
  const { summary, confidence } = result.draft

  const openProject = () => {
    const project = consumeProject()
    if (!project) return
    loadDocument(project, false)
    closeComposer()
    navigate('/plan/new')
  }

  const rows: { label: string; key: ConfidenceKey }[] = [
    { label: 'Gebäude', key: 'building' },
    { label: 'Dach', key: 'roof' },
    ...(summary.hasGarage ? [{ label: 'Garage', key: 'garage' as ConfidenceKey }] : []),
    { label: 'Grundstück', key: 'property' },
    { label: 'Gelände', key: 'terrain' },
    { label: 'Vegetation', key: 'vegetation' },
    { label: 'Innenwände', key: 'interior' },
  ]

  const stat = (icon: React.ReactNode, label: string, value: string) => (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2">
      <span className="text-[color:var(--accent-bright)]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{label}</span>
        <span className="block text-sm tabular-nums text-[color:var(--fg)]">{value}</span>
      </span>
    </div>
  )

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 py-2">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(199,162,78,0.16)] animate-pop-in">
          <Check size={26} className="text-[color:var(--accent-bright)]" strokeWidth={2.5} />
        </span>
        <h3 className="font-display text-2xl">Dein Digital Twin steht</h3>
        <p className="text-sm text-[color:var(--muted)]">
          Gesamt-Konfidenz {formatConfidence(confidence.overall)} · alle Elemente bleiben vollständig editierbar.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stat(<Home size={16} />, 'Grundstück', `${summary.plotAreaSqm} m²`)}
        {stat(<Layers size={16} />, 'Etagen', String(summary.stories))}
        {stat(<ScanLine size={16} />, 'Dach', ROOF_LABEL[summary.roof])}
        {stat(<Trees size={16} />, 'Bäume', String(summary.trees))}
        {stat(<Waves size={16} />, 'Pool', summary.hasPool ? 'ja' : 'nein')}
        {stat(<Car size={16} />, 'Garage', summary.hasGarage ? 'ja' : 'nein')}
      </div>

      <div className="space-y-2 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider text-[color:var(--muted)]">
          <Mountain size={12} /> Konfidenz pro Objekt
        </div>
        {rows.map((r) => (
          <ConfBar key={r.key} label={r.label} value={confidence.byObject[r.key]} />
        ))}
        <p className="pt-1 text-[11px] text-[color:var(--muted)]">
          Unsichere Bereiche (z. B. Innenwände) sind bewusst niedrig bewertet — der Grundriss ist eine plausible
          Schätzung und lässt sich im Editor frei anpassen.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button onClick={reset} className="btn btn-ghost btn-sm">
          <RotateCcw size={14} /> Neu starten
        </button>
        <button onClick={openProject} className="btn btn-primary">
          Projekt öffnen <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )
}

/**
 * ComposerWizard — the Omega AI Home Composer.
 *
 * A four-step, premium wizard: choose a location, tap the property on a
 * satellite map, watch the cinematic offline analysis, and open the freshly
 * generated, fully-editable Digital Twin in the Omega editor. Mounted globally
 * (like the Insights dialog) and opened from the Plans page.
 */
export function ComposerWizard() {
  const open = useComposerStore((s) => s.open)
  const step = useComposerStore((s) => s.step)
  const closeComposer = useComposerStore((s) => s.closeComposer)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useModalA11y({ open, onClose: closeComposer, containerRef: panelRef })

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center scrim p-3 animate-fade-in md:p-6">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="surface-glass flex h-[88vh] w-full max-w-3xl flex-col overflow-hidden outline-none animate-pop-in"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--border)] px-4 py-3 md:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[rgba(199,162,78,0.16)]">
              <Sparkles size={16} className="text-[color:var(--accent-bright)]" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate font-display text-base leading-tight">{STEP_TITLE[step]}</h2>
              <p className="text-[11px] text-[color:var(--muted)]">AI Home Composer</p>
            </div>
          </div>
          <div className="hidden md:block"><StepDots step={step} /></div>
          <button onClick={closeComposer} aria-label="Schließen" className="btn btn-ghost btn-icon shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Mobile step dots */}
        <div className="flex shrink-0 justify-center border-b border-[color:var(--border)] py-2 md:hidden">
          <StepDots step={step} />
        </div>

        {/* Body */}
        <div className={`min-h-0 flex-1 px-4 py-4 md:px-6 ${step === 2 ? 'overflow-hidden' : 'omega-scroll overflow-y-auto'}`}>
          {step === 1 && <LocationStep />}
          {step === 2 && <MapComposer />}
          {step === 3 && <AnalysisStage />}
          {step === 4 && <DoneStep />}
        </div>
      </div>
    </div>
  )
}
