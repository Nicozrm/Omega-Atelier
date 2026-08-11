import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import { enablePcssShadows, __resetPcssForTests } from './pcssShadows'

const ORIGINAL = THREE.ShaderChunk.shadowmap_pars_fragment

beforeEach(() => {
  THREE.ShaderChunk.shadowmap_pars_fragment = ORIGINAL
  __resetPcssForTests()
})

afterEach(() => {
  THREE.ShaderChunk.shadowmap_pars_fragment = ORIGINAL
  __resetPcssForTests()
})

describe('enablePcssShadows', () => {
  it('patches the shipped three shader chunk', () => {
    expect(enablePcssShadows()).toBe(true)
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toContain('omega_pcssDisk')
  })

  it('is idempotent — a second call does not patch the patch', () => {
    enablePcssShadows()
    const once = THREE.ShaderChunk.shadowmap_pars_fragment
    expect(enablePcssShadows()).toBe(true)
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).toBe(once)
    // The helper must appear exactly once, not nested from a double apply.
    const occurrences = once.split('vec2 omega_pcssDisk').length - 1
    expect(occurrences).toBe(1)
  })

  it('replaces getShadow only, leaving the rest of the chunk intact', () => {
    enablePcssShadows()
    const patched = THREE.ShaderChunk.shadowmap_pars_fragment
    // three's other shadow machinery must survive verbatim.
    expect(patched).toContain('float getPointShadow(')
    expect(patched).toContain('float VSMShadow (')
    expect(patched).toContain('float texture2DCompare(')
    expect(patched).toContain('vec2 cubeToUV(')
    // Exactly one getShadow definition, with three's own signature preserved.
    const signature = 'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
    expect(patched.split(signature).length - 1).toBe(1)
  })

  it('keeps the shadowIntensity contract three relies on', () => {
    enablePcssShadows()
    const patched = THREE.ShaderChunk.shadowmap_pars_fragment
    // Once for getShadow, once for getPointShadow.
    const returns = patched.split('return mix( 1.0, shadow, shadowIntensity );').length - 1
    expect(returns).toBe(2)
  })

  it('keeps braces balanced', () => {
    enablePcssShadows()
    const patched = THREE.ShaderChunk.shadowmap_pars_fragment
    let depth = 0
    for (const ch of patched) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })

  it('preserves the non-PCF paths rather than reading VSM data as depth', () => {
    enablePcssShadows()
    const patched = THREE.ShaderChunk.shadowmap_pars_fragment
    expect(patched).toContain('#elif defined( SHADOWMAP_TYPE_VSM )')
    expect(patched).toContain('shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );')
  })

  it('declines to patch a chunk whose signature it does not recognise', () => {
    // Stands in for a future three release renaming or resignaturing getShadow:
    // the scene must fall back to normal shadows, never to a broken shader.
    THREE.ShaderChunk.shadowmap_pars_fragment = 'float getShadow( sampler2D m ) { return 1.0; }'
    expect(enablePcssShadows()).toBe(false)
    expect(THREE.ShaderChunk.shadowmap_pars_fragment).not.toContain('omega_pcssDisk')
  })

  it('declines when the terminating statement is missing', () => {
    THREE.ShaderChunk.shadowmap_pars_fragment =
      'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n return 1.0;\n}'
    expect(enablePcssShadows()).toBe(false)
  })
})
