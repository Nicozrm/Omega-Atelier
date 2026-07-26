import { cn } from '@/lib/utils'

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
  /** Adds 8px breathing room on the block axis. */
  spaced?: boolean
}

/** Divider — hairline separator. Quiet by design. */
export function Divider({ orientation = 'horizontal', className, spaced }: DividerProps) {
  if (orientation === 'vertical') {
    return <span className={cn('w-px self-stretch bg-[color:var(--border)] shrink-0', spaced && 'mx-2', className)} />
  }
  return <div className={cn('h-px w-full bg-[color:var(--border)]', spaced && 'my-2', className)} />
}
