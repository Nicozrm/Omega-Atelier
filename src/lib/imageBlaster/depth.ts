/**
 * Image Blaster 3D — stages 2+3: segmentation & monocular depth estimation.
 *
 * Fully client-side, no ML weights: depth is estimated from a weighted blend
 * of photometric cues (bright→near, saturated→near, bottom-of-frame→near)
 * and then refined with an edge-aware smoothing pass so depth discontinuities
 * stay crisp at object boundaries while flat regions become smooth relief.
 */

import { luminance, saturation } from './analysis'
import type { DepthSettings, PixelGrid, ScalarField, SegmentSource } from './types'

/** Clamp helper local to the pipeline (keeps the module dependency-free). */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Stage 2 — segmentation mask in [0,1] (1 = subject).
 * `alpha` uses the image's own transparency; `luminance`/`chroma` threshold
 * against brightness or colorfulness for photos without an alpha channel.
 */
export function segmentMask(img: PixelGrid, source: SegmentSource, threshold: number): ScalarField {
  const { data, width, height } = img
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) {
    const o = i * 4
    let v: number
    if (source === 'alpha') {
      v = data[o + 3] / 255
    } else if (source === 'chroma') {
      v = saturation(data[o], data[o + 1], data[o + 2])
    } else {
      v = luminance(data[o], data[o + 1], data[o + 2])
    }
    // Soft edge around the threshold keeps extrusion outlines anti-aliased.
    out[i] = clamp01((v - threshold) / 0.08 + 0.5)
  }
  return { data: out, width, height }
}

/**
 * Stage 3 — heuristic depth map in [0,1] (1 = near).
 */
export function estimateDepth(img: PixelGrid, settings: DepthSettings): ScalarField {
  const { data, width, height } = img
  const n = width * height
  const depth = new Float32Array(n)

  const wSum = settings.luminanceWeight + settings.saturationWeight + settings.verticalWeight || 1
  const wl = settings.luminanceWeight / wSum
  const ws = settings.saturationWeight / wSum
  const wv = settings.verticalWeight / wSum

  for (let y = 0; y < height; y++) {
    const vert = height > 1 ? y / (height - 1) : 0 // bottom of frame = near
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const o = i * 4
      const lum = luminance(data[o], data[o + 1], data[o + 2])
      const sat = saturation(data[o], data[o + 1], data[o + 2])
      depth[i] = wl * lum + ws * sat + wv * vert
    }
  }

  const field: ScalarField = { data: depth, width, height }
  edgeAwareSmooth(field, img, Math.round(settings.smoothing))
  normalize(field)

  if (settings.gamma !== 1) {
    const g = settings.gamma
    for (let i = 0; i < n; i++) depth[i] = Math.pow(depth[i], g)
  }
  if (settings.invert) {
    for (let i = 0; i < n; i++) depth[i] = 1 - depth[i]
  }
  return field
}

/** Stretch a field to exactly [0,1]; constant fields settle at 0.5. */
export function normalize(field: ScalarField): void {
  const d = field.data
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < d.length; i++) {
    if (d[i] < min) min = d[i]
    if (d[i] > max) max = d[i]
  }
  const range = max - min
  if (range < 1e-6) {
    d.fill(0.5)
    return
  }
  for (let i = 0; i < d.length; i++) d[i] = (d[i] - min) / range
}

/**
 * Iterative edge-aware smoothing (a cheap bilateral approximation):
 * each pass averages the 4-neighbourhood weighted by color similarity,
 * so depth blurs inside regions but not across strong color edges.
 */
export function edgeAwareSmooth(field: ScalarField, img: PixelGrid, iterations: number): void {
  if (iterations <= 0) return
  const { width, height } = field
  const src = field.data
  const tmp = new Float32Array(src.length)
  const lum = new Float32Array(src.length)
  for (let i = 0; i < lum.length; i++) {
    lum[i] = luminance(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
  }

  const edgeStop = 12 // higher = smoothing stops harder at edges
  let a: Float32Array = src
  let b: Float32Array = tmp
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        let acc = a[i]
        let wsum = 1
        const l0 = lum[i]
        // 4-neighbourhood, weights fall off with luminance difference
        if (x > 0) { const j = i - 1; const w = Math.exp(-Math.abs(lum[j] - l0) * edgeStop); acc += a[j] * w; wsum += w }
        if (x < width - 1) { const j = i + 1; const w = Math.exp(-Math.abs(lum[j] - l0) * edgeStop); acc += a[j] * w; wsum += w }
        if (y > 0) { const j = i - width; const w = Math.exp(-Math.abs(lum[j] - l0) * edgeStop); acc += a[j] * w; wsum += w }
        if (y < height - 1) { const j = i + width; const w = Math.exp(-Math.abs(lum[j] - l0) * edgeStop); acc += a[j] * w; wsum += w }
        b[i] = acc / wsum
      }
    }
    const swap = a; a = b; b = swap
  }
  if (a !== field.data) field.data.set(a)
}

/**
 * Bilinear sample of a scalar field at normalized coordinates (u,v in [0,1]).
 */
export function sampleField(field: ScalarField, u: number, v: number): number {
  const { data, width, height } = field
  const fx = clamp01(u) * (width - 1)
  const fy = clamp01(v) * (height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, width - 1)
  const y1 = Math.min(y0 + 1, height - 1)
  const tx = fx - x0
  const ty = fy - y0
  const a = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx
  const b = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx
  return a * (1 - ty) + b * ty
}

/**
 * Downsample a PixelGrid with box filtering so the longer edge is ≤ `maxEdge`.
 * Returns the input unchanged when it already fits.
 */
export function downsample(img: PixelGrid, maxEdge: number): PixelGrid {
  const { width, height } = img
  const longer = Math.max(width, height)
  if (longer <= maxEdge) return img
  const scale = maxEdge / longer
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y / h) * height)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * height))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x / w) * width)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * width))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * width + sx) * 4
          r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; a += img.data[o + 3]
          n++
        }
      }
      const o = (y * w + x) * 4
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n
    }
  }
  return { data: out, width: w, height: h }
}
