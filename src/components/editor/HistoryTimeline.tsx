/**
 * Undo/Redo History Timeline
 * Shows the current position in history and allows jumping back/forth.
 */

import { usePlanStore } from '@/store/usePlanStore'
import { Undo, Redo, History } from 'lucide-react'

export function HistoryTimeline() {
  const past = usePlanStore((s) => s.past)
  const future = usePlanStore((s) => s.future)
  const undo = usePlanStore((s) => s.undo)
  const redo = usePlanStore((s) => s.redo)
  const canUndo = past.length > 0
  const canRedo = future.length > 0

  const total = past.length + future.length + 1
  const current = past.length + 1

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 surface px-3 py-2 rounded-full shadow-soft">
      <button
        onClick={undo}
        disabled={!canUndo}
        className="btn btn-ghost btn-icon touch-target disabled:opacity-30"
        title="Rückgängig (Ctrl+Z)"
      >
        <Undo size={16} />
      </button>

      <div className="flex items-center gap-1.5 min-w-[80px] justify-center">
        <History size={12} className="text-[color:var(--muted)]" />
        <span className="text-xs font-mono text-[color:var(--fg)]">
          {current} / {total}
        </span>
      </div>

      {/* Mini timeline dots */}
      <div className="flex items-center gap-0.5">
        {total <= 20 ? (
          Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition ${
                i < current
                  ? 'bg-[color:var(--accent)]'
                  : i === current - 1
                  ? 'bg-[color:var(--accent)] scale-125'
                  : 'bg-[color:var(--surface-2)]'
              }`}
            />
          ))
        ) : (
          <div className="flex items-center gap-1 text-xs text-[color:var(--muted)]">
            <div className="w-16 h-1 rounded-full bg-[color:var(--surface-2)] overflow-hidden">
              <div
                className="h-full bg-[color:var(--accent)] transition-all"
                style={{ width: `${(current / total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={redo}
        disabled={!canRedo}
        className="btn btn-ghost btn-icon touch-target disabled:opacity-30"
        title="Wiederherstellen (Ctrl+Shift+Z)"
      >
        <Redo size={16} />
      </button>
    </div>
  )
}
