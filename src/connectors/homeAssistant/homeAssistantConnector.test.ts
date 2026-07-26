import { describe, it, expect } from 'vitest'
import { DigitalTwinRuntime, type DeviceUpdate } from '@/domain'
import { createHomeAssistantConnector } from './homeAssistantConnector'
import { SimulatedHaTransport } from './simulatedTransport'

/** Flush queued microtasks + the simulator's async delivery. */
const flush = () => new Promise((r) => setTimeout(r, 0))

function connector() {
  // liveMs: 0 ⇒ deterministic (no autonomous timer); we drive ticks manually.
  const transport = new SimulatedHaTransport({ liveMs: 0 })
  return { transport, c: createHomeAssistantConnector({ transport }) }
}

describe('Home Assistant connector — contract end-to-end', () => {
  it('connects through the auth handshake', async () => {
    const { c } = connector()
    await c.connect()
    expect(c.health().status).toBe('connected')
    expect(c.health().lastSync).toBeTruthy()
  })

  it('pushes connector status transitions through onStatus', async () => {
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

  it('discovers neutral devices with mapped capabilities', async () => {
    const { c } = connector()
    await c.connect()
    const devices = await c.discover()
    expect(devices.length).toBeGreaterThanOrEqual(8)
    const light = devices.find((d) => d.category === 'light')!
    expect(light.capabilities.some((x) => x.kind === 'Brightness')).toBe(true)
    expect(devices.some((d) => d.category === 'lock')).toBe(true)
    expect(devices.some((d) => d.category === 'sensor')).toBe(true)
    // the connector stamps its own id so the runtime can route back
    expect(light.connectorId).toBe('home-assistant')
  })

  it('streams live capability updates through subscribe', async () => {
    const { transport, c } = connector()
    await c.connect()
    const updates: DeviceUpdate[] = []
    c.subscribe((u) => updates.push(u))
    await flush()
    transport.tick() // one autonomous state change
    await flush()
    expect(updates.length).toBeGreaterThanOrEqual(1)
    expect(updates[0].capabilities?.length).toBeGreaterThanOrEqual(1)
  })

  it('translates a neutral command into an HA service call and reflects it', async () => {
    const { c } = connector()
    await c.connect()
    const updates: DeviceUpdate[] = []
    c.subscribe((u) => updates.push(u))
    await flush()
    await c.publish({ deviceId: 'light.stehlampe', capability: 'OnOff', payload: { on: false } })
    await flush()
    const u = updates.find((x) => x.deviceId === 'light.stehlampe')
    expect(u?.capabilities?.find((x) => x.kind === 'OnOff')).toMatchObject({ on: false })
  })
})

describe('Runtime adoption — vendor stays hidden', () => {
  it('adopts the connector and reflects live updates without knowing the vendor', async () => {
    const { transport, c } = connector()
    const rt = new DigitalTwinRuntime()
    await rt.registerConnector(c)

    expect(rt.listDevices().length).toBeGreaterThanOrEqual(8)
    expect(rt.devicesWith('Temperature').length).toBeGreaterThanOrEqual(1)

    transport.tick()
    await flush()
    // runtime received and merged a streamed update
    expect(rt.listDevices().length).toBeGreaterThanOrEqual(8)
  })

  it('routes a command to the owning connector by connectorId', async () => {
    const { c } = connector()
    const rt = new DigitalTwinRuntime()
    await rt.registerConnector(c)
    const updates: DeviceUpdate[] = []
    c.subscribe((u) => updates.push(u))
    await flush()
    await rt.command({ deviceId: 'lock.haustuer', capability: 'Lock', payload: { locked: false } })
    await flush()
    const u = updates.find((x) => x.deviceId === 'lock.haustuer')
    expect(u?.capabilities?.find((x) => x.kind === 'Lock')).toMatchObject({ locked: false })
  })
})
