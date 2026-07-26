import { useEffect, useRef, useState } from 'react'

/**
 * Tween a number toward `target` with an easeOutCubic over `dur` ms.
 * UI-only; respects prefers-reduced-motion (snaps instantly).
 */
export function useAnimatedNumber(target: number, dur = 420): number {
  const [val, setVal] = useState(target)
  const fromRef = useRef(target)
  const startRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(target)
      return
    }
    fromRef.current = val
    startRef.current = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - startRef.current) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setVal(fromRef.current + (target - fromRef.current) * e)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, dur])

  return val
}
