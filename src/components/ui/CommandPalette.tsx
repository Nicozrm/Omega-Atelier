/**
 * Command Palette — global fuzzy search across quick actions, tools, modes,
 * floors, devices and furniture. Triggered via ⌘K / Ctrl+K.
 *
 * Ranking runs through the pure `fuzzyMatch` scorer (start-of-word, run and
 * tightness bonuses), results are grouped into labelled sections, the matched
 * characters are highlighted, and the active row scrolls itself into view under
 * keyboard navigation. Wired as an ARIA combobox over a listbox.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, Package, Sofa, Layers, ArrowRight, Wand2, CornerDownLeft, BarChart3 } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { OMEGA_MODES } from '@/lib/constants'
import { fuzzyMatch, highlightRuns } from '@/lib/fuzzy'
import type { Tool } from '@/types'

type Category = 'Aktion' | 'Werkzeug' | 'Modus' | 'Etage' | 'Gerät' | 'Möbel'

/** Fixed section order; also the tie-break order between categories. */
const CATEGORY_ORDER: Category[] = ['Aktion', 'Werkzeug', 'Modus', 'Etage', 'Gerät', 'Möbel']
/** Categories hidden until the user types (the big catalogs). */
const CATALOG: Category[] = ['Gerät', 'Möbel']
/** Per-category cap once ranked, so one query can't flood the list. */
const CAP: Partial<Record<Category, number>> = { Gerät: 8, Möbel: 6 }

interface CommandItem {
  id: string
  category: Category
  title: string
  subtitle?: string
  /** Extra text folded into matching (brand, ecosystem, synonyms). */
  keywords?: string
  icon: React.ReactNode
  run: () => void
}

/** The subset of tools surfaced as palette actions, with German labels. */
const PALETTE_TOOLS: Array<[Tool, string]> = [
  ['select', 'Auswählen'], ['wall', 'Wand'], ['device', 'Gerät'],
  ['furniture', 'Möbel'], ['label', 'Beschriftung'], ['measure', 'Messen'],
]

