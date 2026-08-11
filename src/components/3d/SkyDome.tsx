import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { skyModel, type SkyModel } from '@/lib/render/sky'
import { activeProfile } from '@/lib/render/quality'

/**
 * SkyDome — the sky as **geometry with a shader**, not a CSS gradient behind
 * the canvas.
 *
 * That distinction is the whole point. A gradient painted on the canvas element
 * lives *outside* WebGL: it never appears in a reflection, never refracts
 * through a window pane, never contributes to a specular highlight, and never
 * shows up in the environment map. Every chrome tap and every glass pane in the
 * scene was therefore reflecting a studio box while the "sky" behind the model
 * showed something else entirely — the single loudest CG tell in the frame.
 *
 * Here the sky is an inverted sphere carrying an analytic scattering shader fed
 * by `lib/render/sky.ts`, so the visible dome, the reflections and the IBL all
 * derive from one physical model of the air.
 *
 * What the shader draws, cheapest first (all of it is a handful of ALU ops per
 * fragment — there is no loop, no texture fetch and no overdraw beyond one full
 * screen):
 *   1. the Rayleigh gradient from horizon to zenith, on a perceptual curve,
 *   2. the Mie aerosol lobe: a broad forward-scattering glow around the sun
 *      that widens with turbidity — the thing that makes low sun look *hot*,
 *   3. the sun disc itself with limb darkening, at the real angular diameter,
 *   4. the ground half: albedo bounce below the horizon with a soft terminator,
 *   5. stars (quality ≥ 2): a hashed point field with per-star twinkle, fading
 *      in through civil twilight,
 *   6. clouds (quality ≥ 2): two octaves of value noise, drifting, lit from the
 *      sun side so the edges pick up a silver lining.
 *
 * Everything is driven by uniforms and updated imperatively, so changing the
 * time of day never re-renders React or rebuilds a shader program.
 */

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Direction from the camera to this vertex, in world space. The dome is
    // parented to the camera position, so this is a pure view ray.
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vDir;

  uniform vec3  uZenith;
  uniform vec3  uHorizon;
  uniform vec3  uSunDisc;
  uniform vec3  uSunHalo;
  uniform vec3  uGround;
  uniform vec3  uSunDir;
  uniform float uHaze;
  uniform float uStars;
  uniform float uTime;
  uniform float uCloud;      // cloud cover 0…1
  uniform float uExposure;

  // ── Hash / noise (no textures: everything is arithmetic) ──────────────
  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = valueNoise(p) * 0.6;
    v += valueNoise(p * 2.31 + 17.3) * 0.28;
    v += valueNoise(p * 5.17 + 41.7) * 0.12;
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    float cosT = dot(dir, uSunDir);

    // ── 1. Rayleigh gradient ────────────────────────────────────────────
    // pow() on the height puts most of the colour change in the lower third of
    // the dome, which is where the eye actually reads the sky's mood.
    float up = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 col = mix(uHorizon, uZenith, up);

    // ── 2. Mie forward scattering ───────────────────────────────────────
    // Henyey-Greenstein-ish lobe: tight and bright in clear air, broad and
    // milky when hazy. The extra horizon-hugging term is the warm band that
    // spreads sideways from a setting sun.
    float g = mix(0.86, 0.62, uHaze);
    float denom = 1.0 + g * g - 2.0 * g * cosT;
    float mie = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(denom, 1e-4), 1.5));
    col += uSunHalo * mie * (0.55 + 1.9 * uHaze);
    // Horizon glow: brightest where the sun meets the ground line.
    float horizonBand = exp(-abs(h) * 9.0) * pow(max(cosT, 0.0), 3.0);
    col += uSunHalo * horizonBand * (0.28 + 0.7 * uHaze);

    // ── 3. Sun disc ─────────────────────────────────────────────────────
    // The real sun subtends 0.53°; drawn a touch wider so bloom has something
    // to catch. Limb darkening keeps the edge from reading as a decal.
    float ang = acos(clamp(cosT, -1.0, 1.0));
    float discR = 0.0125;                       // ≈ 0.72°
    float disc = 1.0 - smoothstep(discR * 0.72, discR, ang);
    float limb = sqrt(max(0.0, 1.0 - pow(ang / discR, 2.0)));
    col += uSunDisc * disc * (0.62 + 0.38 * limb);

    // ── 4. Below the horizon ────────────────────────────────────────────
    float below = smoothstep(0.0, -0.06, h);
    col = mix(col, uGround, below * 0.92);

    // ── 5. Stars ────────────────────────────────────────────────────────
    #ifdef RICH_SKY
    if (uStars > 0.001 && h > -0.02) {
      // Quantise the direction into a cell grid; one candidate star per cell.
      vec2 cell = floor(dir.xz * (58.0 / max(abs(dir.y) + 0.25, 0.25)) + dir.y * 31.0);
      float r = hash21(cell);
      if (r > 0.955) {
        float bright = (r - 0.955) / 0.045;
        // Twinkle: two out-of-phase sines so it never reads as a pulse.
        float tw = 0.65 + 0.35 * sin(uTime * (1.4 + r * 3.0) + r * 40.0)
                        * sin(uTime * 0.7 + r * 12.0);
        float fade = smoothstep(-0.02, 0.16, h);
        col += vec3(0.85, 0.88, 1.0) * bright * bright * tw * fade * uStars * 0.9;
      }
    }

    // ── 6. Clouds ───────────────────────────────────────────────────────
    if (uCloud > 0.001 && h > 0.008) {
      // Project the view ray onto a flat cloud deck: perspective compression
      // toward the horizon comes out for free.
      vec2 uv = dir.xz / max(h, 0.05) * 0.35 + vec2(uTime * 0.0035, uTime * 0.0021);
      float n = fbm(uv * 1.35);
      float cover = smoothstep(0.52 - uCloud * 0.34, 0.78 - uCloud * 0.2, n);
      // Density gradient toward the sun side gives the silver lining.
      float lit = 0.55 + 0.45 * pow(max(cosT, 0.0), 2.5);
      vec3 cloudCol = mix(uHorizon * 0.72, uSunHalo * 0.55 + vec3(0.42), lit);
      float edgeGlow = smoothstep(0.44, 0.62, n) * (1.0 - smoothstep(0.6, 0.86, n));
      cloudCol += uSunHalo * edgeGlow * pow(max(cosT, 0.0), 6.0) * 0.9;
      col = mix(col, cloudCol, cover * smoothstep(0.008, 0.14, h) * 0.9);
    }
    #endif

    gl_FragColor = vec4(col * uExposure, 1.0);
    // The sky is authored in radiance units (the disc is ~34× white), so it
    // must go through the same tone-map as every lit surface — otherwise the
    // dome clips to flat white while the model beside it rolls off gracefully.
    // PMREMGenerator disables tone mapping while it bakes, so the environment
    // map still captures the full-range HDR sky.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface SkyDomeProps {
  /** Unit vector toward the sun (+Y up), from the environment domain. */
  sunDirection: { x: number; y: number; z: number }
  /** Sun elevation in degrees — drives the whole scattering model. */
  sunElevationDeg: number
  /** Aerosol load. 2.0 = crisp, 6+ = city haze. */
  turbidity?: number
  /** Cloud cover 0…1. */
  cloudiness?: number
  /** How far the dome sits from the camera (world units). */
  radius?: number
}

