import { describe, it, expect } from 'vitest'
import {
  DigitalTwinRuntime,
  type Connector, type ConnectorHealth, type ConnectorStatus, type ConnectorStatusEvent,
  type Device, type DeviceCommand, type DeviceUpdate, type Unsubscribe,
} from './index'

/** A controllable connector that pushes status and deliberately mis-stamps its
 *  device's connectorId — to prove the runtime stamps it correctly. */
class StatusFakeConnector implements Connector {
  readonly info = { id: 'sf', label: 'SF' }
  published: DeviceCommand[] = []
  private statusCb?: (h: ConnectorHealth) => void
  private updateCb?: (u: DeviceUpdate) => void
  private current: ConnectorStatus = 'disconnected'

  async discover(): Promise<Device[]> {
    return [{
      id: 'd1', connectorId: 'WRONG-ID', category: 'light', name: 'x',
      capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
      health: { reachability: 'online' },
    }]
  }
  async connect(): Promise<void> { this.set('connected') }
  async disconnect(): Promise<void> { this.set('disconnected') }
  async synchronize(): Promise<Device[]> { return this.discover() }
  subscribe(cb: (u: DeviceUpdate) => void): Unsubscribe { this.updateCb = cb; return () => { this.updateCb = undefined } }
  async publish(cmd: DeviceCommand): Promise<void> { this.published.push(cmd) }
  health(): ConnectorHealth { return { status: this.current } }
  onStatus(cb: (h: ConnectorHealth) => void): Unsubscribe { this.statusCb = cb; return () => { this.statusCb = undefined } }
  pushUpdate(u: DeviceUpdate) { this.updateCb?.(u) }
  private set(s: ConnectorStatus) { this.current = s; this.statusCb?.({ status: s }) }
}

describe('runtime — auto-stamps connectorId', () => {
  it('stamps the owning connector id and routes commands despite a wrong id from the connector', async () => {
    const rt = new DigitalTwinRuntime()
    const c = new StatusFakeConnector()
    await rt.registerConnector(c)
    // device arrived with connectorId 'WRONG-ID' but the runtime corrected it
    expect(rt.getDevice('d1')?.connectorId).toBe('sf')
    await rt.command({ deviceId: 'd1', capability: 'OnOff', payload: { on: true } })
    expect(c.published).toHaveLength(1)
  })
})

describe('runtime — connector status channel (pushed)', () => {
  it('forwards connector status events to subscribers', async () => {
    const rt = new DigitalTwinRuntime()
    const events: ConnectorStatusEvent[] = []
    rt.subscribeStatus((e) => events.push(e))
    await rt.registerConnector(new StatusFakeConnector())
    expect(events.some((e) => e.connectorId === 'sf' && e.health.status === 'connected')).toBe(true)
  })

  it('emits a disconnected event and stops forwarding after removal', async () => {
    const rt = new DigitalTwinRuntime()
    const c = new StatusFakeConnector()
    const events: ConnectorStatusEvent[] = []
    rt.subscribeStatus((e) => events.push(e))
    await rt.registerConnector(c)
    await rt.removeConnector('sf')
    expect(events.some((e) => e.health.status === 'disconnected')).toBe(true)

    const before = events.length
    await c.connect() // connector pushes 'connected', but runtime is unsubscribed
    expect(events.length).toBe(before)
  })
})

describe('runtime — adoptConnector (already connected)', () => {
  it('adopts an already-connected connector without re-connecting and streams updates', async () => {
    const c = new StatusFakeConnector()
    await c.connect()
    const devices = await c.discover()
    const rt = new DigitalTwinRuntime()
    rt.adoptConnector(c, devices)

    expect(rt.listDevices().length).toBe(1)
    expect(rt.getDevice('d1')?.connectorId).toBe('sf') // stamped here too

    c.pushUpdate({ deviceId: 'd1', capabilities: [{ kind: 'OnOff', access: 'readWrite', on: true }] })
    expect(rt.getDevice('d1')?.capabilities.find((x) => x.kind === 'OnOff')).toMatchObject({ on: true })
  })
})
