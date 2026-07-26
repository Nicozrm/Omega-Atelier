import { describe, it, expect } from 'vitest'
import { modeForHour, daylightWash, formatClock, phaseLabel } from './dayCycle'

describe('modeForHour', () => {
  it('maps the day into the expected modes', () => {
    expect(modeForHour(3)).toBe('night')
    expect(modeForHour(7)).toBe('morning')
    expect(modeForHour(12)).toBe('day-office')
    expect(modeForHour(19)).toBe('relax')
    expect(modeForHour(22)).toBe('film')
    expect(modeForHour(23.5)).toBe('night')
  })
  it('wraps out-of-range hours', () => {
    expect(modeForHour(26)).toBe('night') // 26 → 2:00
    expect(modeForHour(-2)).toBe('film')  // -2 → 22:00
  })
})

describe('daylightWash', () => {
  it('is dark at deep night and bright at midday', () => {
    expect(daylightWash(2).night).toBeGreaterThan(0.9)
    expect(daylightWash(2).day).toBeLessThan(0.05)
    expect(daylightWash(13).day).toBeGreaterThan(0.9)
    expect(daylightWash(13).night).toBeLessThan(0.05)
  })
  it('warms at dusk', () => {
    expect(daylightWash(18.6).dusk).toBeGreaterThan(0.8)
    expect(daylightWash(13).dusk).toBeLessThan(0.2)
  })
  it('keeps every channel within 0..1', () => {
    for (let h = 0; h <= 24; h += 0.5) {
      const w = daylightWash(h)
      for (const v of [w.night, w.day, w.dusk]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('formatClock / phaseLabel', () => {
  it('formats hours as HH:MM', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(9.5)).toBe('09:30')
    expect(formatClock(23.25)).toBe('23:15')
    expect(formatClock(25)).toBe('01:00') // wraps
  })
  it('labels the phase of day', () => {
    expect(phaseLabel(3)).toBe('Nacht')
    expect(phaseLabel(7)).toBe('Morgen')
    expect(phaseLabel(14)).toBe('Tag')
    expect(phaseLabel(19)).toBe('Abend')
  })
})
