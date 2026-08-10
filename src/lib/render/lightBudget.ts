/**
 * lightBudget.ts — renderer-neutral selection of the point lights that matter.
 *
 * ## Why this exists
 *
 * three.js renders with a **forward** pipeline: every enabled light is evaluated
 * in the fragment shader of *every* lit surface. Cost is therefore
 * `O(lights × shaded fragments)`, and it is paid on the expensive
 * `MeshPhysicalMaterial` lobes (clearcoat / sheen / anisotropy) the interior
 * uses. A ten-room plan previously mounted one downlight + two cove washes per
 * room plus one per placed luminaire — 30–40 point lights — so every floor
 * pixel ran forty light evaluations. That, not geometry, was the frame budget.
 *
 * Worse, the light *count* is baked into the compiled shader program. Mounting
 * and unmounting lights while orbiting forces three to recompile every material
 * in the scene, which is the classic mid-interaction stutter.
 *
 * ## The approach
 *
 * Keep a **fixed-size pool** of lights and re-point the pool at whichever
 * sources currently matter most. The count never changes during interaction, so
 * shader programs stay hot; only positions/colours/intensities are written, and
 * those are uniform updates.
 *
 * This module owns the "which sources matter" half — pure data in, pure data
 * out, no THREE types — so the ranking is unit-testable and the renderer glue
 * stays thin.
 *
 * ## Ranking
 *
 * A point light with `decay = 2` and a finite `distance` only illuminates within
 * its influence sphere. What matters visually is whether that sphere covers what
 * the viewer is looking at, so sources are scored by the camera's distance to
 * the **sphere surface** (zero while the camera is inside it), scaled by the
 * source's brightness and its semantic `priority` — a luminaire the user placed
 * outranks an ambient cove strip at equal distance.
 *
 * Selection is **hysteretic**: an incumbent keeps its slot unless a challenger
 * beats it by a relative margin. Without that, two sources with near-equal
 * scores swap every frame and the room visibly flickers while orbiting.
 */

/** A candidate point light, in world metres. Renderer-neutral by design. */
export interface PointLightSpec {
  /** Stable identity across frames — drives hysteresis and React keys. */
  key: string
  position: readonly [number, number, number]
  /** CSS hex colour. */
  color: string
  intensity: number
  /** Influence radius in metres. `0` means unbounded. */
  distance: number
  decay: number
  /**
   * Semantic importance, independent of distance. A placed luminaire (1.0)
   * should win a contested slot over an ambient cove wash (0.45) even when the
   * cove strip is marginally nearer.
   */
  priority: number
}

export interface SelectLightsInput {
  sources: readonly PointLightSpec[]
  /** Camera position, world metres. */
  camera: readonly [number, number, number]
  /** Pool size. Values `<= 0` select nothing. */
  budget: number
  /** Keys selected on the previous evaluation — incumbents get the margin. */
  previous?: readonly string[]
  /**
   * Relative score margin a challenger must beat an incumbent by to take its
   * slot. `0.25` = "must be 25 % better". Default `0.25`.
   */
  hysteresis?: number
}

/**
 * Visual importance of a source from a given viewpoint. Higher wins.
 *
 * The camera's distance to the influence *sphere* (not the light's centre) is
 * what decides whether the light affects anything on screen, so a large-radius
 * cove wash the camera stands inside scores like a lamp at arm's length.
 * Unbounded lights (`distance === 0`) always score as if the camera were inside.
 */
export function lightScore(
  spec: PointLightSpec,
  camera: readonly [number, number, number],
): number {
  if (spec.intensity <= 0 || spec.priority <= 0) return 0
  const dx = spec.position[0] - camera[0]
  const dy = spec.position[1] - camera[1]
  const dz = spec.position[2] - camera[2]
  const centreDist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  // Distance to the sphere surface; 0 while the camera is inside the volume.
  const surfaceDist = spec.distance > 0 ? Math.max(0, centreDist - spec.distance) : 0
  return (spec.priority * spec.intensity) / (1 + surfaceDist * surfaceDist)
}

/**
 * Pick the `budget` most visually relevant sources for this viewpoint.
 *
 * Deterministic: equal scores break by `key`, so the same inputs always yield
 * the same pool ordering and the renderer never sees phantom churn.
 *
 * @returns the selected sources, ranked most-relevant first. Never longer than
 *   `budget`, and never longer than `sources`.
 */
export function selectLights(input: SelectLightsInput): PointLightSpec[] {
  const { sources, camera, budget } = input
  if (budget <= 0 || sources.length === 0) return []

  const hysteresis = input.hysteresis ?? 0.25
  const incumbents = input.previous && input.previous.length > 0 ? new Set(input.previous) : null
  const boost = 1 + Math.max(0, hysteresis)

  const ranked = sources
    .map((spec) => {
      const score = lightScore(spec, camera)
      return {
        spec,
        // Incumbents defend their slot: a challenger must clear the margin.
        effective: incumbents?.has(spec.key) ? score * boost : score,
      }
    })
    .filter((entry) => entry.effective > 0)
    .sort((a, b) => (b.effective - a.effective) || (a.spec.key < b.spec.key ? -1 : 1))

  return ranked.slice(0, budget).map((entry) => entry.spec)
}

/**
 * Pool size for a quality tier.
 *
 * The pool is a *fixed* shader cost, so it is sized to what the tier can carry
 * rather than to the plan: the difference between a two-light and an eight-light
 * program is a recompile, and we would rather pay eight lights' arithmetic than
 * stutter. Callers clamp this to the number of sources actually present, which
 * only changes when the plan or the active mode changes — never while orbiting.
 */
export function lightBudgetForTier(tier: 'high' | 'low' | 'off'): number {
  switch (tier) {
    case 'high':
      return 8
    case 'low':
      return 4
    default:
      return 2
  }
}
