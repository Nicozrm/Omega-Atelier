import { describe, it, expect } from 'vitest'
import {
  deviceHasCapability, deviceCapability, deviceState, mergeCapabilities,
  type Capability, type Device,
} from './index'

function device(caps: Capability[]): Device {
  return {
    id: 'd1', connectorId: 'c1', category: 'light', name: 'Leuchte 1',
    capabilities: caps, health: { reachability: 'online' },
  }
}

describe('device capability access', () => {
  const d = device([
    { kind: 'OnOff', access: 'readWrite', on: true },
    { kind: 'Brightness', access: 'readWrite', percent: 50 },
    { kind: 'ColorTemperature', access: 'readWrite', kelvin: 3000, minKelvin: 2200, maxKelvin: 6500 },
  ])

  it('queries capabilities', () => {
    expect(deviceHasCapability(d, 'OnOff')).toBe(true)
    expect(deviceHasCapability(d, 'Lock')).toBe(false)
    expect(deviceCapability(d, 'ColorTemperature')?.kelvin).toBe(3000)
  })

  it('projects a flat state snapshot from capabilities (no separate store)', () => {
    const s = deviceState(d)
    expect(s.on).toBe(true)
    expect(s.brightness).toBe(50)
    expect(s.kelvin).toBe(3000)
  })
})

describe('mergeCapabilities', () => {
  it('replaces a same-kind capability and appends new kinds', () => {
    const base: Capability[] = [
      { kind: 'OnOff', access: 'readWrite', on: false },
      { kind: 'Brightness', access: 'readWrite', percent: 10 },
    ]
    const merged = mergeCapabilities(base, [
      { kind: 'OnOff', access: 'readWrite', on: true },
      { kind: 'Lock', access: 'readWrite', locked: true },
    ])
    expect(merged.find((c) => c.kind === 'OnOff')).toMatchObject({ on: true })
    expect(merged.find((c) => c.kind === 'Brightness')).toMatchObject({ percent: 10 })
    expect(merged.some((c) => c.kind === 'Lock')).toBe(true)
    expect(merged.length).toBe(3)
  })
})
