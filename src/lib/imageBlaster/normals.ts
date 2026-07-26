/**
 * Image Blaster 3D — stage 5 helper: PBR map synthesis.
 *
 * Generates a tangent-space normal map from the estimated depth field and an
 * optional roughness map from inverted luminance (glossy highlights read as
 * smoother surface). Both return raw RGBA PixelGrids ready for a canvas /
 * three.js DataTexture.
 */

import { luminance } from './analysis'
import type { PixelGrid, ScalarField } from './types'

/**
 * Sobel-based tangent-space normal map. `strength` scales the gradient
 * (0 = flat blue map, ~1 = natural, >1 exaggerated micro-relief).
 */
export function normalMapFromDepth(depth: ScalarField, strength: number): PixelGrid {
  const { data, width, height } = depth
  const out = new Uint8ClampedArray(width * height * 4)
  const s = strength * Math.max(width, height) * 0.02

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const xl = data[y * width + Math.max(0, x - 1)]
      const xr = data[y * width + Math.min(width - 1, x + 1)]
      const yu = data[Math.max(0, y - 1) * width + x]
      const yd = data[Math.min(height - 1, y + 1) * width + x]
      // Central differences; y flipped for OpenGL-style green channel.
      let nx = (xl - xr) * s
      let ny = (yd - yu) * s
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len; ny /= len; nz /= len
      const o = i * 4
      out[o] = (nx * 0.5 + 0.5) * 255
      out[o + 1] = (ny * 0.5 + 0.5) * 255
      out[o + 2] = (nz * 0.5 + 0.5) * 255
      out[o + 3] = 255
    }
  }
  return { data: out, width, height }
}

/**
 * Roughness map from inverted luminance: bright image regions (speculars,
 * sky, metal) become smoother, dark regions rougher. `base` sets the level
 * around which the image modulates; output stays inside [0.08, 0.98].
 */
export function roughnessMapFromImage(img: PixelGrid, base: number): PixelGrid {
  const { data, width, height } = img
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const lum = luminance(data[o], data[o + 1], data[o + 2])
    const rough = Math.min(0.98, Math.max(0.08, base + (0.5 - lum) * 0.55))
    const v = rough * 255
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
  }
  return { data: out, width, height }
}

/** Grayscale visualisation of a scalar field (for the UI map thumbnails). */
export function fieldToPixels(field: ScalarField): PixelGrid {
  const { data, width, height } = field
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(0, Math.min(1, data[i])) * 255
    const o = i * 4
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255
  }
  return { data: out, width, height }
}
