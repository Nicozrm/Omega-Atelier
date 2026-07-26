import { useState, useEffect, useRef, useId } from 'react'
import { cn } from '@/lib/utils'
import { X, ChevronRight, ChevronLeft, MousePointer, Hand, Type, Grid3X3 } from 'lucide-react'
import { useModalA11y } from '@/ui'

interface TourStep {
  title: string
  description: string
  icon: React.ReactNode
  position?: 'center' | 'top' | 'bottom'
}

const STEPS: TourStep[] = [
  {
    title: 'Willkommen bei OMEGA Atelier',
    description: 'Dein Smart-Home Planungstool. Diese kurze Tour zeigt dir die Grundlagen.',
    icon: <Grid3X3 size={32} className="text-[color:var(--accent)]" />,
    position: 'center',
  },
  {
    title: 'Werkzeuge',
    description: 'Oben findest du alle Tools: Wand zeichnen, Geräte platzieren, Möbel hinzufügen, Label setzen.',
    icon: <MousePointer size={32} className="text-[color:var(--accent)]" />,
    position: 'top',
  },
  {
    title: 'Navigation',
    description: 'Mit dem Mausrad zoomst du rein/raus. Halte die Leertaste gedrückt und ziehe zum Verschieben.',
    icon: <Hand size={32} className="text-[color:var(--accent)]" />,
    position: 'center',
  },
  {
    title: 'Omega-Modi',
    description: 'Rechts siehst du die 9 Smart-Home Modi. Der Readiness-Score zeigt, wie gut dein Plan jeden Modus abdeckt.',
    icon: <Type size={32} className="text-[color:var(--accent)]" />,
    position: 'bottom',
  },
]

const TOUR_KEY = 'omega-tour-completed'

export function OnboardingTour() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_KEY)
    if (!completed) {
      // Delay slightly so UI is rendered
      const t = setTimeout(() => setOpen(true), 800)
      return () => clearTimeout(t)
    }
  }, [])

  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalA11y({ open, onClose: skip, containerRef: panelRef })

  if (!open) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  function next() {
    if (isLast) {
      localStorage.setItem(TOUR_KEY, 'true')
      setOpen(false)
    } else {
      setStep(s => s + 1)
    }
  }

  function prev() {
    setStep(s => Math.max(0, s - 1))
  }

  function skip() {
    localStorage.setItem(TOUR_KEY, 'true')
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
        "surface w-full max-w-sm mx-4 p-5 animate-slide-up outline-none",
        current.position === 'top' && "self-start mt-24",
        current.position === 'bottom' && "self-end mb-24",
      )}>
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {current.icon}
            <div>
              <h3 id={titleId} className="font-display text-lg">{current.title}</h3>
              <p className="text-xs text-[color:var(--muted)]">Schritt {step + 1} von {STEPS.length}</p>
            </div>
          </div>
          <button onClick={skip} aria-label="Tour überspringen" className="btn btn-ghost btn-icon">
            <X size={16} />
          </button>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-4">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1 flex-1 rounded-full transition",
                i <= step ? "bg-[color:var(--accent)]" : "bg-[color:var(--surface-2)]",
              )}
            />
          ))}
        </div>

        {/* Content */}
        <p className="text-sm text-[color:var(--fg)] leading-relaxed mb-6">
          {current.description}
        </p>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <button
            onClick={prev}
            disabled={step === 0}
            className="btn btn-ghost btn-sm disabled:opacity-30"
          >
            <ChevronLeft size={16} /> Zurück
          </button>

          <div className="flex gap-2">
            <button onClick={skip} className="btn btn-ghost btn-sm text-[color:var(--muted)]">
              Überspringen
            </button>
            <button onClick={next} className="btn btn-primary btn-sm">
              {isLast ? 'Loslegen!' : 'Weiter'} <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
