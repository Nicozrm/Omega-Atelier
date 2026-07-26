import { Plus, Layers, X } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { cn } from '@/lib/utils'

export function FloorTabs() {
  const doc = usePlanStore((s) => s.doc)
  const setActiveFloor = usePlanStore((s) => s.setActiveFloor)
  const addFloor = usePlanStore((s) => s.addFloor)
  const removeFloor = usePlanStore((s) => s.removeFloor)
  const renameFloor = usePlanStore((s) => s.renameFloor)

  if (!doc) return null

  const handleAddFloor = () => {
    const name = prompt('Name der neuen Etage', `Etage ${doc.floors.length + 1}`)
    if (name) addFloor(name)
  }

  return (
    <div className="flex items-center gap-1 surface px-2 py-1.5 shadow-[var(--shadow-soft)]">
      <Layers size={14} className="mr-1 text-[color:var(--accent)]" />
      <div className="flex items-center gap-0.5 overflow-x-auto omega-scroll">
        {doc.floors
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((f) => {
            const active = f.id === doc.activeFloorId
            return (
              <div
                key={f.id}
                onClick={() => setActiveFloor(f.id)}
                onDoubleClick={() => {
                  const name = prompt('Etage umbenennen', f.name)
                  if (name) renameFloor(f.id, name)
                }}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-md px-3 py-1 text-sm transition',
                  active
                    ? 'bg-[color:var(--accent)] text-white'
                    : 'text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]',
                )}
              >
                <span>{f.name}</span>
                {doc.floors.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Etage "${f.name}" löschen?`)) removeFloor(f.id)
                    }}
                    className="opacity-0 transition group-hover:opacity-60 hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )
          })}
      </div>
      <button onClick={handleAddFloor} className="btn btn-ghost btn-sm" title="Neue Etage">
        <Plus size={14} /> Etage
      </button>
    </div>
  )
}
