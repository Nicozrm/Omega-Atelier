import { describe, it, expect } from 'vitest'
import { estimateCost, costReportToCsv } from './costEstimate'
import type { PlanDocument, DeviceCatalogEntry } from '@/types'

const CAT: Record<string, DeviceCatalogEntry> = {
  bulb:   { id: 'bulb',   name: 'Bulb',   brand: 'Hue',  ecosystem: 'philips-hue', category: 'light',  protocol: ['zigbee'], price: 59 },
  bridge: { id: 'bridge', name: 'Bridge', brand: 'Hue',  ecosystem: 'philips-hue', category: 'hub',    protocol: ['wifi'],   price: 59 },
  cam:    { id: 'cam',    name: 'Cam',    brand: 'Aqara', ecosystem: 'aqara',      category: 'camera', protocol: ['wifi'],   price: 89 },
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

describe('estimateCost', () => {
  const r = estimateCost(plan(['bulb', 'bulb', 'bridge', 'cam']), { entryOf })

  it('sums total device investment', () => {
    expect(r.totalEur).toBe(59 + 59 + 59 + 89)
    expect(r.deviceCount).toBe(4)
    expect(r.pricedCount).toBe(4)
  })

  it('aggregates identical models into one item line with quantity', () => {
    const bulb = r.items.find((i) => i.deviceId === 'bulb')
    expect(bulb).toMatchObject({ count: 2, unit: 59, total: 118 })
  })

  it('groups by ecosystem and by category', () => {
    expect(r.byEcosystem.find((g) => g.key === 'philips-hue')?.total).toBe(177)
    expect(r.byCategory.find((g) => g.key === 'light')?.count).toBe(2)
  })

  it('serialises a CSV shopping list with a total row', () => {
    const csv = costReportToCsv(r)
    expect(csv.split('\n')[0]).toBe('Anzahl,Gerät,Marke,Einzelpreis (€),Summe (€)')
    expect(csv).toContain('Gesamt,266.00')
  })
})
