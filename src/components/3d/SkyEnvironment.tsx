/**
 * SkyEnvironment — the scene's image-based lighting, built from the real sky.
 *
 * Everything with a specular response — glazing, chrome taps, brushed steel,
 * the lacquered floor, every clearcoat — gets its highlights and reflections
 * from `scene.environment`. Previously that was six flat coloured panels built
 * once and only dimmed by day phase, so at midnight the taps still mirrored a
 * bright white softbox. Reflections carried no information about the world,
 * which is the most legible "this is a render" tell a scene can have.
 *
 * Now the source scene is:
 *
 *  - **The sky**, via three's Preetham atmospheric scattering model, driven by
 *    the real solar direction and by turbidity/Rayleigh/Mie terms derived from
 *    the weather. Reflections pick up the horizon glow at golden hour and the
 *    deep blue overhead at noon, from the same solar position that casts the
 *    shadows — so highlight and shadow agree about where the sun is.
 *  - **A ground plane**, so surfaces receive bounce from below rather than
 *    sitting in a half-lit void.
 *  - **Interior bounce panels**, keeping the warm wall/ceiling light that an
 *    interior actually sees. These carry the night: as the sky stops
 *    delivering, they take over (see `lib/render/skyModel`).
 *
 * ## Cost control
 *
 * Convolving a scene into a PMREM is milliseconds of GPU work, so it must not
 * happen per frame. Two filters guard it: a quantised fingerprint of the sky
 * state skips rebuilds when nothing visibly moved, and a rate limit collapses a
 * time-slider drag into a handful of builds. Between builds this component
 * costs nothing at all — no `useFrame`, no per-frame allocation.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import type { EnvironmentState } from '@/lib/environment'
import { skyParamsFor, skyFingerprint } from '@/lib/render/skyModel'

/** Minimum wall-clock gap between two PMREM builds, ms. */
const REBUILD_INTERVAL_MS = 120

/**
 * Interior bounce palettes per user-facing preset. These describe the *room*
 * a surface is standing in — the warm ceiling wash, the key wall, the cool
 * fill from the window side and the neutral bounce opposite it.
 */
export type EnvPreset = 'studio' | 'warm' | 'cool' | 'dramatic'

const INTERIOR_PRESETS: Record<EnvPreset, {
  ceiling: [string, number]
  key: [string, number]
  fill: [string, number]
  bounce: [string, number]
}> = {
  studio:   { ceiling: ['#eef1f6', 2.4], key: ['#ffe9cf', 1.5], fill: ['#dbe6ff', 1.1], bounce: ['#cfd2d8', 0.9] },
  warm:     { ceiling: ['#fff3e0', 2.2], key: ['#ffdcae', 2.2], fill: ['#e8dcc8', 1.1], bounce: ['#d8c8b4', 0.9] },
  cool:     { ceiling: ['#f4f8ff', 2.8], key: ['#eaf1ff', 1.3], fill: ['#cfe0ff', 1.1], bounce: ['#d4dbe4', 0.9] },
  dramatic: { ceiling: ['#ffffff', 3.0], key: ['#ffdcb0', 1.9], fill: ['#aebdd6', 1.1], bounce: ['#a9adb4', 0.9] },
}

/** The mutable pieces of the source scene, kept across rebuilds. */
interface EnvSource {
  scene: THREE.Scene
  sky: Sky
  ground: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  panels: Array<{
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
    base: THREE.Color
    weight: number
  }>
  dispose: () => void
}

/**
 * Build the source scene once. Everything inside sits well within the PMREM
 * camera's default 0.1…100 range, so the convolution sees all of it.
 */
