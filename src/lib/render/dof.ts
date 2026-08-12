/**
 * render/dof.ts — how much the lens is allowed to blur, given where the camera
 * stands.
 *
 * Depth of field is what makes a render read as *photographed* rather than
 * *computed* — but only at the distance the aperture was chosen for. The view
 * has one camera doing two very different jobs:
 *
 *  - **Room level** (2–5 m): the cinematic case. A shallow plane isolates the
 *    sofa from the wall behind it, and the director's focus pull during a glide
 *    is the whole point of the Kino-Tour.
 *  - **Dollhouse overview** (15–25 m): the hero frame, the first thing anyone
 *    sees, and an *architectural* image. The same aperture that flattered the
 *    sofa now softens the far bedroom and the near terrace into mush — the
 *    tilt-shift "miniature" look, which is charming in a photo of a model and
 *    wrong in a plan someone is trying to read.
 *
 * A real architectural photographer solves this by stopping down: close in, wide
 * open; far out, small aperture, everything sharp. That is all this module does
 * — it just does it continuously, so orbiting out of a room never steps.
 *
 * Pure arithmetic, no THREE: the rule is the thing worth checking, and checking
 * it in a unit test beats squinting at a screenshot.
 */

export interface DofInput {
  /** Distance from the camera to the focal point, metres. */
  distanceM: number
  /**
   * The director's focus pull, 0…1. Non-zero only mid-glide, when the story is
   * deliberately isolating a destination — that intent outranks the distance
   * rule, or a fly-in across a large plan would arrive with a flat image.
   */
  pull?: number
  /** Eye-level walking wants uniform sharpness; the bokeh breathes to zero. */
  walkMode?: boolean
}

/** Bokeh scale below which the effect is not worth the pass. */
export const DOF_OFF_THRESHOLD = 0.05

/** Where the aperture starts closing, metres. Inside this, nothing changes. */
const NEAR_M = 5
/** Where it is fully stopped down, metres — a whole-plan overview. */
const FAR_M = 16
/** Bokeh at room level, wide open. */
const BOKEH_NEAR = 1.2
/**
 * Bokeh in the overview. Not zero: a trace of defocus at the very front and
 * back edges still reads as a lens rather than an orthographic drawing, and it
 * hides the hard cut where the ground plane ends. It is a twelfth of the
 * room-level value, which is below the threshold at which a viewer can call it
 * "blurry".
 */
const BOKEH_FAR = 0.1

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

/**
 * Bokeh scale for the current framing.
 *
 * Smoothstep rather than a linear ramp so neither end has a corner: orbiting
 * out of a room must not have a moment where the blur visibly "starts going".
 */
export function bokehForDistance(input: DofInput): number {
  const { distanceM, pull = 0, walkMode = false } = input
  if (walkMode) return 0
  if (!Number.isFinite(distanceM)) return BOKEH_NEAR

  const t = clamp01((Math.max(0, distanceM) - NEAR_M) / (FAR_M - NEAR_M))
  const eased = t * t * (3 - 2 * t)
  const base = BOKEH_NEAR + (BOKEH_FAR - BOKEH_NEAR) * eased

  // The focus pull re-opens the aperture, scaled by how far it is being pulled.
  // It is added rather than blended so a pull at overview distance still reads,
  // without ever exceeding the room-level maximum by more than the pull itself.
  return base + clamp01(pull) * 2.2
}

/**
 * Focal length for the current framing.
 *
 * `DepthOfFieldEffect` derives the circle of confusion from this together with
 * the focus distance; a longer lens at range keeps the falloff gentle instead
 * of letting the far plane fall off a cliff.
 */
export function focalLengthForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM)) return 0.08
  const t = clamp01((Math.max(0, distanceM) - NEAR_M) / (FAR_M - NEAR_M))
  return 0.08 + 0.04 * t
}