export function CommandPalette() {
  const open = useUIStore((s) => s.commandOpen)
  const setOpen = useUIStore((s) => s.setCommandOpen)
  const setBlasterOpen = useUIStore((s) => s.setBlasterOpen)
  const setInsightsOpen = useUIStore((s) => s.setInsightsOpen)

  const doc = usePlanStore((s) => s.doc)
  const setActiveMode = usePlanStore((s) => s.setActiveMode)
  const setActiveFloor = usePlanStore((s) => s.setActiveFloor)
  const setTool = usePlanStore((s) => s.setTool)
  const setHoverDevice = usePlanStore((s) => s.setHoverDevice)
  const setHoverFurniture = usePlanStore((s) => s.setHoverFurniture)

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Full candidate set — built once per document, filtered/ranked below.
  const candidates: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = []

    list.push({
      id: 'blaster:open',
      category: 'Aktion',
      title: 'Image Blaster 3D',
      subtitle: 'Bild in ein texturiertes 3D-Asset verwandeln',
      keywords: 'mesh asset generieren pbr tiefe export foto',
      icon: <Wand2 size={14} className="text-[color:var(--accent-bright)]" />,
      run: () => setBlasterOpen(true),
    })

    list.push({
      id: 'insights:open',
      category: 'Aktion',
      title: 'Insights',
      subtitle: 'Plan-Doktor, Energie- & Kostenreport, Ökosystem-Audit',
      keywords: 'energie kosten strom co2 audit ökosystem plan doktor analyse report',
      icon: <BarChart3 size={14} className="text-[color:var(--accent-bright)]" />,
      run: () => setInsightsOpen(true),
    })

    for (const [t, label] of PALETTE_TOOLS) {
      list.push({
        id: `tool:${t}`,
        category: 'Werkzeug',
        title: label,
        subtitle: 'Aktives Werkzeug wechseln',
        keywords: `werkzeug tool ${t}`,
        icon: <ArrowRight size={14} className="text-[color:var(--accent)]" />,
        run: () => setTool(t),
      })
    }

    for (const m of OMEGA_MODES) {
      list.push({
        id: `mode:${m.key}`,
        category: 'Modus',
        title: m.name,
        subtitle: m.description,
        icon: <Sparkles size={14} style={{ color: m.accent }} />,
        run: () => setActiveMode(m.key),
      })
    }

    if (doc) {
      for (const f of doc.floors) {
        list.push({
          id: `floor:${f.id}`,
          category: 'Etage',
          title: f.name,
          subtitle: 'Zu dieser Etage wechseln',
          keywords: 'etage stockwerk',
          icon: <Layers size={14} />,
          run: () => setActiveFloor(f.id),
        })
      }
    }

    for (const d of DEVICES) {
      list.push({
        id: `device:${d.id}`,
        category: 'Gerät',
        title: d.name,
        subtitle: `${d.brand} · ${d.ecosystem}`,
        keywords: `${d.brand} ${d.ecosystem}`,
        icon: <Package size={14} />,
        run: () => { setHoverDevice(d.id); setTool('device') },
      })
    }

    for (const f of FURNITURE) {
      list.push({
        id: `furn:${f.id}`,
        category: 'Möbel',
        title: f.name,
        subtitle: `${f.size[0]} × ${f.size[1]} cm`,
        icon: <Sofa size={14} />,
        run: () => { setHoverFurniture(f.id); setTool('furniture') },
      })
    }

    return list
  }, [doc, setActiveMode, setActiveFloor, setTool, setHoverDevice, setHoverFurniture, setBlasterOpen, setInsightsOpen])

  // Filter + rank. Empty query shows the starting points (no giant catalog);
  // a typed query fuzzy-scores everything and orders each section by relevance.
  const { flat, groups } = useMemo(() => {
    const q = query.trim()
    const scored: Array<{ item: CommandItem; score: number; hl: number[] }> = []

    for (const item of candidates) {
      if (!q) {
        if (CATALOG.includes(item.category)) continue
        scored.push({ item, score: 0, hl: [] })
        continue
      }
      // Match the title + explicit keywords only — folding in the descriptive
      // subtitle turns generic phrasing ("Aktives Werkzeug wechseln") into
      // spurious subsequence hits that outrank the real targets.
      const searchText = `${item.title} ${item.keywords ?? ''}`
      const m = fuzzyMatch(q, searchText)
      if (!m) continue
      const titleHit = fuzzyMatch(q, item.title)
      scored.push({ item, score: m.score, hl: titleHit?.indices ?? [] })
    }

    // Group, cap, and sort each section by score (desc), stable by input order.
    const byCat = new Map<Category, typeof scored>()
    for (const s of scored) {
      const arr = byCat.get(s.item.category) ?? []
      arr.push(s)
      byCat.set(s.item.category, arr)
    }
    const built: Array<{ category: Category; rows: typeof scored; best: number }> = []
    for (const category of CATEGORY_ORDER) {
      const arr = byCat.get(category)
      if (!arr || arr.length === 0) continue
      if (q) arr.sort((a, b) => b.score - a.score)
      const capped = CAP[category] ? arr.slice(0, CAP[category]) : arr
      built.push({ category, rows: capped, best: capped[0]?.score ?? 0 })
    }
    // With a query, surface the most relevant section first; keep the fixed
    // order (CATEGORY_ORDER, already applied) as the tie-break and for empty.
    if (q) built.sort((a, b) => b.best - a.best)

    const groups: Array<{ category: Category; rows: typeof scored }> = []
    const flat: typeof scored = []
    for (const g of built) {
      groups.push({ category: g.category, rows: g.rows })
      flat.push(...g.rows)
    }
    return { flat, groups }
  }, [query, candidates])

  useEffect(() => { if (activeIdx >= flat.length) setActiveIdx(0) }, [flat.length, activeIdx])

  // Keyboard navigation over the flat list.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (flat.length ? (i + 1) % flat.length : 0)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0)) }
      else if (e.key === 'Home') { e.preventDefault(); setActiveIdx(0) }
      else if (e.key === 'End') { e.preventDefault(); setActiveIdx(Math.max(0, flat.length - 1)) }
      else if (e.key === 'Enter' && flat[activeIdx]) { e.preventDefault(); flat[activeIdx].item.run(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, flat, activeIdx, setOpen])

  // Keep the active row visible as it moves under the keyboard.
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center scrim p-4 pt-[10vh] animate-fade-in"
      onClick={() => setOpen(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Befehle & Suche"
        className="w-full max-w-xl surface-glass overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[color:var(--border)] px-4 py-3">
          <Search size={16} className="text-[color:var(--accent)]" />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat[activeIdx] ? `cmdk-${flat[activeIdx].item.id}` : undefined}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Alles suchen — Modi, Geräte, Möbel, Etagen…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[color:var(--muted)]"
          />
          <kbd className="rounded border border-[color:var(--border)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--muted)]">ESC</kbd>
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" className="max-h-[52vh] overflow-y-auto omega-scroll p-1.5">
          {flat.length === 0 ? (
            <div className="p-8 text-center text-sm text-[color:var(--muted)]">
              Nichts gefunden für „<span className="text-[color:var(--fg)]">{query}</span>".
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="mb-1">
                <div className="label-xs px-2.5 pb-1 pt-2">{sectionLabel(group.category)}</div>
                {group.rows.map((row) => {
                  const idx = flat.indexOf(row)
                  const active = idx === activeIdx
                  return (
                    <button
                      key={row.item.id}
                      id={`cmdk-${row.item.id}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onMouseMove={() => setActiveIdx(idx)}
                      onClick={() => { row.item.run(); setOpen(false) }}
                      className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors duration-100"
                      style={active ? { background: 'rgba(199,162,78,0.13)', boxShadow: 'inset 0 0 0 1px var(--border-accent)' } : undefined}
                    >
                      <span className="flex-shrink-0">{row.item.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {highlightRuns(row.item.title, row.hl).map((run, i) =>
                            run.match
                              ? <mark key={i} className="bg-transparent font-semibold text-[color:var(--accent-bright)]">{run.text}</mark>
                              : <span key={i}>{run.text}</span>,
                          )}
                        </div>
                        {row.item.subtitle && <div className="truncate text-xs text-[color:var(--muted)]">{row.item.subtitle}</div>}
                      </div>
                      {active && <CornerDownLeft size={13} className="flex-shrink-0 text-[color:var(--muted)]" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-[color:var(--border)] px-4 py-2 text-[11px] text-[color:var(--muted)]">
          <span className="flex items-center gap-1.5"><KbdKey>↑</KbdKey><KbdKey>↓</KbdKey> Navigieren</span>
          <span className="flex items-center gap-1.5"><KbdKey>↵</KbdKey> Öffnen</span>
          <span className="ml-auto tabular-nums">{flat.length} {flat.length === 1 ? 'Treffer' : 'Treffer'}</span>
        </div>
      </div>
    </div>
  )
}

function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.1rem] items-center justify-center rounded border border-[color:var(--border)] bg-[color:var(--surface-2)] px-1 py-0.5 font-mono text-[10px] leading-none">
      {children}
    </kbd>
  )
}

function sectionLabel(c: Category): string {
  switch (c) {
    case 'Aktion':   return 'Aktionen'
    case 'Werkzeug': return 'Werkzeuge'
    case 'Modus':    return 'Modi'
    case 'Etage':    return 'Etagen'
    case 'Gerät':    return 'Geräte'
    case 'Möbel':    return 'Möbel'
  }
}
