/**
 * hdriSky.ts — choosing and aligning a captured sky.
 *
 * ## Why captured light at all
 *
 * The environment map has been synthetic: an analytic Preetham sky over flat
 * bounce panels. That is physically reasonable, and it is why reflections track
 * the time of day — but it is *smooth*. Real skies are not. The structure a
 * photographed sky carries (cloud edges, the gradient wrapped around the sun,
 * the warm band sitting on the horizon) is most of what separates a reflective
 * floor that reads as photographed from one that reads as rendered, and no
 * amount of tuning an analytic model produces it.
 *
 * ## Why alignment is the whole problem
 *
 * An HDRI has its sun baked in at whatever bearing the photographer stood at.
 * This app computes a *real* solar position from date, latitude and time, and
 * casts its shadows from it. Drop an HDRI in unrotated and the two disagree —
 * highlights arrive from one side while shadows fall to the other. That is the
 * single most obviously wrong thing a render can do, and it is why "just use an
 * HDRI" is not a one-line change.
 *
 * `scripts/assets/hdri.py` therefore measures where each sky's sun actually is.
 * This module turns that measurement into the rotation that puts it exactly
 * where the shadow-casting light already points.
 *
 * Pure: no THREE types, so both the choice and the alignment are unit-testable
 * without a GPU.
 */

import type { EnvironmentState } from '@/lib/environment'

export type HdriSkyKey = 'day' | 'overcast' | 'evening' | 'night'

export interface HdriSky {
  /** File stem under `public/hdri/`, without `.hdr`. */
  file: string
  /** ambientCG asset it was built from (CC0). */
  source: string
  /**
   * Bearing of the brightest direction, radians, in three's equirectangular
   * convention: `atan2(dir.z, dir.x)`, so 0 is +X and it turns toward +Z.
   */
  sunAzimuth: number
  /**
   * How concentrated that brightest direction is, 0…1 — the resultant length of
   * the circular mean. Near 1 means a definite sun worth aligning; low means a
   * diffuse sky where rotation is meaningless.
   */
  concentration: number
  /** Mean linear luminance, used to normalise exposure across the set. */
  meanLuminance: number
}

/**
 * The shipped skies. All CC0 from ambientCG, downsampled to 512×256 — an
 * environment map is a blurred convolution of this, so only a mirror would
 * resolve more, and nothing in the scene is a mirror.
 */
export const HDRI_SKIES: Record<HdriSkyKey, HdriSky> = {
  day: {
    file: 'day',
    source: 'DaySkyHDRI067B',
    sunAzimuth: 0.000775,
    concentration: 1.0,
    meanLuminance: 0.46986,
  },
  overcast: {
    file: 'overcast',
    source: 'DaySkyHDRI068B',
    sunAzimuth: 2.585753,
    concentration: 0.2804,
    meanLuminance: 0.327629,
  },
  evening: {
    file: 'evening',
    source: 'EveningSkyHDRI046B',
    sunAzimuth: -0.003174,
    concentration: 0.9998,
    meanLuminance: 0.179451,
  },
  night: {
    file: 'night',
    source: 'NightSkyHDRI008',
    sunAzimuth: -0.154743,
    concentration: 0.5362,
    meanLuminance: 0.032511,
  },
}

/** Above this cloud cover the sky has no usable sun, whatever the elevation. */
const OVERCAST_CLOUDINESS = 0.6
/** Sun elevation (degrees) above which the day sky is used. */
const DAY_ELEVATION = 8
/** …and below which the night sky is. */
const NIGHT_ELEVATION = -6

/**
 * Which sky to use for a given world state.
 *
 * Weather wins over elevation: a heavily overcast noon has no sun disc to
 * align, and using the clear-sky map would put one there.
 */
export function selectHdriSky(env: EnvironmentState): HdriSkyKey {
  const elevation = env.sun.elevation
  if (elevation < NIGHT_ELEVATION) return 'night'
  if (env.weather.cloudiness > OVERCAST_CLOUDINESS) return 'overcast'
  if (elevation > DAY_ELEVATION) return 'day'
  return 'evening'
}

/** Bearing of the computed sun, in the same convention as `sunAzimuth`. */
export function solarBearing(env: EnvironmentState): number {
  return Math.atan2(env.sun.direction.z, env.sun.direction.x)
}

