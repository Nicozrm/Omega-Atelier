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
 * The source scene is now an **open-topped room under a real sky** — which is
 * exactly what the dollhouse is:
 *
 *  - **The sky**, via three's Preetham atmospheric scattering model, driven by
 *    the real solar direction and by turbidity/Rayleigh/Mie terms derived from
 *    the weather. Reflections pick up the horizon glow at golden hour and the
 *    deep blue overhead at noon, from the same solar position that casts the
 *    shadows — so highlight and shadow agree about where the sun is.
 *  - **Four walls and a floor**, carrying the warm bounce an interior actually
 *    sees. These carry the night: as the sky stops delivering, they take over
 *    (see `lib/render/skyModel`).
 *  - **An opening around the overhead wash**, which is how daylight gets in.
 *
 * The enclosure is not decoration — it is what makes the exposure correct. A
 * bare sky irradiates every surface as though it stood in an open field, and
 * measuring that against the environment it replaced showed noon coming out
 * twice as bright while night came out half as bright. Interior surfaces see
 * the sky through an opening and are lit mostly by the walls around them;
 * modelling that puts full daylight within ~10 % and night within ~3 % of the
 * previous exposure, by construction rather than by a fudge factor.
 *
 * ## Cost control
 *
 * Convolving a scene into a PMREM is milliseconds of GPU work, so it must not
 * happen per frame. Two filters guard it: a quantised fingerprint of the sky
 * state skips rebuilds when nothing visibly moved, and a rate limit collapses a
 * time-slider drag into a handful of builds. Between builds this component
 * costs nothing at all — no `useFrame`, no per-frame allocation.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import type { EnvironmentState } from '@/lib/environment'
import { skyParamsFor, skyFingerprint } from '@/lib/render/skyModel'
import {
  HDRI_SKIES, selectHdriSky, hdriRotationY, hdriExposure, hdriUrl,
} from '@/lib/render/hdriSky'
import { activeProfile } from '@/lib/render/quality'
import { RGBELoader } from 'three-stdlib'

/** Minimum wall-clock gap between two PMREM builds, ms. */
const REBUILD_INTERVAL_MS = 120

/**
 * Decoded captured skies, cached process-wide.
 *
 * An equirectangular HDR is a few hundred kilobytes and decodes to a float
 * texture; decoding one twice would cost the memory twice for identical pixels.
 * Keyed by sky, so scrubbing back and forth across the day only ever pays for
 * each map once.
 */
const hdriCache = new Map<string, Promise<THREE.DataTexture | null>>()

