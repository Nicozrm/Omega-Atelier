import { cn } from '@/lib/utils'
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Fill the available width, distributing segments evenly. */
  block?: boolean
  size?: 'sm' | 'md'
  className?: string
}

/**
 * SegmentedControl — iOS-style mutually-exclusive switch. A single shared pill
 * glides between segments (magic move) via `useSlidingIndicator` rather than
 * each segment lighting its own background, so switching reads as one object
 * moving, not two crossfading. Quiet inactive labels; the active label lifts to
 * the strong foreground once the pill arrives.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  block,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  const { containerRef, indicatorStyle, ready } = useSlidingIndicator(value)

  return (
    <div
      ref={containerRef}
      role="tablist"
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-0.5',
        block && 'w-full',
        className,
      )}
    >
      {/* Shared magic-move pill — sits under the active segment and glides. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[var(--radius-sm)] will-change-transform"
        style={{
          ...indicatorStyle,
          background: 'var(--surface-3)',
          boxShadow: 'inset 0 0 0 1px var(--border-strong), 0 1px 2px rgba(0,0,0,0.3)',
          opacity: ready ? 1 : 0,
        }}
      />
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            data-seg={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 rounded-[var(--radius-sm)] font-medium transition-colors duration-200',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[0.82rem]',
              block && 'flex-1',
              active
                ? 'text-[color:var(--fg-strong)]'
                : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
