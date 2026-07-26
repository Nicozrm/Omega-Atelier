/**
 * UI-level state: theme toggle, panels open/closed, toasts, command palette.
 * Kept separate from the plan so UI changes never pollute undo history.
 */

import { create } from 'zustand'
import { uuid } from '@/lib/utils'

export type LibraryTab = 'devices' | 'furniture' | 'templates'
export type PanelKey = 'library' | 'modes' | 'properties' | 'layers' | 'comments'
/** Which workspace the center pane shows. The 3D view lives *inside* the editor
 *  shell (framed by the library + inspector rails), not as a fullscreen overlay.
 *  'twin' is the Digital-Twin tab: the same live 3D scene, opened with the
 *  device/mode state in focus (reference top-tab triple). */
export type ViewMode = '2d' | '3d' | 'twin'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error' | 'warning'
  title: string
  description?: string
  duration?: number
  /** Optional click handler; if provided, the whole toast becomes a button. */
  onClick?: () => void
}

interface UIState {
  theme: 'dark' | 'light'
  viewMode: ViewMode
  mobilePanel: PanelKey | null
  desktopPanels: Record<PanelKey, boolean>
  /** Collapse state for the two main workspace rails. */
  leftRailOpen: boolean
  rightRailOpen: boolean
  libraryTab: LibraryTab
  commandOpen: boolean
  onboardingShown: boolean
  toasts: Toast[]

  setTheme: (t: 'dark' | 'light') => void
  toggleTheme: () => void
  setViewMode: (m: ViewMode) => void

  openMobilePanel: (p: PanelKey | null) => void
  toggleDesktopPanel: (p: PanelKey) => void
  toggleLeftRail: () => void
  toggleRightRail: () => void
  setLibraryTab: (t: LibraryTab) => void
  setCommandOpen: (open: boolean) => void
  setOnboardingShown: (shown: boolean) => void

  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
}

const THEME_KEY = 'omega.theme'
const ONBOARDING_KEY = 'omega.onboarded'

function initialTheme(): 'dark' | 'light' {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* */ }
  return 'dark'
}

function applyTheme(t: 'dark' | 'light') {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(t)
  try { localStorage.setItem(THEME_KEY, t) } catch { /* */ }
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: initialTheme(),
  viewMode: '2d',
  mobilePanel: null,
  desktopPanels: { library: true, modes: true, properties: true, layers: false, comments: false },
  leftRailOpen: (() => { try { return localStorage.getItem('omega.leftRail') !== '0' } catch { return true } })(),
  rightRailOpen: (() => { try { return localStorage.getItem('omega.rightRail') !== '0' } catch { return true } })(),
  libraryTab: 'devices',
  commandOpen: false,
  onboardingShown: (() => { try { return localStorage.getItem(ONBOARDING_KEY) === '1' } catch { return true } })(),
  toasts: [],

  setTheme: (t) => { applyTheme(t); set({ theme: t }) },
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next); set({ theme: next })
  },
  setViewMode: (m) => set({ viewMode: m }),

  openMobilePanel: (p) => set({ mobilePanel: p }),
  toggleDesktopPanel: (p) =>
    set({ desktopPanels: { ...get().desktopPanels, [p]: !get().desktopPanels[p] } }),
  toggleLeftRail: () => {
    const next = !get().leftRailOpen
    try { localStorage.setItem('omega.leftRail', next ? '1' : '0') } catch { /* */ }
    set({ leftRailOpen: next })
  },
  toggleRightRail: () => {
    const next = !get().rightRailOpen
    try { localStorage.setItem('omega.rightRail', next ? '1' : '0') } catch { /* */ }
    set({ rightRailOpen: next })
  },
  setLibraryTab: (t) => set({ libraryTab: t }),
  setCommandOpen: (open) => set({ commandOpen: open }),
  setOnboardingShown: (shown) => {
    try { localStorage.setItem(ONBOARDING_KEY, shown ? '1' : '0') } catch { /* */ }
    set({ onboardingShown: shown })
  },

  pushToast: (t) => {
    const toast: Toast = { id: uuid(), duration: 3200, ...t }
    set({ toasts: [...get().toasts, toast] })
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => get().dismissToast(toast.id), toast.duration)
    }
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

// Apply theme to <html> on load
if (typeof document !== 'undefined') {
  applyTheme(useUIStore.getState().theme)
}
