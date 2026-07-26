import { describe, it, expect } from 'vitest'
import { DEVICES } from './devices'

const ids = new Set(DEVICES.map((d) => d.id))

describe('device catalog', () => {
  it('is a substantial library (grew well past the original set)', () => {
    expect(DEVICES.length).toBeGreaterThanOrEqual(160)
  })

  it('has unique ids', () => {
    expect(ids.size).toBe(DEVICES.length)
  })

  it('every device has a name, brand and at least one protocol', () => {
    for (const d of DEVICES) {
      expect(d.id, JSON.stringify(d)).toMatch(/^[a-z0-9-]+$/)
      expect(d.name.length, d.id).toBeGreaterThan(0)
      expect(d.brand.length, d.id).toBeGreaterThan(0)
      expect(d.protocol.length, d.id).toBeGreaterThan(0)
    }
  })

  it('any `requires` reference resolves to a real device (hub/bridge exists)', () => {
    for (const d of DEVICES) {
      for (const req of d.requires ?? []) {
        expect(ids, `${d.id} requires ${req}`).toContain(req)
      }
    }
  })

  it('price and power are non-negative when given', () => {
    for (const d of DEVICES) {
      if (d.price !== undefined) expect(d.price, d.id).toBeGreaterThanOrEqual(0)
      if (d.power !== undefined) expect(d.power, d.id).toBeGreaterThanOrEqual(0)
    }
  })

  it('spans many ecosystems and every device category', () => {
    const ecos = new Set(DEVICES.map((d) => d.ecosystem))
    const cats = new Set(DEVICES.map((d) => d.category))
    expect(ecos.size).toBeGreaterThanOrEqual(25)
    for (const c of ['light', 'sensor', 'climate', 'camera', 'lock', 'speaker', 'blind', 'outlet', 'hub', 'switch', 'irrigation', 'alarm', 'tv', 'appliance'] as const) {
      expect(cats, `category ${c} present`).toContain(c)
    }
  })
})
