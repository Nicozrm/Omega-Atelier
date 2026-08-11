import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { activeProfile } from '@/lib/render/quality'

/**
 * AdaptiveQuality — how the view affords "maximum quality" *and* "maximum
 * performance" at the same time, which sounds contradictory only if you assume
 * the two are needed in the same instant. They are not:
 *
 *  - **While the camera moves**, the eye cannot resolve fine detail anyway, and
 *    what it *does* notice instantly is a dropped frame. So motion renders at
 *    the profile's low resolution and buys smoothness.
 *  - **The moment the camera settles**, the frame becomes a photograph the user
 *    will study. Resolution then climbs in steps well past the display's native
 *    pixel ratio — supersampling — until either the profile's ceiling or the
 *    frame-time budget is reached. Every edge, every texture, every specular
 *    highlight resolves at 2×+ and is downsampled into the display buffer.
 *
 * The result is that an orbit stays at a smooth frame rate and the still frame
 * the user actually looks at is dramatically sharper than a fixed-DPR render at
 * the same average cost.
 *
 * Two more governors ride along:
 *
 *  - **Frame-time back-off.** Each resolution step is measured. If a step
 *    pushes the median frame time past budget, the previous step becomes the
 *    session's ceiling — the ramp learns this machine's real limit instead of
 *    trusting the profile blindly.
 *  - **Shadow-map scheduling.** A 4096² directional shadow map costs a full
 *    scene re-render per frame, and in a still architectural scene it produces
 *    the *identical* result every time. With static content the map is rendered
 *    on demand — when the sun moves, when the profile changes, when the view
 *    mounts — instead of 60×/s. That single change is typically the largest
 *    frame-time saving in the whole view.
 */

export interface RenderStats {
  fps: number
  /** Device-pixel-ratio currently being rendered at. */
  dpr: number
  /** True while the resolution ramp is still climbing toward the ceiling. */
  refining: boolean
  /** Ceiling the frame-time governor settled on (≤ profile.dprStill). */
  ceiling: number
}

/** Written every frame; never handed to React directly. */
export const renderStats: RenderStats = { fps: 0, dpr: 1, refining: false, ceiling: 1 }

/**
 * Immutable snapshot for `useSyncExternalStore`. Replaced only when stats are
 * published (4×/s), so subscribers re-render four times a second instead of
 * sixty — and the identity check actually works, which it would not if the
 * mutable object above were handed out.
 */
let snapshot: RenderStats = { ...renderStats }
export function renderStatsSnapshot(): RenderStats { return snapshot }

