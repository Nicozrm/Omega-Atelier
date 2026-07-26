import { Package, Sparkles, Layers3, Settings2 } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import type { PanelKey } from '@/store/useUIStore'
import { cn } from '@/lib/utils'

const NAV: { key: PanelKey; icon: React.ElementType; label: string }[] = [
  { key: 'library',    icon: Package,   label: 'Bibliothek' },
  { key: 'modes',      icon: Sparkles,  label: 'Modi' },
  { key: 'layers',     icon: Layers3,   label: 'Ebenen' },
  { key: 'properties', icon: Settings2, label: 'Details' },
]

export function MobileNav() {
  const mobilePanel = useUIStore((s) => s.mobilePanel)
  const openMobilePanel = useUIStore((s) => s.openMobilePanel)

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-[color:var(--border)] bg-[color:var(--bg)]/95 backdrop-blur safe-bottom">
      {NAV.map((n) => {
        const active = mobilePanel === n.key
        const Icon = n.icon
        return (
          <button
            key={n.key}
            onClick={() => openMobilePanel(active ? null : n.key)}
            className={cn(
              'flex flex-col items-center justify-center gap-1 py-2.5 text-[11px]',
              active ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]',
            )}
          >
            <Icon size={18} />
            <span>{n.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