function createEnvSource(preset: EnvPreset): EnvSource {
  const scene = new THREE.Scene()
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []

  const sky = new Sky()
  sky.scale.setScalar(90)
  scene.add(sky)

  // Ground: a large disc below the origin. Colour is set per rebuild.
  const groundGeo = new THREE.CircleGeometry(70, 24).rotateX(-Math.PI / 2)
  const groundMat = new THREE.MeshBasicMaterial({ color: '#2a2724', side: THREE.DoubleSide })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.position.y = -6
  scene.add(ground)
  geometries.push(groundGeo)
  materials.push(groundMat)

  // Interior bounce panels — the room around the surface.
  const p = INTERIOR_PRESETS[preset]
  const panels: EnvSource['panels'] = []
  const addPanel = (
    size: [number, number, number],
    position: [number, number, number],
    [hex, weight]: [string, number],
  ) => {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2])
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(position[0], position[1], position[2])
    scene.add(mesh)
    geometries.push(geo)
    materials.push(mat)
    panels.push({ mesh, base: new THREE.Color(hex), weight })
  }
  addPanel([7, 0.2, 7], [0, 3.7, 0], p.ceiling)     // overhead wash
  addPanel([6, 3, 0.2], [0, 1.6, -6.6], p.key)      // key wall
  addPanel([0.2, 4, 7], [-6.8, 0.8, 0], p.fill)     // window-side fill
  addPanel([0.2, 4, 7], [6.8, 0.6, 0], p.bounce)    // neutral bounce opposite

  return {
    scene,
    sky,
    ground,
    panels,
    dispose: () => {
      geometries.forEach((g) => g.dispose())
      materials.forEach((m) => m.dispose())
      sky.geometry.dispose()
      ;(sky.material as THREE.Material).dispose()
    },
  }
}

export function SkyEnvironment({ env, preset }: {
  env: EnvironmentState
  preset: EnvPreset
}) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const source = useMemo(() => createEnvSource(preset), [preset])
  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl])
  const target = useRef<THREE.WebGLRenderTarget | null>(null)
  const lastFingerprint = useRef<string | null>(null)
  const lastBuiltAt = useRef(0)
  const pending = useRef<number | null>(null)

  useEffect(() => () => {
    source.dispose()
  }, [source])

  useEffect(() => () => {
    pmrem.dispose()
  }, [pmrem])

  useEffect(() => () => {
    if (pending.current !== null) window.clearTimeout(pending.current)
    target.current?.dispose()
    target.current = null
    scene.environment = null
  }, [scene])

  // Exposure is a single scalar on the scene, so it is applied on every change
  // rather than only when the map is rebuilt. Gating it behind the rebuild
  // fingerprint would quantise it back into visible steps — the exact
  // discontinuity the continuous ramp exists to remove.
  useEffect(() => {
    scene.environmentIntensity = skyParamsFor(env).environmentIntensity
  }, [scene, env])

  const fingerprint = skyFingerprint(env)

  useEffect(() => {
    // A change of preset rebuilds the source scene, so force a rebuild with it.
    if (lastFingerprint.current === fingerprint && target.current) return

    const build = () => {
      pending.current = null
      lastFingerprint.current = fingerprint
      lastBuiltAt.current = performance.now()

      const params = skyParamsFor(env)
      const u = source.sky.material.uniforms
      u.turbidity.value = params.turbidity
      u.rayleigh.value = params.rayleigh
      u.mieCoefficient.value = params.mieCoefficient
      u.mieDirectionalG.value = params.mieDirectionalG
      // Unit sun vector, matching three's own Sky usage. Shares the solar
      // position that drives the shadow-casting key light, so the brightest
      // point of a reflection and the direction shadows fall always agree.
      u.sunPosition.value.set(env.sun.direction.x, env.sun.direction.y, env.sun.direction.z)

      source.sky.material.uniformsNeedUpdate = true

      // Ground bounce: the sky's horizon colour, dimmed by how much light is
      // actually reaching the ground.
      source.ground.material.color
        .set(env.sky.horizonColor)
        .multiplyScalar(params.ground.intensity)

      for (const panel of source.panels) {
        panel.mesh.material.color
          .copy(panel.base)
          .multiplyScalar(panel.weight * params.interior.intensity)
      }

      const next = pmrem.fromScene(source.scene, 0.04)
      const previous = target.current
      target.current = next
      scene.environment = next.texture
      previous?.dispose()
    }

    // Rate limit: a time-slider drag crosses fingerprint buckets steadily, and
    // each crossing would otherwise mean a full convolution mid-frame.
    const elapsed = performance.now() - lastBuiltAt.current
    if (elapsed >= REBUILD_INTERVAL_MS) {
      build()
    } else if (pending.current === null) {
      pending.current = window.setTimeout(build, REBUILD_INTERVAL_MS - elapsed)
    }

    return () => {
      if (pending.current !== null) {
        window.clearTimeout(pending.current)
        pending.current = null
      }
    }
  }, [fingerprint, env, preset, source, pmrem, scene])

  return null
}
