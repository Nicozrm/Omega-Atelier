import { describe, it, expect } from 'vitest'
import { parseVoiceCommand, knownRooms } from './voiceCommands'
import type { Capability, Device } from '@/domain'

const dev = (id: string, category: Device['category'], caps: Capability[], room?: string): Device => ({
  id, connectorId: 'x', category, name: id, capabilities: caps,
  health: { reachability: 'online' }, ...(room ? { metadata: { room } } : {}),
})

const onoff = (on = false): Capability => ({ kind: 'OnOff', access: 'readWrite', on })
const dim = (percent = 60): Capability => ({ kind: 'Brightness', access: 'readWrite', percent })
const ct = (kelvin = 3000): Capability => ({ kind: 'ColorTemperature', access: 'readWrite', kelvin, minKelvin: 2200, maxKelvin: 6500 })
const pos = (): Capability => ({ kind: 'Position', access: 'readWrite', percent: 100 })
const lock = (): Capability => ({ kind: 'Lock', access: 'readWrite', locked: false })
const vac = (): Capability => ({ kind: 'Vacuum', access: 'readWrite', activity: 'docked' })

const fleet: Device[] = [
  dev('light-wz', 'light', [onoff(true), dim(60), ct(3000)], 'Wohnzimmer'),
  dev('light-kü', 'light', [onoff(true), dim(60), ct(3000)], 'Küche'),
  dev('plug-tv', 'energy', [onoff(true)], 'Wohnzimmer'),
  dev('rollo-wz', 'cover', [pos()], 'Wohnzimmer'),
  dev('lock-haus', 'lock', [lock()], 'Flur'),
  dev('robo', 'appliance', [vac()], 'Wohnzimmer'),
]

describe('parseVoiceCommand — on/off', () => {
  it('turns a specific room light off', () => {
    const r = parseVoiceCommand('Licht Wohnzimmer aus', fleet)!
    expect(r.commands).toEqual([{ deviceId: 'light-wz', capability: 'OnOff', payload: { on: false } }])
    expect(r.reply).toMatch(/ausgeschaltet/)
  })

  it('turns a room light on', () => {
    const r = parseVoiceCommand('mach das Licht in der Küche an', fleet)!
    expect(r.commands).toEqual([{ deviceId: 'light-kü', capability: 'OnOff', payload: { on: true } }])
  })

  it('"alle Lichter aus" hits every light but not the plug', () => {
    const r = parseVoiceCommand('alle Lichter aus', fleet)!
    expect(r.commands.map((c) => c.deviceId).sort()).toEqual(['light-kü', 'light-wz'])
    expect(r.commands.every((c) => c.payload.on === false)).toBe(true)
  })

  it('"alles aus" hits every switchable device (lights + plug)', () => {
    const r = parseVoiceCommand('alles aus', fleet)!
    expect(r.commands.map((c) => c.deviceId).sort()).toEqual(['light-kü', 'light-wz', 'plug-tv'])
  })

  it('scopes to a room across device types with "alles"', () => {
    const r = parseVoiceCommand('alles im Wohnzimmer aus', fleet)!
    // Wohnzimmer switchables: light-wz + plug-tv (robo has no OnOff)
    expect(r.commands.map((c) => c.deviceId).sort()).toEqual(['light-wz', 'plug-tv'])
  })
})

describe('parseVoiceCommand — covers, locks, brightness', () => {
  it('closes the blinds', () => {
    const r = parseVoiceCommand('Rollo runter', fleet)!
    expect(r.commands).toEqual([{ deviceId: 'rollo-wz', capability: 'Position', payload: { percent: 0 } }])
  })
  it('opens the blinds', () => {
    const r = parseVoiceCommand('Rollo hoch', fleet)!
    expect(r.commands[0].payload.percent).toBe(100)
  })
  it('locks and unlocks the door', () => {
    expect(parseVoiceCommand('Haustür abschließen', fleet)!.commands[0]).toMatchObject({ capability: 'Lock', payload: { locked: true } })
    expect(parseVoiceCommand('Tür aufschließen', fleet)!.commands[0]).toMatchObject({ capability: 'Lock', payload: { locked: false } })
  })
  it('sets brightness to a percentage', () => {
    const r = parseVoiceCommand('Licht Küche auf 40 Prozent', fleet)!
    expect(r.commands).toEqual([{ deviceId: 'light-kü', capability: 'Brightness', payload: { percent: 40 } }])
  })
  it('moves a blind to a specific percent', () => {
    const r = parseVoiceCommand('Rollo auf 30 Prozent', fleet)!
    expect(r.commands).toEqual([{ deviceId: 'rollo-wz', capability: 'Position', payload: { percent: 30 } }])
  })
})

describe('parseVoiceCommand — relative brightness & colour temperature', () => {
  it('brightens a room light by a step from its current level', () => {
    const r = parseVoiceCommand('Licht Wohnzimmer heller', fleet)!
    // light-wz starts at 60 → +25 = 85
    expect(r.commands).toEqual([{ deviceId: 'light-wz', capability: 'Brightness', payload: { percent: 85 } }])
    expect(r.reply).toMatch(/heller/)
  })
  it('dims and clamps at 0', () => {
    const dark: Device[] = [dev('l', 'light', [onoff(true), dim(10)], 'Bad')]
    const r = parseVoiceCommand('dunkler', dark)!
    expect(r.commands[0].payload).toEqual({ percent: 0 }) // 10 - 25 clamped
  })
  it('does not treat an absolute "auf 40 prozent" as relative', () => {
    const r = parseVoiceCommand('Licht Küche auf 40 Prozent', fleet)!
    expect(r.commands[0].payload).toEqual({ percent: 40 })
  })
  it('makes a room light warmer (lower kelvin, clamped to min)', () => {
    const r = parseVoiceCommand('Licht Küche wärmer', fleet)!
    // 3000 - 800 = 2200 (== min)
    expect(r.commands).toEqual([{ deviceId: 'light-kü', capability: 'ColorTemperature', payload: { kelvin: 2200 } }])
  })
  it('makes lights cooler (higher kelvin)', () => {
    const r = parseVoiceCommand('alle Lichter kälter', fleet)!
    expect(r.commands.map((c) => c.deviceId).sort()).toEqual(['light-kü', 'light-wz'])
    expect(r.commands.every((c) => c.capability === 'ColorTemperature' && (c.payload as { kelvin: number }).kelvin === 3800)).toBe(true)
  })
})

describe('parseVoiceCommand — vacuum', () => {
  it('starts, pauses and docks the robot', () => {
    expect(parseVoiceCommand('Saugroboter starten', fleet)!.commands[0]).toMatchObject({ capability: 'Vacuum', payload: { activity: 'cleaning' } })
    expect(parseVoiceCommand('Sauger stopp', fleet)!.commands[0]).toMatchObject({ payload: { activity: 'idle' } })
    expect(parseVoiceCommand('Roboter zur Station', fleet)!.commands[0]).toMatchObject({ payload: { activity: 'returning' } })
  })
})

describe('parseVoiceCommand — robustness', () => {
  it('returns null for gibberish or empty input', () => {
    expect(parseVoiceCommand('', fleet)).toBeNull()
    expect(parseVoiceCommand('wie ist das wetter', fleet)).toBeNull()
  })
  it('knownRooms lists the distinct rooms', () => {
    expect(knownRooms(fleet).sort()).toEqual(['Flur', 'Küche', 'Wohnzimmer'])
  })
})
