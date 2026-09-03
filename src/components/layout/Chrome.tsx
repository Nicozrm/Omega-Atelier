import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Chrome — the glass shell every workspace bar sits in.
 *
 * The material (blur, tint, top highlight, bottom hairline) belongs to this one
 * wrapper rather than to each bar inside it. The editor stacks two rows — the
 * document identity strip and the tool rail — and when both carried their own
 * blur and their own border they read as two competing surfaces with a seam
 * between them instead of one pane of glass with a hairline drawn on it.
 *
 * It also means a page cannot accidentally ship a bar with no background: the
 * bars are `chrome-row` layouts and nothing else, so they are only ever placed
 * inside this.
 */
export function Chrome({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('chrome safe-top no-select', className)}>{children}</div>
}
