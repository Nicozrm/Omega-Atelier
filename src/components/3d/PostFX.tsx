import { Component, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, MutableRefObject, ReactNode, Ref } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import {
  EffectComposer, Bloom, N8AO, SMAA, Vignette, ChromaticAberration,
  DepthOfField, GodRays, LUT, SSR, ToneMapping, wrapEffect,
} from '@react-three/postprocessing'
import { ToneMappingMode, type DepthOfFieldEffect } from 'postprocessing'
import { activeProfile, sharpenForResolve } from '@/lib/render/quality'
import { bokehForDistance, focalLengthForDistance } from '@/lib/render/dof'
import { filmLutData } from '@/lib/render/grade'
import { cameraFocus } from './cameraFocusBus'
import { SharpenEffect, type SharpenEffectOptions } from './effects/SharpenEffect'
import { FilmGrainEffect, type FilmGrainEffectOptions } from './effects/FilmGrainEffect'

/**
 * PostFX — the complete post chain, ordered the way a camera and a colour suite
 * would order it, and gated end-to-end by the active render profile.
 *
 * **The pipeline is HDR.** This is the structural change: `EffectComposer`
 * switches the renderer to `NoToneMapping` while it is mounted (it has to — it
 * owns the final write to the screen), which previously meant the scene reached
 * the composer with *no* tone map at all. Every value above 1 — a lamp filament,
 * a sunlit wall, a specular highlight on chrome — clipped to flat white before
 * a single effect ran, and bloom then had nothing but clipped white to bleed.
 * Tone mapping now happens as an *effect*, at the right place in the chain, on a
 * half-float buffer:
 *
 *   scene (linear HDR)
 *     → ambient occlusion      · geometry, unaffected by exposure
 *     → screen-space reflections
 *     → depth of field         · bokeh from real HDR highlights, so specular
 *                                points bloom into discs instead of grey mush
 *     → god rays
 *     → bloom                  · thresholded against true radiance
 *     → **tone mapping (AgX)** · HDR → display-referred, one place
 *     → film LUT grade
 *     → chromatic aberration · vignette
 *     → grain → sharpen → SMAA
 *
 * Everything after the tone map operates in 0…1, everything before it in
 * radiance. Getting that boundary right is most of what separates a render that
 * looks lit from one that looks photographed.
 *
 * **No strength is written here.** Every amount — AO, bloom, grain, sharpen,
 * vignette, aberration — is a field on the active profile, because the right
 * amount is a function of how well the frame is resolved and that differs by
 * four times across the profiles. The tail of the chain in particular scales
 * *down* as quality goes up; the reasoning is at `RENDER_PROFILES`.
 */

/**
 * Any failure inside the effect chain (a driver refusing a float target, an
 * effect that dislikes a resize) must degrade to "no post", never to a blank
 * app. The scene itself keeps rendering underneath.
 */
export class RenderFXBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) {
    // Surfaced once, not per frame — the boundary stops rendering children after this.
    console.warn('[PostFX] Effekt-Kette nach Fehler deaktiviert:', error)
  }
  render() { return this.state.failed ? null : this.props.children }
}

/**
 * Contextual DOF: the focal plane damps onto whatever the story is looking at,
 * and the aperture stops down as the camera pulls back.
 *
 * The aperture used to be fixed, which meant the setting chosen to isolate a
 * sofa from two metres was still in force at eighteen — softening the far
 * bedroom and the near terrace of the dollhouse overview into the tilt-shift
 * "miniature" look. That is charming in a photograph of a scale model and
 * exactly wrong in a plan someone is trying to read, and it was the single
 * loudest reason the top profile looked like a toy. The rule itself lives in
 * `lib/render/dof` so it can be checked rather than eyeballed.
 */
