import { useSyncExternalStore } from 'react'
import {
  activeProfile, detectedProfileId, renderProfileChoice, subscribeRenderProfile,
  type RenderProfile, type RenderProfileChoice, type RenderProfileId,
} from '@/lib/render/quality'
import { renderStatsSnapshot, subscribeRenderStats, type RenderStats } from '@/components/3d/AdaptiveQuality'

/**
 * React bindings for the render-quality store.
 *
 * The store itself is deliberately framework-free — material factories and
 * shader builders read it synchronously, outside any component. `useSyncExternalStore`
 * is the correct bridge: it subscribes without an effect, so a profile change
 * cannot render a component against a stale value.
 */
export function useRenderProfile(): {
  profile: RenderProfile
  choice: RenderProfileChoice
  detected: RenderProfileId
} {
  const profile = useSyncExternalStore(subscribeRenderProfile, activeProfile, activeProfile)
  const choice = useSyncExternalStore(subscribeRenderProfile, renderProfileChoice, () => 'auto' as const)
  const detected = useSyncExternalStore(subscribeRenderProfile, detectedProfileId, () => 'performance' as const)
  return { profile, choice, detected }
}

/**
 * Live frame statistics (fps · pixel ratio · refinement state).
 *
 * `renderStats` is mutated in place every frame and only *published* four times
 * a second, so subscribing here costs the HUD four renders per second rather
 * than sixty.
 */
export function useRenderStats(): RenderStats {
  return useSyncExternalStore(subscribeRenderStats, renderStatsSnapshot, renderStatsSnapshot)
}
