import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Icon rendered before the label. */
  leading?: ReactNode
  /** Icon rendered after the label. */
  trailing?: ReactNode
  /** Stretch to fill the parent width. */
  block?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-ghost',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
  danger: 'btn-danger',
}

/**
 * Button — the single text-action primitive.
 * Pure presentation; callers wire behaviour via `onClick`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', leading, trailing, block, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn('btn', VARIANT[variant], size === 'sm' && 'btn-sm', block && 'w-full', className)}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  )
})