function FocusPuller({ walkMode }: { walkMode: boolean }) {
  const fx = useRef<DepthOfFieldEffect>(null)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null
  useFrame((_, dt) => {
    const eff = fx.current
    if (!eff || !eff.target) return
    const anchor = cameraFocus.pull > 0.02 || !controls?.target ? cameraFocus.point : controls.target
    eff.target.x = THREE.MathUtils.damp(eff.target.x, anchor.x, 7, dt)
    eff.target.y = THREE.MathUtils.damp(eff.target.y, anchor.y, 7, dt)
    eff.target.z = THREE.MathUtils.damp(eff.target.z, anchor.z, 7, dt)

    // Measured to the focal point, not to the plan's centre: what matters is
    // how far away the thing in focus is, which is also true mid-glide.
    const distanceM = camera.position.distanceTo(eff.target)
    const scale = bokehForDistance({ distanceM, pull: cameraFocus.pull, walkMode })
    eff.bokehScale = THREE.MathUtils.damp(eff.bokehScale, scale, 5, dt)

    const cocMat = (eff as unknown as { circleOfConfusionMaterial?: { focalLength: number } })
      .circleOfConfusionMaterial
    if (cocMat) {
      cocMat.focalLength = THREE.MathUtils.damp(
        cocMat.focalLength, focalLengthForDistance(distanceM), 5, dt,
      )
    }
  })
  return <DepthOfField ref={fx} target={[0, 1, 0]} focalLength={0.08} bokehScale={1.2} height={480} />
}

/**
 * Keeps the two resolution-dependent effects honest as `AdaptiveQuality` ramps.
 *
 * Both are corrections for a frame that is not fully resolved, and both are
 * wrong if they ignore how resolved it currently is: sharpening a 2.25×
 * supersampled still puts back the ringing the supersampling just paid to
 * remove, and grain sized in buffer pixels shrinks as the ramp climbs until it
 * reads as sensor noise. The DPR changes several times a second, so this rides
 * the frame loop rather than a React render.
 */
function ResolveTracker({ sharpen, grain }: {
  sharpen: MutableRefObject<SharpenEffect | null>
  grain: MutableRefObject<FilmGrainEffect | null>
}) {
  const gl = useThree((s) => s.gl)
  // Keyed on the effect instance, not captured once: switching quality profiles
  // makes `wrapEffect` rebuild the effect, and a base value carried over from
  // the previous profile would silently scale the new one.
  const base = useRef<{ effect: SharpenEffect | null; sharpness: number }>({ effect: null, sharpness: 0 })
  useFrame(() => {
    const dpr = gl.getPixelRatio()
    const display = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

    const s = sharpen.current
    if (s) {
      // Re-reading the uniform after the first frame would compound the
      // scaling, so the profile value is remembered alongside its instance.
      if (base.current.effect !== s) base.current = { effect: s, sharpness: s.sharpness }
      s.sharpness = sharpenForResolve(base.current.sharpness, dpr, display)
    }
    if (grain.current) grain.current.pixelScale = GRAIN_PX_CSS * dpr
  })
  return null
}

/**
 * The god-ray source: an emissive disc parked at the sun's position in the sky.
 * `GodRaysEffect` builds its occlusion mask from a real mesh — the shafts are
 * literally "this disc, smeared radially wherever geometry does not block it",
 * which is exactly why window mullions slice the beams into bars.
 */