function loadHdri(key: keyof typeof HDRI_SKIES): Promise<THREE.DataTexture | null> {
  const cached = hdriCache.get(key)
  if (cached) return cached
  const pending = new Promise<THREE.DataTexture | null>((resolve) => {
    new RGBELoader().load(
      hdriUrl(HDRI_SKIES[key]),
      (texture) => {
        // Equirectangular, and sampled by a sphere's own UVs — so it needs to
        // wrap horizontally and clamp at the poles like any panorama.
        texture.mapping = THREE.EquirectangularReflectionMapping
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        resolve(texture)
      },
      undefined,
      // A missing or corrupt map must not take the lighting down with it: the
      // analytic sky stays, which is exactly what it is there for.
      () => resolve(null),
    )
  })
  hdriCache.set(key, pending)
  return pending
}

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
  /** Captured sky dome. Hidden until an HDRI has loaded; replaces `sky` then. */
  dome: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
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

  // The captured sky, when one is available. It sits just inside the analytic
  // dome and hides it, rather than replacing it: an HDRI arrives over the
  // network, and the scene must be lit correctly before and during that.
  //
  // Rendered from the inside (BackSide) with tone mapping off, because this is
  // radiance being convolved into an environment map — tone mapping it here
  // would compress the sun's highlights out before they ever light anything.
  const domeGeo = new THREE.SphereGeometry(80, 48, 24)
  const domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false })
  const dome = new THREE.Mesh(domeGeo, domeMat)
  dome.visible = false
  scene.add(dome)
  geometries.push(domeGeo)
  materials.push(domeMat)

  // ── An open-topped room, which is what the dollhouse actually is.
  //
  // This enclosure is the reason the balance works. Without it every surface
  // in the scene is irradiated by the *whole* sky, as though it were standing
  // in an open field — measured, that made noon twice as bright as the studio
  // box it replaced while night came out half as bright. Real interior
  // surfaces see the sky only through an opening, and the walls around them
  // do most of the lighting. Enclosing the source scene restores that, and
  // it does so by construction rather than by an arbitrary sky multiplier
  // (which the Preetham shader could not honour anyway — it writes alpha 1).
  const p = INTERIOR_PRESETS[preset]
  const panels: EnvSource['panels'] = []

  const addPanel = (
    geo: THREE.BufferGeometry,
    position: [number, number, number],
    rotation: [number, number, number],
    [hex, weight]: [string, number],
  ) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(position[0], position[1], position[2])
    mesh.rotation.set(rotation[0], rotation[1], rotation[2])
    scene.add(mesh)
    geometries.push(geo)
    materials.push(mat)
    panels.push({ mesh, base: new THREE.Color(hex), weight })
  }

  const WALL = 6.8      // half-width of the room
  const WALL_H = 9      // wall height
  const wallGeo = () => new THREE.PlaneGeometry(WALL * 2, WALL_H)

  // Four walls. The key wall is the bright one; the other three are fill and
  // bounce, so the room has direction instead of being a uniform grey box.
  addPanel(wallGeo(), [0, 0.5, -WALL], [0, 0, 0], p.key)
  addPanel(wallGeo(), [0, 0.5, WALL], [0, Math.PI, 0], p.bounce)
  addPanel(wallGeo(), [-WALL, 0.5, 0], [0, Math.PI / 2, 0], p.fill)
  addPanel(wallGeo(), [WALL, 0.5, 0], [0, -Math.PI / 2, 0], p.bounce)

  // Overhead wash, covering the middle of the ceiling. The ring of open sky
  // left around it is how daylight gets in — the dollhouse's missing roof.
  addPanel(new THREE.PlaneGeometry(9, 9), [0, 5, 0], [Math.PI / 2, 0, 0], p.ceiling)

  // Floor. Driven by the ground colour rather than the interior palette, so
  // bounce from below tracks the daylight outside.
  const groundGeo = new THREE.PlaneGeometry(WALL * 2, WALL * 2)
  const groundMat = new THREE.MeshBasicMaterial({ color: '#2a2724', side: THREE.DoubleSide })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.position.y = -4
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  geometries.push(groundGeo)
  materials.push(groundMat)

  return {
    scene,
    sky,
    dome,
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

  // Which captured skies have finished decoding. A ref rather than state: the
  // arrival of a texture must trigger exactly one rebuild, not a re-render of
  // the whole subtree.
  const hdriReady = useRef(new Map<string, THREE.DataTexture>())
  const [hdriEpoch, setHdriEpoch] = useState(0)

  const capturedKey = selectHdriSky(env)
  useEffect(() => {
    // Captured skies are an upgrade, not a requirement — a device that cannot
    // afford the extra texture memory keeps the analytic sky, which is the same
    // flag that already decides whether detail maps are affordable.
    if (!activeProfile().detailMaps) return
    if (hdriReady.current.has(capturedKey)) return
    let cancelled = false
    void loadHdri(capturedKey).then((texture) => {
      if (cancelled || !texture) return
      hdriReady.current.set(capturedKey, texture)
      // Force the next effect run to rebuild rather than skip on a matching
      // fingerprint: the world did not change, but what lights it did.
      lastFingerprint.current = null
      setHdriEpoch((n) => n + 1)
    })
    return () => { cancelled = true }
  }, [capturedKey])

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

      // ── Captured sky, when one has arrived.
      //
      // The analytic sky underneath stays configured and simply gets hidden, so
      // the first frames (and any device that never loads an HDRI) are lit
      // correctly rather than being lit by nothing.
      const capturedKey = selectHdriSky(env)
      const captured = hdriReady.current.get(capturedKey) ?? null
      source.dome.visible = captured !== null
      if (captured) {
        const sky = HDRI_SKIES[capturedKey]
        source.dome.material.map = captured
        // Turn the dome so the photographed sun lands on the solar bearing the
        // shadow-casting light already uses. Without this, highlights arrive
        // from one side while shadows fall to the other.
        source.dome.rotation.y = hdriRotationY(sky, env)
        // Normalise the four maps to one exposure. They were photographed at
        // wildly different light levels, and the scene's exposure was calibrated
        // against the analytic sky these replace; the deliberate day/night
        // falloff stays with `environmentIntensity`, which models it on purpose.
        const level = hdriExposure(sky)
        source.dome.material.color.setScalar(level)
        source.dome.material.needsUpdate = true
      }

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
  }, [fingerprint, hdriEpoch, env, preset, source, pmrem, scene])

  return null
}
