import { describe, it, expect } from 'vitest'
import { OMEGA_MODES } from '@/lib/constants'
import { UPHOLSTERY_SLOTS, WOOD_SLOTS } from '@/lib/materialSlots'
import type { DeviceCategory } from '@/types'

const HEX = /^#[0-9a-fA-F]{6}$/
const VALID_CATEGORIES = new Set<DeviceCategory>([
  'light', 'switch', 'sensor', 'climate', 'camera', 'lock', 'speaker', 'tv',
  'blind', 'outlet', 'hub', 'appliance', 'alarm', 'irrigation', 'other',
])

describe('OMEGA_MODES integrity', () => {
  it('contains the nine canonical modes', () => {
    expect(OMEGA_MODES).toHaveLength(9)
  })

  it('has unique mode keys', () => {
    const keys = OMEGA_MODES.map((m) => m.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses valid 6-digit hex accents', () => {
    for (const m of OMEGA_MODES) {
      expect(m.accent, m.key).toMatch(HEX)
    }
  })

  it('gives every mode a name, description and icon', () => {
    for (const m of OMEGA_MODES) {
      expect(m.name, m.key).toBeTruthy()
      expect(m.description, m.key).toBeTruthy()
      expect(m.icon, m.key).toBeTruthy()
    }
  })

  it('only references known device categories in requiredCategories', () => {
    for (const m of OMEGA_MODES) {
      for (const cat of m.requiredCategories) {
        expect(VALID_CATEGORIES.has(cat), `${m.key} → ${cat}`).toBe(true)
      }
    }
  })

  it('defines a trigger for each mode', () => {
    for (const m of OMEGA_MODES) {
      expect(m.trigger, m.key).toBeDefined()
      expect(typeof m.trigger.manual).toBe('boolean')
    }
  })
})

describe('material slots integrity', () => {
  const all = [...UPHOLSTERY_SLOTS, ...WOOD_SLOTS]

  it('has globally unique keys', () => {
    const keys = all.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses valid hex swatches and non-empty labels', () => {
    for (const slot of all) {
      expect(slot.swatch, slot.key).toMatch(HEX)
      expect(slot.label, slot.key).toBeTruthy()
    }
  })

  it('provides at least one upholstery and one wood option', () => {
    expect(UPHOLSTERY_SLOTS.length).toBeGreaterThan(0)
    expect(WOOD_SLOTS.length).toBeGreaterThan(0)
  })
})
