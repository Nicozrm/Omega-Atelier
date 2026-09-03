import { Package, Sparkles, Layers3, Settings2 } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import type { PanelKey } from '@/store/useUIStore'

const NAV: { key: PanelKey; icon: React.ElementType; label: string }[] = [
  { key: 'library',    icon: Package,   label: 'Bibliothek' },
  { key: 'modes',      icon: Sparkles,  label: 'Modi' },
  { key: 'layers',     icon: Layers3,   label: 'Ebenen' },
  { key: 'properties', icon: Settings2, label: 'Details' },
]

/**
 * MobileNav — the phone tab bar.
 *
 * The active item's icon sits in a filled capsule rather than merely changing
 * colour. On a small screen, colour alone is the weakest possible selection
 * signal — it competes with everything else the accent is used for, and it is
 * the first thing lost to glare, to a colour-vision difference, or to a thumb
 * covering half the bar. The capsule is legible in all four cases.
 */
export function MobileNav() {
  const mobilePanel = useUIStore((s) => s.mobilePanel)
  const openMobilePanel = useUIStore((s) => s.openMobilePanel)

  return (
    <nav
      role="tablist"
      aria-label="Bereiche"
      className="tabbar lg:hidden fixed inset-x-0 bottom-0 z-40 grid-cols-4 safe-bottom"
    >
      {NAV.map((n) => {
        const active = mobilePanel === n.key
        const Icon = n.icon
        return (
          <button
            key={n.key}
            role="tab"
            aria-selected={active}
            onClick={() => openMobilePanel(active ? null : n.key)}
            className="tabbar-item touch-target"
          >
            <span className="tabbar-icon"><Icon size={18} /></span>
            <span>{n.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
