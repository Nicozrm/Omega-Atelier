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
 * Map the selected sources onto the fixed pool of light slots, **stickily**.
 *
 * `selectLights` returns sources ranked by relevance, and that ranking
 * reshuffles constantly as the camera moves even when the chosen *set* is
 * unchanged. Driving slot `i` from rank `i` would therefore hand slots to
 * different sources several times a second, restarting crossfades and moving
 * lights that never actually went anywhere.
 *
 * So a source that keeps its place in the budget keeps its slot, and only the
 * genuinely free slots are handed to newcomers.
 *
 * @param current  the key each slot drives today, `null` for an idle slot
 * @param picked   keys selected for this evaluation, in any order
 * @returns the key each slot should drive, `null` where it should fade out.
 *   Same length as `current`.
 */
export function assignSlots(
  current: ReadonlyArray<string | null>,
  picked: ReadonlyArray<string>,
): Array<string | null> {
  const wanted = new Set(picked)
  // Incumbents that are still wanted keep their slot; everything else frees up.
  const next: Array<string | null> = current.map((key) => (key !== null && wanted.has(key) ? key : null))

  const retained = new Set<string>()
  for (const key of next) if (key !== null) retained.add(key)

  const newcomers = picked.filter((key) => !retained.has(key))
  let n = 0
  for (let i = 0; i < next.length && n < newcomers.length; i++) {
    if (next[i] === null) next[i] = newcomers[n++]
  }
  return next
}

/**
 * Pool size for a render profile.
 *
 * The pool is a *fixed* shader cost, so it is sized to what the profile can
 * carry rather than to the plan: the difference between a two-light and an
 * eight-light program is a recompile, and we would rather pay the extra lights'
 * arithmetic than stutter. Callers clamp this to the number of sources actually
 * present, which only changes when the plan or the active mode changes — never
 * while orbiting.
 *
 * This used to take the coarse three-value tier and answer 8/4/2, which quietly
 * discarded the profile's own `maxDynamicLights` (24/16/10/6): an ultra machine
 * lit a scene with eight lamps when it had been budgeted for twenty-four, and
 * `readTier()` can no longer return `'off'` at all, so the third case was
 * unreachable. The profile field is the declared budget, so it is the one that
 * decides — this function exists to state the floor and the rounding, not to
 * hold a second opinion.
 */
export function lightBudgetForProfile(maxDynamicLights: number): number {
  if (!Number.isFinite(maxDynamicLights)) return 1
  // At least one slot: a plan with a single lamp must still light it, and a
  // zero-length pool would compile a program that no source can ever occupy.
  return Math.max(1, Math.floor(maxDynamicLights))
}
