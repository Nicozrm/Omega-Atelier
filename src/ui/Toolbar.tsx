import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Toolbar — horizontal control surface with grouped clusters.
 * Use <ToolbarGroup> to cluster related controls; the implicit
 * separators keep the rail legible without visual noise.
 */
export function Toolbar({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={cn(
        'flex items-center gap-1 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] px-1 py-1',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** ToolbarGroup — a cluster of related controls, auto-separated. */
export function ToolbarGroup({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5',
        '[&:not(:first-child)]:before:mx-1 [&:not(:first-child)]:before:h-5 [&:not(:first-child)]:before:w-px [&:not(:first-child)]:before:bg-[color:var(--border)] [&:not(:first-child)]:before:content-[""]',
        className,
      )}
    >
      {children}
    </div>
  )
}
