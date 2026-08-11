/**
 * render/sky.ts — the **atmosphere model**: what the sky looks like, derived
 * from where the sun is.
 *
 * `environment.ts` already answers *where is the sun and how bright is it*.
 * This module answers the next question — *what colour is the air* — and it
 * answers it from physics rather than from a colour ramp, because the two
 * consumers need consistency the ramp could not give them:
 *
 *  1. the sky-dome shader (`SkyDome.tsx`), which paints the visible sky, and
 *  2. the image-based lighting (`EnvironmentIBL.tsx`), which lights every metal,
 *     glass and gloss surface in the scene from that same sky.
 *
 * If those two disagree the render falls apart instantly: chrome reflecting a
 * blue noon sky while the window shows a red sunset is the single most obvious
 * "this is CG" tell. So both read the *same* numbers from here.
 *
 * The model is a deliberately small analytic approximation of Rayleigh + Mie
 * scattering — not a full Hosek-Wilkie fit, which would cost far more code and
 * be invisible at this exposure range. What it does reproduce, correctly and
 * continuously:
 *
 *  - **Rayleigh (λ⁻⁴)**: air scatters blue far more than red. A short optical
 *    path (sun overhead) leaves the disc white and the zenith deep blue.
 *  - **Optical depth at grazing angles**: a low sun looks through ~38× more
 *    atmosphere, so blue is scattered out of the direct beam entirely and the
 *    disc and the air around it go orange, then red.
 *  - **Mie / aerosol haze**: a forward-scattering white-grey lobe around the
 *    sun that grows with turbidity and washes the horizon out.
 *  - **Night**: below the horizon everything decays to a near-black sky with
 *    airglow at the horizon, and the star field fades in through civil
 *    twilight.
 *
 * Pure functions, plain numbers, no THREE and no DOM — unit-testable, and
 * reusable by anything that needs to know what the air is doing.
 */

export type RGB = [number, number, number]

export interface SkyInput {
  /** Sun elevation above the horizon, degrees (negative = below). */
  sunElevationDeg: number
  /** Atmospheric turbidity: 1.8 = alpine clear … 10 = heavy urban haze. */
  turbidity?: number
  /** Cloud cover 0…1 — desaturates and flattens the whole dome. */
  cloudiness?: number
  /** Ground albedo tint reflected back into the lower dome. */
  groundAlbedo?: RGB
}

/**
 * Everything the shader and the IBL need. All colours are **linear** RGB in
 * radiance units (values above 1 are intended — the sun disc is ~40× white),
 * because they feed an HDR pipeline that tone-maps at the very end.
 */
export interface SkyModel {
  /** Radiance straight up. */
  zenith: RGB
  /** Radiance at the horizon ring, away from the sun. */
  horizon: RGB
  /** Colour of the aerosol glow hugging the sun. */
  sunHalo: RGB
  /** Radiance of the sun disc itself. */
  sunDisc: RGB
  /** Colour reflected up from the ground onto the lower hemisphere. */
  ground: RGB
  /** Width of the Mie forward-scattering lobe, 0…1 (bigger = hazier). */
  haze: number
  /** Star visibility, 0 (day) … 1 (astronomical night). */
  stars: number
  /** Overall sky luminance 0…1 — drives IBL intensity and exposure cues. */
  luminance: number
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const clamp01 = (n: number) => clamp(n, 0, 1)
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k]

/**
 * Rayleigh scattering coefficients at sea level for R/G/B, normalised to the
 * red channel. The λ⁻⁴ law over the sRGB primaries (≈ 680 / 550 / 440 nm):
 * (680/440)⁴ ≈ 5.7, which is exactly why the sky is blue and sunsets are red.
 */
const RAYLEIGH: RGB = [1.0, 2.34, 5.71]

/**
 * Relative optical path length through the atmosphere at a given elevation
 * (Kasten-Young air mass). 1 at the zenith, ≈ 38 at the horizon — the reason a
 * low sun is red rather than merely dim.
 */
