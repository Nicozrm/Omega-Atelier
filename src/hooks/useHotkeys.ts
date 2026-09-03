/**
 * Global hotkey handler. Wires Undo/Redo, tool shortcuts, ⌘K, Delete, etc.
 * Mount once near the root.
 */
import { useEffect } from 'react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { TOOL_HOTKEYS } from '@/lib/constants'
import type { Tool } from '@/types'

export function useGlobalHotkeys() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      // Ignore while typing in inputs/textareas
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const meta = e.metaKey || e.ctrlKey

      // Command palette
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUIStore.getState().setCommandOpen(!useUIStore.getState().commandOpen)
        return
      }

      /*
       * Rail toggles — ⌥1 / ⌥2, as advertised in the top bar's Ansicht menu.
       *
       * Matched on `e.code`, not `e.key`: Alt+1 emits "¡" on a Mac layout and
       * "1" on a PC one, so testing the character would wire the shortcut to
       * exactly one keyboard. `code` is the physical key either way. This runs
       * before the plain-digit zoom shortcuts below, which would otherwise also
       * fire on the same press.
       */
      if (e.altKey && !meta && (e.code === 'Digit1' || e.code === 'Digit2')) {
        e.preventDefault()
        const ui = useUIStore.getState()
        if (e.code === 'Digit1') ui.toggleLeftRail()
        else ui.toggleRightRail()
        return
      }

      // Undo / Redo
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) usePlanStore.getState().redo()
        else usePlanStore.getState().undo()
        return
      }

      // Save
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void usePlanStore.getState().saveToCloud()
        useUIStore.getState().pushToast({ kind: 'success', title: 'Speichern…' })
        return
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selection } = usePlanStore.getState()
        if (selection.type) {
          e.preventDefault()
          usePlanStore.getState().deleteSelection()
        }
        return
      }

      // Tool shortcuts
      const key = e.key.toLowerCase()
      if (TOOL_HOTKEYS[key]) {
        usePlanStore.getState().setTool(TOOL_HOTKEYS[key] as Tool)
      }

      // Zoom
      if (key === '+' || key === '=') {
        const { viewport, setViewport } = usePlanStore.getState()
        setViewport({ zoom: Math.min(6, viewport.zoom * 1.15) })
      }
      if (key === '-' || key === '_') {
        const { viewport, setViewport } = usePlanStore.getState()
        setViewport({ zoom: Math.max(0.05, viewport.zoom / 1.15) })
      }
      // Fit-to-view & 100%
      if (key === '0') {
        const cvs = document.querySelector('canvas') as HTMLCanvasElement | null
        if (cvs) {
          const r = cvs.getBoundingClientRect()
          usePlanStore.getState().fitToView(r.width, r.height, 60)
        }
      }
      if (key === '1' && !meta) {
        const { setViewport } = usePlanStore.getState()
        setViewport({ zoom: 1 })
      }

      // Shift+Enter applies the active mode
      if (e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        const { applyMode, doc } = usePlanStore.getState()
        if (!doc) return
        const result = applyMode()
        useUIStore.getState().pushToast({
          kind: 'success',
          title: 'Modus angewendet',
          description: `${result.applied} Geräte konfiguriert${result.skipped ? `, ${result.skipped} übersprungen` : ''}.`,
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
