/**
 * pcssShadows.ts — contact-hardening soft shadows (PCSS).
 *
 * ## What it changes
 *
 * three filters shadows with a fixed-width kernel: every shadow edge in the
 * scene gets the same blur, whatever cast it. Real shadows do not behave that
 * way. The sun is an area source about half a degree wide, so a shadow is sharp
 * where the caster touches the receiver and softens with distance — the chair
 * leg is crisp at the floor and diffuse a metre up the wall. That gradient is
 * one of the strongest depth cues a render has, and a uniform blur throws it
 * away: everything reads as either stamped-on or uniformly fuzzy.
 *
 * Percentage-Closer Soft Shadows recovers it in three steps per fragment:
 *
 *  1. **Blocker search** — sample the shadow map around the fragment and average
 *     the depth of the samples that occlude it.
 *  2. **Penumbra estimate** — similar triangles: the further the blocker sits in
 *     front of the receiver, the wider the penumbra.
 *  3. **PCF at that width** — filter with the radius just computed.
 *
 * ## Why the light size is a plain constant
 *
 * Penumbra width in shadow-map UV works out independent of plan size. The
 * penumbra grows with the caster/receiver separation in metres, which is the
 * normalised depth difference times the frustum's depth range; converting to UV
 * divides by the frustum's lateral extent. `SunLight` sizes both from the same
 * bounding sphere, so the two scale together and cancel — a small apartment and
 * a large estate get the same, correct shadow softness from one constant.
 *
 * ## Scope of the patch
 *
 * This rewrites `THREE.ShaderChunk.shadowmap_pars_fragment`, which is process-
 * global and affects every material compiled afterwards. It is therefore:
 *
 *  - **narrow** — only the body of `getShadow` is replaced, by locating its
 *    exact signature. three's uniform blocks, VSM path, point-light shadows and
 *    the `mix( 1.0, shadow, shadowIntensity )` contract are left untouched;
 *  - **guarded** — if the expected signature is not found (a three upgrade
 *    changed it), nothing is patched and the caller is told, so the scene falls
 *    back to standard filtering instead of failing to compile;
 *  - **idempotent** — safe to call from a render path or twice under StrictMode;
 *  - **type-aware** — PCSS only takes over the PCF paths. VSM packs two moments
 *    rather than a depth, and reading it as a depth would be nonsense, so that
 *    branch keeps three's own implementation.
 *
 * One caveat worth knowing: three caches compiled programs by parameters, not by
 * shader source. If a material with identical parameters was already compiled
 * before this patch ran, that cached program is reused and keeps the old
 * filtering. Applying the patch before the 3D canvas mounts avoids it in
 * practice; the failure mode is a shadow that is merely ordinary.
 */

import * as THREE from 'three'

/**
 * Penumbra growth per unit of normalised depth separation, in shadow-map UV.
 *
 * The sun subtends ~0.53°, i.e. `tan θ ≈ 0.0093` of penumbra per unit of
 * separation. Scaled up ~4×, which is what archviz renders conventionally do:
 * the physical value alone reads unnaturally crisp because it ignores how much
 * the sky's own diffuse light softens a real shadow's edge.
 */
const LIGHT_SIZE_UV = 0.04

/** Ceiling on the filter radius, UV. Stops a far blocker from spreading the
 *  kernel so wide that the fixed sample count turns into visible noise. */
const MAX_FILTER_RADIUS = 0.015

/** Taps for the blocker search and for the PCF that follows. */
const BLOCKER_SAMPLES = 16
const PCF_SAMPLES = 16

/** The signature we patch. A three upgrade that changes it disables the patch. */
const GET_SHADOW_SIGNATURE =
  'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'

/** The last statement of `getShadow`, used to find where the function ends. */
const GET_SHADOW_TAIL = 'return mix( 1.0, shadow, shadowIntensity );'

