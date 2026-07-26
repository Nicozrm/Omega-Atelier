import { useState, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TooltipProps {
  label: ReactNode
  /** Optional keyboard hint shown as a mono chip. */
  hint?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
  className?: string
}

const SIDE_POS: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

/**
 * Tooltip — delayed, lightweight label on hover/focus. No portal; relies
 * on a relatively-positioned wrapper. Respects keyboard focus.
 */
export function Tooltip({ label, hint, side = 'top', children, className }: TooltipProps) {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const open = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setShow(true), 380)
  }
  const close = () => {
    if (timer.current) clearTimeout(timer.current)
    setShow(false)
  }

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {show && (
        <span
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-[100] flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] border border-[color:var(--border-strong)] bg-[color:var(--surface-3)] px-2 py-1 text-xs text-[color:var(--fg)] shadow-[var(--shadow-3)] animate-fade-in',
            SIDE_POS[side],
          )}
        >
          {label}
          {hint && (
            <kbd className="rounded bg-[color:var(--surface)] px-1 font-mono text-[0.65rem] text-[color:var(--muted)]">
              {hint}
            </kbd>
          )}
        </span>
      )}
    </span>
  )
}