/** Push a resolved sky model into the shader's uniforms, allocation-free. */
function applyModel(u: Record<string, THREE.IUniform>, m: SkyModel): void {
  const vec = (name: string) => u[name].value as THREE.Vector3
  vec('uZenith').set(...m.zenith)
  vec('uHorizon').set(...m.horizon)
  vec('uSunDisc').set(...m.sunDisc)
  vec('uSunHalo').set(...m.sunHalo)
  vec('uGround').set(...m.ground)
  u.uHaze.value = m.haze
  u.uStars.value = m.stars
}

export function SkyDome({
  sunDirection,
  sunElevationDeg,
  turbidity = 2.6,
  cloudiness = 0,
  radius = 4000,
}: SkyDomeProps) {
  const profile = activeProfile()
  const meshRef = useRef<THREE.Mesh>(null)

  const material = useMemo(() => {
    const uniforms: Record<string, THREE.IUniform> = {
      uZenith: { value: new THREE.Vector3(0.05, 0.11, 0.27) },
      uHorizon: { value: new THREE.Vector3(0.6, 0.63, 0.7) },
      uSunDisc: { value: new THREE.Vector3(30, 28, 24) },
      uSunHalo: { value: new THREE.Vector3(1, 0.95, 0.85) },
      uGround: { value: new THREE.Vector3(0.14, 0.13, 0.11) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uHaze: { value: 0.2 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0 },
      uExposure: { value: 1 },
    }
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: true,
      fog: false,
    })
    // Stars and clouds are the only branchy part of the shader; compile them
    // out entirely below the top profiles rather than paying for a dead branch.
    if (profile.skyQuality >= 2) mat.defines = { RICH_SKY: '' }
    return mat
  }, [profile.skyQuality])

  // Dispose the program when the profile (and therefore the material) changes.
  useMemo(() => () => material.dispose(), [material])

  // Sky state is recomputed only when the sun actually moves — the model is
  // cheap, but there is no reason to run it 60×/s for a static time of day.
  const model = useMemo(
    () => skyModel({ sunElevationDeg, turbidity, cloudiness }),
    [sunElevationDeg, turbidity, cloudiness],
  )

  useMemo(() => {
    applyModel(material.uniforms, model)
    ;(material.uniforms.uSunDir.value as THREE.Vector3)
      .set(sunDirection.x, sunDirection.y, sunDirection.z)
      .normalize()
    material.uniforms.uCloud.value = cloudiness > 0 ? Math.max(cloudiness, 0.18) : 0.16
  }, [material, model, sunDirection, cloudiness])

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    // Keep the dome centred on the camera: an infinitely distant sky must not
    // parallax when the user orbits or walks.
    meshRef.current?.position.copy(state.camera.position)
  })

  return (
    <mesh ref={meshRef} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[radius, profile.skyQuality >= 2 ? 48 : 24, profile.skyQuality >= 2 ? 32 : 16]} />
    </mesh>
  )
}
