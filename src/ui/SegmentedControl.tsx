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
 *
 * The track is recessed and the thumb is raised — a real key sitting in a real
 * groove. The previous pill was one step up the neutral ramp from the track it
 * sat in, which at this contrast is close to no selection state at all.
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
      className={cn('segmented', block && 'w-full', className)}
    >
      {/* Shared magic-move pill — sits under the active segment and glides. */}
      <span
        aria-hidden
        className="segmented-thumb pointer-events-none absolute left-0 top-0 will-change-transform"
        style={{ ...indicatorStyle, opacity: ready ? 1 : 0 }}
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
