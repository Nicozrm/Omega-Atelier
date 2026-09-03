/**
 * skyEnvironment — the sky as a *reflection* source for exterior surfaces.
 *
 * In the repository this was ported from, this module published a second,
 * sky-only PMREM: `scene.environment` there held an archviz studio box tuned
 * for the interior, so putting the outdoor sky on exterior materials required
 * giving them their own `envMap`.
 *
 * That premise no longer holds here. `SkyEnvironment` already bakes the **real
 * sky** — the same Preetham model the dome paints — together with the interior
 * bounce, and publishes it as `scene.environment`. A window reflecting the
 * scene environment is therefore already reflecting the actual sky at the
 * actual hour, which is the whole thing the second map existed to provide.
 *
 * So this returns `null` on purpose, and that is the *correct* answer rather
 * than a stub: a material with no `envMap` of its own falls through to
 * `scene.environment`. Returning a separate map would cost a second PMREM
 * convolution per sky change and, worse, would **replace** the scene
 * environment on exactly those materials — the mistake documented at length in
 * `Neighbourhood3D`, where an own `envMap` silently removed the ambient
 * contribution the surface was lit by.
 *
 * The hook is kept rather than deleted so the ported components stay
 * recognisably themselves, and so that reintroducing a dedicated sky map later
 * is a change in one place.
 */
import type * as THREE from 'three'

export function useSkyEnvironment(): THREE.Texture | null {
  return null
}
