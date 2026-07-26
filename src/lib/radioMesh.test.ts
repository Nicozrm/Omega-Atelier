import { describe, it, expect } from 'vitest'
import { protocolFamily, buildMesh, arcPoint, PROTOCOL_COLORS, type MeshDeviceInfo } from './radioMesh'
import type { PlacedDevice } from '@/types'

const placed = (id: string, deviceId: string, x: number, y: number): PlacedDevice => ({
  id, deviceId, position: { x, y },
})

const CATALOG: Record<string, MeshDeviceInfo> = {
  'hue-bridge': { category: 'hub', protocols: ['zigbee', 'wired'] },
  'apple-tv': { category: 'hub', protocols: ['wifi', 'thread', 'matter'] },
  'hue-bulb': { category: 'light', protocols: ['zigbee', 'matter'] },
  'wifi-plug': { category: 'energy', protocols: ['wifi'] },
  'thread-sensor': { category: 'sensor', protocols: ['thread'] },
}
const lookup = (id: string) => CATALOG[id]

describe('protocolFamily', () => {
  it('prefers mesh protocols over wifi', () => {
    expect(protocolFamily(['wifi', 'zigbee'])).toBe('zigbee')
    expect(protocolFamily(['matter', 'thread'])).toBe('thread')
    expect(protocolFamily(['wifi'])).toBe('wifi')
  })
  it('falls back to wifi for unknown/missing protocols', () => {
    expect(protocolFamily(undefined)).toBe('wifi')
    expect(protocolFamily(['proprietary'])).toBe('wifi')
  })
  it('has a colour for every family', () => {
    for (const fam of ['zigbee', 'thread', 'matter', 'wifi', 'bt', 'wired'] as const) {
      expect(PROTOCOL_COLORS[fam]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('buildMesh', () => {
  const hubZigbee = placed('h1', 'hue-bridge', 100, 100)
  const hubWifi = placed('h2', 'apple-tv', 900, 100)

  it('returns nothing without hubs', () => {
    expect(buildMesh([placed('a', 'hue-bulb', 0, 0)], lookup)).toEqual([])
  })

  it('links a zigbee device to the zigbee hub even when the wifi hub is closer', () => {
    const bulb = placed('b', 'hue-bulb', 850, 100) // closer to hubWifi
    const links = buildMesh([hubZigbee, hubWifi, bulb], lookup)
    const l = links.find((x) => x.fromId === 'b')!
    expect(l.toId).toBe('h1')
    expect(l.protocol).toBe('zigbee')
  })

  it('links a wifi device to the nearest hub regardless of hub protocols', () => {
    const plug = placed('p', 'wifi-plug', 880, 140)
    const links = buildMesh([hubZigbee, hubWifi, plug], lookup)
    expect(links.find((x) => x.fromId === 'p')!.toId).toBe('h2')
  })

  it('builds a deduplicated hub backbone', () => {
    const links = buildMesh([hubZigbee, hubWifi], lookup)
    const backbone = links.filter((l) => l.backbone)
    expect(backbone).toHaveLength(1)
    expect(backbone[0].protocol).toBe('wired')
  })
})

describe('arcPoint', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }
  it('starts at from and ends at to', () => {
    expect(arcPoint(a, b, 0)).toEqual(a)
    expect(arcPoint(a, b, 1)).toEqual(b)
  })
  it('bulges perpendicular to the chord at the midpoint', () => {
    const mid = arcPoint(a, b, 0.5, 0.2)
    expect(mid.x).toBeCloseTo(50)
    expect(Math.abs(mid.y)).toBeGreaterThan(5) // off the straight line
  })
  it('a zero bulge degenerates to the straight line', () => {
    const mid = arcPoint(a, b, 0.5, 0)
    expect(mid.y).toBeCloseTo(0)
  })
})
