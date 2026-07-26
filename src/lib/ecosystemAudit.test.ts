import { describe, it, expect } from 'vitest'
import { auditEcosystems } from './ecosystemAudit'
import type { PlanDocument, DeviceCatalogEntry } from '@/types'

const CAT: Record<string, DeviceCatalogEntry> = {
  bulb:    { id: 'bulb',    name: 'Bulb',    brand: 'Hue',   ecosystem: 'philips-hue', category: 'light',  protocol: ['zigbee'] },
  bridge:  { id: 'bridge',  name: 'Bridge',  brand: 'Hue',   ecosystem: 'philips-hue', category: 'hub',    protocol: ['wifi'] },
  eveDoor: { id: 'eveDoor', name: 'Door',    brand: 'Eve',   ecosystem: 'eve',         category: 'sensor', protocol: ['thread', 'matter'] },
  appleTv: { id: 'appleTv', name: 'AppleTV', brand: 'Apple', ecosystem: 'apple-home',  category: 'hub',    protocol: ['thread', 'matter', 'wifi'] },
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

const has = (r: ReturnType<typeof auditEcosystems>, t: string) => r.findings.some((f) => f.title.includes(t))

describe('auditEcosystems', () => {
  it('flags a Zigbee ecosystem with no bridge as an error', () => {
    const r = auditEcosystems(plan(['bulb']), { entryOf })
    expect(has(r, 'Bridge fehlt')).toBe(true)
    expect(r.findings.find((f) => f.title.includes('Bridge fehlt'))?.severity).toBe('error')
  })

  it('clears the bridge error once a matching hub is present', () => {
    const r = auditEcosystems(plan(['bulb', 'bridge']), { entryOf })
    expect(has(r, 'Bridge fehlt')).toBe(false)
  })

  it('warns about Thread devices without a border router', () => {
    const r = auditEcosystems(plan(['eveDoor']), { entryOf })
    expect(has(r, 'Border-Router')).toBe(true)
  })

  it('accepts Thread once a border-router-capable hub is present', () => {
    const r = auditEcosystems(plan(['eveDoor', 'appleTv']), { entryOf })
    expect(has(r, 'Border-Router')).toBe(false)
  })

  it('reports Matter coverage and counts ecosystems + protocols', () => {
    const r = auditEcosystems(plan(['eveDoor', 'appleTv', 'bulb', 'bridge']), { entryOf })
    expect(r.matterCount).toBe(2)
    expect(has(r, 'Matter-fähig')).toBe(true)
    expect(r.ecosystemCount).toBe(3) // eve · apple-home · philips-hue
    expect(r.protocolMix.find((p) => p.protocol === 'thread')?.count).toBe(2)
  })
})
