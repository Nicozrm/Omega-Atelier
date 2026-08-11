import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import type { EnvironmentState } from '@/lib/environment'
import { skyParamsFor } from '@/lib/render/skyModel'
import { activeProfile } from '@/lib/render/quality'

/**
 * SkyDome — the sky the camera actually sees, drawn from the *same* model that
 * `SkyEnvironment` bakes into the reflections.
 *
 * `SkyEnvironment` fixed what polished surfaces reflect. This fixes the other
 * half of the same problem: what the camera sees behind the model was still a
 * CSS gradient painted on the canvas element, i.e. *outside* WebGL. That
 * gradient can never appear in a reflection, refract through a window pane, or
 * contribute to a specular highlight — so the view through the glazing and the
 * sky mirrored in the glazing were two unrelated images. Anyone can spot that
 * without knowing why.
 *
 * Both now come from `three`'s Preetham `Sky` shader, driven by the identical
 * `skyParamsFor(env)` output, so they cannot disagree at any hour. The dome is
 * an inverted box parented to the camera position (an infinitely distant sky
 * must not parallax when the user orbits or walks), drawn first with no depth
 * write, and excluded from fog.
 *
 * Cost: one full-screen pass of an analytic shader with no texture fetches and
 * no overdraw — cheaper than the fog it sits behind. Parameters are pushed
 * imperatively, so scrubbing the time slider never re-renders React or rebuilds
 * a shader program.
 */

export interface SkyDomeProps {
  env: EnvironmentState
  /** Scene span in metres — the dome is sized well outside it. */
  span: number
}

export function SkyDome({ env, span }: SkyDomeProps) {
  const groupRef = useRef<THREE.Group>(null)
  // Below the cheapest profile the flat canvas gradient is kept: on a device
  // that cannot hold the frame rate, a visible sky is the first thing to cut.
  const enabled = activeProfile().skyQuality > 0

  const sky = useMemo(() => {
    const s = new Sky()
    s.frustumCulled = false
    s.renderOrder = -1000
    const mat = s.material as THREE.ShaderMaterial
    mat.depthWrite = false
    mat.fog = false
    return s
  }, [])

  // The Sky shader is authored in radiance and the post chain tone-maps at the
  // end, so it must not be mapped a second time here.
  useEffect(() => {
    const mat = sky.material as THREE.ShaderMaterial
    mat.toneMapped = true
    return () => { sky.geometry.dispose(); mat.dispose() }
  }, [sky])

  // Scale: far enough to read as infinite, well inside the camera's far plane.
  useEffect(() => {
    sky.scale.setScalar(Math.max(span * 40, 2000))
  }, [sky, span])

  // Atmosphere parameters — the identical values `SkyEnvironment` bakes.
  useEffect(() => {
    const p = skyParamsFor(env)
    const u = (sky.material as THREE.ShaderMaterial).uniforms
    u.turbidity.value = p.turbidity
    u.rayleigh.value = p.rayleigh
    u.mieCoefficient.value = p.mieCoefficient
    u.mieDirectionalG.value = p.mieDirectionalG
    // Preetham's sun position is a direction; below the horizon the model
    // returns near-black on its own, which is exactly the night sky we want.
    ;(u.sunPosition.value as THREE.Vector3)
      .set(env.sun.direction.x, env.sun.direction.y, env.sun.direction.z)
      .normalize()
  }, [sky, env])

  // Keep the dome centred on the camera every frame.
  useFrame((state) => {
    groupRef.current?.position.copy(state.camera.position)
  })

  if (!enabled) return null
  return (
    <group ref={groupRef}>
      <primitive object={sky} />
    </group>
  )
}
