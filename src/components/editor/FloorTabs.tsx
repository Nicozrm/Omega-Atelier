import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator'
import { Tooltip } from '@/ui'
import { cn } from '@/lib/utils'

/**
 * FloorTabs — which storey you are working on.
 *
 * Three things used to happen here through the browser's own modal dialogs:
 * adding a floor asked for its name in a `prompt()`, renaming did the same, and
 * deleting went through a `confirm()`. Each one froze the app behind an OS chrome
 * box that cannot be styled, cannot be cancelled with anything but its own two
 * buttons, and looks nothing like the product around it.
 *
 * All three are now in-place. Adding creates "Etage N" and drops straight into
 * the rename field, so naming is a continuation of the same gesture rather than
 * a question asked before anything exists. Deleting just deletes — and offers
 * the undo it always had, in a toast, because a reversible action does not need
 * to be confirmed. Double-click renames, Escape cancels, Enter commits.
 */
export function FloorTabs() {
  const doc = usePlanStore((s) => s.doc)
  const setActiveFloor = usePlanStore((s) => s.setActiveFloor)
  const addFloor = usePlanStore((s) => s.addFloor)
  const removeFloor = usePlanStore((s) => s.removeFloor)
  const renameFloor = usePlanStore((s) => s.renameFloor)
  const undo = usePlanStore((s) => s.undo)
  const pushToast = useUIStore((s) => s.pushToast)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const floors = doc ? doc.floors.slice().sort((a, b) => a.index - b.index) : []
  const activeId = doc?.activeFloorId ?? ''
  const { containerRef, indicatorStyle, ready } = useSlidingIndicator(activeId)

  useEffect(() => {
    if (renamingId) inputRef.current?.select()
  }, [renamingId])

  if (!doc) return null

  const startRename = (id: string, name: string) => { setRenamingId(id); setDraft(name) }

  const commitRename = () => {
    if (!renamingId) return
    const name = draft.trim()
    const current = doc.floors.find((f) => f.id === renamingId)
    if (name && current && name !== current.name) renameFloor(renamingId, name)
    setRenamingId(null)
  }

  const handleAdd = () => {
    const name = `Etage ${doc.floors.length + 1}`
    addFloor(name)
    // `addFloor` makes the new floor active, so the next render can pick it up
    // by id without threading a return value through the store.
    requestAnimationFrame(() => {
      const created = usePlanStore.getState().doc?.activeFloorId
      if (created) startRename(created, name)
    })
  }

  const handleRemove = (id: string, name: string) => {
    removeFloor(id)
    pushToast({
      kind: 'info',
      title: `„${name}" gelöscht`,
      description: 'Zum Rückgängigmachen klicken.',
      duration: 8000,
      onClick: () => undo(),
    })
  }

  return (
    <div className="flex items-center gap-1.5">
      <div ref={containerRef} role="tablist" aria-label="Etage" className="tool-cluster relative max-w-[42vw] overflow-x-auto omega-scroll">
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 rounded-[var(--radius-xs)] will-change-transform"
          style={{
            ...indicatorStyle,
            opacity: ready ? 1 : 0,
            background: 'var(--fill-active)',
            boxShadow: 'inset 0 0 0 1px var(--border-accent), 0 1px 2px rgba(0,0,0,0.28)',
          }}
        />
        {floors.map((f) => {
          const active = f.id === activeId
          if (renamingId === f.id) {
            return (
              <input
                key={f.id}
                ref={inputRef}
                value={draft}
                aria-label="Etage umbenennen"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenamingId(null)
                }}
                className="input h-[1.875rem] w-28 px-2 py-0 text-xs"
              />
            )
          }
          return (
            <div key={f.id} data-seg={f.id} className="group relative z-10 flex items-center">
              <button
                role="tab"
                aria-selected={active}
                onClick={() => setActiveFloor(f.id)}
                onDoubleClick={() => startRename(f.id, f.name)}
                title="Doppelklick zum Umbenennen"
                className={cn(
                  'h-[1.875rem] rounded-[var(--radius-xs)] px-2.5 text-xs font-medium transition-colors duration-200',
                  floors.length > 1 && 'pr-1',
                  active ? 'text-[color:var(--accent-bright)]' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]',
                )}
              >
                {f.name}
              </button>
              {floors.length > 1 && (
                <button
                  aria-label={`Etage ${f.name} löschen`}
                  onClick={() => handleRemove(f.id, f.name)}
                  className={cn(
                    'mr-1 flex h-4 w-4 items-center justify-center rounded-full text-[color:var(--muted)] transition',
                    'hover:bg-[color:var(--fill-hover)] hover:text-[color:var(--danger)] focus-visible:opacity-100',
                    // Visible on the floor you are in, and on whichever one the
                    // pointer is over — never a row of delete buttons at rest.
                    active ? 'opacity-50 hover:opacity-100' : 'opacity-0 group-hover:opacity-60',
                  )}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <Tooltip label="Neue Etage" side="bottom">
        <button onClick={handleAdd} aria-label="Neue Etage hinzufügen" className="tool-btn">
          <Plus size={16} />
        </button>
      </Tooltip>
    </div>
  )
}
