import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'accent' | 'neutral' | 'success' | 'danger' | 'warn' | 'cyan'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Optional leading dot indicator. */
  dot?: boolean
  children: ReactNode
}

const TONE: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  accent:  { bg: 'rgba(199, 162, 78, 0.10)', fg: 'var(--accent-bright)',     bd: 'var(--border-accent)' },
  neutral: { bg: 'var(--surface-3)',          fg: 'var(--muted-strong)',      bd: 'var(--border)' },
  success: { bg: 'rgba(46, 229, 157, 0.10)',  fg: 'var(--color-omega-success)', bd: 'rgba(46, 229, 157, 0.30)' },
  danger:  { bg: 'rgba(255, 77, 77, 0.10)',   fg: 'var(--color-omega-danger)',  bd: 'rgba(255, 77, 77, 0.30)' },
  warn:    { bg: 'rgba(255, 177, 61, 0.10)',  fg: 'var(--color-omega-warn)',    bd: 'rgba(255, 177, 61, 0.30)' },
  cyan:    { bg: 'rgba(232, 200, 121, 0.10)',  fg: 'var(--cyan)',              bd: 'rgba(232, 200, 121, 0.30)' },
}

/** Badge / Tag — compact status or category marker. */
export function Badge({ tone = 'neutral', dot, className, children, style, ...rest }: BadgeProps) {
  const t = TONE[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.68rem] font-medium leading-none',
        className,
      )}
      style={{ background: t.bg, color: t.fg, borderColor: t.bd, ...style }}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  )
}
