/**
 * render/quality.ts — the **render-quality domain** of the 3D view.
 *
 * One question, answered in one place: *how much rendering can this machine
 * actually afford, and what does the frame look like at that budget?*
 *
 * Until now the 3D view read a CSS class (`q-high` / `q-low` / `q-off`) that the
 * ambient background layer derived from `hardwareConcurrency` and `deviceMemory`.
 * That is a **CPU** signal driving a **GPU** decision: a 4-core laptop with a
 * discrete GPU was demoted to the cheap path, a many-core machine with an
 * integrated GPU was promoted into the expensive one, and switching on
 * `prefers-reduced-motion` silently disabled the whole post stack. This module
 * replaces that proxy with a real device probe and turns the answer into a
 * *profile*: an explicit, complete description of the frame.
 *
 * Design rules:
 *  - **Pure core, thin shell.** `scoreDevice`/`profileForScore`/`RENDER_PROFILES`
 *    are pure data + arithmetic and fully unit-tested. Only `probeDevice()`
 *    touches the DOM/WebGL, and it degrades to conservative defaults everywhere
 *    it cannot measure (SSR, tests, locked-down browsers).
 *  - **User beats heuristic.** An explicit choice is persisted and always wins;
 *    `'auto'` re-probes.
 *  - **Readable synchronously.** Material builders and the R3F tree both need
 *    the profile, and materials are built outside React — hence a module-level
 *    singleton with a subscription, exposed to React via `useSyncExternalStore`.
 */

export type RenderProfileId = 'ultra' | 'high' | 'balanced' | 'performance'
/** What the user picked: a fixed profile, or `auto` = trust the probe. */
export type RenderProfileChoice = RenderProfileId | 'auto'

/**
 * The complete description of a frame. Every renderer decision reads a field
 * from here — there are no ad-hoc `readTier() === 'high'` checks left to drift.
 */
export interface RenderProfile {
  id: RenderProfileId
  label: string
  /** One-line rationale, shown in the quality menu. */
  hint: string

  // ── Resolution ────────────────────────────────────────────
  /** Device-pixel-ratio ceiling while the camera moves (smooth beats sharp). */
  dprMotion: number
  /** DPR ceiling once the camera settles — >1 device DPR = supersampling. */
  dprStill: number

  // ── Shadows ───────────────────────────────────────────────
  shadowMapSize: number
  /** PCSS contact hardening (sharp at the contact point, soft further away). */
  softShadows: boolean
  /** Contact-shadow render-target resolution. */
  contactShadowSize: number

  // ── Lighting / materials ─────────────────────────────────
  /** PMREM cube size of the image-based lighting. */
  iblSize: number
  /** Refractive glass (`transmission`) — costs an extra scene render. */
  transmission: boolean
  /** Chromatic dispersion in glass — free-ish on top of transmission. */
  dispersion: boolean
  /** Upload roughness/detail micro-maps (extra sampler + VRAM). */
  detailMaps: boolean
  /**
   * Multiplier on the generated size of every procedural texture.
   *
   * The most direct lever there is on how sharp a material *looks*, and the one
   * that decides whether walk mode reads as a photograph or as a blur: at 1× the
   * wall maps are 256², so a 4 m wall carries about 1.3 texels per centimetre
   * and dissolves as soon as you stand next to it.
   *
   * It is also the most expensive lever, quadratically so. Measured across both
   * generated libraries — the 54 interior maps in `lib/textures` (30 authored
   * at 256², 24 at 512²) and the outdoor surfaces in `lib/proceduralTextures`
   * (brick, board, roof, asphalt, pavers, lawn), mipmaps included:
   *
   *   | scale · cap  | interior | outdoor | total  | profiles              |
   *   | 1× · 512     |    42 MB |   24 MB |  66 MB | performance, balanced |
   *   | 2× · 512     |    72 MB |   33 MB | 105 MB | high                  |
   *   | 2× · 1024    |   168 MB |   81 MB | 249 MB | ultra                 |
   *
   * Generation cost scales the same way — paid once behind the loading spinner,
   * then cached in IndexedDB (interior only; the outdoor set is cheap enough to
   * rebuild). The night-city backdrop is exempt: at 2048×512 it is already the
   * largest texture in the app and it is seen through a window from across a
   * room, so more pixels buy nothing.
   *
   * Integer only: 256 and 512 are powers of two and mipmap cleanly, and so is
   * everything they reach by doubling.
   */
  textureScale: 1 | 2
  /**
   * Ceiling on any single generated map, in pixels.
   *
   * Why a cap and not just a bigger multiplier: the bundle is authored at two
   * sizes, and they are not equally worth enlarging. The 256² half is the wall
   * plaster, the fabrics, the metals, the plastics — most of the surface area
   * of an interior, and the half that actually looks soft. The 512² half is
   * mostly floors, which are already the sharpest thing in the frame.
   *
   * Doubling everything therefore spends two thirds of its VRAM (168 MB vs
   * 72 MB) on the maps with the least to gain. Capping at 512 doubles the soft
   * half and leaves the floors alone, which is where `high` sits; `ultra` lifts
   * the cap because it can afford to.
   *
   * Never smaller than the authored size — a cap below it would blur the
   * material rather than sharpen it, which is the opposite of the point.
   */
  textureMaxSize: number
  /** Texture anisotropy cap (clamped again by the GPU limit). */
  anisotropy: number
  /** Keep expensive PBR lobes (clearcoat / sheen / anisotropy) in materials. */
  richMaterials: boolean
  /** Ceiling on simultaneously-lit dynamic point lights. */
  maxDynamicLights: number
  /** Mirror-like planar reflections on polished floors. */
  reflectiveFloor: boolean

