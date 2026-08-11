/**
 * render/grade.ts — the **colour grade**, generated rather than shipped.
 *
 * Photographic renders are graded; ungraded ones look like renders. The usual
 * way to get there is to ship a `.cube` LUT exported from a colour-grading
 * application, but that is an opaque 400 KB binary nobody can review, tweak or
 * diff. So the grade is *authored as code* here — an ASC-CDL trim, a filmic
 * contrast pivot, split toning and a highlight-saturation rolloff — and baked
 * into a 3D lookup table at startup. The maths is legible, the parameters are
 * named, and the whole thing costs one 32³ table and a single texture fetch per
 * pixel at render time.
 *
 * The grade runs on **display-referred** values (after tone mapping), which is
 * why every operator here works in 0…1.
 *
 * Pure functions and typed arrays only — no THREE, no DOM. `filmLutData` is
 * unit-tested; the thin `Data3DTexture` wrapper lives with the renderer.
 */

export interface GradeOptions {
  /** ASC-CDL slope (gain) per channel. */
  slope: [number, number, number]
  /** ASC-CDL offset (lift) per channel. */
  offset: [number, number, number]
  /** ASC-CDL power (gamma) per channel. */
  power: [number, number, number]
  /** Contrast strength around the pivot. 0 = untouched. */
  contrast: number
  /** Where the S-curve pivots. 0.435 ≈ 18 % grey in a display transfer. */
  pivot: number
  /** Tint pushed into the shadows (linear RGB delta, applied by shadow mask). */
  shadowTint: [number, number, number]
  /** Tint pushed into the highlights. */
  highlightTint: [number, number, number]
  /** Global saturation multiplier. */
  saturation: number
  /** How much saturation is removed as a pixel approaches white, 0…1. */
  highlightDesat: number
}

/**
 * The house look: a cool-shadow / warm-highlight split with a gentle filmic
 * contrast. It is deliberately *subtle* — the grade should make the frame feel
 * photographed, not Instagrammed. Interiors here are warm-lit against dark
 * surroundings, so the shadows get a touch of blue to hold the separation and
 * the highlights get a touch of amber to keep the tungsten cue.
 */
export const OMEGA_FILM_GRADE: GradeOptions = {
  slope: [1.015, 1.0, 0.984],
  offset: [-0.004, -0.002, 0.004],
  power: [0.99, 1.0, 1.015],
  contrast: 0.14,
  pivot: 0.435,
  shadowTint: [-0.012, -0.002, 0.022],
  highlightTint: [0.018, 0.007, -0.014],
  saturation: 1.06,
  highlightDesat: 0.42,
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)
const LUMA: [number, number, number] = [0.2126, 0.7152, 0.0722]

/**
 * Grade a single display-referred RGB triple. Exported so the transform can be
 * reasoned about (and tested) one colour at a time, independently of the table
 * it eventually gets baked into.
 */
export function gradeColor(
  r: number, g: number, b: number,
  o: GradeOptions = OMEGA_FILM_GRADE,
): [number, number, number] {
  let c: [number, number, number] = [clamp01(r), clamp01(g), clamp01(b)]

  // 1. ASC CDL — the industry's primary trim: out = (in · slope + offset)^power
  c = [
    Math.pow(Math.max(0, c[0] * o.slope[0] + o.offset[0]), o.power[0]),
    Math.pow(Math.max(0, c[1] * o.slope[1] + o.offset[1]), o.power[1]),
    Math.pow(Math.max(0, c[2] * o.slope[2] + o.offset[2]), o.power[2]),
  ]

  // 2. Contrast around a pivot, on a cubic S that is an *exact* identity at
  //    contrast 0 and pins both endpoints. A plain multiply would clip white
  //    and crush black; this steepens the midtones and eases off toward the
  //    ends, which is what a film response curve does.
  //      t' = t · (1 + a·(1 − t²))   with t = (v − pivot) / span ∈ [−1, 1]
  //    Slope at the pivot is 1 + a; at the ends 1 − 2a, so it stays monotonic
  //    for any a < 0.5 and never overshoots.
  const s = (v: number) => {
    const span = v >= o.pivot ? 1 - o.pivot : o.pivot
    const t = (v - o.pivot) / span
    return o.pivot + t * (1 + o.contrast * (1 - t * t)) * span
  }
  c = [s(c[0]), s(c[1]), s(c[2])]

  // 3. Split toning. The masks are complementary and smooth, so mid-greys stay
  //    neutral — the tint only shows where the eye reads "shadow" or "glow".
  const l = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
  const shadowMask = Math.pow(1 - clamp01(l), 2.2)
  const highMask = Math.pow(clamp01(l), 2.6)
  c = [
    c[0] + o.shadowTint[0] * shadowMask + o.highlightTint[0] * highMask,
    c[1] + o.shadowTint[1] * shadowMask + o.highlightTint[1] * highMask,
    c[2] + o.shadowTint[2] * shadowMask + o.highlightTint[2] * highMask,
  ]

  // 4. Saturation, with film's highlight rolloff: real emulsion loses colour as
  //    it approaches white, and skipping this is what makes bright CG glow
  //    look like coloured plastic.
  const l2 = LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2]
  const sat = o.saturation * (1 - o.highlightDesat * Math.pow(clamp01(l2), 3.4))
  c = [
    l2 + (c[0] - l2) * sat,
    l2 + (c[1] - l2) * sat,
    l2 + (c[2] - l2) * sat,
  ]

  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])]
}

/**
 * Bake the grade into a `size³` RGBA lookup table, laid out for a 3D texture
 * (x = red, y = green, z = blue, row-major over x then y then z).
 *
 * 32³ is the film-industry default and is indistinguishable from 64³ for a
 * smooth grade like this one, at an eighth of the memory.
 */
export function filmLutData(size = 32, o: GradeOptions = OMEGA_FILM_GRADE) {
  const data = new Float32Array(size * size * size * 4)
  const n = size - 1
  let i = 0
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = gradeColor(x / n, y / n, z / n, o)
        data[i++] = r
        data[i++] = g
        data[i++] = b
        data[i++] = 1
      }
    }
  }
  return data
}

/** A neutral (identity) table of the same shape — useful as a grade-off state. */
export function neutralLutData(size = 32) {
  const data = new Float32Array(size * size * size * 4)
  const n = size - 1
  let i = 0
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        data[i++] = x / n
        data[i++] = y / n
        data[i++] = z / n
        data[i++] = 1
      }
    }
  }
  return data
}
