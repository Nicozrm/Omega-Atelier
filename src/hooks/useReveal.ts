import { useEffect, useRef, useState } from 'react'

/**
 * useReveal — reveal an element once, the first time it scrolls into view.
 *
 * The landing page's only ambient motion: a single, gentle rise-and-fade per
 * block that guides attention down the page, instead of many effects competing
 * at once. Fires once, then disconnects. Under `prefers-reduced-motion` the
 * element is shown immediately with no transition.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true)
      return
    }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setShown(true); io.disconnect(); break }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return { ref, shown }
}