  // ── Atmosphere ────────────────────────────────────────────
  /** 0 = flat gradient · 1 = analytic scattering · 2 = + clouds & stars. */
  skyQuality: 0 | 1 | 2
  /** Light shafts through the windows (god rays). */
  godRays: boolean
  /** Visible light cones under the ceiling spots. */
  volumetrics: boolean

  // ── Post ──────────────────────────────────────────────────
  /** Ambient occlusion: off · half-res · full-res. */
  ao: 'off' | 'half' | 'full'
  /** Screen-space reflections (temporally resolved). */
  ssr: boolean
  bloom: boolean
  dof: boolean
  /** Film grain amount, 0 = off. */
  grain: number
  /** Contrast-adaptive sharpening strength, 0 = off. */
  sharpen: number
  /** Procedural filmic 3D-LUT colour grade. */
  colorGrade: boolean
  chromaticAberration: boolean
  /** MSAA sample count for the composer's input buffer (0 = off). */
  msaa: number
}

/** Shared baseline; each profile below states only what it changes. */
const BASE: Omit<RenderProfile, 'id' | 'label' | 'hint'> = {
  dprMotion: 1,
  dprStill: 1,
  shadowMapSize: 1024,
  softShadows: false,
  contactShadowSize: 512,
  iblSize: 128,
  transmission: false,
  dispersion: false,
  detailMaps: false,
  textureScale: 1,
  textureMaxSize: 512,
  anisotropy: 2,
  richMaterials: false,
  maxDynamicLights: 6,
  reflectiveFloor: false,
  skyQuality: 0,
  godRays: false,
  volumetrics: false,
  ao: 'off',
  ssr: false,
  bloom: false,
  dof: false,
  grain: 0,
  sharpen: 0,
  colorGrade: false,
  chromaticAberration: false,
  msaa: 0,
}

/**
 * The four budgets. `performance` is the floor every device can hold; `ultra`
 * is what a discrete GPU can carry without dropping below a smooth frame,
 * because the expensive parts (supersampling, SSR, full-res AO) only run while
 * the camera is *still* — see `AdaptiveQuality`.
 */
export const RENDER_PROFILES: Record<RenderProfileId, RenderProfile> = {
  ultra: {
    ...BASE,
    id: 'ultra',
    label: 'Ultra',
    hint: 'Alles an — SSR, Volumetrik, Supersampling im Standbild',
    dprMotion: 1.25,
    dprStill: 2.25,
    shadowMapSize: 4096,
    softShadows: true,
    contactShadowSize: 2048,
    iblSize: 512,
    transmission: true,
    dispersion: true,
    detailMaps: true,
    textureScale: 2,
    textureMaxSize: 1024,
    anisotropy: 16,
    richMaterials: true,
    maxDynamicLights: 24,
    reflectiveFloor: true,
    skyQuality: 2,
    godRays: true,
    volumetrics: true,
    ao: 'full',
    ssr: true,
    bloom: true,
    dof: true,
    grain: 0.028,
    sharpen: 0.42,
    colorGrade: true,
    chromaticAberration: true,
    msaa: 4,
  },
  high: {
    ...BASE,
    id: 'high',
    label: 'Hoch',
    hint: 'Fotorealistisch ohne SSR — der Standard für gute GPUs',
    dprMotion: 1.1,
    dprStill: 1.85,
    shadowMapSize: 3072,
    softShadows: true,
    contactShadowSize: 1024,
    iblSize: 256,
    transmission: true,
    dispersion: false,
    detailMaps: true,
    textureScale: 2,
    anisotropy: 8,
    richMaterials: true,
    maxDynamicLights: 16,
    reflectiveFloor: true,
    skyQuality: 2,
    godRays: true,
    volumetrics: true,
    ao: 'half',
    bloom: true,
    dof: true,
    grain: 0.022,
    sharpen: 0.35,
    colorGrade: true,
    chromaticAberration: true,
    msaa: 4,
  },
  balanced: {
    ...BASE,
    id: 'balanced',
    label: 'Ausgewogen',
    hint: 'Weiche Schatten und Farbgrading, ohne teure Passes',
    dprMotion: 1,
    dprStill: 1.5,
    shadowMapSize: 2048,
    contactShadowSize: 512,
    iblSize: 128,
    detailMaps: true,
    anisotropy: 4,
    richMaterials: true,
    maxDynamicLights: 10,
    skyQuality: 1,
    ao: 'half',
    bloom: true,
    grain: 0.016,
    sharpen: 0.28,
    colorGrade: true,
    msaa: 2,
  },
  performance: {
    ...BASE,
    id: 'performance',
    label: 'Performance',
    hint: 'Maximale Bildrate — für schwache GPUs und Mobilgeräte',
    dprMotion: 1,
    dprStill: 1.15,
    shadowMapSize: 1024,
    contactShadowSize: 256,
    iblSize: 64,
    anisotropy: 2,
    maxDynamicLights: 6,
    skyQuality: 1,
    sharpen: 0.2,
    msaa: 2,
  },
}

