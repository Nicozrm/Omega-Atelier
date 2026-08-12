/**
 * render/exposure.ts — the camera's exposure, as a function of the world.
 *
 * ## What was missing
 *
 * The post chain is HDR end to end and tone-maps with AgX or ACES — but it did
 * so at a **fixed exposure of 1.0**, at every hour of the day. Nothing else in
 * the pipeline compensates: `skyModel` deliberately leaves the atmospheric
 * model physical (its night falloff is correct and scaling it would only make
 * it less true), `environment` swings sun, ambient and hemisphere intensities
 * across roughly an order of magnitude between midnight and noon, and the tone
 * curve then received all of that through the same aperture.
 *
 * The two ends of the day are where it showed. At noon the sunlit wall beside a
 * window sat far into the roll-off, so the surface that carries most of an
 * interior's information rendered as a flat bright field with its material
 * detail compressed away. At night the scene fell into the toe, where AgX
 * desaturates hard by design, and the warm lamp light it was built to render
 * came out grey.
 *
 * A photographer does not shoot a noon exterior and a lamp-lit interior at the
 * same exposure. This module is that adjustment.
 *
 * ## Partial adaptation, not auto-levels
 *
 * Full normalisation would be wrong in the opposite direction: if exposure
 * exactly cancelled scene luminance, midnight and midday would render at
 * identical brightness and the day cycle would stop meaning anything.
 *
 * So adaptation is *partial*, with exponent `ADAPTATION` ∈ (0, 1):
 *
 *     exposure = (L_ref / L) ^ a
 *     displayed = L · exposure = L^(1−a) · L_ref^a
 *
 * Because `a < 1`, displayed brightness stays strictly increasing in scene
 * luminance — night still renders darker than day, always — while the range it
 * spans is compressed into the part of the tone curve that actually holds
 * detail. This is the same relationship a photographer's exposure choices
 * describe, and the monotonicity is a property worth testing rather than
 * assuming (`exposure.test.ts` does).
 *
 * Pure arithmetic over the environment domain: no THREE types, no renderer.
 */

import { deriveEnvironment, type EnvironmentState } from '@/lib/environment'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/**
 * How much of the scene's brightness swing the exposure cancels.
 *
 * 0 = the previous behaviour (fixed exposure, the full swing hits the tone
 * curve); 1 = auto-levels, where midnight and noon look identical.
 *
 * Deliberately modest. The environment model already darkens the world at night
 * by far more than these three light intensities show — exterior albedo drops to
 * 0.07, the sky goes near-black — so a strong adaptation here would stack on top
 * of that and wash the night out. At 0.35 the measured effect across the model's
 * own range is: clear noon unchanged, a lamp-lit night lifted by about nine
 * tenths of a stop, interiors by half of one.
 */
export const ADAPTATION = 0.35

/**
 * Exposure is never allowed past these, whatever the arithmetic says.
 *
 * Wide enough that the model's own range (clear midnight to clear noon, indoors
 * and out) never touches them — they exist for a plan or an environment that
 * produces something the model was not measured against, not as part of the
 * curve. A clamp that engages in normal use would flatten the day cycle at the
 * end where it engaged.
 */
export const MIN_EXPOSURE = 0.7
export const MAX_EXPOSURE = 1.95

/**
 * Relative weights of the three lights that set the scene's overall level.
 *
 * These are three.js intensities, not photometric quantities — but each
 * contributes near-linearly to the irradiance on a diffuse surface, which is
 * the quantity the exposure has to answer to.
 */
const SUN_WEIGHT = 1.0
const AMBIENT_WEIGHT = 1.35
const HEMISPHERE_WEIGHT = 0.85

/**
 * Fraction of the sun an interior surface actually receives.
 *
 * A room is lit by the sun through its glazing, not by the sun. Without this
 * the walk-mode exposure would stop down for direct sunlight the walls never
 * see, and the interior would render darker at noon than at dusk.
 */
const INTERIOR_SUN_SHARE = 0.28

/**
 * The floor the artificial fixtures put under the scene.
 *
 * Interiors keep their lamps, cove strips and downlights at every hour, so the
 * luminance never actually reaches zero — and without a floor the night
 * exposure would run away into the clamp. Outdoors the equivalent is street
 * lighting, which is far weaker.
 */
const INTERIOR_ARTIFICIAL = 0.55
const EXTERIOR_ARTIFICIAL = 0.14

export interface ExposureContext {
  /** First-person interior view: the sun arrives through glazing, not directly. */
  walkMode?: boolean
}

