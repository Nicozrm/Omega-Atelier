/**
 * SunLight — the scene's single shadow-casting key light.
 *
 * Direction, colour and intensity are decided by the environment domain
 * (`lib/environment`) from the real solar position; this component only places
 * the light and sizes its shadow frustum.
 *
 * ## Framing the shadow camera
 *
 * A directional light's shadow map is an orthographic render, so its frustum is
 * a fixed budget of texels spread over whatever area it covers — half the area
 * is twice the shadow resolution, for free.
 *
 * The frustum is therefore centred on the **building**, not on the world origin.
 * Plan coordinates start at the origin and run to `(width, height)`, so a
 * frustum centred at the origin has to be twice as wide just to reach the far
 * corner, and spends three quarters of its texels on empty ground west and north
 * of the plan.
 *
 * Its size is the bounding sphere of the region worth shadowing — the footprint
 * plus a margin for terrace, fence and parking, and enough headroom for the roof
 * ridge. Using the bounding *sphere* rather than the projected bounds makes the
 * frustum rotation-invariant: the shadow texel density does not change as the
 * sun swings through the day, so scrubbing the time slider cannot make shadow
 * edges crawl and shimmer.
 *
 * The near/far planes are then clamped to that same sphere, which is what buys
 * back depth precision and lets the depth bias stay small enough to keep contact
 * points tight instead of detaching shadows from their casters.
 */

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { EnvironmentState } from '@/lib/environment'
import { activeProfile } from '@/lib/render/quality'
import { shadowRadius, sunDistance } from '@/lib/render/shadowFrustum'

export function SunLight({ env, wM, hM, cx, cz }: {
  env: EnvironmentState
  /** Plan extent in metres. */
  wM: number
  hM: number
  /** Plan centre in metres — the frustum is centred here. */
  cx: number
  cz: number
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null)
  // The light aims at its `target`, whose world matrix three does not update for
  // us while the object sits outside the scene graph — so we drive it directly.
  const target = useMemo(() => new THREE.Object3D(), [])

  useEffect(() => {
    target.position.set(cx, 0, cz)
    target.updateMatrixWorld()
    const light = lightRef.current
    if (light) light.target = target
  }, [target, cx, cz])

  const radius = shadowRadius(wM, hM)
  const distance = sunDistance(radius)
  const { x, y, z } = env.sun.direction
  // The render profile is the single source for quality budgets (see
  // `lib/render/quality`). This used to read the coarse `readTier()` class and
  // resolve to 4096 or 2048, which both over-spent on the performance tier —
  // 2048² of depth on a phone — and under-spent on ultra, where the profile
  // asks for the full 4096 the frustum's texel density was designed around.
  const mapSize = activeProfile().shadowMapSize

  return (
    <directionalLight
      ref={lightRef}
      position={[cx + x * distance, y * distance, cz + z * distance]}
      intensity={env.lighting.sun.intensity}
      color={env.lighting.sun.color}
      castShadow={env.lighting.sun.castShadow}
      shadow-mapSize-width={mapSize}
      shadow-mapSize-height={mapSize}
      shadow-camera-near={distance - radius - 1}
      shadow-camera-far={distance + radius + 1}
      shadow-camera-left={-radius}
      shadow-camera-right={radius}
      shadow-camera-top={radius}
      shadow-camera-bottom={-radius}
      // Small constant bias plus a normal-offset: the normal offset does the
      // real work (it pushes the lookup along the surface normal, which scales
      // with slope), letting the constant bias stay low so contact shadows keep
      // touching their casters.
      shadow-bias={-0.0002}
      shadow-normalBias={0.02}
      // Read by the PCSS patch as the *minimum* filter radius, in texels: the
      // floor that keeps a hard contact edge from aliasing into stair-steps
      // where the penumbra estimate collapses to zero. Because it is counted in
      // texels it tracks `mapSize` automatically — a smaller map gets a wider
      // world-space floor, which is exactly what hides its coarser texels.
      // Stock three ignores it on the PCF_SOFT path, so on profiles without
      // PCSS this is inert rather than wrong.
      shadow-radius={4}
    />
  )
}
