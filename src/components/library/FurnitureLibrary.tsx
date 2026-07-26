import { useMemo, useState } from 'react'
import { Search, CheckCircle2 } from 'lucide-react'
import { FURNITURE } from '@/data/furniture'
import { usePlanStore } from '@/store/usePlanStore'
import type { FurnitureCategory } from '@/types'
import { cn } from '@/lib/utils'

const CAT_LABELS: Record<FurnitureCategory, string> = {
  sofa: 'Sitzmöbel',
  bed: 'Betten',
  table: 'Tische',
  chair: 'Stühle',
  storage: 'Stauraum',
  kitchen: 'Küche',
  bath: 'Bad',
  decor: 'Dekor',
  outdoor: 'Outdoor',
  other: 'Sonstiges',
}

/**
 * Mini line-art silhouette per category — gives every card a visual
 * thumbnail (the reference library look) without shipping image assets.
 * 24x24 viewBox, stroked paths, currentColor.
 */
export function FurnitureThumb({ category }: { category: FurnitureCategory }) {
  const paths: Record<FurnitureCategory, string> = {
    sofa: 'M3 13v4h18v-4M5 13v-3a2 2 0 012-2h10a2 2 0 012 2v3M3 13a2 2 0 114 0M17 13a2 2 0 114 0M6 17v2M18 17v2',
    bed: 'M3 17v-6h18v6M3 17v1M21 17v1M5 11V8a1 1 0 011-1h5v4M12 11V7h6a1 1 0 011 1v3',
    table: 'M3 9h18M5 9v8M19 9v8M8 13h8',
    chair: 'M8 4v9M16 4v9M8 8h8M6 13h12M8 13v7M16 13v7',
    storage: 'M5 4h14v16H5zM5 12h14M12 4v16M9 8h.5M14.5 8h.5M9 16h.5M14.5 16h.5',
    kitchen: 'M3 10h18v9H3zM3 14h18M8 10V7M16 10V7M3 7h18M6 17h.5M11 17h2',
    bath: 'M4 12h16v3a4 4 0 01-4 4H8a4 4 0 01-4-4v-3zM6 12V6a2 2 0 012-2h1M9 6h3M7 19l-1 2M17 19l1 2',
    decor: 'M12 3c2 3 5 4 5 8a5 5 0 01-10 0c0-4 3-5 5-8zM9 19h6M10 16l1 3M14 16l-1 3',
    outdoor: 'M12 3v13M12 6l4-2M12 6l-4-2M12 10l5-2M12 10l-5-2M6 19h12M8 16l-1 3M16 16l1 3',
    other: 'M5 8h14v10H5zM5 12h14M9 5l3 3 3-3',
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
      <path d={paths[category] ?? paths.other} />
    </svg>
  )
}

const RECENT_KEY = 'omega.recentFurniture'
const RECENT_MAX = 6

function readRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}
function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* */ }
  return next
}

export function FurnitureLibrary() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FurnitureCategory | 'all'>('all')
  const [recent, setRecent] = useState<string[]>(readRecent)
  const hover = usePlanStore((s) => s.hoverFurnitureCatalogId)
  const setHover = usePlanStore((s) => s.setHoverFurniture)
  const setTool = usePlanStore((s) => s.setTool)
  const pick = (id: string) => {
    setHover(id)
    setTool('furniture')
    setRecent(pushRecent(id))
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return FURNITURE.filter((f) => {
      if (category !== 'all' && f.category !== category) return false
      if (!q) return true
      return f.name.toLowerCase().includes(q)
    })
  }, [query, category])

  const counts = useMemo(() => {
    const m = new Map<FurnitureCategory, number>()
    for (const f of FURNITURE) m.set(f.category, (m.get(f.category) ?? 0) + 1)
    return m
  }, [])
  const categories = useMemo(() => Array.from(counts.keys()), [counts])

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-[color:var(--border)] p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
          <input
            className="input pl-9"
            placeholder="Möbel suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {/* KATEGORIEN — vertical list with counts (reference library) */}
        <div>
          <div className="px-1 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
            Kategorien
          </div>
          <div className="max-h-44 space-y-px overflow-y-auto omega-scroll">
            <button
              onClick={() => setCategory('all')}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition-colors',
                category === 'all'
                  ? 'bg-[color:var(--surface-2)] text-[color:var(--fg)]'
                  : 'text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--fg)]',
              )}
            >
              Alle <span className="font-mono text-[10px]">{FURNITURE.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition-colors',
                  category === c
                    ? 'bg-[color:var(--surface-2)] text-[color:var(--fg)]'
                    : 'text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--fg)]',
                )}
              >
                {CAT_LABELS[c]} <span className="font-mono text-[10px]">{counts.get(c)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto omega-scroll p-2">
        {/* KÜRZLICH VERWENDET — quick re-pick row (reference library) */}
        {recent.length > 0 && !query && category === 'all' && (
          <div className="mb-2">
            <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
              Kürzlich verwendet
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {recent.map((id) => {
                const f = FURNITURE.find((x) => x.id === id)
                if (!f) return null
                return (
                  <button
                    key={id}
                    onClick={() => pick(f.id)}
                    title={f.name}
                    className={cn(
                      'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border transition',
                      hover === f.id
                        ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.10)] text-[color:var(--accent)]'
                        : 'border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--fg)]',
                    )}
                  >
                    <FurnitureThumb category={f.category} />
                    <span className="max-w-full truncate px-1 text-[9px]">{f.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {/* Card grid with visual thumbnails */}
        <div className="grid grid-cols-2 gap-1.5">
          {filtered.map((f) => {
            const selected = hover === f.id
            return (
              <button
                key={f.id}
                data-lib-id={f.id}
                data-lib-kind="furniture"
                data-lib-label={f.name}
                onClick={() => pick(f.id)}
                className={cn(
                  'group relative flex flex-col items-stretch rounded-lg border p-2 text-left transition',
                  selected
                    ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.10)]'
                    : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-2)]',
                )}
              >
                <div className={cn(
                  'flex h-12 items-center justify-center rounded-md bg-[color:var(--surface-2)] transition-colors',
                  selected ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)] group-hover:text-[color:var(--fg)]',
                )}>
                  <FurnitureThumb category={f.category} />
                </div>
                <div className="mt-1.5 truncate text-xs font-medium">{f.name}</div>
                <div className="font-mono text-[10px] text-[color:var(--muted)]">
                  {f.size[0]} × {f.size[1]} cm
                </div>
                {selected && <CheckCircle2 size={13} className="absolute right-1.5 top-1.5 text-[color:var(--accent)]" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
