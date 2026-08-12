import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as THREE from 'three'
import {
  enableSpecularAA, __resetSpecularAAForTests,
  filteredRoughness, normalVariance,
  SCREEN_SPACE_VARIANCE, VARIANCE_THRESHOLD,
} from './specularAA'

const ORIGINAL = THREE.ShaderChunk.lights_physical_fragment

beforeEach(() => {
  THREE.ShaderChunk.lights_physical_fragment = ORIGINAL
  __resetSpecularAAForTests()
})

afterEach(() => {
  THREE.ShaderChunk.lights_physical_fragment = ORIGINAL
  __resetSpecularAAForTests()
})

const FLAT = [0, 0, 0] as const

describe('normalVariance', () => {
  it('is zero where the normal does not change across the pixel', () => {
    expect(normalVariance(FLAT, FLAT)).toBe(0)
  })

  it('scales with the squared magnitude of the derivatives', () => {
    const small = normalVariance([0.1, 0, 0], FLAT)
    const twice = normalVariance([0.2, 0, 0], FLAT)
    // Squared: doubling the derivative quadruples the variance.
    expect(twice).toBeCloseTo(small * 4, 12)
  })

  it('weights both screen axes equally', () => {
    expect(normalVariance([0.3, 0, 0], FLAT)).toBeCloseTo(normalVariance(FLAT, [0, 0.3, 0]), 12)
  })

  it('applies the pixel-filter variance as the coefficient', () => {
    // |dndx|² = 1 → σ² · 1.
    expect(normalVariance([1, 0, 0], FLAT)).toBeCloseTo(SCREEN_SPACE_VARIANCE, 12)
  })
})

describe('filteredRoughness', () => {
  it('leaves a resolved surface exactly as authored', () => {
    // Close to the camera the normal is constant across the pixel: the material
    // must render at its authored roughness, not a blurred approximation of it.
    for (const r of [0, 0.05, 0.3, 0.68, 1]) {
      expect(filteredRoughness(r, 0)).toBeCloseTo(r, 12)
    }
  })

  it('only ever widens the lobe', () => {
    for (const r of [0, 0.08, 0.25, 0.5, 0.9, 1]) {
      for (const v of [0, 0.001, 0.02, 0.4, 5]) {
        expect(filteredRoughness(r, v)).toBeGreaterThanOrEqual(r - 1e-12)
      }
    }
  })

  it('is monotonic in variance', () => {
    let last = -1
    for (const v of [0, 0.005, 0.01, 0.05, 0.09, 0.2]) {
      const r = filteredRoughness(0.2, v)
      expect(r).toBeGreaterThanOrEqual(last)
      last = r
    }
  })

  it('filters in alpha, not in roughness', () => {
    // The defining property: variance adds to roughness², so the same variance
    // moves a near-mirror far more (in roughness) than an already-rough surface.
    const v = 0.01
    const mirrorShift = filteredRoughness(0.05, v) - 0.05
    const matteShift = filteredRoughness(0.9, v) - 0.9
    expect(mirrorShift).toBeGreaterThan(matteShift)
  })

  it('caps the added kernel at the threshold, so a mirror stays a mirror', () => {
    // An unbounded grazing-angle derivative must not wash the surface to fully
    // rough — the added alpha saturates at kappa.
    const extreme = filteredRoughness(0, 1e6)
    expect(extreme).toBeCloseTo(Math.sqrt(VARIANCE_THRESHOLD), 12)
    expect(extreme).toBeLessThan(0.5)
  })

  it('never exceeds a valid roughness', () => {
    for (const r of [0.9, 1]) {
      expect(filteredRoughness(r, 1e6)).toBeLessThanOrEqual(1)
    }
  })
})

