/**
 * specularAA.ts — geometric specular anti-aliasing (normal-variance roughness
 * filtering).
 *
 * ## The artefact
 *
 * Every normal-mapped surface in this scene — the parquet planks, the brushed
 * steel of the appliances, the tile grout, the slate — carries detail far finer
 * than a pixel once the camera pulls back. A pixel then covers many texels, each
 * pointing somewhere slightly different, and the shader answers with the
 * highlight of *one* of them: whichever normal happened to land under the sample
 * point. Move the camera a hair and a different texel wins.
 *
 * The result is the single most recognisable "this is CG" tell there is: a
 * crawling, sparkling glitter across glossy surfaces that no amount of MSAA or
 * SMAA removes, because it is not an edge-geometry problem. The sample is not
 * *aliased*, it is *wrong* — a full BRDF lobe got replaced by a point sample of
 * itself.
 *
 * ## The fix
 *
 * Widen the lobe to cover what the pixel actually spans. If the normal varies
 * across a pixel, that variation is indistinguishable — at this distance — from
 * the surface simply being rougher. So measure the variance of the shading
 * normal in screen space and fold it into the roughness:
 *
 *   α' = clamp( α + min( 2σ²·(|∂n/∂x|² + |∂n/∂y|²), κ ), 0, 1 )
 *
 * This is Tokuyoshi & Kaplanyan's *Improved Geometric Specular Antialiasing*
 * (2019), the formulation that shipped in Unreal and Frostbite. The highlight
 * stops sparkling and starts *converging*: a distant metal rail reads as an even
 * satin sheen instead of a line of fireflies, and it does so without blurring
 * anything the pixel can genuinely resolve — at close range the variance goes to
 * zero and the material renders exactly as authored.
 *
 * ## Why three does not already do this
 *
 * It looks like it does. `lights_physical_fragment` computes a `geometryRoughness`
 * term from screen-space derivatives and adds it to the material roughness — but
 * it takes those derivatives of `nonPerturbedNormal`, the *interpolated vertex*
 * normal. That catches curvature (a cylinder's silhouette) and nothing else. The
 * normal map, which is where essentially all of the sub-pixel detail in a PBR
 * scene lives, contributes exactly zero. This patch adds the term three leaves
 * out, taken from the perturbed `normal` that actually shades the fragment.
 *
 * ## Cost, and why this is never gated behind a quality profile
 *
 * Two `dFdx`/`dFdy` pairs on a vec3, a dot product and a square root, per
 * fragment. The chunk this patches already calls `dFdx` on a vec3 one line
 * above, so no new hardware capability is required and no new varying is
 * introduced.
 *
 * It is also the wrong knob to save frames with: specular aliasing gets *worse*
 * as resolution drops, so the cheap devices — the ones rendering at DPR 1 with
 * no supersampling to average the sparkle away — are precisely the ones that
 * need it most. It runs on every profile.
 *
 * ## Scope of the patch
 *
 * Same contract as `pcssShadows`: this rewrites a process-global
 * `THREE.ShaderChunk`, so it is **narrow** (two exact anchor statements, each
 * asserted to be unique), **guarded** (an anchor that no longer matches disables
 * the patch rather than corrupting the shader), and **idempotent**.
 *
 * The usual `ShaderChunk` caveat applies: three caches compiled programs by
 * parameters, not by source, so this must run before the materials that should
 * use it compile.
 */

import * as THREE from 'three'

/**
 * σ² — the variance of the pixel reconstruction filter, in pixels².
 *
 * 0.25 is the paper's recommended value and corresponds to a Gaussian whose
 * standard deviation is half a pixel: the filter is assumed to gather roughly
 * one pixel's worth of surface, which is what a non-supersampled raster does.
 */
export const SCREEN_SPACE_VARIANCE = 0.25

/**
 * κ — the ceiling on how much α the filter may add.
 *
 * Without it, a normal map viewed at a grazing angle produces an unbounded
 * derivative and washes the surface to fully rough in a single frame, which
 * reads as a grey band sweeping across the floor. 0.18 is the paper's threshold:
 * high enough to kill the sparkle, low enough that a mirror stays a mirror.
 */
export const VARIANCE_THRESHOLD = 0.18

/**
 * The screen-space variance of a shading normal, from its two derivatives.
 *
 * The TS mirror of the GLSL below — same expression, same constants, so the
 * behaviour of the shader can be reasoned about and tested without a GPU.
 */
export function normalVariance(
  dndx: readonly [number, number, number],
  dndy: readonly [number, number, number],
): number {
  const sqx = dndx[0] * dndx[0] + dndx[1] * dndx[1] + dndx[2] * dndx[2]
  const sqy = dndy[0] * dndy[0] + dndy[1] * dndy[1] + dndy[2] * dndy[2]
  return SCREEN_SPACE_VARIANCE * (sqx + sqy)
}

