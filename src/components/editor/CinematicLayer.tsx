import { useEffect, useState } from 'react'
import { onCinematicPulse, type CinematicPulse } from '@/lib/cinematic'

/**
 * CinematicLayer — the visible half of Cinematic Mode. A fixed, click-through
 * overlay that turns each placement into a soft gold ring + a scatter of
 * particles at the cursor, with a perfect ease-out. Deliberately restrained
 * (see cinematic.ts) — luxury, not fireworks. Honours prefers-reduced-motion.
 */

const LIFETIME = 680 // ms — must match the longest animation below

/** Deterministic particle scatter for a pulse (stable across re-renders). */
function particlesFor(id: number, n = 6) {
  const out: { dx: number; dy: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (id % 7) * 0.31
    const d = 24 + ((id * 13 + i * 7) % 18)
    out.push({ dx: Math.round(Math.cos(a) * d), dy: Math.round(Math.sin(a) * d) })
  }
  return out
}

export function CinematicLayer() {
  const [pulses, setPulses] = useState<CinematicPulse[]>([])

  useEffect(() => onCinematicPulse((p) => {
    setPulses((cur) => [...cur, p])
    window.setTimeout(() => setPulses((cur) => cur.filter((q) => q.id !== p.id)), LIFETIME)
  }), [])

  return (
    <div aria-hidden className="cine-layer">
      <style>{CINE_CSS}</style>
      {pulses.map((p) => (
        <div key={p.id} className="cine-pulse" style={{ left: p.x, top: p.y }}>
          <span className="cine-ring" />
          <span className="cine-ring cine-ring--2" />
          {particlesFor(p.id).map((pt, i) => (
            <span key={i} className="cine-dot" style={{ ['--dx' as string]: `${pt.dx}px`, ['--dy' as string]: `${pt.dy}px` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

const CINE_CSS = `
.cine-layer { position: fixed; inset: 0; pointer-events: none; z-index: 60; overflow: hidden; }
.cine-pulse { position: absolute; width: 0; height: 0; }
.cine-ring {
  position: absolute; left: 0; top: 0; width: 40px; height: 40px; border-radius: 50%;
  border: 2px solid var(--accent, #C7A24E);
  transform: translate(-50%, -50%) scale(0.35);
  animation: cineRing 620ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.cine-ring--2 { border-color: var(--accent-bright, #E6CC86); animation-duration: 680ms; animation-delay: 40ms; }
.cine-dot {
  position: absolute; left: 0; top: 0; width: 5px; height: 5px; border-radius: 50%;
  background: var(--accent-bright, #E6CC86); box-shadow: 0 0 6px var(--accent, #C7A24E);
  transform: translate(-50%, -50%);
  animation: cineDot 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
@keyframes cineRing {
  0%   { transform: translate(-50%, -50%) scale(0.35); opacity: 0.85; }
  100% { transform: translate(-50%, -50%) scale(2.0);  opacity: 0; }
}
@keyframes cineDot {
  0%   { transform: translate(-50%, -50%); opacity: 0.95; }
  100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .cine-ring, .cine-dot { animation: none; opacity: 0; }
}
`