const PCSS_GLSL = /* glsl */ `
	// ── PCSS helpers ─────────────────────────────────────────────────────
	// A Vogel (sunflower) disk: sample k of n at radius sqrt((k+0.5)/n) and
	// angle k × the golden angle. Evenly distributed by construction, and
	// computed rather than looked up — no array indexing, which keeps this
	// valid on every GLSL version three targets.
	vec2 omega_pcssDisk( const in int index, const in int count, const in float phase ) {

		float i = float( index );
		float r = sqrt( ( i + 0.5 ) / float( count ) );
		float theta = i * 2.39996323 + phase;
		return vec2( cos( theta ), sin( theta ) ) * r;

	}

	// Per-fragment rotation of that disk. Without it the sampling pattern
	// prints its own shape into every penumbra as fixed banding.
	float omega_pcssPhase( const in vec2 fragment ) {

		return fract( sin( dot( fragment, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * PI2;

	}

	${GET_SHADOW_SIGNATURE}

		float shadow = 1.0;

		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;

		if ( frustumTest ) {

		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT )

			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float receiver = shadowCoord.z;
			float phase = omega_pcssPhase( gl_FragCoord.xy );

			// A floor of one filtered texel keeps hard contact edges from
			// aliasing into stair-steps when the penumbra estimate is ~0.
			float minRadius = texelSize.x * max( shadowRadius, 1.0 ) * 0.5;

			// ── 1. Blocker search ───────────────────────────────────────
			float searchRadius = ${LIGHT_SIZE_UV.toFixed(4)} * 0.5 + minRadius;
			float blockerSum = 0.0;
			float blockerCount = 0.0;

			for ( int i = 0; i < ${BLOCKER_SAMPLES}; i ++ ) {

				vec2 offset = omega_pcssDisk( i, ${BLOCKER_SAMPLES}, phase ) * searchRadius;
				float depth = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + offset ) );
				if ( depth < receiver ) {

					blockerSum += depth;
					blockerCount += 1.0;

				}

			}

			if ( blockerCount > 0.5 ) {

				// ── 2. Penumbra from similar triangles ──────────────────
				// The shadow camera is orthographic, so depth is linear and
				// the caster/receiver separation is just the depth difference.
				float averageBlocker = blockerSum / blockerCount;
				float penumbra = ( receiver - averageBlocker ) * ${LIGHT_SIZE_UV.toFixed(4)};
				float filterRadius = clamp( penumbra, minRadius, ${MAX_FILTER_RADIUS.toFixed(4)} );

				// ── 3. PCF at the estimated width ───────────────────────
				float sum = 0.0;
				for ( int i = 0; i < ${PCF_SAMPLES}; i ++ ) {

					vec2 offset = omega_pcssDisk( i, ${PCF_SAMPLES}, phase ) * filterRadius;
					sum += texture2DCompare( shadowMap, shadowCoord.xy + offset, receiver );

				}
				shadow = sum / float( ${PCF_SAMPLES} );

			}
			// No blocker found — nothing stands between this point and the
			// sun, so it keeps the fully lit default.

		#elif defined( SHADOWMAP_TYPE_VSM )

			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );

		#else

			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );

		#endif

		}

		${GET_SHADOW_TAIL}

	}
`

/** Set once the global chunk has been rewritten, so repeat calls are no-ops. */
let applied: boolean | null = null

/**
 * Install contact-hardening shadow filtering, process-wide.
 *
 * Call before the canvas that should use it mounts — materials compiled earlier
 * keep their cached program. Idempotent.
 *
 * @returns whether PCSS is in effect. `false` means three's shader no longer
 *   matches what this patch expects and standard filtering is still in use.
 */
export function enablePcssShadows(): boolean {
  if (applied !== null) return applied

  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment
  const start = chunk.indexOf(GET_SHADOW_SIGNATURE)
  if (start === -1) {
    applied = false
    return applied
  }

  // `getShadow` ends at the first occurrence of its tail statement after the
  // signature; `getPointShadow` shares the tail but appears later in the chunk.
  const tail = chunk.indexOf(GET_SHADOW_TAIL, start)
  if (tail === -1) {
    applied = false
    return applied
  }
  const close = chunk.indexOf('}', tail + GET_SHADOW_TAIL.length)
  if (close === -1) {
    applied = false
    return applied
  }

  THREE.ShaderChunk.shadowmap_pars_fragment =
    chunk.slice(0, start) + PCSS_GLSL.trim() + chunk.slice(close + 1)

  applied = true
  return applied
}

/** Test seam: forget that the patch ran. Does not restore the original chunk. */
export function __resetPcssForTests(): void {
  applied = null
}
