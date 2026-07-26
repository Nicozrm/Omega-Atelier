import { describe, it, expect } from 'vitest'
import { matchRoomByName, resolveRoomBinding, deriveRoomLiveState } from './binding'
import type { Device } from '@/domain'
import type { Room } from '@/types'

const rooms: Room[] = [
  { id: 'r1', name: 'Wohnzimmer', polygon: [] },
  { id: 'r3', name: 'Schlafzimmer', polygon: [] },
  { id: 'r4', name: 'Flur / Bad', polygon: [] },
]

const dev = (id: string, room: string | undefined, caps: Device['capabilities'], category: Device['category'] = 'other'): Device => ({
  id, connectorId: 'x', category, name: id, capabilities: caps,
  health: { reachability: 'online' }, ...(room ? { metadata: { room } } : {}),
})

describe('matchRoomByName', () => {
  it('matches exact then token-contains', () => {
    expect(matchRoomByName('Wohnzimmer', rooms)?.id).toBe('r1')
    expect(matchRoomByName('wohnzimmer', rooms)?.id).toBe('r1')
    expect(matchRoomByName('Flur', rooms)?.id).toBe('r4') // "Flur" ↔ "Flur / Bad"
    expect(matchRoomByName('Eingang', rooms)).toBeUndefined()
    expect(matchRoomByName(undefined, rooms)).toBeUndefined()
  })
})

describe('resolveRoomBinding', () => {
  it('auto-binds by name, honours overrides, collects the unassigned', () => {
    const devices = [
      dev('a', 'Wohnzimmer', []),
      dev('b', 'Schlafzimmer', []),
      dev('c', 'Eingang', []), // no plan room → unassigned…
    ]
    const r = resolveRoomBinding(devices, rooms, { c: 'r4' }) // …unless overridden
    expect(r.byRoom.get('r1')?.map((d) => d.id)).toEqual(['a'])
    expect(r.roomOf.get('b')).toBe('r3')
    expect(r.roomOf.get('c')).toBe('r4')
    expect(r.unassigned).toHaveLength(0)
  })

  it('ignores overrides pointing at non-existent rooms', () => {
    const r = resolveRoomBinding([dev('c', 'Eingang', [])], rooms, { c: 'nope' })
    expect(r.unassigned.map((d) => d.id)).toEqual(['c'])
  })
})

describe('deriveRoomLiveState', () => {
  it('aggregates lights, climate, motion, energy and locks', () => {
    const devices = [
      dev('l1', 'W', [{ kind: 'OnOff', access: 'readWrite', on: true }, { kind: 'Brightness', access: 'readWrite', percent: 80 }, { kind: 'ColorTemperature', access: 'readWrite', kelvin: 2700, minKelvin: 2200, maxKelvin: 6500 }], 'light'),
      dev('l2', 'W', [{ kind: 'OnOff', access: 'readWrite', on: false }, { kind: 'Brightness', access: 'readWrite', percent: 40 }], 'light'),
      dev('s1', 'W', [{ kind: 'Temperature', access: 'read', celsius: 21.5 }, { kind: 'Humidity', access: 'read', percent: 48 }], 'sensor'),
      dev('m1', 'W', [{ kind: 'Motion', access: 'read', detected: true }], 'sensor'),
      dev('e1', 'W', [{ kind: 'Energy', access: 'read', watts: 42 }], 'energy'),
      dev('k1', 'W', [{ kind: 'Lock', access: 'readWrite', locked: true }], 'lock'),
    ]
    const s = deriveRoomLiveState(devices)
    expect(s.lightTotal).toBe(2)
    expect(s.lightsOn).toBe(1) // only l1 on
    expect(s.brightness).toBe(80) // avg of ON lights only
    expect(s.glow).toBeTruthy()
    expect(s.temperature).toBe(21.5)
    expect(s.humidity).toBe(48)
    expect(s.motion).toBe(true)
    expect(s.energyW).toBe(42)
    expect(s.hasLock).toBe(true)
    expect(s.locked).toBe(true)
    expect(s.deviceCount).toBe(6)
  })

  it('reports no glow when every light is off', () => {
    const s = deriveRoomLiveState([dev('l', 'W', [{ kind: 'OnOff', access: 'readWrite', on: false }], 'light')])
    expect(s.lightsOn).toBe(0)
    expect(s.glow).toBeUndefined()
  })
})
