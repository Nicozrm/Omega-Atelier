import { describe, it, expect } from 'vitest'
import { estimateEnergy } from './energy'
import type { PlanDocument, DeviceCatalogEntry } from '@/types'

const CAT: Record<string, DeviceCatalogEntry> = {
  bulb:   { id: 'bulb',   name: 'Bulb',   brand: 'X', ecosystem: 'philips-hue', category: 'light',  protocol: ['zigbee'], price: 59, power: 10 },
  bridge: { id: 'bridge', name: 'Bridge', brand: 'X', ecosystem: 'philips-hue', category: 'hub',    protocol: ['wifi'],   price: 59, power: 3 },
  motion: { id: 'motion', name: 'Motion', brand: 'X', ecosystem: 'philips-hue', category: 'sensor', protocol: ['zigbee'], price: 44 },
}
const entryOf = (id: string) => CAT[id]

function plan(ids: string[]): PlanDocument {
  return {
    schemaVersion: 2, id: 't', title: 't',
    floors: [{
      id: 'f', name: 'F', index: 0, walls: [], rooms: [], furniture: [], labels: [],
      devices: ids.map((deviceId, i) => ({ id: `d${i}`, deviceId, position: { x: 0, y: 0 } })),
      layers: { walls: true, furniture: true, devices: true, labels: true }, extent: { width: 100, height: 100 },
    }],
    activeFloorId: 'f', activeModeKey: 'auto', modes: [],
    settings: { unit: 'cm', gridSize: 50, snap: true, snapStep: 10, showGrid: true, theme: 'dark' },
    createdAt: '', updatedAt: '',
  }
}

describe('estimateEnergy', () => {
  const r = estimateEnergy(plan(['bulb', 'bulb', 'bridge', 'motion']), { entryOf })

  it('counts every placed device but only powered ones toward load', () => {
    expect(r.deviceCount).toBe(4)
    expect(r.poweredCount).toBe(3)
    expect(r.connectedWatts).toBe(23)
  })

  it('separates an always-on standby baseline (the hub)', () => {
    expect(r.standbyWatts).toBe(3)
  })

  it('applies per-category duty hours to reach kWh & cost', () => {
    // 2×(10W·5h) + 3W·24h = 0.1 + 0.072 = 0.172 kWh/day
    expect(r.kwhPerDay).toBeCloseTo(0.172, 5)
    expect(r.kwhPerMonth).toBeCloseTo(0.172 * 30.44, 4)
    expect(r.costPerMonth).toBeCloseTo(0.172 * 30.44 * 0.35, 4)
  })

  it('honours a custom price', () => {
    const r2 = estimateEnergy(plan(['bulb']), { entryOf, pricePerKwh: 1 })
    expect(r2.costPerMonth).toBeCloseTo(r2.kwhPerMonth, 6)
  })

  it('breaks down by category, biggest consumer first', () => {
    expect(r.byCategory[0].category).toBe('light')
    expect(r.byCategory.find((l) => l.category === 'hub')?.count).toBe(1)
  })

  it('ignores unknown device ids gracefully', () => {
    const r3 = estimateEnergy(plan(['ghost']), { entryOf })
    expect(r3.deviceCount).toBe(1)
    expect(r3.connectedWatts).toBe(0)
  })
})
