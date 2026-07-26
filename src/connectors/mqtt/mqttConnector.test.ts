import { describe, it, expect } from 'vitest'
import { DigitalTwinRuntime, type ConnectorStatusEvent, type DeviceUpdate } from '@/domain'
import { createMqttConnector } from './mqttConnector'
import { SimulatedMqttBroker } from './simulatedBroker'
import { topicMatches } from './transport'
import { parseHomieDevices } from './mapping'
import { findCapability } from '@/domain'

const flush = () => new Promise((r) => setTimeout(r, 0))

function connector() {
  const transport = new SimulatedMqttBroker({ liveMs: 0 })
  return { transport, c: createMqttConnector({ transport }) }
}

describe('MQTT topic-filter matching', () => {
  it('matches single- and multi-level wildcards', () => {
    expect(topicMatches('homie/+/$name', 'homie/lamp/$name')).toBe(true)
    expect(topicMatches('homie/+/$name', 'homie/lamp/light/power')).toBe(false)
    expect(topicMatches('homie/#', 'homie/lamp/light/power/$datatype')).toBe(true)
    expect(topicMatches('homie/lamp/#', 'homie/other/x')).toBe(false)
  })
})

describe('Homie → capability mapping (schemaless, datatype-driven)', () => {
  it('derives a light and disambiguates boolean power vs float watts by datatype', () => {
    const t = new Map<string, string>([
      ['homie/p/$name', 'Plug'],
      ['homie/p/switch/power', 'true'], ['homie/p/switch/power/$datatype', 'boolean'], ['homie/p/switch/power/$settable', 'true'],
      ['homie/p/switch/watts', '42'], ['homie/p/switch/watts/$datatype', 'float'], ['homie/p/switch/watts/$unit', 'W'],
    ])
    const { devices } = parseHomieDevices(t, 'mqtt')
    const d = devices[0]
    expect(findCapability(d.capabilities, 'OnOff')?.on).toBe(true) // boolean power
    expect(findCapability(d.capabilities, 'Energy')?.watts).toBe(42) // float watts
    expect(d.connectorId).toBe('mqtt')
    expect('topic' in d).toBe(false)
  })
})

describe('MQTT connector — contract end-to-end', () => {
  it('connects and pushes status transitions', async () => {
    const { c } = connector()
    expect(c.onStatus).toBeDefined()
    const statuses: string[] = []
    c.onStatus?.((h) => statuses.push(h.status))
    await c.connect()
    expect(statuses).toContain('connecting')
    expect(statuses).toContain('connected')
    await c.disconnect()
    expect(statuses).toContain('disconnected')
  })

  it('discovers neutral devices from retained topics', async () => {
    const { c } = connector()
    await c.connect()
    const devices = await c.discover()
    expect(devices.length).toBeGreaterThanOrEqual(6)
    const light = devices.find((d) => d.category === 'light')!
    expect(light.capabilities.some((x) => x.kind === 'Brightness')).toBe(true)
    expect(light.capabilities.some((x) => x.kind === 'ColorTemperature')).toBe(true)
    expect(devices.some((d) => d.category === 'lock')).toBe(true)
    expect(devices.some((d) => d.category === 'sensor')).toBe(true)
  })

  it('streams live updates and reflects published commands', async () => {
    const { transport, c } = connector()
    await c.connect()
    await c.discover()
    const updates: DeviceUpdate[] = []
    c.subscribe((u) => updates.push(u))
    transport.tick()
    await flush()
    expect(updates.length).toBeGreaterThanOrEqual(1)

    await c.publish({ deviceId: 'steckdose-tv', capability: 'OnOff', payload: { on: false } })
    await flush()
    const u = updates.find((x) => x.deviceId === 'steckdose-tv')
    expect(u?.capabilities?.find((x) => x.kind === 'OnOff')).toMatchObject({ on: false })
  })
})

describe('Runtime adoption — second connector, hardened contract', () => {
  it('forwards status, adopts devices and routes commands without knowing MQTT', async () => {
    const rt = new DigitalTwinRuntime()
    const events: ConnectorStatusEvent[] = []
    rt.subscribeStatus((e) => events.push(e))
    const { c } = connector()
    await rt.registerConnector(c)

    expect(events.some((e) => e.connectorId === 'mqtt' && e.health.status === 'connected')).toBe(true)
    expect(rt.listDevices().length).toBeGreaterThanOrEqual(6)
    expect(rt.devicesWith('Energy').length).toBeGreaterThanOrEqual(1)

    await rt.command({ deviceId: 'steckdose-tv', capability: 'OnOff', payload: { on: false } })
    await flush()
    expect(findCapability(rt.getDevice('steckdose-tv')!.capabilities, 'OnOff')).toMatchObject({ on: false })
    // Off ⇒ the plug reports ~0 W, so an energy-saving scene visibly lowers the total.
    expect(findCapability(rt.getDevice('steckdose-tv')!.capabilities, 'Energy')).toMatchObject({ watts: 0 })
  })
})
