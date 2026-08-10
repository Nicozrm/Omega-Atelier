/**
 * skyModel.ts — atmospheric and interior-bounce parameters for the scene's
 * image-based lighting, derived from the physical environment state.
 *
 * ## What this fixes
 *
 * Reflections used to come from a fixed studio box: six coloured panels, built
 * once, with only an overall intensity multiplier varying by day phase. So at
 * midnight the chrome taps, the glazing and the lacquered floor all mirrored a
 * bright white softbox — the single most obvious "this is a 3D render" tell in
 * the scene, because reflections carried no information about the world.
 *
 * The environment domain already knows the real solar position, sky colour and
 * cloud cover. This module turns that state into the parameters an atmospheric
 * scattering model (Preetham, via three's `Sky`) and the interior bounce panels
 * need, so what a polished surface reflects actually tracks the time of day.
 *
 * ## The interior/exterior balance
 *
 * An IBL should approximate what a surface *sees*. Inside a house at night that
 * is warm wall bounce from the lamps; at noon it is mostly sky through the
 * glazing. The two contributions therefore cross over with daylight rather than
 * one simply replacing the other — at dusk both are present, which is exactly
 * when interiors look their best.
 *
 * Pure data in, pure data out: no THREE types, so the mapping is unit-testable.
 */

import type { EnvironmentState } from '@/lib/environment'

/** Parameters for one build of the environment map. */
export interface SkyParams {
  /** Preetham atmospheric turbidity — haze/aerosol load. Clear ≈ 2, overcast ≈ 10. */
  turbidity: number
  /** Rayleigh scattering strength — the blue of a clear sky. */
  rayleigh: number
  /** Mie scattering coefficient — the bright halo hugging the sun. */
  mieCoefficient: number
  /** Mie directionality — how tightly that halo clings to the sun. */
  mieDirectionalG: number
  /** Ground bounce — the light a surface receives from below. */
  ground: { intensity: number }
  /** Warm interior wall/ceiling bounce. Dominates once the sun is down. */
  interior: { intensity: number }
  /**
   * Global exposure for the finished environment map (`scene.environmentIntensity`).
   *
   * Deliberately *not* a multiplier on the sky itself: the scattering model is
   * physical, and its day/night falloff is already correct — with the sun below
   * the horizon its radiance goes to zero on its own. Scaling it by hand would
   * only make it less true. Exposure, interior bounce and the atmosphere stay
   * three orthogonal controls.
   */
  environmentIntensity: number
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Smooth 0→1 ramp across `[e0, e1]`. Used instead of hard phase buckets so that
 * scrubbing the time slider dissolves the lighting rather than stepping it.
 */
function smooth(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

/**
 * Daylight weight from the sun's elevation: 0 through the night, 1 with the sun
 * well up. Deliberately starts lifting a few degrees *below* the horizon, since
 * civil twilight is still a meaningful light source.
 */
export function daylightWeight(elevationDeg: number): number {
  return smooth(-6, 16, elevationDeg)
}

/**
 * Map the world state onto environment-map parameters.
 *
 * @param env  the physical environment (sun, sky, weather) from `lib/environment`
 */
export function skyParamsFor(env: EnvironmentState): SkyParams {
  const elevation = env.sun.elevation
  const cloudiness = clamp01(env.weather.cloudiness)
  const day = daylightWeight(elevation)

  // Cloud cover thickens the atmosphere and washes the blue out of it: turbidity
  // climbs, Rayleigh falls, and the sun's Mie halo spreads into a flat glare.
  const turbidity = 2 + cloudiness * 8
  const rayleigh = (3 - cloudiness * 2.2) * (0.35 + 0.65 * day)
  const mieCoefficient = 0.005 + cloudiness * 0.02
  const mieDirectionalG = 0.8 - cloudiness * 0.15

  // Ground bounce tracks how much light is actually landing on the ground.
  const ground = { intensity: 0.15 + 0.85 * day }

  // Interior bounce is what is left when the sky stops delivering. It never
  // reaches zero by day — lamps and warm walls still bounce light at noon — and
  // never exceeds one, so the two contributions cross over instead of stacking
  // into an over-bright environment at dusk.
  const interior = { intensity: 1 - 0.45 * day }

  // Continuous exposure ramp. This replaces a five-value lookup keyed on the
  // day *phase*, which stepped the reflection strength on every phase border —
  // the same discontinuity `exteriorLightScale` was already smoothed out for.
  // The sub-linear curve keeps twilight from reading as flatly dark.
  const environmentIntensity = 0.35 + 0.65 * Math.pow(day, 0.7)

  return {
    turbidity, rayleigh, mieCoefficient, mieDirectionalG,
    ground, interior, environmentIntensity,
  }
}

/**
 * A coarse fingerprint of the parameters that matter for rebuilding the map.
 *
 * Generating a PMREM is milliseconds of GPU work — cheap once, wasteful sixty
 * times a second. Quantising the sun's direction and the daylight weight means
 * a rebuild is skipped whenever the sky has not visibly moved, which covers the
 * common case of the scene re-rendering for reasons unrelated to lighting.
 *
 * This is a coarse filter, not the whole story: dragging the time slider still
 * crosses buckets steadily, so the renderer additionally rate-limits rebuilds.
 * The quantisation is chosen for *visual* fidelity — roughly 7° of sun movement,
 * below what a blurred environment convolution resolves anywhere except in a
 * mirror — rather than to hit a rebuild count.
 */
export function skyFingerprint(env: EnvironmentState): string {
  const d = env.sun.direction
  const q = (n: number) => Math.round(n * 8)
  return [
    q(d.x), q(d.y), q(d.z),
    Math.round(daylightWeight(env.sun.elevation) * 24),
    Math.round(env.weather.cloudiness * 10),
  ].join(',')
}
