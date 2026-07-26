import type { ReactNode } from 'react'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/ui'

export interface WorkspaceRailProps {
  side: 'left' | 'right'
  open: boolean
  onToggle: () => void
  /** Title shown in the rail header. */
  title: string
  /** Optional header actions (e.g. tab switch). */
  headerActions?: ReactNode
  /** CSS width when expanded, e.g. 'var(--sidebar-width)'. */
  width: string
  children: ReactNode
  className?: string
}

/**
 * WorkspaceRail — a collapsible, animated side panel for the 3-panel editor.
 *
 * Collapsed it shrinks to a thin spine with a single expand affordance, so
 * the canvas reclaims the space. Width animates smoothly; the rail never
 * jitters because only `width` and `opacity` transition.
 */
export function WorkspaceRail({
  side,
  open,
  onToggle,
  title,
  headerActions,
  width,
  children,
  className,
}: WorkspaceRailProps) {
  const isLeft = side === 'left'
  const ExpandIcon = isLeft ? PanelLeftOpen : PanelRightOpen
  const CollapseIcon = isLeft ? PanelLeftClose : PanelRightClose

  return (
    <aside
      className={cn(
        'relative z-10 flex h-full shrink-0 flex-col overflow-hidden bg-[color:var(--bg-elevated)] transition-[width] duration-300 ease-[var(--ease-out-expo)]',
        isLeft ? 'border-r' : 'border-l',
        'border-[color:var(--border)]',
        className,
      )}
      style={{ width: open ? width : '0px' }}
      aria-hidden={!open}
    >
      {/* Header */}
      <div
        className={cn(
          'flex h-11 shrink-0 items-center gap-2 border-b border-[color:var(--border)] px-3',
          isLeft ? '' : 'flex-row-reverse',
        )}
      >
        <Tooltip label={open ? 'Einklappen' : 'Ausklappen'} side={isLeft ? 'right' : 'left'}>
          <button
            onClick={onToggle}
            aria-label={open ? `${title} einklappen` : `${title} ausklappen`}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-[color:var(--muted)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--fg)] transition-colors"
          >
            {open ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
          </button>
        </Tooltip>
        <span className="label-xs flex-1 truncate" style={{ textAlign: isLeft ? 'left' : 'right' }}>
          {title}
        </span>
        {headerActions}
      </div>

      {/* Body — fades with collapse so text doesn't smear during the width tween */}
      <div
        className="flex-1 overflow-hidden transition-opacity duration-200"
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none' }}
      >
        {children}
      </div>
    </aside>
  )
}

/**
 * RailReopenTab — a slim floating affordance shown over the canvas edge when
 * a rail is collapsed, so it can be summoned without hunting for controls.
 */
export function RailReopenTab({
  side,
  onClick,
  label,
  className,
}: {
  side: 'left' | 'right'
  onClick: () => void
  label: string
  className?: string
}) {
  const isLeft = side === 'left'
  const Icon = isLeft ? PanelLeftOpen : PanelRightOpen
  return (
    <div
      className={cn(
        'absolute top-3 z-20 animate-fade-in',
        isLeft ? 'left-3' : 'right-3',
        className,
      )}
    >
      <Tooltip label={label} side={isLeft ? 'right' : 'left'}>
        <button
          onClick={onClick}
          aria-label={label}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] surface-glass text-[color:var(--muted)] hover:text-[color:var(--accent-bright)] shadow-[var(--shadow-2)] transition-colors"
        >
          <Icon size={17} />
        </button>
      </Tooltip>
    </div>
  )
}
