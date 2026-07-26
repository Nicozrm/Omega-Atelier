import { describe, it, expect } from 'vitest'
import { mapStatusToCapabilities, mapTuyaDevice, commandToTuya, type TuyaStatus } from './mapping'
import { findCapability } from '@/domain'

describe('mapStatusToCapabilities', () => {
  it('maps a colour bulb to OnOff + Brightness + ColorTemperature + Color', () => {
    const status: TuyaStatus[] = [
      { code: 'switch_led', value: true },
      { code: 'bright_value_v2', value: 500 },
      { code: 'temp_value_v2', value: 0 },
      { code: 'colour_data_v2', value: JSON.stringify({ h: 0, s: 1000, v: 1000 }) },
    ]
    const caps = mapStatusToCapabilities(status)
    expect(findCapability(caps, 'OnOff')).toMatchObject({ on: true })
    expect(findCapability(caps, 'Brightness')).toMatchObject({ percent: 50 })
    expect(findCapability(caps, 'ColorTemperature')).toMatchObject({ kelvin: 2700 }) // temp 0 → warmest
    expect(findCapability(caps, 'Color')?.hex).toBe('#ff0000') // pure red HSV
  })

  it('maps a plug to OnOff + Energy (power ÷10 W)', () => {
    const caps = mapStatusToCapabilities([{ code: 'switch_1', value: true }, { code: 'cur_power', value: 842 }])
    expect(findCapability(caps, 'OnOff')).toMatchObject({ on: true })
    expect(findCapability(caps, 'Energy')).toMatchObject({ watts: 84 })
  })

  it('maps a climate sensor (temperature ÷10, humidity)', () => {
    const caps = mapStatusToCapabilities([{ code: 'va_temperature', value: 224 }, { code: 'va_humidity', value: 58 }])
    expect(findCapability(caps, 'Temperature')).toMatchObject({ celsius: 22.4 })
    expect(findCapability(caps, 'Humidity')).toMatchObject({ percent: 58 })
  })

  it('maps a PIR presence code to Motion', () => {
    expect(findCapability(mapStatusToCapabilities([{ code: 'pir', value: 'pir' }]), 'Motion')).toMatchObject({ detected: true })
    expect(findCapability(mapStatusToCapabilities([{ code: 'pir', value: 'none' }]), 'Motion')).toMatchObject({ detected: false })
  })

  it('maps a legacy vacuum mode DP to a Vacuum activity', () => {
    expect(findCapability(mapStatusToCapabilities([{ code: 'mode', value: 'standby' }]), 'Vacuum')).toMatchObject({ activity: 'docked' })
    expect(findCapability(mapStatusToCapabilities([{ code: 'mode', value: 'smart' }]), 'Vacuum')).toMatchObject({ activity: 'cleaning' })
  })

  it('maps a real robot-vacuum `status` enum to the neutral activity', () => {
    const act = (s: string) => findCapability(mapStatusToCapabilities([{ code: 'status', value: s }]), 'Vacuum')
    expect(act('cleaning')).toMatchObject({ activity: 'cleaning' })
    expect(act('zone_clean')).toMatchObject({ activity: 'cleaning' })
    expect(act('goto_charge')).toMatchObject({ activity: 'returning' })
    expect(act('chargego')).toMatchObject({ activity: 'returning' })
    expect(act('charging')).toMatchObject({ activity: 'docked' })
    expect(act('paused')).toMatchObject({ activity: 'idle' })
  })

  it('reads `power_go` as start/pause when there is no status enum', () => {
    expect(findCapability(mapStatusToCapabilities([{ code: 'power_go', value: true }]), 'Vacuum')).toMatchObject({ activity: 'cleaning' })
    expect(findCapability(mapStatusToCapabilities([{ code: 'power_go', value: false }]), 'Vacuum')).toMatchObject({ activity: 'idle' })
  })

  it('does not mistake a light with a `mode` DP for a vacuum', () => {
    expect(findCapability(mapStatusToCapabilities([{ code: 'switch_led', value: true }, { code: 'mode', value: 'white' }]), 'Vacuum')).toBeUndefined()
  })
})

