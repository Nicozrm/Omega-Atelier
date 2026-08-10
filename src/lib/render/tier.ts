/**
 * tier.ts — the render quality tier, read from the document root.
 *
 * `AmbientScene` probes the device once on boot and stamps `q-high` / `q-low` /
 * `q-off` onto `<html>`. Every renderer-side quality decision (shadow map size,
 * post-processing stack, light pool size, texture detail maps) reads it from
 * there, so the whole app agrees on one answer without threading a prop through
 * the tree or subscribing to a store.
 */

export type RenderTier = 'high' | 'low' | 'off'

/** The active tier. Defaults to `high` outside the browser (SSR, tests). */
export function readTier(): RenderTier {
  if (typeof document === 'undefined') return 'high'
  const c = document.documentElement.classList
  if (c.contains('q-off')) return 'off'
  if (c.contains('q-low')) return 'low'
  return 'high'
}
