import { describe, it, expect } from 'vitest'
import {
  readinessByCategory,
  readinessByModeTags,
  modeReadiness,
  type DeviceLookup,
} from '@/lib/readiness'
import type { DeviceCategory, ModeKey, PlacedDevice } from '@/types'

/** Tiny in-memory catalogue for deterministic tests. */
const CATALOG: Record<string, { category: DeviceCategory; modeTags?: ModeKey[] }> = {
  hue:    { category: 'light', modeTags: ['film', 'night'] },
  motion: { category: 'sensor', modeTags: ['auto'] },
  blindA: { category: 'blind' },
  unknownTagless: { category: 'light' },
}
const lookup: DeviceLookup = (id) => CATALOG[id]

function place(deviceId: string, n = 1): PlacedDevice[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${deviceId}-${i}`,
    deviceId,
    position: { x: 0, y: 0 },
  }))
}

describe('readinessByCategory', () => {
  it('is 100 with no required categories', () => {
    expect(readinessByCategory([], new Set())).toEqual({ score: 100, missing: [] })
  })
  it('scores partial coverage and reports missing', () => {
    const present = new Set<DeviceCategory>(['light'])
    const r = readinessByCategory(['light', 'sensor'], present)
    expect(r.score).toBe(50)
    expect(r.missing).toEqual(['sensor'])
  })
  it('is 100 when all present', () => {
    const present = new Set<DeviceCategory>(['light', 'sensor'])
    expect(readinessByCategory(['light', 'sensor'], present).score).toBe(100)
  })
  it('rounds correctly for thirds', () => {
    const present = new Set<DeviceCategory>(['light'])
    // 1 of 3 → 33
    expect(readinessByCategory(['light', 'sensor', 'blind'], present).score).toBe(33)
  })
})

describe('readinessByModeTags', () => {
  it('counts only devices that declare support for the mode', () => {
    const placed = [...place('hue'), ...place('motion')]
    // film: hue supports film (light), motion does NOT (its tag is 'auto')
    const r = readinessByModeTags('film', ['light', 'sensor'], placed, lookup)
    expect(r.score).toBe(50)
    expect(r.missing).toEqual(['sensor'])
  })
  it('ignores tagless devices even if the category matches', () => {
    const placed = place('unknownTagless') // light, no modeTags
    const r = readinessByModeTags('film', ['light'], placed, lookup)
    expect(r.score).toBe(0)
    expect(r.missing).toEqual(['light'])
  })
  it('is 100 with no required categories', () => {
    expect(readinessByModeTags('auto', [], [], lookup).score).toBe(100)
  })
})

describe('modeReadiness (combined)', () => {
  const filmMode = { key: 'film' as ModeKey, requiredCategories: ['light'] as DeviceCategory[] }

  it('takes the higher of category vs mode-tag score', () => {
    // hue is light + supports film → both signals 100
    const r = modeReadiness(filmMode, place('hue'), lookup)
    expect(r.score).toBe(100)
  })

  it('flags tagsDominant only when mode-tags strictly beats category', () => {
    // tagless light device: category=100, tags=0 → category wins, not tag-dominant
    const r = modeReadiness(filmMode, place('unknownTagless'), lookup)
    expect(r.score).toBe(100)
    expect(r.byModeTags).toBe(false)
    expect(r.tagsDominant).toBe(false)
  })

  it('handles unknown device ids gracefully', () => {
    const placed: PlacedDevice[] = [{ id: 'x', deviceId: 'does-not-exist', position: { x: 0, y: 0 } }]
    const r = modeReadiness(filmMode, placed, lookup)
    expect(r.score).toBe(0)
    expect(r.missing).toEqual(['light'])
  })

  it('is fully ready for a mode with no requirements', () => {
    const r = modeReadiness({ key: 'auto', requiredCategories: [] }, [], lookup)
    expect(r.score).toBe(100)
    expect(r.missing).toEqual([])
  })
})