/** Wrap to (-π, π] so a rotation is always the short way round. */
export function wrapAngle(radians: number): number {
  const wrapped = (radians + Math.PI) % (2 * Math.PI)
  return (wrapped < 0 ? wrapped + 2 * Math.PI : wrapped) - Math.PI
}

/**
 * Rotation (radians about +Y) that lands the sky's sun on the computed solar
 * bearing, so the brightest point of every reflection agrees with the direction
 * shadows fall.
 *
 * ## The sign is measured, not derived
 *
 * The sky is a texture on a sphere seen from *inside* (`BackSide`), and that
 * inverts the horizontal mapping: sweeping the dome through +90° was measured
 * in WebGL to move the sun to **−90°**, not +90°. So the rotation subtracts.
 *
 * Deriving this from the sphere's UV winding and the back-face flip is possible
 * and was not worth trusting — getting it backwards produces a scene lit from
 * one side and shadowed from the other, which is subtle enough to ship and
 * miserable to diagnose. A probe renders the dome into a cube map, finds the
 * brightest texel and reports its bearing; the relationship above is what it
 * measured.
 *
 * ## What this cannot fix
 *
 * Only the *bearing*. A captured sun also sits at a fixed elevation — the clear
 * day map's is ~40° — and no rotation about Y changes that. Selecting a
 * different map per elevation band (day / evening / night) is what keeps the
 * mismatch small; within a band the captured sun stays a little high or low.
 * The shadow-casting light is unaffected and remains physically correct.
 *
 * A diffuse sky has no sun to align, and forcing one would only swing its cloud
 * structure around for no reason — so below `minConcentration` the sky is left
 * where it is.
 */
export function hdriRotationY(
  sky: HdriSky,
  env: EnvironmentState,
  minConcentration = 0.45,
): number {
  if (sky.concentration < minConcentration) return 0
  return wrapAngle(sky.sunAzimuth - solarBearing(env))
}

/**
 * Calibration constant: how much of the analytic sky's delivered light the
 * captured dome should reproduce.
 *
 * Measured, not chosen. Rendering a white matte sphere under the source scene
 * in three configurations — enclosure alone, enclosure + analytic sky,
 * enclosure + captured dome — separates the sky term from the room it sits in.
 * The captured maps are photographed at higher absolute radiance than the
 * analytic model delivers, and without this the swap made full daylight
 * 1.4–1.75× brighter while leaving night and dusk untouched. The ratio the
 * daylight hours need clusters at 0.20–0.24.
 *
 * ## The bigger number this exposes
 *
 * That same measurement showed the enclosure supplying roughly 80 % of the
 * lighting and the sky only ~18 % at noon. That balance came from calibrating
 * against the *studio box* these replaced, whose entire purpose was interior
 * bounce — and it is defensible for a walk-through, where a surface really is
 * lit mostly by the walls around it. For the dollhouse seen from outside it is
 * not: those surfaces see sky.
 *
 * Rebalancing it is a deliberate art-direction change with a visible effect on
 * every interior, so it is left as one number rather than made silently here.
 * Raising this raises the sky's share; `skyModel`'s `interior.intensity` lowers
 * the enclosure's.
 */
export const HDRI_SKY_CALIBRATION = 0.22

/**
 * Scale that brings a sky to a common exposure.
 *
 * The four maps were photographed at wildly different light levels — noon is
 * fourteen times the mean luminance of the night sky — and the scene's exposure
 * was calibrated against the analytic sky these replace. Normalising here keeps
 * that calibration valid, and leaves the *relative* day/night falloff to
 * `skyModel`'s `environmentIntensity`, which already models it deliberately.
 *
 * @param reference  the luminance all skies are normalised to; defaults to the
 *   clear day sky, which is the one the exposure pass was measured against.
 */
export function hdriExposure(sky: HdriSky, reference = HDRI_SKIES.day.meanLuminance): number {
  if (!(sky.meanLuminance > 0) || !(reference > 0)) return HDRI_SKY_CALIBRATION
  const scale = (reference / sky.meanLuminance) * HDRI_SKY_CALIBRATION
  return Number.isFinite(scale) && scale > 0 ? scale : HDRI_SKY_CALIBRATION
}

/** Base-aware URL (works under the GitHub Pages sub-path). */
export function hdriUrl(sky: HdriSky): string {
  return `${import.meta.env.BASE_URL}hdri/${sky.file}.hdr`
}
