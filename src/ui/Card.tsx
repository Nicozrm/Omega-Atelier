import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover-lift + selectable affordance. */
  interactive?: boolean
  /** Marks the card as selected (accent ring). */
  selected?: boolean
  children: ReactNode
}

/**
 * Card — device / room / tool tile. 16px radius, quiet by default,
 * lifts subtly on hover when `interactive`.
 */
export function Card({ interactive, selected, className, children, style, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-xl)] border bg-[color:var(--surface-2)] border-[color:var(--border)]',
        interactive && 'card-hover cursor-pointer',
        className,
      )}
      style={
        selected
          ? { borderColor: 'var(--border-accent)', boxShadow: 'var(--glow-accent-soft)', ...style }
          : style
      }
      {...rest}
    >
      {children}
    </div>
  )
}
