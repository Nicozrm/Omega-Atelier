import { activeProfile } from '@/lib/render/quality'

/**
 * tier.ts — the render quality tier, in the three-value vocabulary the scene
 * already speaks.
 *
 * This used to read a CSS class that `AmbientScene` stamped onto `<html>` from
 * `hardwareConcurrency` and `deviceMemory` — a **CPU** signal answering a
 * **GPU** question. A four-core laptop with a discrete card was demoted to the
 * cheap path; a many-core machine with integrated graphics was promoted onto
 * the expensive one; and switching on `prefers-reduced-motion` silently
 * disabled the entire post stack, which has nothing to do with motion.
 *
 * The answer now comes from `render/quality.ts`, which measures the GPU
 * directly (WebGL2, renderer string, texture limits) and which the user can
 * override. This shim keeps the existing three-value call sites working while
 * they migrate to reading the specific profile field they actually care about
 * — `richMaterials`, `detailMaps`, `reflectiveFloor`, `maxDynamicLights`, … —
 * which is both more precise and self-documenting.
 */

export type RenderTier = 'high' | 'low' | 'off'

/** The active tier, derived from the measured render profile. */
export function readTier(): RenderTier {
  const id = activeProfile().id
  return id === 'ultra' || id === 'high' ? 'high' : 'low'
}
