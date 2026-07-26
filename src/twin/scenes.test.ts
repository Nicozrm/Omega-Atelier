import { describe, it, expect } from 'vitest'
import { sceneCommandsForDevice, sceneCommands, sunAdaptiveLight, totalEnergyW } from './scenes'
import type { Device } from '@/domain'
import { deriveEnvironment } from '@/lib/environment'

const dev = (id: string, category: Device['category'], caps: Device['capabilities']): Device => ({
  id, connectorId: 'x', category, name: id, capabilities: caps, health: { reachability: 'online' },
})

const dimmableLight = (id: string) => dev(id, 'light', [
  { kind: 'OnOff', access: 'readWrite', on: true },
  { kind: 'Brightness', access: 'readWrite', percent: 80 },
  { kind: 'ColorTemperature', access: 'readWrite', kelvin: 2700, minKelvin: 2200, maxKelvin: 6500 },
])

describe('sceneCommandsForDevice', () => {
  it('dims a light for Film (from the shared mode table)', () => {
    const cmds = sceneCommandsForDevice(dimmableLight('l1'), 'film')
    expect(cmds).toEqual([
      { deviceId: 'l1', capability: 'OnOff', payload: { on: true } },
      { deviceId: 'l1', capability: 'Brightness', payload: { percent: 15 } },
      { deviceId: 'l1', capability: 'ColorTemperature', payload: { kelvin: 2200 } },
    ])
  })

  it('closes a cover (domain cover → plan blind) for Film', () => {
    const cover = dev('c1', 'cover', [{ kind: 'Position', access: 'readWrite', percent: 60 }])
    expect(sceneCommandsForDevice(cover, 'film')).toEqual([
      { deviceId: 'c1', capability: 'Position', payload: { percent: 0 } },
    ])
  })

  it('locks for Night and turns an energy switch off for Away', () => {
    const lock = dev('k1', 'lock', [{ kind: 'Lock', access: 'readWrite', locked: false }])
    expect(sceneCommandsForDevice(lock, 'night')).toEqual([
      { deviceId: 'k1', capability: 'Lock', payload: { locked: true } },
    ])
    const plug = dev('p1', 'energy', [{ kind: 'OnOff', access: 'readWrite', on: true }, { kind: 'Energy', access: 'read', watts: 42 }])
    expect(sceneCommandsForDevice(plug, 'away')).toEqual([
      { deviceId: 'p1', capability: 'OnOff', payload: { on: false } },
    ])
  })

  it('never commands read-only capabilities', () => {
    const sensor = dev('s1', 'sensor', [{ kind: 'Temperature', access: 'read', celsius: 21 }, { kind: 'Motion', access: 'read', detected: false }])
    expect(sceneCommandsForDevice(sensor, 'film')).toEqual([])
  })
})

describe('sunAdaptiveLight + auto scene', () => {
  it('turns auto lights off in daylight and on after dark', () => {
    const day = deriveEnvironment({ timeOfDay: 12 })
    const night = deriveEnvironment({ timeOfDay: 1 })
    expect(sunAdaptiveLight(day)).toMatchObject({ on: false })
    expect(sunAdaptiveLight(night)).toMatchObject({ on: true })

    const lightDay = sceneCommandsForDevice(dimmableLight('l'), 'auto', day)
    expect(lightDay.find((c) => c.capability === 'OnOff')?.payload).toEqual({ on: false })

    const lightNight = sceneCommandsForDevice(dimmableLight('l'), 'auto', night)
    expect(lightNight.find((c) => c.capability === 'OnOff')?.payload).toEqual({ on: true })
  })
})

describe('sceneCommands + totalEnergyW', () => {
  it('fans out across a mixed device set', () => {
    const devices = [dimmableLight('l1'), dev('k1', 'lock', [{ kind: 'Lock', access: 'readWrite', locked: false }])]
    const cmds = sceneCommands(devices, 'away')
    // light off (no brightness/kelvin written when off has no values), lock locked
    expect(cmds.some((c) => c.deviceId === 'l1' && c.capability === 'OnOff')).toBe(true)
    expect(cmds.some((c) => c.deviceId === 'k1' && c.capability === 'Lock')).toBe(true)
  })

  it('sums live energy', () => {
    const devices = [
      dev('a', 'energy', [{ kind: 'Energy', access: 'read', watts: 42 }]),
      dev('b', 'energy', [{ kind: 'Energy', access: 'read', watts: 8 }]),
      dev('c', 'light', [{ kind: 'OnOff', access: 'readWrite', on: true }]),
    ]
    expect(totalEnergyW(devices)).toBe(50)
  })
})
