import { useLayoutEffect, useRef, useState, useCallback } from 'react'

/**
 * useSlidingIndicator — the "magic move" pill behind a segmented control.
 *
 * Given a container and the currently-active option, it measures the active
 * segment's box and hands back an inline style that positions a single shared
 * pill under it. The pill then *glides* between segments on the compositor via
 * a CSS transform transition (spring curve from the design tokens) instead of
 * the background hopping instantly from one segment to the next — the signature
 * shared-element interaction Apple/Linear controls use.
 *
 * Renderer-agnostic: it owns no markup, only geometry. Consumers spread
 * `indicatorStyle` onto an absolutely-positioned element inside the container
 * and mark each segment with `data-seg="<value>"`.
 *
 * - First paint places the pill without transition (no glide-in from 0).
 * - `ResizeObserver` + the active value keep it aligned through layout shifts,
 *   font swaps and window resizes.
 * - Under `prefers-reduced-motion` the caller's CSS drops the transition, so
 *   the pill snaps — this hook stays motion-neutral.
 */
export interface SlidingIndicator {
  /** Ref for the positioned container (the track). */
  containerRef: React.RefObject<HTMLDivElement>
  /** Inline style for the shared pill element. */
  indicatorStyle: React.CSSProperties
  /** Whether the pill has a measured position yet (hide until true). */
  ready: boolean
}

export function useSlidingIndicator(activeValue: string): SlidingIndicator {
  const containerRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef(true)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const measure = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const seg = container.querySelector<HTMLElement>(`[data-seg="${cssEscape(activeValue)}"]`)
    // No matching segment (e.g. the active value lives in a sibling group) →
    // clear the box so the pill hides instead of stranding at a stale spot.
    if (!seg) { setBox(null); return }
    // Measure in viewport space (getBoundingClientRect) so a relatively-
    // positioned wrapper between the segment and the track — e.g. a Tooltip
    // span — can't hijack offsetParent. Subtract the track's border
    // (clientLeft/Top) since the pill is positioned from the padding box.
    const c = container.getBoundingClientRect()
    const s = seg.getBoundingClientRect()
    setBox({
      left: s.left - c.left - container.clientLeft,
      top: s.top - c.top - container.clientTop,
      width: s.width,
      height: s.height,
    })
  }, [activeValue])

  useLayoutEffect(() => {
    measure()
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(container)
    container.querySelectorAll('[data-seg]').forEach((el) => ro.observe(el))
    return () => ro.disconnect()
  }, [measure])

  // The very first measured frame should not animate in from the origin.
  const noTransition = firstRef.current
  useLayoutEffect(() => {
    if (box) firstRef.current = false
  }, [box])

  const indicatorStyle: React.CSSProperties = box
    ? {
        transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
        width: box.width,
        height: box.height,
        transition: noTransition
          ? 'none'
          : 'transform var(--spring-panel-ms) var(--spring-panel), width var(--spring-panel-ms) var(--spring-panel)',
      }
    : { opacity: 0 }

  return { containerRef, indicatorStyle, ready: !!box }
}

/** Minimal CSS.escape shim (attribute selector values may hold odd chars). */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\\]]/g, '\\$&')
}