/**
 * How much of the sun's intensity actually lands on the scene, by elevation.
 *
 * Two reasons, and the second is why it is a ramp rather than a gate.
 *
 * Physically: irradiance on a horizontal surface falls with the cosine of the
 * incidence angle, so a sun at one degree delivers almost nothing however
 * bright it looks.
 *
 * Practically: the environment model's sun intensity steps from exactly zero to
 * ~0.06 as the sun crosses the horizon — three simulated minutes at sunrise.
 * Reading it raw made the exposure inherit that step, which is visible as a
 * flicker when the time slider is dragged through dawn. The ramp dissolves it
 * without touching daylight, where it is flat 1 by six degrees up.
 */
function horizonRamp(elevationDeg: number): number {
  const t = clamp((elevationDeg + 2) / 10, 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * The scene's key luminance, in the renderer's own arbitrary units.
 *
 * Only the *ratio* to `REFERENCE_LUMINANCE` is ever used, so the unit does not
 * matter — but it has to move with the world, which is exactly what a fixed
 * exposure of 1.0 failed to do.
 */
export function sceneKeyLuminance(env: EnvironmentState, ctx: ExposureContext = {}): number {
  const walkMode = ctx.walkMode ?? false
  const sun = Math.max(0, env.lighting.sun.intensity) * horizonRamp(env.sun.elevation)
  const sunShare = walkMode ? INTERIOR_SUN_SHARE : 1
  const artificial = walkMode ? INTERIOR_ARTIFICIAL : EXTERIOR_ARTIFICIAL

  return (
    sun * sunShare * SUN_WEIGHT
    + Math.max(0, env.lighting.ambient.intensity) * AMBIENT_WEIGHT
    + Math.max(0, env.lighting.hemisphere.intensity) * HEMISPHERE_WEIGHT
    + artificial
  )
}

/**
 * The luminance that renders at exposure 1.0 — a clear exterior at midday.
 *
 * Anchored there rather than at the middle of the range on purpose: full
 * daylight is the condition the scene's materials, the tone curve and every
 * grading decision were authored under, so it is the one that must not move.
 * Everything else is pulled toward it, and adding exposure control therefore
 * changes nothing about the view most of this app was tuned in.
 *
 * Derived from the environment model rather than written down, so the anchor
 * cannot drift out of step with it: change how `deriveEnvironment` lights a
 * clear noon and the reference follows.
 */
let _reference: number | undefined
export function referenceLuminance(): number {
  if (_reference === undefined) {
    _reference = sceneKeyLuminance(deriveEnvironment({ timeOfDay: 12, weather: 'clear' }))
  }
  return _reference
}

/** Below this the ratio is meaningless; it also stops a division by zero. */
const MIN_LUMINANCE = 0.05

export function exposureForLuminance(luminance: number): number {
  const reference = referenceLuminance()
  const l = Math.max(MIN_LUMINANCE, Number.isFinite(luminance) ? luminance : reference)
  return clamp(Math.pow(reference / l, ADAPTATION), MIN_EXPOSURE, MAX_EXPOSURE)
}

/** The exposure this world state should be photographed at. */
export function exposureFor(env: EnvironmentState, ctx: ExposureContext = {}): number {
  return exposureForLuminance(sceneKeyLuminance(env, ctx))
}

/**
 * Brightness actually reaching the tone curve — `L · exposure`.
 *
 * Exported because it is the thing the design has to guarantee: it must stay
 * increasing in `L`, or the renderer would show a brighter night than day.
 */
export function displayedLuminance(luminance: number): number {
  return luminance * exposureForLuminance(luminance)
}

/** Seconds to adapt toward a *brighter* image (the eye's slow direction). */
const ADAPT_UP_SECONDS = 0.9
/** …and toward a darker one, which both eye and camera do faster. */
const ADAPT_DOWN_SECONDS = 0.45

/**
 * One frame of exposure adaptation.
 *
 * Scrubbing the time slider crosses several stops in a second, and a hard cut
 * on every frame would strobe. The two time constants differ because adaptation
 * is asymmetric in both the eye and every auto-exposure system: opening up takes
 * longer than stopping down.
 *
 * Exponential rather than linear so the result is frame-rate independent —
 * the same wall-clock curve at 30 fps and at 144.
 */
export function adaptExposure(current: number, target: number, dt: number): number {
  if (!(current > 0) || !Number.isFinite(current)) return target
  if (!Number.isFinite(dt) || dt <= 0) return current
  const tau = target > current ? ADAPT_UP_SECONDS : ADAPT_DOWN_SECONDS
  const k = 1 - Math.exp(-Math.min(dt, 0.25) / tau)
  return current + (target - current) * k
}
