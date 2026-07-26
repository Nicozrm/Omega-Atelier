import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type PanelVariant = 'solid' | 'glass'

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant
  children: ReactNode
}

/**
 * Panel — the base container surface (sidebars, inspector groups, popovers).
 * `glass` adds the frosted backdrop used for floating overlays.
 */
export function Panel({ variant = 'solid', className, children, ...rest }: PanelProps) {
  return (
    <div className={cn(variant === 'glass' ? 'surface-glass' : 'surface', className)} {...rest}>
      {children}
    </div>
  )
}

export interface PanelHeaderProps extends HTMLAttributes<HTMLDivElement> {
  /** Small leading icon. */
  icon?: ReactNode
  title: string
  /** Right-aligned actions (buttons, counts…). */
  actions?: ReactNode
}

/** PanelHeader — consistent eyebrow header for any Panel section. */
export function PanelHeader({ icon, title, actions, className, ...rest }: PanelHeaderProps) {
  return (
    <div
      className={cn('flex items-center justify-between gap-2 px-3 py-2.5', className)}
      {...rest}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[color:var(--muted)] shrink-0">{icon}</span>}
        <span className="label-xs truncate">{title}</span>
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </div>
  )
}
