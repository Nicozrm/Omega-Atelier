import { describe, it, expect } from 'vitest'
import { modeStateFor, formatModeState } from '@/lib/modeState'
import type { DeviceCategory, ModeKey } from '@/types'

const ALL_MODES: ModeKey[] = [
  'auto', 'morning', 'day-office', 'film', 'night', 'relax', 'away', 'party', 'alarm',
]
const ALL_CATS: DeviceCategory[] = [
  'light', 'switch', 'sensor', 'climate', 'camera', 'lock', 'speaker', 'tv',
  'blind', 'outlet', 'hub', 'appliance', 'alarm', 'irrigation', 'other',
]

describe('modeStateFor', () => {
  it('returns a defined object for every category × mode combination', () => {
    for (const cat of ALL_CATS) {
      for (const mode of ALL_MODES) {
        const state = modeStateFor(cat, mode)
        expect(state, `${cat}/${mode}`).toBeTypeOf('object')
        expect(state).not.toBeNull()
      }
    }
  })

  it('turns lights off at night and on for film (dim)', () => {
    expect(modeStateFor('light', 'night').on).toBe(false)
    expect(modeStateFor('light', 'film').on).toBe(true)
    expect(modeStateFor('light', 'film').brightness).toBeLessThan(30)
  })

  it('closes blinds for film and opens them in the morning', () => {
    expect(modeStateFor('blind', 'film').position).toBe(0)
    expect(modeStateFor('blind', 'morning').position).toBe(100)
  })

  it('lowers climate target at night and when away', () => {
    const night = modeStateFor('climate', 'night').target_temp as number
    const away = modeStateFor('climate', 'away').target_temp as number
    const day = modeStateFor('climate', 'day-office').target_temp as number
    expect(night).toBeLessThan(day)
    expect(away).toBeLessThanOrEqual(night)
  })

  it('returns an empty object for an unknown category', () => {
    // @ts-expect-error deliberately invalid category
    expect(modeStateFor('nonsense', 'auto')).toEqual({})
  })
})

describe('formatModeState', () => {
  it('renders an em dash for empty/undefined', () => {
    expect(formatModeState(undefined)).toBe('—')
    expect(formatModeState({})).toBe('—')
  })
  it('formats booleans in German', () => {
    expect(formatModeState({ on: true })).toBe('on: an')
    expect(formatModeState({ on: false })).toBe('on: aus')
  })
  it('formats percentage-style fields', () => {
    expect(formatModeState({ brightness: 70 })).toBe('brightness 70%')
    expect(formatModeState({ position: 50 })).toBe('position 50%')
  })
  it('formats kelvin and temperature units', () => {
    expect(formatModeState({ kelvin: 3000 })).toBe('3000 K')
    expect(formatModeState({ target_temp: 21 })).toBe('21°C')
  })
  it('joins multiple entries with a middot', () => {
    expect(formatModeState({ on: true, brightness: 80 })).toBe('on: an · brightness 80%')
  })
})
