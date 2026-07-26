/**
 * Keyboard Shortcuts Help Overlay
 * Shows all available shortcuts. Triggered by "?" key.
 */

import { useState, useEffect } from 'react'
import { X, Keyboard, MousePointer, ZoomIn, Move, Undo, Redo, Save, Download } from 'lucide-react'

interface ShortcutGroup {
  title: string
  shortcuts: { keys: string; action: string; icon?: React.ReactNode }[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: 'Leertaste + Ziehen', action: 'Pan / Verschieben', icon: <Move size={14} /> },
      { keys: 'Scroll', action: 'Zoom rein/raus', icon: <ZoomIn size={14} /> },
      { keys: 'Shift + Scroll', action: 'Schneller Zoom', icon: <ZoomIn size={14} /> },
    ],
  },
  {
    title: 'Werkzeuge',
    shortcuts: [
      { keys: 'W', action: 'Wand-Werkzeug', icon: <MousePointer size={14} /> },
      { keys: 'D', action: 'Gerät-Werkzeug', icon: <MousePointer size={14} /> },
      { keys: 'F', action: 'Möbel-Werkzeug', icon: <MousePointer size={14} /> },
      { keys: 'L', action: 'Label-Werkzeug', icon: <MousePointer size={14} /> },
      { keys: 'V', action: 'Auswahl-Werkzeug', icon: <MousePointer size={14} /> },
      { keys: 'ESC', action: 'Werkzeug abbrechen', icon: <X size={14} /> },
    ],
  },
  {
    title: 'Aktionen',
    shortcuts: [
      { keys: '⌘/Ctrl + Z', action: 'Rückgängig', icon: <Undo size={14} /> },
      { keys: '⌘/Ctrl + Shift + Z', action: 'Wiederherstellen', icon: <Redo size={14} /> },
      { keys: '⌘/Ctrl + S', action: 'Speichern', icon: <Save size={14} /> },
      { keys: '⌘/Ctrl + E', action: 'Exportieren', icon: <Download size={14} /> },
      { keys: 'Löschen', action: 'Auswahl löschen', icon: <X size={14} /> },
    ],
  },
  {
    title: 'Ansicht',
    shortcuts: [
      { keys: 'G', action: 'Grid ein/aus', icon: <MousePointer size={14} /> },
      { keys: '?', action: 'Diese Hilfe', icon: <Keyboard size={14} /> },
    ],
  },
]

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-fade-in">
      <div className="surface w-full max-w-md mx-4 p-5 animate-slide-up">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg flex items-center gap-2">
            <Keyboard size={20} className="text-[color:var(--accent)]" />
            Tastaturkürzel
          </h3>
          <button onClick={() => setOpen(false)} className="btn btn-ghost btn-icon">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto omega-scroll pr-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-xs uppercase tracking-wider text-[color:var(--muted)] mb-2">{g.title}</h4>
              <div className="space-y-1.5">
                {g.shortcuts.map((s) => (
                  <div key={s.action} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-[color:var(--surface-2)]/50">
                    <div className="flex items-center gap-2 text-sm">
                      {s.icon && <span className="text-[color:var(--muted)]">{s.icon}</span>}
                      {s.action}
                    </div>
                    <kbd className="px-2 py-0.5 rounded text-xs font-mono bg-[color:var(--surface-2)] border border-[color:var(--border)] text-[color:var(--fg)]">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-center text-[color:var(--muted)]">
          Drücke <kbd className="px-1.5 py-0.5 rounded text-xs font-mono bg-[color:var(--surface-2)] border border-[color:var(--border)]">?</kbd> jederzeit für diese Hilfe
        </p>
      </div>
    </div>
  )
}
