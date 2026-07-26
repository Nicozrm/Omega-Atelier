import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'

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

export function ToastViewport() {
  const toasts = useUIStore((s) => s.toasts)
  const dismiss = useUIStore((s) => s.dismissToast)

  return (
    <div className="pointer-events-none fixed right-4 bottom-20 md:bottom-4 z-50 flex flex-col items-end gap-2 safe-bottom">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        const color = COLOR[t.kind]
        const isClickable = !!t.onClick
        return (
          <div
            key={t.id}
            className={`pointer-events-auto relative flex max-w-sm items-start gap-3 pl-4 pr-3 py-3 rounded-xl border bg-[color:var(--surface)] backdrop-blur-md overflow-hidden ${
              isClickable ? 'cursor-pointer hover:bg-[color:var(--surface-2)] transition' : ''
            }`}
            style={{
              borderColor: `${color}40`,
              boxShadow: `0 1px 0 rgba(255,255,255,0.5) inset, 0 8px 24px rgba(20,16,8,0.10), 0 0 0 1px ${color}15`,
              animation: 'toastIn 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onClick={() => {
              if (t.onClick) {
                t.onClick()
                dismiss(t.id)
              }
            }}
            role={isClickable ? 'button' : undefined}
            tabIndex={isClickable ? 0 : undefined}
          >
            {/* Left color stripe */}
            <span
              className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
              style={{ background: `linear-gradient(180deg, ${color}, ${color}aa)` }}
            />
            <Icon size={16} style={{ color }} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">{t.title}</div>
              {t.description && (
                <div className="text-xs text-[color:var(--muted)] mt-1 leading-relaxed">{t.description}</div>
              )}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}
              className="text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors p-0.5 rounded hover:bg-[color:var(--surface-2)]"
              aria-label="Schließen"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes toastIn {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  )
}
