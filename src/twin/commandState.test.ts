import { describe, it, expect } from 'vitest'
import { TwinManager, commandKey } from './twinManager'
import type {
  Capability, Connector, ConnectorHealth, Device, DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'

const flush = () => new Promise((r) => setTimeout(r, 0))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A minimal connector whose confirmation behaviour is scripted:
 *  - 'confirm'  → publish emits the fresh capability (a real bridge's echo)
 *  - 'silent'   → publish succeeds but nothing ever confirms (command into the void)
 *  - 'reject'   → publish throws (transport down)
 */
function scriptedConnector(behaviour: 'confirm' | 'silent' | 'reject'): Connector {
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  const caps: Capability[] = [{ kind: 'OnOff', access: 'readWrite', on: false }]
  const device: Device = {
    id: 'lamp', connectorId: 'scripted', category: 'light', name: 'Lampe',
    capabilities: caps, health: { reachability: 'online' },
  }
  const health: ConnectorHealth = { status: 'connected' }
  return {
    info: { id: 'scripted', label: 'Scripted' },
    async connect() {},
    async disconnect() {},
    async discover() { return [device] },
    async synchronize() { return [device] },
    subscribe(h: (u: DeviceUpdate) => void): Unsubscribe {
      onUpdate = h
      return () => { onUpdate = undefined }
    },
    async publish(cmd: DeviceCommand) {
      if (behaviour === 'reject') throw new Error('transport down')
      if (behaviour === 'confirm') {
        onUpdate?.({ deviceId: cmd.deviceId, capabilities: [{ kind: 'OnOff', access: 'readWrite', on: Boolean(cmd.payload.on) }] })
      }
    },
    health() { return health },
  }
}

const descriptor = (behaviour: 'confirm' | 'silent' | 'reject') => ({
  label: 'Scripted', kind: 'scripted', make: () => scriptedConnector(behaviour),
})

const KEY = commandKey('lamp', 'OnOff')

describe('TwinManager — predictive command state', () => {
  it('confirmed commands leave no trace: pending appears, the device echo clears it', async () => {
    const m = new TwinManager()
    await m.addConnector(descriptor('confirm'))
    await flush()

    const seen: Array<string | undefined> = []
    m.subscribe((v) => seen.push(v.commands[KEY]))

    await m.command({ deviceId: 'lamp', capability: 'OnOff', payload: { on: true } })
    await flush()

    expect(seen).toContain('pending') // the mask was up while in flight…
    expect(m.view().commands[KEY]).toBeUndefined() // …and the echo dropped it
  })

  it('a command into the void times out into `failed`, then morphs back', async () => {
    const m = new TwinManager()
    await m.addConnector(descriptor('silent'))
    await flush()

    await m.command(
      { deviceId: 'lamp', capability: 'OnOff', payload: { on: true } },
      { timeoutMs: 20, failureHoldMs: 40 },
    )
    expect(m.view().commands[KEY]).toBe('pending')

    await wait(30)
    expect(m.view().commands[KEY]).toBe('failed')

    await wait(50)
    expect(m.view().commands[KEY]).toBeUndefined() // failure released after the hold
  })

  it('a transport rejection fails immediately and the promise still resolves', async () => {
    const m = new TwinManager()
    await m.addConnector(descriptor('reject'))
    await flush()

    await expect(
      m.command({ deviceId: 'lamp', capability: 'OnOff', payload: { on: true } }, { failureHoldMs: 40 }),
    ).resolves.toBeUndefined()
    expect(m.view().commands[KEY]).toBe('failed')
  })

  it('re-sending while failed re-arms the pending mask', async () => {
    const m = new TwinManager()
    await m.addConnector(descriptor('silent'))
    await flush()

    await m.command({ deviceId: 'lamp', capability: 'OnOff', payload: { on: true } }, { timeoutMs: 15, failureHoldMs: 5000 })
    await wait(25)
    expect(m.view().commands[KEY]).toBe('failed')

    await m.command({ deviceId: 'lamp', capability: 'OnOff', payload: { on: true } }, { timeoutMs: 5000 })
    expect(m.view().commands[KEY]).toBe('pending')
  })

  it('removing the connector clears its tracked commands', async () => {
    const m = new TwinManager()
    await m.addConnector(descriptor('silent'))
    await flush()

    await m.command({ deviceId: 'lamp', capability: 'OnOff', payload: { on: true } }, { timeoutMs: 5000 })
    expect(m.view().commands[KEY]).toBe('pending')

    await m.removeConnector('scripted')
    expect(m.view().commands[KEY]).toBeUndefined()
  })
})
