import { describe, it, expect } from 'vitest'
import { gradeColor, filmLutData, neutralLutData, OMEGA_FILM_GRADE } from './grade'

const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('gradeColor', () => {
  it('keeps black black and white white — the grade must not clip the ends', () => {
    const black = gradeColor(0, 0, 0)
    const white = gradeColor(1, 1, 1)
    expect(luma(black)).toBeLessThan(0.03)
    expect(luma(white)).toBeGreaterThan(0.95)
  })

  it('stays inside 0…1 for every input, including out-of-range ones', () => {
    for (const v of [-1, 0, 0.2, 0.5, 0.8, 1, 2]) {
      for (const c of gradeColor(v, v * 0.5, 1 - v)) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
        expect(Number.isNaN(c)).toBe(false)
      }
    }
  })

  it('is monotonic on the grey ramp — no banding or inversion', () => {
    let prev = -1
    for (let i = 0; i <= 64; i++) {
      const v = i / 64
      const l = luma(gradeColor(v, v, v))
      expect(l).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = l
    }
  })

  it('adds contrast: darks go darker, brights go brighter', () => {
    expect(luma(gradeColor(0.2, 0.2, 0.2))).toBeLessThan(0.2)
    expect(luma(gradeColor(0.75, 0.75, 0.75))).toBeGreaterThan(0.75)
  })

  it('keeps mid grey close to neutral (the pivot barely moves)', () => {
    const mid = gradeColor(0.435, 0.435, 0.435)
    expect(luma(mid)).toBeGreaterThan(0.39)
    expect(luma(mid)).toBeLessThan(0.48)
  })

  it('splits the toning: cool shadows, warm highlights', () => {
    const shadow = gradeColor(0.08, 0.08, 0.08)
    const highlight = gradeColor(0.9, 0.9, 0.9)
    expect(shadow[2]).toBeGreaterThan(shadow[0])   // blue lifted in the dark
    expect(highlight[0]).toBeGreaterThan(highlight[2]) // amber up top
  })

  it('desaturates as it approaches white (film highlight rolloff)', () => {
    const sat = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(1e-6, Math.max(...c))
    const mid = gradeColor(0.5, 0.32, 0.2)
    const hot = gradeColor(1.0, 0.82, 0.7)
    expect(sat(hot)).toBeLessThan(sat(mid))
  })

  it('an identity-ish option set leaves colours essentially untouched', () => {
    const identity = {
      ...OMEGA_FILM_GRADE,
      slope: [1, 1, 1] as [number, number, number],
      offset: [0, 0, 0] as [number, number, number],
      power: [1, 1, 1] as [number, number, number],
      contrast: 0,
      shadowTint: [0, 0, 0] as [number, number, number],
      highlightTint: [0, 0, 0] as [number, number, number],
      saturation: 1,
      highlightDesat: 0,
    }
    for (const v of [0.1, 0.435, 0.9]) {
      const out = gradeColor(v, v, v, identity)
      expect(out[0]).toBeCloseTo(v, 5)
    }
  })
})

describe('filmLutData', () => {
  it('produces a size³ RGBA table', () => {
    expect(filmLutData(8)).toHaveLength(8 * 8 * 8 * 4)
    expect(filmLutData(32)).toHaveLength(32 * 32 * 32 * 4)
  })

  it('is laid out x = red, y = green, z = blue', () => {
    const size = 8
    const lut = filmLutData(size)
    const at = (x: number, y: number, z: number) => {
      const i = ((z * size + y) * size + x) * 4
      return [lut[i], lut[i + 1], lut[i + 2]]
    }
    // Walking +x must raise red far more than blue, and vice-versa.
    const dx = at(size - 1, 0, 0)[0] - at(0, 0, 0)[0]
    const dz = at(0, 0, size - 1)[2] - at(0, 0, 0)[2]
    expect(dx).toBeGreaterThan(0.8)
    expect(dz).toBeGreaterThan(0.8)
    expect(at(size - 1, 0, 0)[0]).toBeGreaterThan(at(size - 1, 0, 0)[2])
  })

  it('fills alpha with 1 and stays in range', () => {
    const lut = filmLutData(8)
    for (let i = 0; i < lut.length; i += 4) {
      expect(lut[i + 3]).toBe(1)
      for (let c = 0; c < 3; c++) {
        expect(lut[i + c]).toBeGreaterThanOrEqual(0)
        expect(lut[i + c]).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('neutralLutData', () => {
  it('is a true identity table', () => {
    const size = 8
    const lut = neutralLutData(size)
    const n = size - 1
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = ((z * size + y) * size + x) * 4
          expect(lut[i]).toBeCloseTo(x / n, 6)
          expect(lut[i + 1]).toBeCloseTo(y / n, 6)
          expect(lut[i + 2]).toBeCloseTo(z / n, 6)
        }
      }
    }
  })
})