function SunSprite({ direction, distance, color, onReady }: {
  direction: { x: number; y: number; z: number }
  distance: number
  color: string
  onReady: (mesh: THREE.Mesh | null) => void
}) {
  const ref = useRef<THREE.Mesh>(null)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    onReady(ref.current)
    return () => onReady(null)
  }, [onReady])
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    // Anchored to the camera so the sun stays at infinity while orbiting.
    mesh.position.set(
      camera.position.x + direction.x * distance,
      camera.position.y + direction.y * distance,
      camera.position.z + direction.z * distance,
    )
    mesh.lookAt(camera.position)
  })
  return (
    <mesh ref={ref} frustumCulled={false} renderOrder={-900}>
      <circleGeometry args={[distance * 0.05, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/**
 * Wraps the procedural film grade into a 3D texture the LUT effect can sample.
 *
 * Stored as 8-bit rather than float: linear filtering of full-float 3D textures
 * needs `OES_texture_float_linear`, which plenty of mobile GPUs do not expose,
 * and 8 bits is the industry norm for a display-referred grade anyway — the
 * table is smooth, so quantisation error stays far below a display's own step.
 */
function useFilmLut(enabled: boolean): THREE.Data3DTexture | null {
  const tex = useMemo(() => {
    if (!enabled) return null
    const size = 32
    const source = filmLutData(size)
    const bytes = new Uint8Array(source.length)
    for (let i = 0; i < source.length; i++) bytes[i] = Math.round(source[i] * 255)
    const t = new THREE.Data3DTexture(bytes, size, size, size)
    t.type = THREE.UnsignedByteType
    t.format = THREE.RGBAFormat
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping
    t.unpackAlignment = 1
    t.needsUpdate = true
    return t
  }, [enabled])
  useEffect(() => () => { tex?.dispose() }, [tex])
  return tex
}

/**
 * The two hand-written effects, mounted the same way the library's own are:
 * `wrapEffect` registers the class with R3F so the composer discovers it as a
 * child and manages its lifetime.
 */
/**
 * `wrapEffect` forwards its ref to the r3f element, so `ref.current` is the
 * effect *instance* — but the library types it as `typeof Effect`, the class.
 * Corrected once here rather than with a cast at each of the two call sites.
 */
const FilmGrain = wrapEffect(FilmGrainEffect) as unknown as
  ComponentType<FilmGrainEffectOptions & { ref?: Ref<FilmGrainEffect> }>
const Sharpen = wrapEffect(SharpenEffect) as unknown as
  ComponentType<SharpenEffectOptions & { ref?: Ref<SharpenEffect> }>

/**
 * Grain cell size in CSS pixels — the unit the viewer actually perceives,
 * unlike buffer pixels which the adaptive ramp keeps changing underneath.
 * Slightly above 1 so the result is a grain structure rather than per-pixel
 * noise, which is what "digital" looks like.
 */
const GRAIN_PX_CSS = 1.5

export interface PostFXProps {
  walkMode: boolean
  /** Unit vector toward the sun. */
  sunDirection: { x: number; y: number; z: number }
  sunAboveHorizon: boolean
  sunColor: string
  /** Scene span in metres — sizes the god-ray sun distance. */
  span: number
  /** AgX (photographic roll-off) vs ACES (punchier, more saturated). */
  photoLook: boolean
  /** Exposure applied at the tone-map stage. */
  exposure?: number
  /**
   * Thumbnail context (dashboard preview card): keeps the look — tone map,
   * grade, AO, bloom — but drops the passes whose value only shows at full
   * size (SSR, god rays, bokeh) and would otherwise cost a card as much as the
   * full viewport.
   */
  lite?: boolean
  /** Suppresses the whole chain (raw-frame capture, tests, …). */
  disabled?: boolean
}

export function PostFX({
  walkMode, sunDirection, sunAboveHorizon, sunColor, span,
  photoLook, exposure = 1, lite = false, disabled = false,
}: PostFXProps) {
  const base = activeProfile()
  const p = lite
    ? { ...base, ssr: false, godRays: false, dof: false, ao: base.ao === 'off' ? 'off' as const : 'half' as const }
    : base
  const gl = useThree((s) => s.gl)
  const lut = useFilmLut(p.colorGrade)
  const sharpenRef = useRef<SharpenEffect | null>(null)
  const grainRef = useRef<FilmGrainEffect | null>(null)
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null)
  const caOffset = useMemo(
    () => new THREE.Vector2(p.chromaticAberration, p.chromaticAberration),
    [p.chromaticAberration],
  )
  const sunDistance = Math.max(60, span * 4)
  const godRaysActive = p.godRays && sunAboveHorizon

  // Exposure still lives on the renderer — `ToneMappingEffect` reads
  // `toneMappingExposure` from it, so this is the one knob both paths share.
  useEffect(() => { gl.toneMappingExposure = exposure }, [gl, exposure])

  if (disabled) return null

  return (
    <RenderFXBoundary>
      {godRaysActive && (
        <SunSprite
          direction={sunDirection}
          distance={sunDistance}
          color={sunColor}
          onReady={setSunMesh}
        />
      )}
      <EffectComposer multisampling={p.msaa}>
        {/* ── HDR domain ───────────────────────────────────────────── */}
        {p.ao !== 'off' ? (
          <N8AO
            aoRadius={0.9}
            distanceFalloff={1.0}
            intensity={p.aoIntensity}
            quality={p.ao === 'full' ? 'high' : 'medium'}
            halfRes={p.ao === 'half'}
            // Near-black rather than the blue-black it used to be: a tinted AO
            // term is a colour nothing in the scene emitted, and it is the
            // reason corners read as "dirty" instead of "unlit".
            color="#0b0b0d"
          />
        ) : <></>}

        {p.ssr ? (
          <SSR
            temporalResolve
            temporalResolveMix={0.9}
            temporalResolveCorrectionMix={0.4}
            maxSamples={0}
            ENABLE_BLUR
            blurMix={0.5}
            blurSharpness={12}
            blurKernelSize={1}
            rayStep={0.4}
            intensity={0.8}
            maxRoughness={0.5}
            ENABLE_JITTERING={false}
            jitter={0.1}
            jitterSpread={0.15}
            jitterRough={0.1}
            MAX_STEPS={20}
            NUM_BINARY_SEARCH_STEPS={5}
            maxDepthDifference={10}
            maxDepth={1}
            thickness={8}
            ior={1.45}
            STRETCH_MISSED_RAYS
            USE_MRT
            USE_NORMALMAP
            USE_ROUGHNESSMAP
          />
        ) : <></>}

        {p.dof ? <FocusPuller walkMode={walkMode} /> : <></>}

        {godRaysActive && sunMesh ? (
          <GodRays
            sun={sunMesh}
            samples={30}
            density={0.94}
            decay={0.92}
            weight={0.3}
            exposure={0.26}
            clampMax={1}
            blur
          />
        ) : <></>}

        {p.bloomIntensity > 0 ? (
          // Threshold above 1 keeps this a *highlight* effect: only radiance a
          // display cannot show blooms, which is what a real lens does. At 1.0
          // every fully-lit white surface was already bleeding, and a wide
          // radius on top of that is the haze that reads as "video-game glow".
          <Bloom
            luminanceThreshold={1.15}
            luminanceSmoothing={0.24}
            intensity={p.bloomIntensity}
            mipmapBlur
            radius={0.6}
          />
        ) : <></>}

        {/* ── HDR → display ────────────────────────────────────────── */}
        <ToneMapping mode={photoLook ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC} />

        {/* ── Display-referred domain ──────────────────────────────── */}
        {lut ? <LUT lut={lut} tetrahedralInterpolation /> : <></>}

        {p.chromaticAberration > 0 ? (
          // `modulationOffset` pushed out to 0.6 so the fringing stays in the
          // last third of the frame radius. A good lens is clean across the
          // centre; aberration that reaches the middle is a filter, not glass.
          <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.6} />
        ) : <></>}

        {p.vignette > 0 ? <Vignette offset={0.32} darkness={p.vignette} /> : <></>}

        {p.grain > 0 ? <FilmGrain ref={grainRef} intensity={p.grain} pixelScale={GRAIN_PX_CSS} /> : <></>}
        {p.sharpen > 0 ? <Sharpen ref={sharpenRef} sharpness={p.sharpen} /> : <></>}

        <SMAA />
      </EffectComposer>
      {/* Outside the composer on purpose: it contributes no pass, and the
          composer discovers its children by walking the three.js objects
          attached to its group. Its frame callback runs at the default
          priority, i.e. before the composer's own render. */}
      <ResolveTracker sharpen={sharpenRef} grain={grainRef} />
    </RenderFXBoundary>
  )
}
