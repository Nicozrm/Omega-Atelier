import { describe, it, expect } from 'vitest'
import {
  SEASONS, SEASON_LABEL, seasonFromDate, seasonPalette, snowed, mixHex,
  type Season,
} from './season'

const luma = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

describe('seasonFromDate', () => {
  it('uses meteorological seasons — whole months', () => {
    expect(seasonFromDate(12)).toBe('winter')
    expect(seasonFromDate(1)).toBe('winter')
    expect(seasonFromDate(2)).toBe('winter')
    expect(seasonFromDate(3)).toBe('spring')
    expect(seasonFromDate(5)).toBe('spring')
    expect(seasonFromDate(6)).toBe('summer')
    expect(seasonFromDate(8)).toBe('summer')
    expect(seasonFromDate(9)).toBe('autumn')
    expect(seasonFromDate(11)).toBe('autumn')
  })

  it('wraps out-of-range months instead of failing', () => {
    expect(seasonFromDate(13)).toBe(seasonFromDate(1))
    expect(seasonFromDate(0)).toBe(seasonFromDate(12))
    expect(seasonFromDate(-11)).toBe(seasonFromDate(1))
  })

  it('falls back to summer for a non-finite month', () => {
    expect(seasonFromDate(Number.NaN)).toBe('summer')
    expect(seasonFromDate(Number.POSITIVE_INFINITY)).toBe('summer')
  })

  it('covers all twelve months and yields only known seasons', () => {
    for (let m = 1; m <= 12; m++) expect(SEASONS).toContain(seasonFromDate(m))
  })
})

describe('seasonPalette', () => {
  it('gives every season a full palette with four foliage slots', () => {
    for (const s of SEASONS) {
      const p = seasonPalette(s)
      expect(p.foliage).toHaveLength(4)
      for (const c of [...p.foliage, p.hedge, p.lawn]) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(p.snow).toBeGreaterThanOrEqual(0)
      expect(p.snow).toBeLessThanOrEqual(1)
      expect(p.blossom).toBeGreaterThanOrEqual(0)
      expect(p.blossom).toBeLessThanOrEqual(1)
    }
  })

  it('puts the snow in winter and the blossom in spring', () => {
    expect(seasonPalette('winter').snow).toBeGreaterThan(seasonPalette('autumn').snow)
    expect(seasonPalette('summer').snow).toBe(0)
    expect(seasonPalette('spring').blossom).toBeGreaterThan(seasonPalette('summer').blossom)
  })

  it('keeps the clipped hedge greener than the autumn canopy', () => {
    const autumn = seasonPalette('autumn')
    const hedgeGreen = Number.parseInt(autumn.hedge.slice(3, 5), 16)
    const canopyGreen = Number.parseInt(autumn.foliage[0].slice(3, 5), 16)
    expect(hedgeGreen).toBeGreaterThan(canopyGreen * 0.8)
  })

  it('falls back to summer for an unknown season', () => {
    expect(seasonPalette('mud' as Season)).toEqual(seasonPalette('summer'))
  })
})

describe('mixHex', () => {
  it('returns the endpoints exactly', () => {
    expect(mixHex('#102030', '#a0b0c0', 0)).toBe('#102030')
    expect(mixHex('#102030', '#a0b0c0', 1)).toBe('#a0b0c0')
  })

  it('clamps t outside 0…1', () => {
    expect(mixHex('#000000', '#ffffff', -3)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 4)).toBe('#ffffff')
  })

  it('expands three-digit hex', () => {
    expect(mixHex('#fff', '#fff', 0.5)).toBe('#ffffff')
  })

  it('degrades to black on malformed input rather than emitting NaN', () => {
    expect(mixHex('nonsense', '#ffffff', 0)).toBe('#000000')
  })

  it('is monotonic along the ramp', () => {
    let last = -1
    for (let i = 0; i <= 10; i++) {
      const l = luma(mixHex('#000000', '#ffffff', i / 10))
      expect(l).toBeGreaterThanOrEqual(last)
      last = l
    }
  })
})

describe('snowed', () => {
  it('is a no-op with no snow', () => {
    expect(snowed('#3a5f2b', 0)).toBe('#3a5f2b')
  })

  it('lightens toward white as snow grows', () => {
    const base = '#3a5f2b'
    expect(luma(snowed(base, 0.5))).toBeGreaterThan(luma(base))
    expect(luma(snowed(base, 1))).toBeGreaterThan(luma(snowed(base, 0.5)))
  })

  it('scales by exposure, so a vertical face stays clear', () => {
    const base = '#3a5f2b'
    expect(snowed(base, 1, 0)).toBe(base)
    expect(luma(snowed(base, 1, 0.3))).toBeLessThan(luma(snowed(base, 1, 1)))
  })

  it('clamps out-of-range snow and exposure', () => {
    expect(snowed('#3a5f2b', -1)).toBe('#3a5f2b')
    expect(snowed('#3a5f2b', 5)).toBe(snowed('#3a5f2b', 1))
  })
})

describe('SEASON_LABEL', () => {
  it('labels every season', () => {
    for (const s of SEASONS) expect(SEASON_LABEL[s].length).toBeGreaterThan(0)
  })
})
