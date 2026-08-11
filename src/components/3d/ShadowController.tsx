/**
 * ShadowController — renders the sun's shadow map only when it would change.
 *
 * ## Why
 *
 * A shadow map is a full re-rasterisation of every shadow-casting mesh from the
 * light's point of view. three does that *every frame* by default, so a scene
 * with a single directional light pays for two geometry passes per frame — and
 * this scene's caster set (walls, furniture, the house shell, the neighbourhood)
 * is the expensive half of the frame.
 *
 * A directional light's shadow map is **view-independent**: orbiting, zooming
 * and walking do not change one texel of it. It only needs re-rendering when the
 * sun moves or the geometry does — which, in a planning tool, is rare and
 * discrete. So the map is switched to manual and re-rendered on demand.
 *
 * ## Correctness over cleverness
 *
 * The failure mode of an on-demand shadow map is a *stale* one — furniture that
 * casts no shadow because it arrived after the last update. Two things guard
 * against it:
 *
 *  - **Bursts, not single frames.** A change re-renders the map for several
 *    consecutive frames, because geometry, textures and lazily-loaded models
 *    routinely land a frame or two after the state change that requested them.
 *  - **A generous warm-up.** The first seconds after mount refresh continuously,
 *    covering async texture decode, GLTF loads and generated Blaster assets.
 *
 * While something genuinely animates (residents walking), the map refreshes at
 * half rate — a walking figure's shadow at 30 Hz is indistinguishable from 60 Hz
 * and costs half as much.
 */

import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

/** Frames of continuous refresh after mount, covering async scene population. */
const WARMUP_FRAMES = 150
/** Frames of refresh after a discrete world change. */
const BURST_FRAMES = 8

/**
 * Wall-clock deadline (ms, `performance.now()` domain) until which the shadow
 * map keeps refreshing. Module-level rather than React state on purpose: the
 * callers are `useFrame` animations running dozens of times a second, and
 * routing that through a re-render would cost far more than the shadow pass.
 */
let refreshUntil = 0

/**
 * Ask for the shadow map to keep updating for a moment.
 *
 * For animations that move a shadow *caster* without changing any of the state
 * in `worldKey` — the hover lift under a device or a piece of furniture is the
 * case that matters. Those run for a few hundred milliseconds and would
 * otherwise leave the object's shadow behind at its old position.
 *
 * Cheap to over-call: it only ever pushes a deadline forward.
 */
export function requestShadowRefresh(seconds = 0.3): void {
  const until = performance.now() + seconds * 1000
  if (until > refreshUntil) refreshUntil = until
}

export function ShadowController({ worldKey, dynamic }: {
  /**
   * An identity token: pass a value whose **reference** changes whenever
   * anything the shadow map depicts changes — the plan, the sun, the active
   * floor, the house/stack toggles. Identity rather than a serialised string
   * on purpose, because the cheap-to-build strings (counts, ids) miss the
   * changes that matter most, like a single piece of furniture being dragged.
   */
  worldKey: unknown
  /** True while shadow casters animate on their own (residents walking). */
  dynamic: boolean
}) {
  const gl = useThree((s) => s.gl)
  const burst = useRef(WARMUP_FRAMES)
  const tick = useRef(0)

  useEffect(() => {
    const shadowMap = gl.shadowMap
    shadowMap.autoUpdate = false
    shadowMap.needsUpdate = true
    // A lost-and-restored context drops the shadow map's contents; so does
    // returning to a backgrounded tab on some drivers. Re-arm on both.
    const refresh = () => { burst.current = Math.max(burst.current, BURST_FRAMES) }
    document.addEventListener('visibilitychange', refresh)
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextrestored', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      canvas.removeEventListener('webglcontextrestored', refresh)
      // Hand the renderer back the way we found it — other views (robot,
      // Blaster preview) share this module and expect automatic shadows.
      shadowMap.autoUpdate = true
    }
  }, [gl])

  useEffect(() => {
    burst.current = Math.max(burst.current, BURST_FRAMES)
  }, [worldKey])

  useFrame(() => {
    if (dynamic || performance.now() < refreshUntil) {
      // Something is genuinely moving. Refresh at half rate — a shadow updating
      // at 30 Hz is indistinguishable from 60 Hz and costs half as much.
      tick.current++
      if (tick.current % 2 === 0) gl.shadowMap.needsUpdate = true
      return
    }
    if (burst.current > 0) {
      burst.current--
      gl.shadowMap.needsUpdate = true
    }
  })

  return null
}
