import { useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { skyModel } from '@/lib/render/sky'
import { activeProfile } from '@/lib/render/quality'

/**
 * EnvironmentIBL — image-based lighting baked from the *same* sky the window
 * shows, blended with a physical studio rig for the interior.
 *
 * Why this replaces the previous local environment: that one baked a closed box
 * (six coloured walls) into a PMREM. It gave metals something to reflect, but it
 * was a permanently overcast studio — it never knew what time it was. Chrome at
 * sunset reflected the same neutral grey as chrome at noon, glass never picked
 * up the sky, and the two most reflective materials in an interior render
 * therefore looked *painted* rather than lit.
 *
 * The environment built here has three parts, in falling order of importance:
 *
 *  1. **The sky.** The analytic dome from `lib/render/sky.ts` — the identical
 *     model `SkyDome` paints — so a reflection and the view through the window
 *     agree, at every hour.
 *  2. **The ground.** A large dark disc: real interiors are lit from above and
 *     get almost nothing back from below, and skipping it makes every metal
 *     look like it is floating in a void.
 *  3. **The room.** Softbox + key + bounce cards from the chosen preset,
 *     approximating the light the walls and ceiling throw around. Cards, not a
 *     sealed box — a box would occlude the sky it took so much care to build.
 *
 * Cost control: the bake is a cube render at `profile.iblSize`, and it runs only
 * when something it depends on actually changes. The sun's elevation is
 * **quantised into 1.5° buckets** for that check, so dragging the time slider
 * across a day triggers a bounded number of bakes instead of one per frame,
 * while still stepping finely enough that nobody sees it happen.
 */

export type EnvPresetId = 'studio' | 'warm' | 'cool' | 'dramatic'

export const ENV_PRESET_LABELS: Record<EnvPresetId, string> = {
  studio: 'Studio',
  warm: 'Warm',
  cool: 'Kühl',
  dramatic: 'Dramatisch',
}

interface PresetRig {
  /** Overhead softbox: [colour, radiance]. */
  box: [string, number]
  /** Key card behind the camera-left: [colour, radiance]. */
  key: [string, number]
  /** Cool fill from one side. */
  fill: [string, number]
  /** Neutral bounce from the other. */
  bounce: [string, number]
  /** How strongly the interior rig competes with the sky, 0…1. */
  interiorWeight: number
}

const PRESETS: Record<EnvPresetId, PresetRig> = {
  studio: { box: ['#eef1f6', 2.4], key: ['#ffe9cf', 1.5], fill: ['#dbe6ff', 1.1], bounce: ['#cfd2d8', 0.9], interiorWeight: 1.0 },
  warm: { box: ['#fff3e0', 2.2], key: ['#ffdcae', 2.2], fill: ['#e8dcc8', 1.1], bounce: ['#d8c8b4', 0.9], interiorWeight: 1.05 },
  cool: { box: ['#f4f8ff', 2.8], key: ['#eaf1ff', 1.3], fill: ['#cfe0ff', 1.2], bounce: ['#d4dbe4', 0.9], interiorWeight: 0.95 },
  dramatic: { box: ['#ffffff', 3.0], key: ['#ffdcb0', 1.9], fill: ['#aebdd6', 0.75], bounce: ['#a9adb4', 0.5], interiorWeight: 1.15 },
}

/**
 * The sky, as a shader on the inside of a sphere. A trimmed-down twin of
 * `SkyDome`'s shader: the gradient, the Mie lobe and the disc — the three parts
 * a reflection can actually resolve — without stars, clouds or tone mapping,
 * because the environment map must stay linear HDR.
 */
const ENV_SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith, uHorizon, uSunDisc, uSunHalo, uGround, uSunDir;
  uniform float uHaze;
  void main() {
    vec3 dir = normalize(vDir);
    float cosT = dot(dir, uSunDir);
    vec3 col = mix(uHorizon, uZenith, pow(clamp(dir.y, 0.0, 1.0), 0.42));
    float g = mix(0.86, 0.62, uHaze);
    float denom = 1.0 + g * g - 2.0 * g * cosT;
    col += uSunHalo * ((1.0 - g * g) / (4.0 * 3.14159265 * pow(max(denom, 1e-4), 1.5))) * (0.55 + 1.9 * uHaze);
    col += uSunHalo * exp(-abs(dir.y) * 9.0) * pow(max(cosT, 0.0), 3.0) * (0.28 + 0.7 * uHaze);
    float ang = acos(clamp(cosT, -1.0, 1.0));
    col += uSunDisc * (1.0 - smoothstep(0.009, 0.0125, ang));
    col = mix(col, uGround, smoothstep(0.0, -0.06, dir.y) * 0.92);
    gl_FragColor = vec4(col, 1.0);
  }
`

const ENV_SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

interface BuildArgs {
  sunElevationDeg: number
  sunDirection: { x: number; y: number; z: number }
  turbidity: number
  cloudiness: number
  preset: EnvPresetId
}

/** Assemble the throwaway scene that gets baked into the PMREM cube. */
function buildEnvScene(args: BuildArgs): THREE.Scene {
  const { sunElevationDeg, sunDirection, turbidity, cloudiness, preset } = args
  const rig = PRESETS[preset]
  const model = skyModel({ sunElevationDeg, turbidity, cloudiness })
  const scene = new THREE.Scene()

  // 1. Sky dome (BackSide, huge) — the dominant term outdoors and at windows.
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: ENV_SKY_VERT,
    fragmentShader: ENV_SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uZenith: { value: new THREE.Vector3(...model.zenith) },
      uHorizon: { value: new THREE.Vector3(...model.horizon) },
      uSunDisc: { value: new THREE.Vector3(...model.sunDisc) },
      uSunHalo: { value: new THREE.Vector3(...model.sunHalo) },
      uGround: { value: new THREE.Vector3(...model.ground) },
      uSunDir: { value: new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z).normalize() },
      uHaze: { value: model.haze },
    },
  })
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 24), skyMat))

  // 2. Ground disc — stops metals from being lit from below by a phantom sky.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(48, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(...model.ground), side: THREE.DoubleSide }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -3.6
  scene.add(ground)

  // 3. Interior rig — emissive cards standing in for ceiling, walls and bounce.
  //    Their weight tracks daylight: at night the room *is* the light source, so
  //    the cards carry the whole environment; at noon the sky dominates and they
  //    only fill the shadows.
  const dayF = Math.max(0, Math.min(1, (sunElevationDeg + 6) / 24))
  const interior = rig.interiorWeight * (1.25 - 0.45 * dayF)
  const card = (
    w: number, h: number, d: number,
    hex: string, mul: number,
    pos: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(hex).multiplyScalar(mul * interior),
        toneMapped: false,
      }),
    )
    mesh.position.set(...pos)
    scene.add(mesh)
  }
  card(7, 0.2, 7, ...rig.box, [0, 3.7, 0])       // ceiling softbox
  card(6, 3, 0.2, ...rig.key, [0, 1.6, -6.6])    // key wall
  card(0.2, 4, 7, ...rig.fill, [-6.8, 0.8, 0])   // cool fill
  card(0.2, 4, 7, ...rig.bounce, [6.8, 0.6, 0])  // neutral bounce

  return scene
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose()
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
    else m?.dispose()
  })
}

export interface EnvironmentIBLProps {
  sunElevationDeg: number
  sunDirection: { x: number; y: number; z: number }
  preset: EnvPresetId
  turbidity?: number
  cloudiness?: number
  /** Extra multiplier on top of the sky's own luminance (UI mood control). */
  intensity?: number
}

export function EnvironmentIBL({
  sunElevationDeg,
  sunDirection,
  preset,
  turbidity = 2.6,
  cloudiness = 0,
  intensity = 1,
}: EnvironmentIBLProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const size = activeProfile().iblSize

  // Quantised sun: 1.5° buckets. Fine enough that a reflection never visibly
  // steps, coarse enough that dragging the clock across a day costs ~60 bakes
  // instead of one per animation frame.
  const sunBucket = Math.round(sunElevationDeg / 1.5)
  // The azimuth matters too (it moves the specular sun in the reflection), but
  // only coarsely — 6° buckets.
  const azBucket = Math.round((Math.atan2(sunDirection.x, sunDirection.z) * 180) / Math.PI / 6)

  useEffect(() => {
    const envScene = buildEnvScene({ sunElevationDeg, sunDirection, turbidity, cloudiness, preset })

    // Bake through an explicit cube render rather than `PMREMGenerator.fromScene`,
    // which hardcodes a 256² cube: this is the step that makes `profile.iblSize`
    // mean something, so a phone bakes a 64² cube (about a sixteenth of the
    // fragments) and a workstation bakes 512² for mirror-sharp reflections.
    // Half-float is required — the sun disc is ~34× white and would otherwise
    // clip to grey before the convolution ever sees it.
    const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    })
    const cubeCam = new THREE.CubeCamera(0.1, 200, cubeRT)

    // The environment must stay scene-referred; tone mapping belongs at the end
    // of the post chain, not inside a reflection probe.
    const prevToneMapping = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    cubeCam.update(gl, envScene)
    gl.toneMapping = prevToneMapping

    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromCubemap(cubeRT.texture)
    scene.environment = rt.texture

    cubeRT.dispose()
    disposeScene(envScene)
    pmrem.dispose()

    return () => {
      if (scene.environment === rt.texture) scene.environment = null
      rt.dispose()
    }
    // `sunElevationDeg` / `sunDirection` are intentionally *not* dependencies:
    // the quantised buckets stand in for them so a slider drag cannot thrash
    // the bake. eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, preset, size, sunBucket, azBucket, turbidity, cloudiness]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reflection strength follows the sky's own luminance, so interiors keep a
  // day/night cue in every metal and gloss surface without a second bake.
  useEffect(() => {
    const { luminance } = skyModel({ sunElevationDeg, turbidity, cloudiness })
    scene.environmentIntensity = (0.34 + luminance * 0.86) * intensity
  }, [scene, sunElevationDeg, turbidity, cloudiness, intensity])

  return null
}
