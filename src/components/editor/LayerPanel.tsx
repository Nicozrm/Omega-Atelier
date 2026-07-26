import { Eye, EyeOff } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import type { LayerKey } from '@/types'

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'walls', label: 'Wände' },
  { key: 'furniture', label: 'Möbel' },
  { key: 'devices', label: 'Geräte' },
  { key: 'labels', label: 'Beschriftungen' },
]

export function LayerPanel() {
  const doc = usePlanStore((s) => s.doc)
  const toggleLayer = usePlanStore((s) => s.toggleLayer)
  const floor = doc?.floors.find((f) => f.id === doc.activeFloorId)
  if (!floor) return null

  return (
    <div className="space-y-1">
      {LAYERS.map((l) => {
        const on = floor.layers[l.key]
        return (
          <button
            key={l.key}
            onClick={() => toggleLayer(l.key)}
            className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-sm hover:bg-[color:var(--surface-2)] transition-colors"
          >
            <span className={on ? '' : 'text-[color:var(--muted)] line-through'}>{l.label}</span>
            {on ? <Eye size={14} className="text-[color:var(--accent-bright)]" /> : <EyeOff size={14} className="text-[color:var(--muted)]" />}
          </button>
        )
      })}
    </div>
  )
}
