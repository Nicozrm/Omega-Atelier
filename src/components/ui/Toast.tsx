import { useEffect, useRef, useState, useCallback } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import type { Toast } from '@/store/useUIStore'

const ICON = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const COLOR = {
  success: '#7cba7a',
  error:   '#d06464',
  warning: '#FFB13D',
  info:    '#6f9fd8',
}

/** Time the collapse/fade-out plays before the toast is actually removed. */
const EXIT_MS = 280

export function ToastViewport() {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Benachrichtigungen"
      className="pointer-events-none fixed right-4 bottom-20 md:bottom-4 z-50 flex flex-col items-end safe-bottom"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const Icon = ICON[toast.kind]
  const color = COLOR[toast.kind]
  const isClickable = !!toast.onClick

  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  const beginExit = useCallback(() => {
    clearTimer()
    setLeaving(true)
    setTimeout(() => onRemove(toast.id), EXIT_MS)
  }, [clearTimer, onRemove, toast.id])

  const startTimer = useCallback(() => {
    if (!toast.duration || toast.duration <= 0) return
    clearTimer()
    timer.current = setTimeout(beginExit, toast.duration)
  }, [toast.duration, clearTimer, beginExit])

  // Own the countdown; pause while the pointer/focus is on the toast so an
  // actionable toast can't slip away while you reach for it.
  useEffect(() => { startTimer(); return clearTimer }, [startTimer, clearTimer])

  const handleClick = () => {
    if (toast.onClick) { toast.onClick(); beginExit() }
  }

  return (
    <div
      // Outer collapses its own height (grid 1fr→0fr) + bottom margin on exit,
      // so the toasts above slide down to fill instead of snapping.
      style={{
        display: 'grid',
        gridTemplateRows: leaving ? '0fr' : '1fr',
        marginBottom: leaving ? 0 : 8,
        opacity: leaving ? 0 : 1,
        transition: `grid-template-rows ${EXIT_MS}ms var(--ease-out-quart), margin-bottom ${EXIT_MS}ms var(--ease-out-quart), opacity 200ms var(--ease-out-quart)`,
        willChange: 'grid-template-rows, opacity',
      }}
    >
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <div
          className={`pointer-events-auto relative flex max-w-sm items-start gap-3 rounded-xl border bg-[color:var(--surface)] py-3 pl-4 pr-3 backdrop-blur-md ${
            isClickable ? 'cursor-pointer transition hover:bg-[color:var(--surface-2)]' : ''
          }`}
          style={{
            borderColor: `${color}40`,
            boxShadow: `0 1px 0 rgba(255,255,255,0.5) inset, 0 8px 24px rgba(20,16,8,0.10), 0 0 0 1px ${color}15`,
            animation: leaving ? undefined : 'toastIn var(--spring-bounce-ms) var(--spring-bounce) both',
          }}
          onClick={handleClick}
          onMouseEnter={clearTimer}
          onMouseLeave={startTimer}
          onFocus={clearTimer}
          onBlur={startTimer}
          role={isClickable ? 'button' : undefined}
          tabIndex={isClickable ? 0 : undefined}
        >
          {/* Left colour stripe */}
          <span
            className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
            style={{ background: `linear-gradient(180deg, ${color}, ${color}aa)` }}
          />
          <Icon size={16} style={{ color }} className="mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-tight">{toast.title}</div>
            {toast.description && (
              <div className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">{toast.description}</div>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); beginExit() }}
            className="rounded p-0.5 text-[color:var(--muted)] transition-colors hover:bg-[color:var(--surface-2)] hover:text-[color:var(--fg)]"
            aria-label="Schließen"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <style>{`
        @keyframes toastIn {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  )
}
