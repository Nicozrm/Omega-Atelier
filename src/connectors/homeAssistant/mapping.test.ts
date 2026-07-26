import { describe, it, expect } from 'vitest'
import { mapStateToCapabilities, mapEntityToDevice, commandToCallService } from './mapping'
import { findCapability } from '@/domain'
import type { HaEntityState } from './transport'

const st = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HaEntityState =>
  ({ entity_id, state, attributes })

describe('HA → capability mapping', () => {
  it('maps a light to on/off, brightness, colour temperature and colour', () => {
    const caps = mapStateToCapabilities(st('light.x', 'on', { brightness: 255, color_temp_kelvin: 2700, rgb_color: [255, 214, 170] }))
    expect(findCapability(caps, 'OnOff')?.on).toBe(true)
    expect(findCapability(caps, 'Brightness')?.percent).toBe(100)
    expect(findCapability(caps, 'ColorTemperature')?.kelvin).toBe(2700)
    expect(findCapability(caps, 'Color')?.hex).toBe('#ffd6aa')
  })

  it('maps a lock, a motion sensor, a temperature sensor and a cover', () => {
    expect(findCapability(mapStateToCapabilities(st('lock.x', 'locked')), 'Lock')?.locked).toBe(true)
    expect(findCapability(mapStateToCapabilities(st('binary_sensor.x', 'on', { device_class: 'motion' })), 'Motion')?.detected).toBe(true)
    expect(findCapability(mapStateToCapabilities(st('sensor.x', '21.5', { device_class: 'temperature' })), 'Temperature')?.celsius).toBe(21.5)
    expect(findCapability(mapStateToCapabilities(st('cover.x', 'open', { current_position: 60 })), 'Position')?.percent).toBe(60)
  })

  it('produces a neutral device with no manufacturer/HA fields leaking', () => {
    const d = mapEntityToDevice(st('lock.haustuer', 'locked', { friendly_name: 'Haustür', battery_level: 80 }), 'home-assistant')!
    expect(d.category).toBe('lock')
    expect(d.connectorId).toBe('home-assistant')
    expect(d.name).toBe('Haustür')
    expect(d.battery?.percent).toBe(80)
    expect('entity_id' in d).toBe(false)
    expect('brand' in d).toBe(false)
  })

  it('maps neutral commands to HA call_service', () => {
    expect(commandToCallService({ deviceId: 'light.x', capability: 'OnOff', payload: { on: false } }))
      .toMatchObject({ domain: 'light', service: 'turn_off' })
    expect(commandToCallService({ deviceId: 'light.x', capability: 'Brightness', payload: { percent: 50 } }))
      .toMatchObject({ service: 'turn_on', service_data: { brightness_pct: 50 } })
    expect(commandToCallService({ deviceId: 'lock.x', capability: 'Lock', payload: { locked: true } }))
      .toMatchObject({ domain: 'lock', service: 'lock' })
  })
})