/**
 * Widen a roughness to account for sub-pixel normal variation.
 *
 * Filtering happens in **α = roughness²**, not in roughness. α is the GGX
 * distribution's actual width parameter, so variances add there; adding in
 * roughness space would over-filter smooth surfaces (where α is tiny but
 * roughness is not) and under-filter rough ones.
 *
 * @param roughness perceptual roughness as authored, 0…1
 * @param variance  from {@link normalVariance}
 * @returns the filtered perceptual roughness, ≥ `roughness`, ≤ 1
 */
export function filteredRoughness(roughness: number, variance: number): number {
  const alpha = roughness * roughness
  const kernel = Math.min(2 * variance, VARIANCE_THRESHOLD)
  return Math.sqrt(Math.min(1, Math.max(0, alpha + kernel)))
}

/**
 * The GLSL for one filtering site, as a *block* rather than a function.
 *
 * `lights_physical_fragment` is inlined into `main()`, where a function
 * declaration is not legal GLSL — so the maths is emitted inline and scoped in
 * braces, which keeps `dndx`/`dndy` from colliding with anything three declares
 * later in the same body. Emitting it from one template is also what keeps the
 * two call sites (base roughness, clearcoat roughness) from drifting apart.
 */
function filterBlock(roughnessExpr: string, normalExpr: string): string {
  return /* glsl */ `
	{
		vec3 omega_dndx = dFdx( ${normalExpr} );
		vec3 omega_dndy = dFdy( ${normalExpr} );
		float omega_variance = ${SCREEN_SPACE_VARIANCE.toFixed(4)} * ( dot( omega_dndx, omega_dndx ) + dot( omega_dndy, omega_dndy ) );
		float omega_kernel = min( 2.0 * omega_variance, ${VARIANCE_THRESHOLD.toFixed(4)} );
		${roughnessExpr} = sqrt( saturate( ${roughnessExpr} * ${roughnessExpr} + omega_kernel ) );
	}`
}

/**
 * The statements we append to. Chosen because they are the last write to each
 * roughness before it is used: three clamps to 1.0 on the following line, which
 * this block's own `saturate` makes redundant but harmless.
 */
const BASE_ANCHOR = 'material.roughness += geometryRoughness;'
const CLEARCOAT_ANCHOR = 'material.clearcoatRoughness += geometryRoughness;'

/** Set once the global chunk has been rewritten, so repeat calls are no-ops. */
let applied: boolean | null = null

/**
 * Replace `anchor` with `anchor` + its filter block, but only if the anchor
 * occurs exactly once — a second occurrence would mean the chunk is not the one
 * this patch was written against, and patching both sites blindly is how a
 * shader ends up silently wrong instead of loudly unpatched.
 */
function appendFilter(chunk: string, anchor: string, normalExpr: string): string | null {
  const parts = chunk.split(anchor)
  if (parts.length !== 2) return null
  const roughnessExpr = anchor.slice(0, anchor.indexOf(' '))
  return parts[0] + anchor + filterBlock(roughnessExpr, normalExpr) + parts[1]
}

/**
 * Install normal-variance roughness filtering, process-wide.
 *
 * Call before the canvas that should use it mounts. Idempotent.
 *
 * @returns whether the base-roughness filter is in effect. `false` means three's
 *   shader no longer matches what this patch expects and the scene renders with
 *   three's own (normal-map-blind) geometric roughness instead.
 *
 *   The clearcoat filter is applied opportunistically on top: it matters for the
 *   lacquered floors, but a scene without it is merely slightly sparklier, not
 *   wrong, so a missing clearcoat anchor does not veto the base patch.
 */
export function enableSpecularAA(): boolean {
  if (applied !== null) return applied

  const original = THREE.ShaderChunk.lights_physical_fragment
  const withBase = appendFilter(original, BASE_ANCHOR, 'normal')
  if (!withBase) {
    applied = false
    return applied
  }

  // `clearcoatNormal` only exists under `#ifdef USE_CLEARCOAT`, which is exactly
  // the block this anchor sits in — so the reference is always in scope.
  const withClearcoat = appendFilter(withBase, CLEARCOAT_ANCHOR, 'clearcoatNormal')

  THREE.ShaderChunk.lights_physical_fragment = withClearcoat ?? withBase
  applied = true
  return applied
}

/** Test seam: forget that the patch ran. Does not restore the original chunk. */
export function __resetSpecularAAForTests(): void {
  applied = null
}
