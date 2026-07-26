import { cn } from '@/lib/utils'

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
 * SegmentedControl — iOS-style mutually-exclusive switch. The active pill
 * slides via the highlighted segment; quiet inactive labels.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  block,
  size = 'md',
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-0.5',
        block && 'w-full',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative rounded-[var(--radius-sm)] font-medium transition-all duration-200',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[0.82rem]',
              block && 'flex-1',
              active
                ? 'text-[color:var(--fg-strong)]'
                : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]',
            )}
            style={
              active
                ? {
                    background: 'var(--surface-3)',
                    boxShadow: 'inset 0 0 0 1px var(--border-strong), 0 1px 2px rgba(0,0,0,0.3)',
                  }
                : undefined
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
