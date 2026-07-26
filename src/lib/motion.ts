/**
 * motion.ts — physical motion for the interface (Fluid Interfaces).
 *
 * The premium feel of spring physics without a runtime animation library:
 * a damped-harmonic-oscillator solver renders each spring ONCE into a native
 * CSS `linear()` easing curve + duration. Transitions then run entirely on
 * the browser's compositor thread — zero JavaScript per frame, zero React
 * re-renders, zero impact on the WebGL render loop.
 *
 * `installMotion()` upgrades the `--spring-*` design tokens at startup on
 * browsers that support `linear()`; everywhere else the CSS keeps its
 * cubic-bezier fallbacks. Under `prefers-reduced-motion` nothing is
 * upgraded (and the global reduce rule disables durations anyway).
 */

export interface SpringSpec {
  /** Spring constant k — higher = faster. */
  stiffness: number
  /** Viscous damping c — lower = more overshoot/bounce. */
  damping: number
  mass?: number
}

export interface SpringCurve {
  /** CSS `linear(…)` easing string sampling the spring, 0 → 1. */
  easing: string
  /** Time until the spring has physically settled (|x−1| < ε). */
  durationMs: number
  /** The sampled positions (useful for tests / debugging). */
  samples: number[]
}

interface CurveOptions {
  /** Settle tolerance. Default 0.001 (0.1 % of travel). */
  epsilon?: number
  /** Hard cap for the settle search. Default 1200 ms. */
  maxMs?: number
  /** Sample count for the `linear()` curve. Default 64. */
  points?: number
}

/**
 * Displacement-from-target y(t) for x(0)=0, v(0)=0, target 1 — the analytic
 * solution of the damped harmonic oscillator in all three damping regimes.
 */
function makeOscillator(spec: SpringSpec): (tSec: number) => number {
  const m = spec.mass ?? 1
  const w0 = Math.sqrt(spec.stiffness / m)
  const zeta = spec.damping / (2 * Math.sqrt(spec.stiffness * m))

  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return (t) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t))
  }
  if (zeta === 1) {
    return (t) => Math.exp(-w0 * t) * (1 + w0 * t)
  }
  const s = Math.sqrt(zeta * zeta - 1)
  const r1 = -w0 * (zeta - s)
  const r2 = -w0 * (zeta + s)
  return (t) => (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
}

/** Render a spring into a CSS `linear()` easing + its physical duration. */
export function springCurve(spec: SpringSpec, opts: CurveOptions = {}): SpringCurve {
  const epsilon = opts.epsilon ?? 0.001
  const maxMs = opts.maxMs ?? 1200
  const points = Math.max(16, opts.points ?? 64)
  const y = makeOscillator(spec)

  // Settle time: the LAST millisecond the spring is outside the tolerance.
  let settleMs = 0
  for (let t = 0; t <= maxMs; t++) {
    if (Math.abs(y(t / 1000)) >= epsilon) settleMs = t
  }
  const durationMs = Math.max(120, Math.min(maxMs, settleMs + 1))

  const samples: number[] = []
  const parts: string[] = []
  for (let i = 0; i <= points; i++) {
    const f = i / points
    const x = i === points ? 1 : 1 - y((f * durationMs) / 1000)
    samples.push(x)
    parts.push(`${Math.round(x * 10_000) / 10_000} ${Math.round(f * 10_000) / 100}%`)
  }
  return { easing: `linear(${parts.join(', ')})`, durationMs, samples }
}

/**
 * The interface's spring vocabulary. Three voices are enough — more would
 * make the motion language mushy:
 *  - pop:    press/release of controls — a fast, barely-visible rebound.
 *  - panel:  panels, sheets, palettes — weight without wobble.
 *  - bounce: entrances (toasts, popovers) — one playful overshoot.
 */
export const SPRINGS: Record<'pop' | 'panel' | 'bounce', SpringSpec> = {
  pop: { stiffness: 560, damping: 35.5 }, // ζ≈0.75 → ~3 % overshoot
  panel: { stiffness: 420, damping: 36.9 }, // ζ≈0.90 → settles, no wobble
  bounce: { stiffness: 340, damping: 20.3 }, // ζ≈0.55 → ~12 % overshoot
}

/**
 * Upgrade the `--spring-*` CSS tokens to real physics. Call once at startup;
 * safe everywhere (no-ops without DOM, without `linear()` support, or when
 * the user prefers reduced motion).
 */
export function installMotion(root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null): void {
  if (!root || typeof CSS === 'undefined' || !CSS.supports?.('transition-timing-function', 'linear(0, 1)')) return
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (const [name, spec] of Object.entries(SPRINGS)) {
    const { easing, durationMs } = springCurve(spec)
    root.style.setProperty(`--spring-${name}`, easing)
    root.style.setProperty(`--spring-${name}-ms`, `${durationMs}ms`)
  }
}
