import { useMemo } from 'react'
import type { DayPhase } from '@/lib/environment'
import type { PlanGeo } from '@/types'
import { activeProfile } from '@/lib/render/quality'
import { seasonFromDate } from '@/lib/season'
import type { WorldDetail } from '@/lib/world'
import { useNeighbourhood } from './useNeighbourhood'
import { useOrthophotoGround } from './useOrthophotoGround'
import { Neighbourhood3D } from './Neighbourhood3D'
import { StreetLife } from './StreetLife'

/**
 * WorldAround — what surrounds the plan, from the real world where that is
 * knowable and from the generator where it is not.
 *
 * The rule the whole layer follows: **measured beats assumed, assumed beats
 * empty.** A plan without a location is not a failure state — most plans are
 * drawn before anyone picks a plot — so it keeps the generated neighbourhood
 * it always had. Give it a location and the same scene is rebuilt from the
 * official cadastre, the aerial survey and OpenStreetMap.
 *
 * The two halves are deliberately switched *together*. An official 10 cm aerial
 * photograph underneath a procedurally invented street grid is worse than
 * either on its own: the photograph shows where the roads actually run, and the
 * generator would draw different ones on top of it. So the ground texture is
 * only ever handed to the neighbourhood that was built to match it.
 *
 * Cost: nothing is fetched without a location, every request carries a deadline,
 * and any failure leaves the generated world standing rather than emptying the
 * scene.
 */

export interface WorldAroundProps {
  /** Stable per plan — seeds the generated world so it does not reshuffle. */
  planId: string
  /** Real-world anchor. Absent → generated world, no network traffic at all. */
  geo?: PlanGeo
  /** Plan centre in world metres. */
  cx: number
  cz: number
  /** Plan extent in metres. */
  wM: number
  hM: number
  phase: DayPhase
  /** The environment's continuous exterior-albedo scale. */
  daylightScale: number
  /** Calendar month driving the season's palette (1…12). */
  month?: number
  /** Off for the dashboard thumbnail, where none of this is legible. */
  enabled?: boolean
}

export function WorldAround({
  planId, geo, cx, cz, wM, hM, phase, daylightScale, month, enabled = true,
}: WorldAroundProps) {
  const profile = activeProfile()

  // Detail follows the render budget: the world's own level-of-detail ladder is
  // the cheapest place to spend or save, because it decides how many buildings
  // exist at all rather than how expensively each one is shaded.
  const detail: WorldDetail =
    profile.id === 'ultra' || profile.id === 'high' ? 'high'
      : profile.id === 'balanced' ? 'medium'
        : 'low'

  const centre = useMemo(() => ({ x: cx, z: cz }), [cx, cz])
  const span = Math.max(wM, hM)
  // The ground plane the generator uses, so photo and geometry stay congruent.
  const groundSizeM = useMemo(() => Math.max(120, Math.round((span + 6) * 7)), [span])

  const { world, source } = useNeighbourhood({
    planId,
    geo,
    style: 'de',
    detail,
    centre,
    widthM: wM,
    depthM: hM,
    enabled,
  })

  // The photograph is only requested once the world it belongs under actually
  // came from the real world; under the generated one it would contradict every
  // street it shows.
  const ground = useOrthophotoGround({
    geo,
    groundSizeM,
    pixels: profile.id === 'ultra' ? 4096 : profile.id === 'performance' ? 1024 : 2048,
    enabled: enabled && source === 'osm',
  })

  const season = useMemo(
    () => seasonFromDate(month ?? new Date().getMonth() + 1),
    [month],
  )

  if (!enabled) return null

  return (
    <>
      <Neighbourhood3D
        world={world}
        phase={phase}
        daylightScale={daylightScale}
        season={season}
        rich={profile.richMaterials}
        groundTexture={ground.texture}
        sampleGround={ground.sampleAt}
      />
      {/* People and traffic only where there is budget for the extra draw
          calls — they are life, not legibility. */}
      {profile.richMaterials && (
        <StreetLife world={world} phase={phase} daylightScale={daylightScale} rich={profile.richMaterials} />
      )}
    </>
  )
}