export const RENDER_PROFILE_ORDER: RenderProfileId[] = ['performance', 'balanced', 'high', 'ultra']

// ─────────────────────────────────────────────────────────────
// Device probe
// ─────────────────────────────────────────────────────────────

/** Everything the heuristic is allowed to look at. Plain data → testable. */
export interface DeviceProbe {
  /** WebGL2 available (MRT, float targets — required by SSR and N8AO). */
  webgl2: boolean
  /** `UNMASKED_RENDERER_WEBGL`, lower-cased. Empty when masked. */
  renderer: string
  /** GL_MAX_TEXTURE_SIZE — a decent proxy for GPU class when the name is masked. */
  maxTextureSize: number
  /** Logical CPU cores (tie-breaker only). */
  cores: number
  /** `navigator.deviceMemory` in GB (tie-breaker only; often absent). */
  memoryGB: number
  /** Touch-primary / phone-class device. */
  mobile: boolean
  /** Physical device pixel ratio. */
  dpr: number
  /** Software rasteriser (SwiftShader / llvmpipe / ANGLE-on-CPU). */
  software: boolean
}

/** Conservative probe used when nothing can be measured (SSR, jsdom, no WebGL). */
export const UNKNOWN_DEVICE: DeviceProbe = {
  webgl2: false,
  renderer: '',
  maxTextureSize: 4096,
  cores: 4,
  memoryGB: 4,
  mobile: false,
  dpr: 1,
  software: false,
}

/** GPU families we can name with confidence, strongest first. */
const GPU_RULES: Array<{ re: RegExp; score: number }> = [
  // Discrete desktop — the only class that can afford SSR + supersampling.
  { re: /rtx|geforce (rtx|gtx 16|gtx 10)|radeon rx (5|6|7|9)\d{3}|rx 9070|arc a7/, score: 100 },
  { re: /geforce|quadro|radeon (pro )?(rx|vii)|amd radeon r9/, score: 82 },
  // Apple silicon: the Pro/Max/Ultra dies are discrete-class, the base M is not.
  { re: /apple m\d+ (pro|max|ultra)/, score: 92 },
  { re: /apple m\d+/, score: 76 },
  { re: /apple gpu|apple a\d+/, score: 58 },
  // Modern Intel integrated / entry discrete.
  { re: /intel\(r\) arc|arc a3/, score: 62 },
  { re: /iris|intel.*\bxe\b|intel.*g7/, score: 52 },
  // AMD integrated (RDNA2 in Ryzen APUs) — a real step above Intel's old iGPUs.
  { re: /radeon graphics|vega \d/, score: 40 },
  // Legacy integrated: renders everything, affords nothing.
  { re: /uhd graphics|hd graphics/, score: 28 },
  // Mobile SoCs — capable but thermally limited; never promote past balanced.
  { re: /adreno (7|8)\d\d/, score: 46 },
  { re: /adreno|mali-g[78]\d|immortalis/, score: 34 },
  { re: /mali|powervr|videocore/, score: 22 },
]

/**
 * Score a device 0…100. The GPU name dominates; when it is masked (Firefox's
 * default, Safari, privacy extensions) we fall back to structural signals —
 * WebGL2 + max texture size + cores/RAM — which correlate well enough to place
 * the device in the right *bucket*, which is all that is asked of this number.
 */
