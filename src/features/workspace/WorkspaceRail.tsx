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
 * Collapsed it goes to zero width so the canvas reclaims every pixel; the
 * `RailReopenTab` below is what keeps the panel findable from there. Only
 * `width` and `opacity` transition, so the rail never jitters.
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
  const CollapseIcon = isLeft ? PanelLeftClose : PanelRightClose

  return (
    <aside
      className={cn(
        'rail transition-[width] duration-300 ease-[var(--ease-out-expo)]',
        isLeft ? 'border-r' : 'border-l',
        'border-[color:var(--hairline)]',
        className,
      )}
      style={{ width: open ? width : '0px' }}
      aria-hidden={!open}
    >
      <div className={cn('rail-header', !isLeft && 'flex-row-reverse')}>
        <span className="rail-title flex-1 truncate" style={{ textAlign: isLeft ? 'left' : 'right' }}>
          {title}
        </span>
        {headerActions}
        <Tooltip label={`${title} ausblenden`} hint={isLeft ? '⌥1' : '⌥2'} side="bottom">
          <button
            onClick={onToggle}
            aria-label={`${title} ausblenden`}
            className="tool-btn h-7 w-7"
          >
            <CollapseIcon size={15} />
          </button>
        </Tooltip>
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
 * RailReopenTab — the affordance shown over the canvas edge when a rail is
 * collapsed.
 *
 * It carries the panel's name, not just an arrow. A bare chevron on the edge of
 * a workspace is a puzzle: it says something will happen, never what. The label
 * costs 60px of canvas on a screen wide enough to have rails in the first place.
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
      <Tooltip label={`${label} einblenden`} hint={isLeft ? '⌥1' : '⌥2'} side={isLeft ? 'right' : 'left'}>
        <button onClick={onClick} aria-label={`${label} einblenden`} className="rail-tab">
          {isLeft && <Icon size={15} />}
          <span>{label}</span>
          {!isLeft && <Icon size={15} />}
        </button>
      </Tooltip>
    </div>
  )
}
