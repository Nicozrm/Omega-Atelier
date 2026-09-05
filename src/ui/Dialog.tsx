import { useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useModalA11y } from './useModalA11y'

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Accessible title; wired to `aria-labelledby` and rendered in the header. */
  title: ReactNode
  size?: keyof typeof SIZES
  /** Optional extra classes on the panel. */
  className?: string
  children: ReactNode
}

/**
 * Dialog — an accessible modal primitive.
 *
 * Replaces the project's ad-hoc `<div className="fixed inset-0 …">` overlays,
 * which lacked every modal affordance. Provides `role="dialog"` + `aria-modal`
 * + `aria-labelledby`, a focus trap, focus return to the trigger, Escape to
 * close, body scroll-lock and backdrop-click — the focus/keyboard/scroll parts
 * via the shared {@link useModalA11y} hook.
 */
export function Dialog({ open, onClose, title, size = 'md', className, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useModalA11y({ open, onClose, containerRef: panelRef })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center scrim p-4 animate-fade-in"
      onClick={onClose}
    >
      {/*
        Header, body, and a hairline between them — the header stays put while
        the body scrolls. A dialog that scrolls its own title away leaves you
        looking at a floating panel with no name on it.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn('dialog-panel w-full max-h-[90vh]', SIZES[size], className)}
      >
        <header className="dialog-head">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button onClick={onClose} aria-label="Schließen" className="tool-btn h-7 w-7">
            <X size={16} />
          </button>
        </header>
        <div className="dialog-body omega-scroll">{children}</div>
      </div>
    </div>
  )
}