export function airMass(elevationDeg: number): number {
  const e = Math.max(elevationDeg, -2)
  const z = 90 - e
  return 1 / (Math.cos((z * Math.PI) / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364))
}

/**
 * Beer-Lambert extinction of the direct solar beam: what survives the trip
 * through `mass` atmospheres. Blue is stripped first, so the surviving beam
 * walks white → gold → orange → deep red as the sun sets. This *is* the sunset.
 */
export function beamTransmittance(mass: number, turbidity: number): RGB {
  // Sea-level Rayleigh optical depth at the red primary is ≈ 0.04 per air mass;
  // the other channels follow the λ⁻⁴ ratios above. Aerosols add a spectrally
  // flatter, turbidity-driven term (Ångström exponent ~1.3 ⇒ mild blue bias).
  const rayleigh = 0.04 * mass
  const aerosol = 0.0088 * mass * (turbidity - 1) * 0.42
  return [
    Math.exp(-rayleigh * RAYLEIGH[0] - aerosol * 0.82),
    Math.exp(-rayleigh * RAYLEIGH[1] - aerosol * 1.0),
    Math.exp(-rayleigh * RAYLEIGH[2] - aerosol * 1.24),
  ]
}

/**
 * The *perceived colour* of the sun and of the air lit by it — the extincted
 * beam, renormalised to full brightness and filled back in by multiple
 * scattering.
 *
 * Extinction alone would drive a horizon sun to pure monochromatic red
 * (transmittance ≈ 0.26 / 0.04 / 0.0004), which is not what a photograph
 * records: light scattered *out* of the beam elsewhere in the sky scatters
 * *back* into the line of sight, and that fill grows with path length. Weighting
 * the fill by wavelength — red needs none, blue receives least — lands the low
 * sun on deep orange instead of blood red, exactly where photographs sit.
 */
export function beamTint(mass: number, turbidity: number): RGB {
  const t = beamTransmittance(mass, turbidity)
  const peak = Math.max(t[0], t[1], t[2]) || 1
  const n: RGB = [t[0] / peak, t[1] / peak, t[2] / peak]
  const fill = 0.1 + 0.22 * smoothstep(1, 20, mass)
  return [n[0], n[1] + (1 - n[1]) * fill * 0.6, n[2] + (1 - n[2]) * fill * 0.32]
}

/** Photometric weight of an RGB radiance — Rec. 709 luma. */
const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * Rayleigh scattering *hue*, normalised so the strongest channel is 1. This is
 * the colour of clear air lit from any direction — the blue of the zenith.
 */
const RAYLEIGH_HUE: RGB = [RAYLEIGH[0] / RAYLEIGH[2], RAYLEIGH[1] / RAYLEIGH[2], 1]

/**
 * Resolve the full sky appearance. Continuous in `sunElevationDeg` — scrubbing
 * the time-of-day slider must never step, because both the visible dome and the
 * IBL follow this function and a step would pop every reflection in the scene.
 */