const listeners = new Set<() => void>()
export function subscribeRenderStats(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function notifyStats(): void {
  snapshot = { ...renderStats }
  for (const l of [...listeners]) l()
}

export interface AdaptiveQualityProps {
  /**
   * Something in the scene animates every frame (walking residents, walk mode),
   * so the shadow map cannot be frozen. Costs the per-frame shadow render.
   */
  dynamicShadows?: boolean
  /**
   * Changes whenever the lighting rig moves (sun position, mode switch). Forces
   * exactly one shadow re-render.
   */
  shadowKey?: string | number
}

/** How long the camera must be still before the ramp starts, in seconds. */
const SETTLE_DELAY = 0.22
/** Seconds between resolution steps while refining. */
const STEP_INTERVAL = 0.2
/** Frame-time budget in ms; a step that busts it is rolled back permanently. */
const FRAME_BUDGET_MS = 26

export function AdaptiveQuality({ dynamicShadows = false, shadowKey }: AdaptiveQualityProps) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const setDpr = useThree((s) => s.setDpr)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null
  const profile = activeProfile()

  const state = useRef({
    lastPos: new THREE.Vector3(),
    lastQuat: new THREE.Quaternion(),
    lastTarget: new THREE.Vector3(),
    stillFor: 0,
    sinceStep: 0,
    dpr: profile.dprMotion,
    ceiling: profile.dprStill,
    /** Frame times sampled since the last step, for the median. */
    samples: [] as number[],
    fpsAccum: 0,
    fpsFrames: 0,
    statsTick: 0,
  })

  // Reset the ramp whenever the profile changes: the new budget invalidates
  // whatever ceiling the old one learned.
  useEffect(() => {
    const s = state.current
    s.ceiling = profile.dprStill
    s.dpr = profile.dprMotion
    s.samples.length = 0
    setDpr(profile.dprMotion)
    renderStats.ceiling = profile.dprStill
    renderStats.dpr = profile.dprMotion
    notifyStats()
  }, [profile, setDpr])

  // ── Shadow scheduling ───────────────────────────────────────────────
  useEffect(() => {
    gl.shadowMap.autoUpdate = dynamicShadows
    gl.shadowMap.needsUpdate = true
    return () => { gl.shadowMap.autoUpdate = true }
  }, [gl, dynamicShadows])

  // One explicit refresh per lighting change while the map is frozen.
  useEffect(() => {
    if (!dynamicShadows) gl.shadowMap.needsUpdate = true
  }, [gl, dynamicShadows, shadowKey])

  useFrame((_, dt) => {
    const s = state.current
    const frameMs = dt * 1000

    // ── FPS read-out (a tenth-of-a-second average, published 4×/s) ──
    s.fpsAccum += dt
    s.fpsFrames++
    s.statsTick += dt
    if (s.statsTick >= 0.25) {
      renderStats.fps = Math.round(s.fpsFrames / Math.max(s.fpsAccum, 1e-4))
      s.fpsAccum = 0
      s.fpsFrames = 0
      s.statsTick = 0
      notifyStats()
    }

    // ── Movement detection ──
    // Position, orientation *and* the orbit target: panning moves the target
    // without moving the camera's rotation, and it must still count as motion.
    const moved =
      s.lastPos.distanceToSquared(camera.position) > 1e-8 ||
      Math.abs(s.lastQuat.dot(camera.quaternion)) < 0.999999 ||
      (controls?.target ? s.lastTarget.distanceToSquared(controls.target) > 1e-8 : false)

    s.lastPos.copy(camera.position)
    s.lastQuat.copy(camera.quaternion)
    if (controls?.target) s.lastTarget.copy(controls.target)

    if (moved) {
      s.stillFor = 0
      s.sinceStep = 0
      s.samples.length = 0
      if (s.dpr !== profile.dprMotion) {
        s.dpr = profile.dprMotion
        setDpr(s.dpr)
        renderStats.dpr = s.dpr
        renderStats.refining = false
        notifyStats()
      }
      return
    }

    s.stillFor += dt
    if (s.stillFor < SETTLE_DELAY) return

    // ── Refinement ramp ──
    if (s.dpr >= s.ceiling - 1e-3) {
      if (renderStats.refining) { renderStats.refining = false; notifyStats() }
      return
    }

    s.samples.push(frameMs)
    s.sinceStep += dt
    if (s.sinceStep < STEP_INTERVAL) return
    s.sinceStep = 0

    // Median, not mean: one hitch (a texture upload, a GC pause) must not
    // convince the governor that this machine cannot hold the resolution.
    const sorted = s.samples.slice().sort((a, b) => a - b)
    const median = sorted.length ? sorted[sorted.length >> 1] : frameMs
    s.samples.length = 0

    if (median > FRAME_BUDGET_MS && s.dpr > profile.dprMotion) {
      // The step we are *currently* at is already too expensive — step back and
      // make that this machine's ceiling for the rest of the session.
      s.ceiling = Math.max(profile.dprMotion, Math.round((s.dpr - 0.25) * 100) / 100)
      s.dpr = s.ceiling
      setDpr(s.dpr)
      renderStats.dpr = s.dpr
      renderStats.ceiling = s.ceiling
      renderStats.refining = false
      notifyStats()
      return
    }

    s.dpr = Math.min(s.ceiling, Math.round((s.dpr + 0.25) * 100) / 100)
    setDpr(s.dpr)
    renderStats.dpr = s.dpr
    renderStats.refining = s.dpr < s.ceiling - 1e-3
    // A frozen shadow map survives a resolution change untouched — but the
    // contact-shadow and AO buffers were sized to the old resolution, so a
    // single refresh keeps them from lagging a step behind.
    if (!dynamicShadows) gl.shadowMap.needsUpdate = true
    notifyStats()
  })

  return null
}