export function scoreDevice(p: DeviceProbe): number {
  // A software rasteriser must never be promoted — it will render, slowly.
  if (p.software) return 5
  if (!p.webgl2) return 18

  const named = GPU_RULES.find((r) => r.re.test(p.renderer))
  let score: number
  if (named) {
    score = named.score
  } else {
    // Masked renderer: infer from capability + host. Max texture size splits
    // "real GPU" (16k) from "integrated/mobile" (8k) from "old" (4k).
    const byTexture = p.maxTextureSize >= 16384 ? 62 : p.maxTextureSize >= 8192 ? 46 : 28
    const byHost = Math.min(20, p.cores * 1.4) + Math.min(12, p.memoryGB * 1.6)
    score = byTexture * 0.72 + byHost
  }

  // Phones/tablets pay a thermal-headroom penalty: a phone that benchmarks like
  // a laptop still throttles after a minute of continuous rendering.
  if (p.mobile) score *= 0.62
  // A hi-dpi panel means every quality step costs 2–4× the pixels.
  if (p.dpr >= 2.5) score *= 0.86
  else if (p.dpr >= 2) score *= 0.93

  return Math.max(0, Math.min(100, Math.round(score)))
}

/** Map a device score onto the profile it can hold at a smooth frame rate. */
export function profileForScore(score: number): RenderProfileId {
  if (score >= 78) return 'ultra'
  if (score >= 56) return 'high'
  if (score >= 33) return 'balanced'
  return 'performance'
}

/**
 * Measure the current device. Creates a throwaway WebGL context, reads what it
 * can, and destroys it. Never throws: any failure yields `UNKNOWN_DEVICE`,
 * which scores into `performance`.
 */
export function probeDevice(): DeviceProbe {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return UNKNOWN_DEVICE
  try {
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null
    const gl = (gl2 ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return UNKNOWN_DEVICE

    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(
      (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
    ).toLowerCase()
    const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096

    // Release the probe context immediately — browsers cap live GL contexts.
    gl.getExtension('WEBGL_lose_context')?.loseContext()

    const nav = navigator as Navigator & { deviceMemory?: number; maxTouchPoints?: number }
    const ua = (nav.userAgent || '').toLowerCase()
    const mobile =
      /android|iphone|ipad|ipod|mobile|tablet/.test(ua) ||
      ((nav.maxTouchPoints ?? 0) > 1 && /mac/.test(ua) === false && /win/.test(ua) === false)

    return {
      webgl2: !!gl2,
      renderer,
      maxTextureSize,
      cores: nav.hardwareConcurrency ?? 4,
      memoryGB: nav.deviceMemory ?? 4,
      mobile,
      dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      software: /swiftshader|llvmpipe|software|basic render|microsoft basic/.test(renderer),
    }
  } catch {
    return UNKNOWN_DEVICE
  }
}

// ─────────────────────────────────────────────────────────────
// Store — one profile per page, readable outside React
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'omega.render.profile'

export function loadProfileChoice(): RenderProfileChoice {
  if (typeof localStorage === 'undefined') return 'auto'
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'auto' || (v && v in RENDER_PROFILES)) return v as RenderProfileChoice
  } catch { /* private mode — fall through to auto */ }
  return 'auto'
}

function persistProfileChoice(choice: RenderProfileChoice): void {
  try { localStorage?.setItem(STORAGE_KEY, choice) } catch { /* non-fatal */ }
}

let _probe: DeviceProbe | null = null
let _detected: RenderProfileId | null = null
let _choice: RenderProfileChoice | null = null
const listeners = new Set<() => void>()

/** The measured device, probed once per page. */
export function deviceProbe(): DeviceProbe {
  if (!_probe) _probe = probeDevice()
  return _probe
}

/** The profile the probe recommends, ignoring any user override. */
export function detectedProfileId(): RenderProfileId {
  if (!_detected) _detected = profileForScore(scoreDevice(deviceProbe()))
  return _detected
}

/** The user's persisted choice (`'auto'` until they pick one). */
export function renderProfileChoice(): RenderProfileChoice {
  if (!_choice) _choice = loadProfileChoice()
  return _choice
}

/** **The** profile in force right now. Safe to call from anywhere, any time. */
export function activeProfile(): RenderProfile {
  const choice = renderProfileChoice()
  return RENDER_PROFILES[choice === 'auto' ? detectedProfileId() : choice]
}

/**
 * Switch profiles. Persists, then notifies subscribers — the 3D view remounts
 * its scene on the returned id so materials and render targets are rebuilt for
 * the new budget instead of limping along with the old one's shaders.
 */
export function setRenderProfileChoice(choice: RenderProfileChoice): void {
  if (_choice === choice) return
  _choice = choice
  persistProfileChoice(choice)
  for (const l of [...listeners]) l()
}

export function subscribeRenderProfile(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Test seam: force a profile/probe without touching localStorage or WebGL. */
export function __setProfileForTests(
  choice: RenderProfileChoice,
  probe?: DeviceProbe,
): void {
  _choice = choice
  if (probe) { _probe = probe; _detected = profileForScore(scoreDevice(probe)) }
  for (const l of [...listeners]) l()
}
