import { describe, it, expect } from 'vitest'
import { climateColor, lightIntensity, glowOpacity } from './reflection'

describe('climateColor', () => {
  it('is undefined without a reading', () => {
    expect(climateColor(undefined)).toBeUndefined()
  })
  it('hits the cool / neutral / hot anchors', () => {
    expect(climateColor(16)).toBe('#6aa8ff')
    expect(climateColor(21)).toBe('#ffd9a0')
    expect(climateColor(27)).toBe('#ff6a4a')
  })
  it('interpolates between anchors and stays a valid hex', () => {
    const mid = climateColor(18)
    expect(mid).toMatch(/^#[0-9a-f]{6}$/)
    expect(mid).not.toBe('#6aa8ff')
    expect(mid).not.toBe('#ffd9a0')
  })
  it('clamps extremes to the anchors', () => {
    expect(climateColor(5)).toBe('#6aa8ff')
    expect(climateColor(40)).toBe('#ff6a4a')
  })
})

describe('lightIntensity', () => {
  it('is zero when no light is on', () => {
    expect(lightIntensity(80, 0)).toBe(0)
  })
  it('scales with brightness when lights are on', () => {
    expect(lightIntensity(0, 1)).toBeCloseTo(0.4)
    expect(lightIntensity(100, 2)).toBeCloseTo(2.6)
    expect(lightIntensity(undefined, 1)).toBeCloseTo(0.4 + 0.6 * 2.2)
  })
})

describe('glowOpacity', () => {
  it('scales with brightness and caps', () => {
    expect(glowOpacity(0)).toBeCloseTo(0.12)
    expect(glowOpacity(80)).toBeCloseTo(0.36)
    expect(glowOpacity(undefined)).toBeCloseTo(0.30)
    expect(glowOpacity(1000)).toBe(0.5)
  })
})
