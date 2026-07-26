import {
  createContext, useContext, useState, useRef, useEffect, useCallback, useId,
  type ReactNode, type CSSProperties,
} from 'react'
import { cn } from '@/lib/utils'

/**
 * Menu — an accessible dropdown menu (WAI-ARIA menu-button pattern).
 *
 * Replaces the `:hover`-only popover: opens on click/Enter/Space/ArrowDown,
 * closes on Escape / outside-click / select and returns focus to the trigger,
 * and supports full roving keyboard navigation (Up/Down/Home/End, type-ahead
 * via native focus). Panel springs open from its anchored corner and honours
 * `prefers-reduced-motion` through the global reduce rule.
 *
 * Compound API:
 *   <Menu trigger={(p) => <IconButton {...p}>…</IconButton>} align="end">
 *     <Menu.Label>user@example.com</Menu.Label>
 *     <Menu.Item icon={<LogOut/>} onSelect={signOut}>Abmelden</Menu.Item>
 *   </Menu>
 */

interface MenuCtx {
  close: () => void
  panelRef: React.RefObject<HTMLDivElement>
}
const Ctx = createContext<MenuCtx | null>(null)

interface TriggerProps {
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

export interface MenuProps {
  trigger: (props: TriggerProps & { ref: React.Ref<HTMLButtonElement> }) => ReactNode
  children: ReactNode
  /** Anchor the panel to the start or end edge of the trigger. */
  align?: 'start' | 'end'
  className?: string
}

export function Menu({ trigger, children, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Move focus to the first item when the menu opens.
  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
    first?.focus()
  }, [open])

  // Outside click / Escape while open.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const items = () =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    const list = items()
    if (list.length === 0) return
    const idx = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1) % list.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(idx - 1 + list.length) % list.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    else if (e.key === 'Tab') { setOpen(false) }
  }

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const panelStyle: CSSProperties = {
    transformOrigin: align === 'end' ? 'top right' : 'top left',
  }

  return (
    <Ctx.Provider value={{ close, panelRef }}>
      <div className={cn('relative', className)}>
        {trigger({
          ref: triggerRef,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen((v) => !v),
          onKeyDown: onTriggerKeyDown,
        })}
        {open && (
          <div
            ref={panelRef}
            role="menu"
            id={menuId}
            aria-orientation="vertical"
            onKeyDown={onPanelKeyDown}
            style={panelStyle}
            className={cn(
              'absolute top-full z-50 mt-1.5 min-w-[12rem] origin-top-right animate-pop-in',
              'surface-glass rounded-[var(--radius-lg)] p-1',
              align === 'end' ? 'right-0' : 'left-0',
            )}
          >
            {children}
          </div>
        )}
      </div>
    </Ctx.Provider>
  )
}

/** A non-interactive header row (e.g. the signed-in account). */
function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="truncate border-b border-[color:var(--border)] px-3 py-2 text-xs text-[color:var(--muted)]">
      {children}
    </div>
  )
}

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  icon?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
}

function MenuItem({ children, onSelect, icon, tone = 'default', disabled }: MenuItemProps) {
  const ctx = useContext(Ctx)
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => { if (disabled) return; onSelect?.(); ctx?.close() }}
      className={cn(
        'flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition-colors duration-150',
        'focus:outline-none focus-visible:outline-none',
        disabled
          ? 'cursor-not-allowed text-[color:var(--muted)] opacity-60'
          : tone === 'danger'
            ? 'text-[color:var(--color-omega-danger)] hover:bg-[rgba(255,77,77,0.10)] focus:bg-[rgba(255,77,77,0.10)]'
            : 'text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] focus:bg-[color:var(--surface-2)]',
      )}
    >
      {icon && <span className="flex h-4 w-4 items-center justify-center text-[color:inherit] opacity-80">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  )
}

/** A thin divider between item groups. */
function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-[color:var(--border)]" />
}

Menu.Label = MenuLabel
Menu.Item = MenuItem
Menu.Separator = MenuSeparator