describe('mapTuyaDevice', () => {
  it('stamps category, battery and room; drops uncontrollable/empty devices', () => {
    const dev = mapTuyaDevice({
      id: 'x', name: 'Sensor', category: 'wsdcg', online: true, room: 'Bad',
      status: [{ code: 'va_temperature', value: 210 }, { code: 'battery_percentage', value: 76 }],
    }, 'tuya-cloud')
    expect(dev).not.toBeNull()
    expect(dev!.category).toBe('sensor')
    expect(dev!.battery).toEqual({ percent: 76 })
    expect(dev!.metadata).toEqual({ room: 'Bad' })
    expect(dev!.connectorId).toBe('tuya-cloud')

    expect(mapTuyaDevice({ id: 'y', name: 'Unknown', status: [] }, 'tuya-cloud')).toBeNull()
  })

  it('flags offline devices as unreachable', () => {
    const dev = mapTuyaDevice({ id: 'z', name: 'Plug', category: 'cz', online: false, status: [{ code: 'switch_1', value: false }] }, 't')
    expect(dev!.health.reachability).toBe('offline')
  })

  it('maps a Tuya robot vacuum (category sd) to an appliance with Vacuum + battery', () => {
    const dev = mapTuyaDevice({
      id: 'robo', name: 'Saugroboter', category: 'sd', online: true, room: 'Wohnzimmer',
      status: [{ code: 'status', value: 'cleaning' }, { code: 'battery_percentage', value: 64 }],
    }, 'tuya-cloud')
    expect(dev).not.toBeNull()
    expect(dev!.category).toBe('appliance')
    expect(findCapability(dev!.capabilities, 'Vacuum')).toMatchObject({ activity: 'cleaning' })
    expect(dev!.battery).toEqual({ percent: 64 })
  })
})

describe('commandToTuya', () => {
  it('OnOff emits both common switch codes', () => {
    const c = commandToTuya({ deviceId: 'x', capability: 'OnOff', payload: { on: true } })
    expect(c!.commands).toEqual(expect.arrayContaining([{ code: 'switch_led', value: true }, { code: 'switch_1', value: true }]))
  })

  it('Brightness scales 0–100 % to Tuya 0–1000', () => {
    const c = commandToTuya({ deviceId: 'x', capability: 'Brightness', payload: { percent: 50 } })
    expect(c!.commands).toEqual([{ code: 'bright_value_v2', value: 500 }])
  })

  it('ColorTemperature clamps into Tuya 0–1000', () => {
    const warm = commandToTuya({ deviceId: 'x', capability: 'ColorTemperature', payload: { kelvin: 2700 } })
    const cold = commandToTuya({ deviceId: 'x', capability: 'ColorTemperature', payload: { kelvin: 6500 } })
    expect(warm!.commands[0].value).toBe(0)
    expect(cold!.commands[0].value).toBe(1000)
  })

  it('Vacuum start/pause/return map to the canonical DPs; read-only kinds return null', () => {
    expect(commandToTuya({ deviceId: 'x', capability: 'Vacuum', payload: { activity: 'cleaning' } })!.commands).toEqual([{ code: 'power_go', value: true }])
    expect(commandToTuya({ deviceId: 'x', capability: 'Vacuum', payload: { activity: 'idle' } })!.commands).toEqual([{ code: 'power_go', value: false }])
    expect(commandToTuya({ deviceId: 'x', capability: 'Vacuum', payload: { activity: 'returning' } })!.commands).toEqual([{ code: 'mode', value: 'chargego' }])
    expect(commandToTuya({ deviceId: 'x', capability: 'Vacuum', payload: { activity: 'docked' } })!.commands).toEqual([{ code: 'mode', value: 'chargego' }])
    expect(commandToTuya({ deviceId: 'x', capability: 'Temperature', payload: { celsius: 20 } })).toBeNull()
  })
})
