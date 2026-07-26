import { describe, it, expect } from 'vitest'
import { placedToDevice, planDevicesToTwin } from './deviceTwin'
import { deviceHasCapability, deviceCapability } from '@/domain'
import type { PlacedDevice } from '@/types'

const placed = (deviceId: string, extra: Partial<PlacedDevice> = {}): PlacedDevice => ({
  id: `p-${deviceId}-${Math.random().toString(36).slice(2, 6)}`,
  deviceId,
  position: { x: 0, y: 0 },
  ...extra,
})

describe('deviceTwin adapter — capability derivation', () => {
  it('derives light capabilities and carries NO manufacturer fields', () => {
    const d = placedToDevice(placed('hue-e27-white-color'), 'auto')
    expect(d.category).toBe('light')
    expect(deviceHasCapability(d, 'OnOff')).toBe(true)
    expect(deviceHasCapability(d, 'Brightness')).toBe(true)
    expect(deviceHasCapability(d, 'ColorTemperature')).toBe(true)
    // manufacturer-neutral: legacy brand / ecosystem / protocol never leak in
    expect('brand' in d).toBe(false)
    expect('ecosystem' in d).toBe(false)
    expect('protocol' in d).toBe(false)
    expect(d.connectorId).toBe('local-plan')
    expect(d.health.reachability).toBe('online')
  })

  it('derives a lock with a battery', () => {
    const d = placedToDevice(placed('nuki-smart-lock-4'), 'auto')
    expect(d.category).toBe('lock')
    expect(deviceHasCapability(d, 'Lock')).toBe(true)
    expect(d.battery?.percent).toBeGreaterThanOrEqual(20)
  })

  it('derives a motion sensor', () => {
    const d = placedToDevice(placed('hue-motion'), 'auto')
    expect(d.category).toBe('sensor')
    expect(deviceHasCapability(d, 'Motion')).toBe(true)
  })

  it('applies the active light mode state onto capabilities', () => {
    const d = placedToDevice(
      placed('hue-e27-white-color', { modeState: { film: { brightness: 40, kelvin: 2400 } } }),
      'film',
    )
    expect(deviceCapability(d, 'OnOff')?.on).toBe(true)
    expect(deviceCapability(d, 'Brightness')?.percent).toBe(40)
    expect(deviceCapability(d, 'ColorTemperature')?.kelvin).toBe(2400)
  })

  it('falls back to a neutral "other" device for unknown ids', () => {
    const d = placedToDevice(placed('does-not-exist'), 'auto')
    expect(d.category).toBe('other')
    expect(d.capabilities).toHaveLength(0)
  })

  it('numbers devices per neutral label without brand names', () => {
    const twin = planDevicesToTwin(
      [placed('hue-e27-white-color'), placed('hue-e27-white-color')],
      'auto',
    )
    expect(twin.map((d) => d.name)).toEqual(['Leuchte 1', 'Leuchte 2'])
  })
})
