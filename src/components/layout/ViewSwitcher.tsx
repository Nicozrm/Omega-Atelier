import { Box, SquarePen, ScanEye } from 'lucide-react'
import type { ViewMode } from '@/store/useUIStore'
import { useUIStore } from '@/store/useUIStore'
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator'

const TABS: Array<[ViewMode, string, typeof Box]> = [
  ['2d', 'Editor', SquarePen],
  ['3d', '3D Ansicht', Box],
  ['twin', 'Digital Twin', ScanEye],
]

/**
 * ViewSwitcher — the app's signature control: Editor · 3D Ansicht · Digital
 * Twin. A single violet-tinted pill glides between the three modes (magic move,
 * spring physics) instead of the highlight hopping instantly, and the active
 * segment's icon gives a subtle lift once the pill settles under it. This is
 * the most-used switch in the studio, so it carries the most polish.
 */
export function ViewSwitcher() {
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const { containerRef, indicatorStyle, ready } = useSlidingIndicator(viewMode)

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Ansicht"
      className="relative hidden items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-0.5 md:flex"
    >
      {/* Shared magic-move pill: accent-lit glass, glides between the tabs. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[var(--radius-sm)] will-change-transform"
        style={{
          ...indicatorStyle,
          opacity: ready ? 1 : 0,
          background: 'linear-gradient(180deg, rgba(199,162,78,0.20), rgba(199,162,78,0.11))',
          boxShadow:
            'inset 0 0 0 1px var(--border-accent), inset 0 1px 0 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.32)',
        }}
      />
      {TABS.map(([mode, label, Icon]) => {
        const active = viewMode === mode
        return (
          <button
            key={mode}
            data-seg={mode}
            role="tab"
            aria-selected={active}
            title={label}
            onClick={() => setViewMode(mode)}
            className={`relative z-10 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium transition-colors duration-200 lg:px-3 ${
              active
                ? 'text-[color:var(--accent-bright)]'
                : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
            }`}
          >
            <Icon
              size={13}
              className={`transition-transform duration-[var(--spring-pop-ms)] ease-[var(--spring-pop)] ${active ? 'scale-110' : 'scale-100'}`}
            />
            <span className="hidden lg:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
