import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
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

/** Distance between trigger and bubble. */
const GAP = 8

/**
 * Open delay.
 *
 * 380ms was long enough that the tip usually arrived after the pointer had
 * already moved on — which in a bar of icon buttons is the difference between
 * "hover to find out what this is" working and not. 240ms still keeps the tips
 * from firing while the pointer merely crosses the toolbar on its way
 * somewhere else.
 */
const OPEN_DELAY = 240

interface Pos { left: number; top: number; transform: string }

/** Fixed-viewport coordinates for the bubble, anchored to the trigger rect. */
function place(rect: DOMRect, side: NonNullable<TooltipProps['side']>): Pos {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  switch (side) {
    case 'top':    return { left: cx, top: rect.top - GAP, transform: 'translate(-50%, -100%)' }
    case 'bottom': return { left: cx, top: rect.bottom + GAP, transform: 'translate(-50%, 0)' }
    case 'left':   return { left: rect.left - GAP, top: cy, transform: 'translate(-100%, -50%)' }
    case 'right':  return { left: rect.right + GAP, top: cy, transform: 'translate(0, -50%)' }
  }
}

/**
 * Tooltip — delayed, lightweight label on hover/focus. The bubble renders in a
 * portal on <body> with fixed positioning, so it is never clipped by an
 * ancestor's overflow (the editor toolbar lives inside an `overflow-x-auto`
 * rail, which would otherwise cut off a `side="bottom"` tip). The trigger
 * wrapper stays in flow to catch pointer/focus; only the bubble is portalled.
 */
export function Tooltip({ label, hint, side = 'top', children, className }: TooltipProps) {
  const [pos, setPos] = useState<Pos | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const compute = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    setPos(place(el.getBoundingClientRect(), side))
  }, [side])

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(compute, OPEN_DELAY)
  }, [compute])

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }, [])

  // Keep the bubble glued to the trigger if the layout shifts while it's open.
  useLayoutEffect(() => {
    if (!pos) return
    const onMove = () => compute()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [pos, compute])

  return (
    <span
      ref={wrapRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {pos && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          style={{ position: 'fixed', left: pos.left, top: pos.top, transform: pos.transform }}
          className="tooltip-bubble pointer-events-none z-[100] flex items-center gap-1.5 whitespace-nowrap"
        >
          {label}
          {hint && (
            <kbd className="tooltip-kbd">{hint}</kbd>
          )}
        </span>,
        document.body,
      )}
    </span>
  )
}