describe('enableSpecularAA', () => {
  it('patches the shipped three shader chunk', () => {
    expect(enableSpecularAA()).toBe(true)
    expect(THREE.ShaderChunk.lights_physical_fragment).toContain('omega_variance')
  })

  it('filters the perturbed normal, which is the one three ignores', () => {
    enableSpecularAA()
    const patched = THREE.ShaderChunk.lights_physical_fragment
    // The whole point: three derives its geometryRoughness from the *non*
    // perturbed normal, so the normal map contributes nothing. Ours must read
    // `normal` — if this ever reverts to nonPerturbedNormal the patch is a no-op.
    expect(patched).toContain('vec3 omega_dndx = dFdx( normal );')
    expect(patched).toContain('vec3 omega_dndy = dFdy( normal );')
  })

  it('filters the clearcoat lobe from the clearcoat normal', () => {
    enableSpecularAA()
    const patched = THREE.ShaderChunk.lights_physical_fragment
    expect(patched).toContain('vec3 omega_dndx = dFdx( clearcoatNormal );')
    expect(patched).toContain('material.clearcoatRoughness = sqrt( saturate(')
  })

  it('keeps three\'s own geometric roughness rather than replacing it', () => {
    // Curvature filtering and normal-map filtering answer different questions;
    // this patch adds the second, it does not take over the first.
    enableSpecularAA()
    const patched = THREE.ShaderChunk.lights_physical_fragment
    expect(patched).toContain('vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );')
    expect(patched).toContain('material.roughness += geometryRoughness;')
    expect(patched).toContain('material.clearcoatRoughness += geometryRoughness;')
  })

  it('emits the same constants the TS mirror uses', () => {
    // The guard against the shader and `filteredRoughness` drifting apart.
    enableSpecularAA()
    const patched = THREE.ShaderChunk.lights_physical_fragment
    expect(patched).toContain(`${SCREEN_SPACE_VARIANCE.toFixed(4)} * ( dot( omega_dndx, omega_dndx )`)
    expect(patched).toContain(`min( 2.0 * omega_variance, ${VARIANCE_THRESHOLD.toFixed(4)} )`)
  })

  it('is idempotent — a second call does not patch the patch', () => {
    enableSpecularAA()
    const once = THREE.ShaderChunk.lights_physical_fragment
    expect(enableSpecularAA()).toBe(true)
    expect(THREE.ShaderChunk.lights_physical_fragment).toBe(once)
    // Two filter sites, one block each — never four from a double apply.
    expect(once.split('float omega_variance').length - 1).toBe(2)
  })

  it('leaves the rest of the material set-up intact', () => {
    enableSpecularAA()
    const patched = THREE.ShaderChunk.lights_physical_fragment
    expect(patched).toContain('PhysicalMaterial material;')
    expect(patched).toContain('material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );')
    expect(patched).toContain('#ifdef USE_ANISOTROPY')
    expect(patched).toContain('material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );')
  })

  it('keeps braces balanced', () => {
    enableSpecularAA()
    let depth = 0
    for (const ch of THREE.ShaderChunk.lights_physical_fragment) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      expect(depth).toBeGreaterThanOrEqual(0)
    }
    expect(depth).toBe(0)
  })

  it('reaches every PBR material in the scene through one chunk', () => {
    // Load-bearing assumption behind patching a single chunk: three compiles
    // MeshStandardMaterial and MeshPhysicalMaterial from the *same* fragment
    // shader, so both pick up the filter. If a three release ever splits them,
    // half the scene (walls, rugs, steel — everything on Standard) would go
    // back to sparkling, silently. This is the tripwire for that.
    expect(THREE.ShaderLib.standard.fragmentShader).toBe(THREE.ShaderLib.physical.fragmentShader)
    expect(THREE.ShaderLib.standard.fragmentShader).toContain('#include <lights_physical_fragment>')
  })

  it('declines to patch a chunk it does not recognise', () => {
    THREE.ShaderChunk.lights_physical_fragment = 'PhysicalMaterial material;\nmaterial.roughness = roughnessFactor;'
    expect(enableSpecularAA()).toBe(false)
    expect(THREE.ShaderChunk.lights_physical_fragment).not.toContain('omega_variance')
  })

  it('declines when the anchor is ambiguous', () => {
    // Two occurrences mean this is not the chunk the patch was written against;
    // filtering both blindly is how a shader ends up silently wrong.
    THREE.ShaderChunk.lights_physical_fragment =
      'material.roughness += geometryRoughness;\nmaterial.roughness += geometryRoughness;'
    expect(enableSpecularAA()).toBe(false)
  })

  it('still applies the base filter when only the clearcoat anchor is gone', () => {
    THREE.ShaderChunk.lights_physical_fragment =
      'PhysicalMaterial material;\nmaterial.roughness += geometryRoughness;\nmaterial.roughness = min( material.roughness, 1.0 );'
    expect(enableSpecularAA()).toBe(true)
    const patched = THREE.ShaderChunk.lights_physical_fragment
    expect(patched).toContain('material.roughness = sqrt( saturate(')
    expect(patched).not.toContain('clearcoatNormal')
  })
})
