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
      <div className="lib-head">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
          <input
            className="input pl-9"
            placeholder="Gerät suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
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

      <div className="flex-1 overflow-y-auto omega-scroll px-1.5 pb-2">
        <div className="lib-eyebrow">
          <span>{filtered.length} {filtered.length === 1 ? 'Ergebnis' : 'Ergebnisse'}</span>
          {(query || ecosystem !== 'all' || category !== 'all') && (
            <button
              onClick={() => { setQuery(''); setEcosystem('all'); setCategory('all') }}
              className="text-[0.6875rem] font-medium normal-case tracking-normal text-[color:var(--accent-bright)] hover:underline"
            >
              Zurücksetzen
            </button>
          )}
        </div>
        <div className="space-y-px">
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
                aria-pressed={selected}
                className={cn('lib-row', selected && 'is-selected')}
              >
                {(() => {
                  const Icon = CATEGORY_ICONS[d.category] ?? Cpu
                  return <span className="lib-thumb"><Icon size={15} /></span>
                })()}
                <span className="min-w-0 flex-1">
                  <span className="lib-name block">{d.name}</span>
                  <span className="lib-meta block">{d.brand} · {CATEGORY_LABELS[d.category]}</span>
                </span>
                {d.price && <span className="lib-price">€{d.price}</span>}
                {selected && <CheckCircle2 size={14} className="shrink-0 text-[color:var(--accent-bright)]" />}
              </button>
            )
          })}
        </div>
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--fill-quiet)] text-[color:var(--muted)]">
              <Search size={19} />
            </span>
            <div className="mb-1 text-sm font-medium text-[color:var(--fg)]">Nichts gefunden</div>
            <div className="max-w-[220px] text-xs leading-relaxed text-[color:var(--muted)]">
              Versuche andere Suchbegriffe oder setze die Filter zurück.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
