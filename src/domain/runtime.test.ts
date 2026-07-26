import { describe, it, expect } from 'vitest'
import {
  DigitalTwinRuntime,
  type Capability, type Connector, type ConnectorHealth, type Device,
  type DeviceCommand, type DeviceUpdate, type Unsubscribe,
} from './index'

function device(id: string, connectorId: string, caps: Capability[] = [], roomId?: string): Device {
  return { id, connectorId, roomId, category: 'light', name: id, capabilities: caps, health: { reachability: 'online' } }
}

/**
 * A fake ecosystem, added to the runtime *solely* by implementing the Connector
 * contract — the runtime/core is never modified. This is exactly how a real
 * Matter / Home Assistant / SwitchBot integration would plug in.
 */
class FakeConnector implements Connector {
  readonly info = { id: 'fake-eco', label: 'Fake Ecosystem' }
  published: DeviceCommand[] = []
  private cb?: (u: DeviceUpdate) => void
  async discover(): Promise<Device[]> { return [device('eco-1', 'fake-eco', [{ kind: 'OnOff', access: 'readWrite', on: false }])] }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async synchronize(): Promise<Device[]> { return this.discover() }
  subscribe(onUpdate: (u: DeviceUpdate) => void): Unsubscribe { this.cb = onUpdate; return () => { this.cb = undefined } }
  async publish(cmd: DeviceCommand): Promise<void> { this.published.push(cmd) }
  health(): ConnectorHealth { return { status: 'connected' } }
  push(u: DeviceUpdate) { this.cb?.(u) }
}

describe('DigitalTwinRuntime — registry & queries', () => {
  it('stores, lists and queries devices', () => {
    const rt = new DigitalTwinRuntime()
    rt.setDevices([
      device('a', 'c1', [{ kind: 'OnOff', access: 'readWrite', on: true }], 'room-1'),
      device('b', 'c1', [{ kind: 'Lock', access: 'readWrite', locked: true }], 'room-2'),
    ])
    expect(rt.listDevices().length).toBe(2)
    expect(rt.getDevice('a')?.id).toBe('a')
    expect(rt.devicesInRoom('room-1').map((d) => d.id)).toEqual(['a'])
    expect(rt.devicesWith('Lock').map((d) => d.id)).toEqual(['b'])
  })

  it('notifies subscribers on change', () => {
    const rt = new DigitalTwinRuntime()
    let count = 0
    const unsub = rt.subscribe(() => { count++ })
    rt.setDevices([device('a', 'c1')])
    rt.upsertDevice(device('b', 'c1'))
    unsub()
    rt.upsertDevice(device('c', 'c1'))
    expect(count).toBe(2)
  })

  it('merges connector updates into a device', () => {
    const rt = new DigitalTwinRuntime()
    rt.setDevices([device('a', 'c1', [{ kind: 'OnOff', access: 'readWrite', on: false }])])
    rt.applyUpdate({
      deviceId: 'a',
      capabilities: [{ kind: 'OnOff', access: 'readWrite', on: true }],
      health: { reachability: 'offline' },
      battery: { percent: 42 },
    })
    const d = rt.getDevice('a')!
    expect(d.capabilities.find((c) => c.kind === 'OnOff')).toMatchObject({ on: true })
    expect(d.health.reachability).toBe('offline')
    expect(d.battery?.percent).toBe(42)
  })
})

describe('DigitalTwinRuntime — connector lifecycle', () => {
  it('adopts a connector\'s devices and streams its updates', async () => {
    const rt = new DigitalTwinRuntime()
    const eco = new FakeConnector()
    await rt.registerConnector(eco)
    expect(rt.getDevice('eco-1')?.capabilities[0]).toMatchObject({ on: false })

    eco.push({ deviceId: 'eco-1', capabilities: [{ kind: 'OnOff', access: 'readWrite', on: true }] })
    expect(rt.getDevice('eco-1')?.capabilities[0]).toMatchObject({ on: true })
  })

  it('routes commands to the owning connector', async () => {
    const rt = new DigitalTwinRuntime()
    const eco = new FakeConnector()
    await rt.registerConnector(eco)
    await rt.command({ deviceId: 'eco-1', capability: 'OnOff', payload: { on: true } })
    expect(eco.published).toHaveLength(1)
    expect(eco.published[0]).toMatchObject({ deviceId: 'eco-1', capability: 'OnOff' })
  })

  it('drops devices and stops streaming when a connector is removed', async () => {
    const rt = new DigitalTwinRuntime()
    const eco = new FakeConnector()
    await rt.registerConnector(eco)
    await rt.removeConnector('fake-eco')
    expect(rt.getDevice('eco-1')).toBeUndefined()
    // updates after removal are ignored (unsubscribed)
    eco.push({ deviceId: 'eco-1', capabilities: [{ kind: 'OnOff', access: 'readWrite', on: true }] })
    expect(rt.getDevice('eco-1')).toBeUndefined()
  })
})
