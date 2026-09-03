import { useMemo, useState } from 'react'
import {
  Search, CheckCircle2, Lightbulb, Speaker, Camera, Lock, Activity,
  Thermometer, Router, Tv, ToggleLeft, Plug, Siren, WashingMachine, Cpu,
  PanelTop,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DEVICES } from '@/data/devices'
import { DEVICE_ECOSYSTEM_LABELS, CATEGORY_LABELS } from '@/lib/constants'
import { usePlanStore } from '@/store/usePlanStore'
import type { DeviceCategory, Ecosystem } from '@/types'
import { cn } from '@/lib/utils'

/** Category icon tile — gives every device row a visual anchor. */
const CATEGORY_ICONS: Partial<Record<DeviceCategory, LucideIcon>> = {
  light: Lightbulb,
  speaker: Speaker,
  camera: Camera,
  lock: Lock,
  sensor: Activity,
  climate: Thermometer,
  hub: Router,
  tv: Tv,
  switch: ToggleLeft,
  outlet: Plug,
  alarm: Siren,
  appliance: WashingMachine,
  blind: PanelTop,
}

export function DeviceLibrary() {
  const [query, setQuery] = useState('')
  const [ecosystem, setEcosystem] = useState<Ecosystem | 'all'>('all')
  const [category, setCategory] = useState<DeviceCategory | 'all'>('all')

  const hover = usePlanStore((s) => s.hoverDeviceCatalogId)
  const setHover = usePlanStore((s) => s.setHoverDevice)
  const setTool = usePlanStore((s) => s.setTool)

  const ecosystems = useMemo(() => Array.from(new Set(DEVICES.map((d) => d.ecosystem))), [])
  const categories = useMemo(() => Array.from(new Set(DEVICES.map((d) => d.category))), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return DEVICES.filter((d) => {
      if (ecosystem !== 'all' && d.ecosystem !== ecosystem) return false
      if (category !== 'all' && d.category !== category) return false
      if (!q) return true
      return d.name.toLowerCase().includes(q) || d.brand.toLowerCase().includes(q)
    })
  }, [query, ecosystem, category])

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-[color:var(--hairline-soft)] p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
          <input
            className="input pl-9"
            placeholder="Gerät suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select
            className="select"
            aria-label="Nach Ökosystem filtern"
            value={ecosystem}
            onChange={(e) => setEcosystem(e.target.value as Ecosystem | 'all')}
          >
            <option value="all">Alle Systeme</option>
            {ecosystems.map((e) => (
              <option key={e} value={e}>{DEVICE_ECOSYSTEM_LABELS[e]}</option>
            ))}
          </select>
          <select
            className="select"
            aria-label="Nach Kategorie filtern"
            value={category}
            onChange={(e) => setCategory(e.target.value as DeviceCategory | 'all')}
          >
            <option value="all">Alle Kategorien</option>
            {categories.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto omega-scroll p-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-[color:var(--muted)] mb-2 px-1">
          <span>{filtered.length} {filtered.length === 1 ? 'Ergebnis' : 'Ergebnisse'}</span>
          {(query || ecosystem !== 'all' || category !== 'all') && (
            <button
              onClick={() => { setQuery(''); setEcosystem('all'); setCategory('all') }}
              className="text-[color:var(--accent)] hover:underline normal-case tracking-normal text-xs"
            >
              zurücksetzen
            </button>
          )}
        </div>
        <div className="space-y-1">
          {filtered.map((d) => {
            const selected = hover === d.id
            return (
              <button
                key={d.id}
                data-lib-id={d.id}
                data-lib-kind="device"
                data-lib-label={d.name}
                onClick={() => {
                  setHover(d.id)
                  setTool('device')
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-all duration-150',
                  selected
                    ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.10)] shadow-[0_2px_10px_rgba(199,162,78,0.18)]'
                    : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-2)] hover:-translate-y-0.5',
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {(() => {
                    const Icon = CATEGORY_ICONS[d.category] ?? Cpu
                    return (
                      <div className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[color:var(--surface-2)]',
                        selected ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]',
                      )}>
                        <Icon size={15} />
                      </div>
                    )
                  })()}
                  <div className="min-w-0">
                    <div className="truncate text-sm">{d.name}</div>
                    <div className="truncate text-xs text-[color:var(--muted)]">
                      {d.brand} · {CATEGORY_LABELS[d.category]}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {d.price && <span className="font-mono text-xs text-[color:var(--muted)]">€{d.price}</span>}
                  {selected && <CheckCircle2 size={14} className="text-[color:var(--accent)]" />}
                </div>
              </button>
            )
          })}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="w-14 h-14 rounded-full border-2 border-dashed border-[color:var(--border)] flex items-center justify-center mb-3 text-[color:var(--muted)]">
              <Search size={22} />
            </div>
            <div className="text-sm font-medium text-[color:var(--fg)] mb-1">Nichts gefunden</div>
            <div className="text-xs text-[color:var(--muted)] max-w-[240px] leading-relaxed">
              Versuche andere Suchbegriffe oder setze die Filter zurück.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