export function skyModel(input: SkyInput): SkyModel {
  const elev = input.sunElevationDeg
  const turbidity = clamp(input.turbidity ?? 2.6, 1.5, 10)
  const cloudiness = clamp01(input.cloudiness ?? 0)
  const groundAlbedo = input.groundAlbedo ?? [0.16, 0.15, 0.13]

  // Day factor: 0 below civil twilight, 1 with the sun well up.
  const day = smoothstep(-6, 12, elev)
  // Golden factor: peaks while the sun sits in the 0…8° band.
  const golden = smoothstep(-5, 2, elev) * (1 - smoothstep(3, 14, elev))

  const mass = airMass(elev)
  /** What the beam *looks* like (normalised + multiple scattering). */
  const beam = beamTint(mass, turbidity)
  /** How much of the beam actually survives — drives brightness, not colour. */
  const survival = beamTransmittance(mass, turbidity)
  /**
   * Solar energy still available to scatter anywhere in the dome, 0…1. This is
   * the term that makes the whole sky dim as the sun sets: the air has not
   * changed, the light reaching it has.
   */
  const beamEnergy = luma(survival)

  // ── Zenith ──
  // Straight up we look through the shortest path and see almost pure Rayleigh
  // scattering — hence blue. It stays blue at dusk (the zenith air is still lit
  // by a sun grazing the *upper* atmosphere) and only dims; the warm shift
  // belongs to the horizon band, where the path is long.
  const zenithDay = scale(RAYLEIGH_HUE, 0.3 * (0.08 + 0.92 * beamEnergy))
  // Night zenith: no scattering left, only a faint airglow. Kept near-neutral —
  // a saturated blue night reads as a video game, not as a photograph.
  const zenithNight: RGB = [0.006, 0.008, 0.016]
  let zenith = mixRGB(zenithNight, zenithDay, day)

  // ── Horizon ──
  // A long path in every direction: heavily multiply-scattered (so pale and
  // slightly cool at noon) and, once the sun is low, tinted by whatever survives
  // the beam. This is the band the windows actually show.
  const hazeGrey: RGB = [0.62, 0.66, 0.74]
  const horizonDay = scale(
    mixRGB(hazeGrey, beam, 0.55 + 0.4 * golden),
    0.22 + 0.95 * beamEnergy,
  )
  const horizonNight: RGB = [0.018, 0.020, 0.030]
  let horizon = mixRGB(horizonNight, horizonDay, smoothstep(-8, 4, elev))

  // ── Sun disc + halo ──
  // The disc is the *unscattered* beam: bright, and exactly the colour the
  // extinction curve left behind. Its intensity falls with air mass, which is
  // why you can look straight at a setting sun and not at a midday one.
  const discEnergy = 34 * (0.22 + 0.78 * smoothstep(-2, 10, elev)) * (0.35 + 0.65 * beamEnergy)
  const sunDisc: RGB = scale(beam, discEnergy)
  // The Mie lobe around it: the beam colour, softened toward white by aerosols.
  const sunHalo = mixRGB(scale(beam, 1.5), [1.1, 1.0, 0.92], 0.35 + 0.3 * (turbidity - 1.5) / 8.5)

  // ── Ground bounce ──
  const ground = scale(groundAlbedo as RGB, 0.12 + 0.85 * day)

  // ── Weather + summary ──
  if (cloudiness > 0) {
    // Overcast: the dome collapses toward a single flat grey, dimmer overall.
    const grey = (c: RGB): RGB => { const l = luma(c); return [l, l, l] }
    zenith = mixRGB(zenith, scale(grey(zenith), 1.06), cloudiness * 0.86)
    horizon = mixRGB(horizon, scale(grey(horizon), 0.94), cloudiness * 0.86)
  }

  // A single 0…1 handle on "how much light is the sky giving the scene" — the
  // IBL strength and the exposure cues both hang off it.
  const luminance = clamp01((luma(zenith) * 0.45 + luma(horizon) * 0.55) * 1.35 * (1 - cloudiness * 0.3))
  // Stars survive only once the sun is well below the horizon, and never
  // through cloud.
  const stars = clamp01(1 - smoothstep(-14, -2, elev)) * (1 - cloudiness)

  return {
    zenith,
    horizon,
    sunHalo,
    sunDisc,
    ground,
    haze: clamp01(0.12 + (turbidity - 1.5) / 12 + golden * 0.28 + cloudiness * 0.3),
    stars,
    luminance,
  }
}

/** Linear RGB → an `#rrggbb` string, with the sRGB transfer curve applied. */
export function linearToHex(c: RGB): string {
  const enc = (v: number) => {
    const x = clamp01(v)
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.round(clamp01(s) * 255).toString(16).padStart(2, '0')
  }
  return `#${enc(c[0])}${enc(c[1])}${enc(c[2])}`
}
