import { describe, it, expect } from 'vitest'
import { sobelStrengthFor, effectiveTextureScale } from './textures'
import { RENDER_PROFILES, RENDER_PROFILE_ORDER } from './render/quality'

/** The two sizes the generators author at. */
const AUTHORED = [256, 512] as const

describe('effectiveTextureScale', () => {
  it('applies the multiplier below the cap', () => {
    expect(effectiveTextureScale(256, 2, 1024)).toBe(2)
    expect(effectiveTextureScale(512, 2, 1024)).toBe(2)
  })

  it('lets the cap hold back only the maps that hit it', () => {
    // The point of the cap: the soft 256² half doubles, the already-sharp 512²
    // floors stay put, so the VRAM goes where it buys something.
    expect(effectiveTextureScale(256, 2, 512)).toBe(2)
    expect(effectiveTextureScale(512, 2, 512)).toBe(1)
  })

  it('is a no-op at scale 1', () => {
    for (const size of AUTHORED) {
      expect(effectiveTextureScale(size, 1, 512)).toBe(1)
      expect(effectiveTextureScale(size, 1, 1024)).toBe(1)
    }
  })

  it('never shrinks a map below what was authored', () => {
    // A cap under the authored size would blur the material — the opposite of
    // what this knob exists for.
    expect(effectiveTextureScale(512, 1, 256)).toBe(1)
    expect(effectiveTextureScale(512, 2, 128)).toBe(1)
    expect(effectiveTextureScale(256, 0, 512)).toBe(1)
  })

  it('keeps every resulting size a power of two, for clean mipmaps', () => {
    const isPot = (n: number) => n > 0 && (n & (n - 1)) === 0
    for (const id of RENDER_PROFILE_ORDER) {
      const { textureScale, textureMaxSize } = RENDER_PROFILES[id]
      for (const size of AUTHORED) {
        const px = size * effectiveTextureScale(size, textureScale, textureMaxSize)
        expect(isPot(px), `${id} @ ${size} → ${px}`).toBe(true)
      }
    }
  })
})

describe('sobelStrengthFor', () => {
  it('leaves the authored strength alone at 1×', () => {
    expect(sobelStrengthFor(0.6, 1)).toBeCloseTo(0.6, 12)
  })

  it('cancels the flattening that comes with more pixels', () => {
    // A normal map measures slope *per pixel*. At 2× the same physical ramp is
    // spread over twice as many pixels, so each Sobel step is half as steep and
    // the relief comes out flat — the grain would soften exactly when it was
    // supposed to sharpen. The compensation is the inverse of that.
    expect(sobelStrengthFor(0.6, 2)).toBeCloseTo(1.2, 12)
    expect(sobelStrengthFor(0.5, 2)).toBeCloseTo(1.0, 12)
  })

  it('is linear in the scale, so relief reads the same at every resolution', () => {
    const base = 0.4
    for (const scale of [1, 2, 4]) {
      expect(sobelStrengthFor(base, scale) / scale).toBeCloseTo(base, 12)
    }
  })

  it('never weakens the relief on a nonsense scale', () => {
    expect(sobelStrengthFor(0.6, 0)).toBeCloseTo(0.6, 12)
    expect(sobelStrengthFor(0.6, 0.5)).toBeCloseTo(0.6, 12)
  })
})

describe('texture budgets across the profiles', () => {
  it('spends the extra resolution only where the GPU can hold it', () => {
    expect(RENDER_PROFILES.performance.textureScale).toBe(1)
    expect(RENDER_PROFILES.balanced.textureScale).toBe(1)
    expect(RENDER_PROFILES.high.textureScale).toBe(2)
    expect(RENDER_PROFILES.ultra.textureScale).toBe(2)
  })

  it('separates high from ultra by the cap, not the multiplier', () => {
    expect(RENDER_PROFILES.high.textureMaxSize).toBe(512)
    expect(RENDER_PROFILES.ultra.textureMaxSize).toBe(1024)
  })

  it('never lets a cheaper profile generate more pixels than a dearer one', () => {
    // VRAM is quadratic in this, so an inversion would put a desktop budget on
    // a phone. Compared as total pixels over the two authored sizes.
    const pixels = (id: (typeof RENDER_PROFILE_ORDER)[number]) => {
      const { textureScale, textureMaxSize } = RENDER_PROFILES[id]
      return AUTHORED.reduce((sum, size) => {
        const px = size * effectiveTextureScale(size, textureScale, textureMaxSize)
        return sum + px * px
      }, 0)
    }
    for (let i = 1; i < RENDER_PROFILE_ORDER.length; i++) {
      expect(pixels(RENDER_PROFILE_ORDER[i])).toBeGreaterThanOrEqual(pixels(RENDER_PROFILE_ORDER[i - 1]))
    }
  })

  it('leaves the two cheap profiles exactly where they were', () => {
    // This change must cost the machines that cannot afford it precisely
    // nothing — same pixels, same VRAM, same generation time as before.
    for (const id of ['performance', 'balanced'] as const) {
      for (const size of AUTHORED) {
        const { textureScale, textureMaxSize } = RENDER_PROFILES[id]
        expect(effectiveTextureScale(size, textureScale, textureMaxSize)).toBe(1)
      }
    }
  })
})
