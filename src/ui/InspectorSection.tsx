import { useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface InspectorSectionProps {
  title: string
  icon?: ReactNode
  /** Right-aligned summary or action shown in the header. */
  trailing?: ReactNode
  /** Start expanded (default true). */
  defaultOpen?: boolean
  /** Render without the collapse affordance. */
  static?: boolean
  children: ReactNode
  className?: string
}

/**
 * InspectorSection — a titled, collapsible group for the right inspector.
 * Progressive disclosure: open the section to reveal its controls.
 */
export function InspectorSection({
  title,
  icon,
  trailing,
  defaultOpen = true,
  static: isStatic,
  children,
  className,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const expanded = isStatic ? true : open

  return (
    <section className={cn('border-b border-[color:var(--border)] last:border-b-0', className)}>
      <header
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2.5 select-none',
          !isStatic && 'cursor-pointer hover:bg-[color:var(--surface-2)]',
        )}
        onClick={isStatic ? undefined : () => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!isStatic && (
            <ChevronDown
              size={13}
              className="text-[color:var(--muted)] transition-transform duration-200 shrink-0"
              style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
          )}
          {icon && <span className="text-[color:var(--muted)] shrink-0">{icon}</span>}
          <span className="label-xs truncate">{title}</span>
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </header>
      <div
        className="grid transition-all duration-300 ease-[var(--ease-out-expo)]"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  )
}

/** A labelled row inside an InspectorSection — label left, control right. */
export function InspectorRow({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5', className)}>
      <span className="text-xs text-[color:var(--muted)] shrink-0">{label}</span>
      <div className="min-w-0 flex items-center justify-end gap-1.5">{children}</div>
    </div>
  )
}
