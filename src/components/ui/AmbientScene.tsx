import { useEffect, useRef } from 'react'

/**
 * AmbientScene — a GPU-light cinematic atmosphere rendered *behind* the app
 * (fixed, pointer-events-none, z-index -1). It is purely presentational and
 * touches no store/domain/runtime state.
 *
 * Effects, all progressive-enhanced via a quality tier on <html>:
 *  - volumetric light cones (CSS radial gradients, blurred, screen-blended,
 *    slowly drifting + cursor-parallaxed),
 *  - an ambient dust/particle field (single Canvas2D, capped count, DPR≤2),
 *  - cursor parallax exposed as CSS vars (--cursor-x/y, --parallax-x/y) so other
 *    layers can react.
 *
 * Performance budget: one rAF loop, particle count scales with the tier,
 * the loop pauses when the tab is hidden, and the whole layer is disabled for
 * `prefers-reduced-motion` / low-end devices (tier "off").
 */

type Tier = 'high' | 'low' | 'off'

function detectTier(): Tier {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off'
  const nav = navigator as Navigator & { deviceMemory?: number }
  const cores = nav.hardwareConcurrency ?? 8
  const mem = nav.deviceMemory ?? 8
  if (cores <= 4 || mem <= 4) return 'low'
  return 'high'
}

interface Particle { x: number; y: number; r: number; vx: number; vy: number; a: number; cool: boolean }

export function AmbientScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef(0)
  const particles = useRef<Particle[]>([])
  const tx = useRef(0.5)
  const ty = useRef(0.5)
  const cx = useRef(0.5)
  const cy = useRef(0.5)

  useEffect(() => {
    const root = document.documentElement
    const tier = detectTier()
    root.classList.remove('q-high', 'q-low', 'q-off')
    root.classList.add(`q-${tier}`)

    if (tier === 'off') {
      root.style.setProperty('--parallax-x', '0px')
      root.style.setProperty('--parallax-y', '0px')
      return () => { root.classList.remove('q-off') }
    }

    const canvas = canvasRef.current
    const ctx = canvas ? canvas.getContext('2d') : null
    let w = 0
    let h = 0
    const count = tier === 'high' ? 56 : 26

    const seed = () => {
      const arr: Particle[] = []
      for (let i = 0; i < count; i++) {
        arr.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.6 + Math.random() * 1.7,
          vx: (Math.random() - 0.5) * 0.00006,
          vy: -(0.00004 + Math.random() * 0.0001),
          a: 0.05 + Math.random() * 0.16,
          cool: Math.random() < 0.3,
        })
      }
      particles.current = arr
    }

    const resize = () => {
      if (!canvas || !ctx) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const onMove = (e: MouseEvent) => {
      tx.current = e.clientX / Math.max(1, window.innerWidth)
      ty.current = e.clientY / Math.max(1, window.innerHeight)
    }

    let last = performance.now()
    const frame = (now: number) => {
      const dt = Math.min(50, now - last)
      last = now
      cx.current += (tx.current - cx.current) * 0.06
      cy.current += (ty.current - cy.current) * 0.06
      root.style.setProperty('--cursor-x', cx.current.toFixed(4))
      root.style.setProperty('--cursor-y', cy.current.toFixed(4))
      root.style.setProperty('--parallax-x', `${((cx.current - 0.5) * 26).toFixed(2)}px`)
      root.style.setProperty('--parallax-y', `${((cy.current - 0.5) * 26).toFixed(2)}px`)

      if (ctx) {
        ctx.clearRect(0, 0, w, h)
        const ox = (cx.current - 0.5) * 18
        const oy = (cy.current - 0.5) * 18
        for (const p of particles.current) {
          p.x += p.vx * dt
          p.y += p.vy * dt
          if (p.y < -0.02) { p.y = 1.02; p.x = Math.random() }
          if (p.x < -0.02) { p.x = 1.02 } else if (p.x > 1.02) { p.x = -0.02 }
          const sx = p.x * w + ox * (p.r / 2)
          const sy = p.y * h + oy * (p.r / 2)
          ctx.beginPath()
          ctx.arc(sx, sy, p.r, 0, Math.PI * 2)
          ctx.fillStyle = p.cool ? `rgba(230, 204, 134,${p.a})` : `rgba(255,255,255,${p.a})`
          ctx.fill()
        }
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    const onVis = () => {
      cancelAnimationFrame(rafRef.current)
      if (!document.hidden) {
        last = performance.now()
        rafRef.current = requestAnimationFrame(frame)
      }
    }

    seed()
    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('visibilitychange', onVis)
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('visibilitychange', onVis)
      root.classList.remove('q-high', 'q-low')
    }
  }, [])

  return (
    <div className="ambient-root" aria-hidden="true">
      <div className="ambient-cone ambient-cone-1" />
      <div className="ambient-cone ambient-cone-2" />
      <canvas ref={canvasRef} className="ambient-canvas" />
    </div>
  )
}
