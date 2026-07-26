import { describe, it, expect } from 'vitest'
import { kelvinToHex, deriveRoomLighting, deriveLightSources, type CategoryLookup } from './lighting'
import type { PlacedDevice } from '@/types'

const light = (id: string, roomId: string, modeState?: PlacedDevice['modeState']): PlacedDevice => ({
  id,
  deviceId: 'lamp',
  position: { x: 0, y: 0 },
  roomId,
  modeState,
})

// Everything with deviceId 'lamp' is a light; 'mote' is a sensor.
const lookup: CategoryLookup = (deviceId) => (deviceId === 'lamp' ? 'light' : deviceId === 'mote' ? 'sensor' : undefined)

describe('kelvinToHex', () => {
  it('returns a valid 6-digit hex', () => {
    expect(kelvinToHex(3000)).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('renders cool light with a higher blue-to-red ratio than warm light', () => {
    const warm = kelvinToHex(2200)
    const cool = kelvinToHex(6500)
    const r = (h: string) => parseInt(h.slice(1, 3), 16)
    const b = (h: string) => parseInt(h.slice(5, 7), 16)
    // Warm is dominated by red; cool shifts strongly toward blue.
    expect(r(warm)).toBeGreaterThan(b(warm))
    expect(b(cool) / r(cool)).toBeGreaterThan(b(warm) / r(warm))
    expect(b(cool)).toBeGreaterThan(b(warm))
  })

  it('clamps extreme inputs without throwing', () => {
    expect(kelvinToHex(-1000)).toMatch(/^#[0-9a-f]{6}$/)
    expect(kelvinToHex(999999)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('deriveRoomLighting', () => {
  it('reports an unlit room when there are no lights', () => {
    const r = deriveRoomLighting({ roomId: 'R1', devices: [], lookup, mode: 'auto' })
    expect(r.on).toBe(false)
    expect(r.intensity).toBe(0)
    expect(r.lightCount).toBe(0)
  })

  it('uses the per-mode light defaults (auto → 70%, 3000K)', () => {
    const r = deriveRoomLighting({ roomId: 'R1', devices: [light('l1', 'R1')], lookup, mode: 'auto' })
    expect(r.on).toBe(true)
    expect(r.intensity).toBeCloseTo(0.7, 5)
    expect(r.kelvin).toBe(3000)
    expect(r.lightCount).toBe(1)
  })

  it('treats a mode that turns lights off as unlit but still counts fixtures', () => {
    const r = deriveRoomLighting({ roomId: 'R1', devices: [light('l1', 'R1')], lookup, mode: 'night' })
    expect(r.on).toBe(false)
    expect(r.intensity).toBe(0)
    expect(r.lightCount).toBe(1)
  })

  it('averages brightness and kelvin across on-lights', () => {
    const devices = [
      light('l1', 'R1', { auto: { on: true, brightness: 100, kelvin: 2200 } }),
      light('l2', 'R1'), // default auto → 70 / 3000
    ]
    const r = deriveRoomLighting({ roomId: 'R1', devices, lookup, mode: 'auto' })
    expect(r.intensity).toBeCloseTo(0.85, 5) // (100 + 70) / 2 / 100
    expect(r.kelvin).toBe(2600) // (2200 + 3000) / 2
  })

  it('ignores non-light devices and lights in other rooms', () => {
    const devices = [
      light('l1', 'R1'),
      light('l2', 'R2'), // different room
      { id: 's1', deviceId: 'mote', position: { x: 0, y: 0 }, roomId: 'R1' } as PlacedDevice, // sensor
    ]
    const r = deriveRoomLighting({ roomId: 'R1', devices, lookup, mode: 'auto' })
    expect(r.lightCount).toBe(1)
    expect(r.on).toBe(true)
  })
})

describe('deriveLightSources', () => {
  it('returns one source per light, filtering out non-lights', () => {
    const devices = [
      light('l1', 'R1'),
      light('l2', 'R2'),
      { id: 's1', deviceId: 'mote', position: { x: 0, y: 0 }, roomId: 'R1' } as PlacedDevice,
    ]
    const sources = deriveLightSources({ devices, lookup, mode: 'auto' })
    expect(sources).toHaveLength(2)
    expect(sources.map((s) => s.deviceId).sort()).toEqual(['l1', 'l2'])
  })

  it('carries position and roomId from the device and colour from kelvin', () => {
    const d = light('l1', 'R1')
    d.position = { x: 220, y: 140 }
    const [s] = deriveLightSources({ devices: [d], lookup, mode: 'auto' })
    expect(s.position).toEqual({ x: 220, y: 140 })
    expect(s.roomId).toBe('R1')
    expect(s.color).toBe(kelvinToHex(3000)) // auto default
  })

  it('maps brightness to 0..1 intensity and reflects on/off per mode', () => {
    const on = deriveLightSources({ devices: [light('l1', 'R1')], lookup, mode: 'auto' })[0]
    expect(on.on).toBe(true)
    expect(on.intensity).toBeCloseTo(0.7, 5) // brightness 70

    const off = deriveLightSources({ devices: [light('l1', 'R1')], lookup, mode: 'night' })[0]
    expect(off.on).toBe(false)
    expect(off.intensity).toBe(0)
  })

  it('respects a per-device mode override', () => {
    const d = light('l1', 'R1', { auto: { on: true, brightness: 100, kelvin: 2200 } })
    const [s] = deriveLightSources({ devices: [d], lookup, mode: 'auto' })
    expect(s.intensity).toBeCloseTo(1, 5)
    expect(s.kelvin).toBe(2200)
    expect(s.color).toBe(kelvinToHex(2200))
  })

  it('uses a valid per-scene RGB colour over the Kelvin white, and ignores an invalid one', () => {
    const rgb = light('l1', 'R1', { relax: { on: true, brightness: 40, color: '#3B6BFF' } })
    const [s] = deriveLightSources({ devices: [rgb], lookup, mode: 'relax' })
    expect(s.on).toBe(true)
    expect(s.color).toBe('#3b6bff') // normalised, overrides kelvinToHex

    const bad = light('l2', 'R1', { relax: { on: true, brightness: 40, color: 'blau' } })
    const [t] = deriveLightSources({ devices: [bad], lookup, mode: 'relax' })
    expect(t.color).toBe(kelvinToHex(t.kelvin)) // falls back to white
  })
})
