import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const DOCK_ID = 'omega-canvas-dock'

/**
 * CanvasDock — the one place overlay controls may float over the plan.
 *
 * The three plan overlays (Tagesverlauf, Hörmodus, Funknetz) each used to pin
 * themselves to the canvas with a hand-counted offset — `bottom-16`,
 * `bottom-[104px]`, `bottom-[148px]`, each with a second value for the md
 * breakpoint. That arithmetic only holds while all three are collapsed: expand
 * one and it changes height, and the stack either overlaps or leaves a gap,
 * because no chip knows anything about its neighbours.
 *
 * A flex column knows. The dock owns the anchoring and the spacing; each
 * control contributes only its own content, at whatever height it currently
 * needs.
 *
 * It is a portal rather than a wrapper because two of these controls also draw
 * *on* the plan — the draggable ear, the radio-mesh canvas — and those are
 * positioned against the canvas itself. Nesting the components inside the dock
 * would re-anchor those overlays to a 200px box in the corner.
 */
export function CanvasDock() {
  return (
    <div
      id={DOCK_ID}
      className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col-reverse items-start gap-1.5"
    />
  )
}

/**
 * DockSlot — renders its children into the dock.
 *
 * Falls back to rendering in place when no dock is mounted, so a control is
 * never silently swallowed by a layout that forgot to include one.
 */
export function DockSlot({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)

  // The dock is a sibling that mounts in the same commit, so it is only in the
  // DOM by the time effects run — hence state rather than a render-time lookup.
  useEffect(() => {
    setHost(document.getElementById(DOCK_ID))
  }, [])

  if (!host) return <>{children}</>
  return createPortal(<div className="pointer-events-auto">{children}</div>, host)
}
