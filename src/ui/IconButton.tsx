import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type IconButtonVariant = 'ghost' | 'outline' | 'primary' | 'danger'
export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required, since there is no visible text. */
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Render the active/selected state (soft accent glow). */
  active?: boolean
  children: ReactNode
}

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  primary: 'btn-primary',
  danger: 'btn-danger',
}

/**
 * IconButton — square, icon-only control with a mandatory aria-label.
 * `active` lights the soft selection glow used across the workspace.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={cn(
        'btn btn-icon',
        VARIANT[variant],
        size === 'sm' && 'btn-sm',
        active && 'is-active',
        className,
      )}
      style={
        active
          ? {
              background: 'rgba(199, 162, 78, 0.14)',
              borderColor: 'var(--border-accent)',
              color: 'var(--accent-bright)',
              boxShadow: 'var(--glow-accent-soft)',
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </button>
  )
})
