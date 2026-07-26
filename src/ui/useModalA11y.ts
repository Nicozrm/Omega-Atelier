import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
}

export interface ModalA11yOptions {
  open: boolean
  onClose: () => void
  /** The modal panel. Focus is trapped within and moved into it on open. */
  containerRef: RefObject<HTMLElement | null>
}

/**
 * useModalA11y — the shared accessibility behaviour for every modal surface
 * (the `Dialog` primitive and the guided OnboardingTour both consume it).
 *
 * While `open`:
 *   - moves focus into the panel (first focusable, else the panel itself),
 *   - traps Tab / Shift+Tab inside the panel (wrapping at both ends),
 *   - closes on Escape (captured, so it never leaks to global key handlers),
 *   - locks background scroll,
 *   - returns focus to the previously-focused element on close.
 *
 * `onClose` is read through a ref, so the trap effect re-runs only when `open`
 * toggles — not on every parent re-render (e.g. an OnboardingTour step change),
 * which would otherwise tear down and re-arm focus mid-interaction.
 *
 * The consumer is responsible for the ARIA wiring (`role="dialog"`,
 * `aria-modal`, `aria-labelledby`) and for rendering the backdrop — this hook
 * owns only focus + keyboard + scroll behaviour.
 */
export function useModalA11y({ open, onClose, containerRef }: ModalA11yOptions) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const panel = containerRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    const initial = panel ? focusable(panel) : []
    ;(initial[0] ?? panel)?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab' && panel) {
        const items = focusable(panel)
        if (items.length === 0) {
          e.preventDefault()
          panel.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, containerRef])
}
