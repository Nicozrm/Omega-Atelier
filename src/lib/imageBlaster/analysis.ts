/**
 * Image Blaster 3D — stage 1: image analysis.
 *
 * Pure functions over a {@link PixelGrid}. Extracts the statistics the
 * pipeline needs to pick sensible defaults (mesh mode, segmentation source)
 * and to show the user what the blaster "sees".
 */

import type { ImageAnalysis, MeshMode, PixelGrid, SegmentSource } from './types'

/** Rec. 709 luma in [0,1] from 8-bit RGB. */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** HSL-style saturation in [0,1] from 8-bit RGB. */
export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  if (max === min) return 0
  const l = (max + min) / 2
  const d = max - min
  return l > 0.5 ? d / (2 - max - min) : d / (max + min)
}

/** Luminance of every pixel as a {@link Float32Array} field. */
export function luminanceField(img: PixelGrid): Float32Array {
  const { data, width, height } = img
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) {
    out[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
  }
  return out
}

/** Fraction of pixels whose Sobel gradient magnitude exceeds `threshold`. */
export function edgeDensity(lum: Float32Array, width: number, height: number, threshold = 0.24): number {
  if (width < 3 || height < 3) return 0
  let edges = 0
  let total = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx =
        -lum[i - width - 1] + lum[i - width + 1]
        - 2 * lum[i - 1] + 2 * lum[i + 1]
        - lum[i + width - 1] + lum[i + width + 1]
      const gy =
        -lum[i - width - 1] - 2 * lum[i - width] - lum[i - width + 1]
        + lum[i + width - 1] + 2 * lum[i + width] + lum[i + width + 1]
      if (Math.hypot(gx, gy) > threshold) edges++
      total++
    }
  }
  return total === 0 ? 0 : edges / total
}

/** Quantised dominant colors (4 bits/channel), most frequent first. */
export function dominantColors(img: PixelGrid, count = 5): string[] {
  const { data } = img
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  const pixels = img.width * img.height
  const stride = Math.max(1, Math.floor(pixels / 20000)) // sample ≤ ~20k pixels
  for (let i = 0; i < pixels; i += stride) {
    const o = i * 4
    if (data[o + 3] < 32) continue
    const key = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4)
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    b.n++; b.r += data[o]; b.g += data[o + 1]; b.b += data[o + 2]
    buckets.set(key, b)
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((b) => {
      const hex = (v: number) => Math.round(v / b.n).toString(16).padStart(2, '0')
      return `#${hex(b.r)}${hex(b.g)}${hex(b.b)}`
    })
}

/** Full stage-1 analysis of an image. */
export function analyseImage(img: PixelGrid): ImageAnalysis {
  const { data, width, height } = img
  const pixels = width * height
  const lum = luminanceField(img)

  let lumSum = 0
  let satSum = 0
  let transparent = 0
  for (let i = 0; i < pixels; i++) {
    lumSum += lum[i]
    satSum += saturation(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    if (data[i * 4 + 3] < 250) transparent++
  }
  const luminanceMean = pixels ? lumSum / pixels : 0
  let varSum = 0
  for (let i = 0; i < pixels; i++) {
    const d = lum[i] - luminanceMean
    varSum += d * d
  }

  const transparentRatio = pixels ? transparent / pixels : 0
  const density = edgeDensity(lum, width, height)

  // A real alpha cutout (logo, product shot, sticker) extrudes beautifully;
  // everything else defaults to a relief plaque which never fails.
  const suggestedSegment: SegmentSource = transparentRatio > 0.02 ? 'alpha' : 'luminance'
  const suggestedMode: MeshMode = transparentRatio > 0.02 ? 'extrude' : 'relief'

  return {
    width,
    height,
    luminanceMean,
    contrast: pixels ? Math.sqrt(varSum / pixels) : 0,
    saturationMean: pixels ? satSum / pixels : 0,
    transparentRatio,
    edgeDensity: density,
    dominantColors: dominantColors(img),
    suggestedMode,
    suggestedSegment,
  }
}
