/**
 * KeyboardHelp — pressing `?` opens a polished overlay listing every
 * keyboard shortcut. Esc to dismiss. Mounted globally so it works on every
 * route.
 */

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface ShortcutGroup { title: string; items: { keys: string[]; label: string }[] }

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Tools',
    items: [
      { keys: ['V'],   label: 'Auswahl-Werkzeug' },
      { keys: ['W'],   label: 'Wand zeichnen' },
      { keys: ['D'],   label: 'Gerät platzieren' },
      { keys: ['F'],   label: 'Möbel platzieren' },
      { keys: ['T'],   label: 'Beschriftung' },
      { keys: ['M'],   label: 'Messen' },
      { keys: ['Esc'], label: 'Tool zurücksetzen' },
    ],
  },
  {
    title: 'Bearbeiten',
    items: [
      { keys: ['R'],         label: 'Drehen +15°' },
      { keys: ['Shift', 'R'],label: 'Drehen −15°' },
      { keys: ['Del'],       label: 'Löschen' },
      { keys: ['Backspace'], label: 'Löschen' },
      { keys: ['↑', '↓', '←', '→'], label: 'Verschieben 1cm' },
      { keys: ['Shift', '↑↓←→'],   label: 'Verschieben 10cm' },
      { keys: ['Cmd/Ctrl', 'Z'],   label: 'Rückgängig' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], label: 'Wiederholen' },
    ],
  },
  {
    title: 'Ansicht',
    items: [
      { keys: ['Space', 'Drag'], label: 'Pannen' },
      { keys: ['Mausrad'],       label: 'Zoom' },
      { keys: ['F'],             label: 'An Fenster anpassen' },
      { keys: ['?'],             label: 'Diese Hilfe' },
    ],
  },
  {
    title: '3D-View',
    items: [
      { keys: ['Klick'],     label: 'Maus locken (Walk-Mode)' },
      { keys: ['WASD'],      label: 'Bewegen (Walk-Mode)' },
      { keys: ['Esc'],       label: 'Pointer freigeben' },
      { keys: ['Drag'],      label: 'Rotieren (Orbit-Mode)' },
      { keys: ['Rechtsklick'], label: 'Pannen (Orbit-Mode)' },
    ],
  },
]

export function KeyboardHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if (inField) return
      // ? in most layouts = Shift+/
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ animation: 'kbdFade 0.18s ease-out' }}
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[rgba(20,16,8,0.45)] backdrop-blur-sm" />

      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] backdrop-blur-md p-6"
        style={{
          boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 12px 32px rgba(20,16,8,0.20), 0 32px 64px rgba(20,16,8,0.18)',
          animation: 'kbdScale 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-[color:var(--muted)] font-medium mb-1">
              Tastenkürzel
            </p>
            <h2 className="font-display text-2xl tracking-tight leading-none">
              Schneller arbeiten mit der Tastatur
            </h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors p-1.5 rounded-md hover:bg-[color:var(--surface-2)]"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>

        {/* Grid of groups */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--accent)] font-medium mb-2 pb-2 border-b border-[color:var(--border)]">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[color:var(--fg)]">{it.label}</span>
                    <span className="flex items-center gap-1">
                      {it.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[10px] font-mono rounded-[5px] border border-[color:var(--border)] bg-[color:var(--bg)] text-[color:var(--fg)]"
                          style={{ boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset, 0 1px 0 rgba(20,16,8,0.08)' }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Hint footer */}
        <div className="mt-5 pt-4 border-t border-[color:var(--border)] flex items-center justify-between text-xs text-[color:var(--muted)]">
          <span>
            Drücke{' '}
            <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 text-[9px] font-mono rounded border border-[color:var(--border)] bg-[color:var(--bg)]">?</kbd>
            {' '}um diese Hilfe ein- oder auszuschalten.
          </span>
          <span className="opacity-60">Esc zum Schließen</span>
        </div>
      </div>

      <style>{`
        @keyframes kbdFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes kbdScale {
          0%   { opacity: 0; transform: scale(0.94) translateY(8px); }
          100% { opacity: 1; transform: scale(1)    translateY(0); }
        }
      `}</style>
    </div>
  )
}
