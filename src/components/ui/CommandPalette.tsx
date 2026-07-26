/**
 * Command Palette — global fuzzy search across devices, furniture, modes,
 * floors, and quick actions. Triggered via ⌘K / Ctrl+K.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, Package, Sofa, Layers, ArrowRight } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { OMEGA_MODES } from '@/lib/constants'
import type { Tool } from '@/types'

interface CommandItem {
  id: string
  title: string
  subtitle?: string
  icon: React.ReactNode
  run: () => void
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandOpen)
  const setOpen = useUIStore((s) => s.setCommandOpen)

  const doc = usePlanStore((s) => s.doc)
  const setActiveMode = usePlanStore((s) => s.setActiveMode)
  const setActiveFloor = usePlanStore((s) => s.setActiveFloor)
  const setTool = usePlanStore((s) => s.setTool)
  const setHoverDevice = usePlanStore((s) => s.setHoverDevice)
  const setHoverFurniture = usePlanStore((s) => s.setHoverFurniture)

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = []
    const q = query.trim().toLowerCase()
    const match = (s: string) => !q || s.toLowerCase().includes(q)

    // Quick actions
    const tools: Tool[] = ['select', 'wall', 'device', 'furniture', 'label', 'measure']
    for (const t of tools) {
      if (match(`werkzeug ${t}`)) {
        list.push({
          id: `tool:${t}`,
          title: `Werkzeug: ${t}`,
          subtitle: 'Aktives Werkzeug wechseln',
          icon: <ArrowRight size={14} className="text-[color:var(--accent)]" />,
          run: () => setTool(t),
        })
      }
    }

    // Modes
    for (const m of OMEGA_MODES) {
      if (match(m.name) || match(m.description)) {
        list.push({
          id: `mode:${m.key}`,
          title: `Modus: ${m.name}`,
          subtitle: m.description,
          icon: <Sparkles size={14} style={{ color: m.accent }} />,
          run: () => setActiveMode(m.key),
        })
      }
    }

    // Floors
    if (doc) {
      for (const f of doc.floors) {
        if (match(`etage ${f.name}`)) {
          list.push({
            id: `floor:${f.id}`,
            title: `Etage: ${f.name}`,
            subtitle: 'Zu dieser Etage wechseln',
            icon: <Layers size={14} />,
            run: () => setActiveFloor(f.id),
          })
        }
      }
    }

    // Devices (top 20 matches)
    let devShown = 0
    for (const d of DEVICES) {
      if (devShown >= 20) break
      if (match(d.name) || match(d.brand)) {
        list.push({
          id: `device:${d.id}`,
          title: `Gerät: ${d.name}`,
          subtitle: `${d.brand} · ${d.ecosystem}`,
          icon: <Package size={14} />,
          run: () => {
            setHoverDevice(d.id)
            setTool('device')
          },
        })
        devShown++
      }
    }

    // Furniture (top 10 matches)
    let furnShown = 0
    for (const f of FURNITURE) {
      if (furnShown >= 10) break
      if (match(f.name)) {
        list.push({
          id: `furn:${f.id}`,
          title: `Möbel: ${f.name}`,
          subtitle: `${f.size[0]} × ${f.size[1]} cm`,
          icon: <Sofa size={14} />,
          run: () => {
            setHoverFurniture(f.id)
            setTool('furniture')
          },
        })
        furnShown++
      }
    }

    return list
  }, [query, doc, setActiveMode, setActiveFloor, setTool, setHoverDevice, setHoverFurniture])

  // Keyboard navigation
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(items.length - 1, i + 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(0, i - 1))
      }
      if (e.key === 'Enter' && items[activeIdx]) {
        e.preventDefault()
        items[activeIdx].run()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, activeIdx, setOpen])

  useEffect(() => {
    if (activeIdx >= items.length) setActiveIdx(0)
  }, [items.length, activeIdx])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[10vh] animate-fade-in"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl surface overflow-hidden shadow-[var(--shadow-soft)] animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3">
          <Search size={16} className="text-[color:var(--accent)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder="Alles suchen — Modi, Geräte, Möbel, Etagen…"
            className="w-full bg-transparent outline-none text-sm"
          />
          <kbd className="text-[10px] font-mono text-[color:var(--muted)] border border-[color:var(--border)] px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto omega-scroll p-1">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-[color:var(--muted)]">Nichts gefunden.</div>
          ) : (
            items.map((it, i) => (
              <button
                key={it.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { it.run(); setOpen(false) }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                  i === activeIdx ? 'bg-[rgba(199, 162, 78,0.12)]' : 'hover:bg-[color:var(--surface-2)]'
                }`}
              >
                <span className="flex-shrink-0">{it.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{it.title}</div>
                  {it.subtitle && <div className="truncate text-xs text-[color:var(--muted)]">{it.subtitle}</div>}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
