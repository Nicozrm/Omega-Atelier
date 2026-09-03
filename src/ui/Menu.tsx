import {
  createContext, useContext, useState, useRef, useEffect, useCallback, useId,
  useLayoutEffect, type ReactNode, type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Menu — an accessible dropdown menu (WAI-ARIA menu-button pattern).
 *
 * Opens on click/Enter/Space/ArrowDown, closes on Escape / outside-click /
 * select and returns focus to the trigger, with roving keyboard navigation
 * (Up/Down/Home/End).
 *
 * ## Why the panel is portalled
 *
 * The menus that matter most in this app hang off the top bar, which is a
 * `backdrop-blur` glass strip inside a `overflow-hidden` column. An absolutely
 * positioned panel was clipped by that column the moment it grew past the bar,
 * and a blurred ancestor also becomes a containing block for fixed children —
 * so the panel renders on `<body>` and is anchored to the trigger's viewport
 * rect instead. That also lets it flip and clamp itself against the viewport
 * rather than disappearing off the edge on a laptop screen.
 *
 * ## Structure over icon soup
 *
 * A workspace this dense cannot put every action in the bar; what it can do is
 * name them. Hence sections with headings, a fixed icon column so labels align
 * into a readable list, right-aligned shortcut hints, and check marks for the
 * toggles — the reader scans one column of words, not a row of glyphs.
 *
 * Compound API:
 *   <Menu trigger={(p) => <IconButton {...p}>…</IconButton>} align="end">
 *     <Menu.Section title="Plan">
 *       <Menu.Item icon={<Share2/>} shortcut="⌘⇧S" onSelect={share}>Teilen …</Menu.Item>
 *     </Menu.Section>
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
  /** Minimum panel width in px. Defaults to a comfortable 15rem. */
  minWidth?: number
  className?: string
}

/** Gap between trigger and panel, and the margin kept to the viewport edge. */
const GAP = 6
const EDGE = 10

/**
 * Every focusable row, whichever role it carries. A toggle row is a
 * `menuitemcheckbox` so screen readers announce its state, and it still has to
 * take its turn under Arrow-key navigation — hence both roles here rather than
 * a bare `[role="menuitem"]`, which would silently skip every toggle.
 */
const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"])'

/**
 * Where the panel sits, in viewport coordinates. A flipped panel is pinned by
 * its `bottom` edge rather than translated up: the open animation owns
 * `transform`, so anything positional put there is wiped the moment it lands.
 */
interface Anchor {
  left: number
  top?: number
  bottom?: number
  origin: string
  maxHeight: number
}

export function Menu({ trigger, children, align = 'end', minWidth = 240, className }: MenuProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  /**
   * Anchor the panel to the trigger in viewport coordinates, then keep it on
   * screen: clamp horizontally, and flip above the trigger when the space below
   * is the smaller half. `maxHeight` is what stops a long menu from running off
   * the bottom — it scrolls inside itself instead.
   */
  const place = useCallback(() => {
    const t = triggerRef.current?.getBoundingClientRect()
    if (!t) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.max(panelRef.current?.offsetWidth ?? 0, minWidth)

    let left = align === 'end' ? t.right - width : t.left
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - width - EDGE))

    const below = vh - t.bottom - GAP - EDGE
    const above = t.top - GAP - EDGE
    const flip = below < 220 && above > below

    setAnchor({
      left,
      top: flip ? undefined : t.bottom + GAP,
      bottom: flip ? vh - t.top + GAP : undefined,
      origin: `${flip ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`,
      maxHeight: Math.max(160, flip ? above : below),
    })
  }, [align, minWidth])

  // Place before paint so the panel never flashes at the wrong corner, then
  // re-place once its real width is known.
  useLayoutEffect(() => {
    if (!open) { setAnchor(null); return }
    place()
    const raf = requestAnimationFrame(place)
    return () => cancelAnimationFrame(raf)
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  // Move focus to the first item when the menu opens.
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
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

  const items = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])

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
    position: 'fixed',
    left: anchor?.left ?? -9999,
    top: anchor?.bottom === undefined ? (anchor?.top ?? -9999) : undefined,
    bottom: anchor?.bottom,
    minWidth,
    maxHeight: anchor?.maxHeight,
    transformOrigin: anchor?.origin ?? 'top right',
    visibility: anchor ? 'visible' : 'hidden',
  }

  const panel = open && (
    <div
      ref={panelRef}
      role="menu"
      id={menuId}
      aria-orientation="vertical"
      onKeyDown={onPanelKeyDown}
      style={panelStyle}
      className="menu-panel z-[80] overflow-y-auto omega-scroll"
    >
      {children}
    </div>
  )

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
        {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : panel}
      </div>
    </Ctx.Provider>
  )
}

/** A non-interactive header row (e.g. the signed-in account). */
function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('menu-label', className)}>{children}</div>
  )
}

/**
 * A titled group of items. The heading is what turns a list of glyphs into a
 * scannable menu: "Werkzeuge", "Plan", "Ansicht" tell you where to look before
 * you read a single item.
 */
function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="menu-section" role="group" aria-label={title}>
      {title && <div className="menu-section-title">{title}</div>}
      {children}
    </div>
  )
}

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  icon?: ReactNode
  /** Keyboard hint, right-aligned (e.g. `⌘K`). */
  shortcut?: string
  /** Secondary line under the label — one short phrase, never a paragraph. */
  description?: string
  /** Renders a check mark in the icon column; use for toggles. */
  checked?: boolean
  /** Right-aligned adornment (badge, status). Wins over `shortcut`. */
  trailing?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Responsive visibility, for rows that duplicate a button the bar drops. */
  className?: string
}

function MenuItem({
  children, onSelect, icon, shortcut, description, checked, trailing, tone = 'default', disabled,
  className,
}: MenuItemProps) {
  const ctx = useContext(Ctx)
  const isToggle = checked !== undefined
  return (
    <button
      role={isToggle ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isToggle ? checked : undefined}
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => { if (disabled) return; onSelect?.(); ctx?.close() }}
      className={cn('menu-item', tone === 'danger' && 'is-danger', disabled && 'is-disabled', className)}
      data-tone={tone}
    >
      <span className="menu-item-icon" aria-hidden>
        {isToggle ? (checked ? <Check size={14} /> : null) : icon}
      </span>
      <span className="menu-item-body">
        <span className="menu-item-label">{children}</span>
        {description && <span className="menu-item-desc">{description}</span>}
      </span>
      {trailing
        ? <span className="menu-item-trailing">{trailing}</span>
        : shortcut && <kbd className="menu-item-kbd">{shortcut}</kbd>}
    </button>
  )
}

/** A thin divider between item groups. */
function MenuSeparator() {
  return <div role="separator" className="menu-separator" />
}

Menu.Label = MenuLabel
Menu.Section = MenuSection
Menu.Item = MenuItem
Menu.Separator = MenuSeparator
