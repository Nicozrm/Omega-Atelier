import { describe, it, expect, vi } from 'vitest'
import { TwinManager, type ConnectorDescriptor } from './twinManager'
import type { Connector, ConnectorHealth, Device, DeviceCommand, Unsubscribe } from '@/domain'

/**
 * The lifecycle bug behind "connected, and nothing works".
 *
 * `addConnector` drove connect() and discover() inside one try/catch, so a
 * connector that authenticated and then failed to enumerate devices ended up
 * half-registered: present in the manager, absent from the runtime, never
 * subscribed, unable to recover — and `removeConnector` skipped its
 * `disconnect()` because the runtime did not know it either.
 *
 * Both failures are now distinct states, and both are recoverable.
 */

const device = (id: string, connectorId: string): Device => ({
  id, connectorId, category: 'light', name: id,
  capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
  health: { reachability: 'online' },
})

interface FakeOptions {
  id?: string
  failConnect?: string
  failDiscover?: string
  devices?: Device[]
}

/** A connector whose two phases can fail independently, and that records both. */
function fakeConnector(opts: FakeOptions = {}) {
  const id = opts.id ?? 'fake'
  const calls = { connect: 0, discover: 0, synchronize: 0, disconnect: 0, subscribe: 0 }
  let health: ConnectorHealth = { status: 'disconnected' }
  let devices = opts.devices ?? [device('d1', id)]
  let listener: ((h: ConnectorHealth) => void) | undefined

  const connector: Connector = {
    info: { id, label: id },
    async connect() {
      calls.connect++
      if (opts.failConnect) {
        health = { status: 'error', message: opts.failConnect }
        listener?.(health)
        throw new Error(opts.failConnect)
      }
      health = { status: 'connected' }
      listener?.(health)
    },
    async disconnect() {
      calls.disconnect++
      health = { status: 'disconnected' }
    },
    async discover() {
      calls.discover++
      if (opts.failDiscover) throw new Error(opts.failDiscover)
      return devices
    },
    async synchronize() {
      calls.synchronize++
      if (opts.failDiscover) throw new Error(opts.failDiscover)
      return devices
    },
    subscribe(): Unsubscribe {
      calls.subscribe++
      return () => {}
    },
    async publish(_cmd: DeviceCommand) { /* accepted */ },
    health: () => health,
    onStatus(next): Unsubscribe {
      listener = next
      return () => { listener = undefined }
    },
  }

  return {
    calls,
    connector,
    /** Change what the next discovery returns — drives the re-check tests. */
    setDevices(next: Device[]) { devices = next },
    clearDiscoverFailure() { opts.failDiscover = undefined },
    descriptor: { label: id, kind: 'fake', make: () => connector } satisfies ConnectorDescriptor,
  }
}

describe('addConnector — authentication and discovery fail separately', () => {
  it('records a successful discovery with its count', async () => {
    const fake = fakeConnector()
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)

    const session = manager.view().sessions.find((s) => s.id === 'fake')!
    expect(session.health.status).toBe('connected')
    expect(session.discovery).toMatchObject({ phase: 'ok', count: 1 })
    expect(manager.view().devices).toHaveLength(1)
  })

  it('keeps an authenticated connector live when discovery fails', async () => {
    const fake = fakeConnector({ failDiscover: 'Geräteliste abgelehnt' })
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)

    const session = manager.view().sessions.find((s) => s.id === 'fake')!
    // The transport is genuinely up; only the listing failed.
    expect(session.health.status).toBe('connected')
    expect(session.discovery).toMatchObject({ phase: 'failed', error: 'Geräteliste abgelehnt' })
    // The regression: it was adopted, so it is subscribed and can recover.
    expect(manager.isActive('fake')).toBe(true)
    expect(fake.calls.subscribe).toBe(1)
  })

  it('a discovery failure is recoverable by re-checking, with no new credentials', async () => {
    const fake = fakeConnector({ failDiscover: 'Geräteliste abgelehnt' })
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)
    expect(manager.view().devices).toHaveLength(0)

    fake.clearDiscoverFailure()
    await manager.refreshConnector('fake')

    expect(manager.view().sessions[0].discovery).toMatchObject({ phase: 'ok', count: 1 })
    expect(manager.view().devices).toHaveLength(1)
    // No second handshake — the session was valid the whole time.
    expect(fake.calls.connect).toBe(1)
  })

  it('rolls a failed handshake back so a retry is possible', async () => {
    const fake = fakeConnector({ failConnect: 'Token abgelehnt' })
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)

    const session = manager.view().sessions.find((s) => s.id === 'fake')!
    expect(session.health.status).toBe('error')
    expect(session.health.message).toBe('Token abgelehnt')
    // Not registered: the guard in addConnector must not swallow the retry…
    expect(manager.isActive('fake')).toBe(false)
    // …and the connector was released rather than left holding a transport.
    expect(fake.calls.disconnect).toBe(1)
    expect(fake.calls.discover).toBe(0)
  })

  it('a session left by a failed handshake can still be dismissed', async () => {
    const fake = fakeConnector({ failConnect: 'Token abgelehnt' })
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)
    // Previously a no-op, leaving the card stuck in an error nobody could clear.
    await manager.removeConnector('fake')
    expect(manager.view().sessions).toHaveLength(0)
  })

  it('a second connect after a failed handshake actually reconnects', async () => {
    const failing = fakeConnector({ id: 'retry', failConnect: 'Token abgelehnt' })
    const manager = new TwinManager()
    await manager.addConnector(failing.descriptor)

    const working = fakeConnector({ id: 'retry', devices: [device('d1', 'retry')] })
    await manager.addConnector(working.descriptor)

    expect(working.calls.connect).toBe(1)
    expect(manager.view().sessions.find((s) => s.id === 'retry')!.health.status).toBe('connected')
    expect(manager.view().devices).toHaveLength(1)
  })
})

describe('refreshConnector — the "Prüfen" action', () => {
  it('re-reads devices from the connector rather than reusing the view', async () => {
    const fake = fakeConnector()
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)

    fake.setDevices([device('d1', 'fake'), device('d2', 'fake')])
    await manager.refreshConnector('fake')

    expect(fake.calls.synchronize).toBe(1)
    expect(manager.view().devices.map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(manager.view().sessions[0].discovery.count).toBe(2)
  })

  it('drops devices the source no longer reports', async () => {
    const fake = fakeConnector({ devices: [device('d1', 'fake'), device('d2', 'fake')] })
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)
    expect(manager.view().devices).toHaveLength(2)

    fake.setDevices([device('d1', 'fake')])
    await manager.refreshConnector('fake')
    expect(manager.view().devices.map((d) => d.id)).toEqual(['d1'])
  })

  it('leaves other connectors untouched', async () => {
    const a = fakeConnector({ id: 'a', devices: [device('a1', 'a')] })
    const b = fakeConnector({ id: 'b', devices: [device('b1', 'b')] })
    const manager = new TwinManager()
    await manager.addConnector(a.descriptor)
    await manager.addConnector(b.descriptor)

    a.setDevices([])
    await manager.refreshConnector('a')

    expect(manager.view().devices.map((d) => d.id)).toEqual(['b1'])
    expect(b.calls.synchronize).toBe(0)
  })

  it('records a failed re-check without tearing the session down', async () => {
    const fake = fakeConnector()
    const manager = new TwinManager()
    await manager.addConnector(fake.descriptor)

    // The live connector starts failing its listing mid-session.
    vi.spyOn(fake.connector, 'synchronize').mockRejectedValue(new Error('Netzwerkfehler'))

    await manager.refreshConnector('fake')
    const session = manager.view().sessions.find((s) => s.id === 'fake')!
    expect(session.discovery).toMatchObject({ phase: 'failed', error: 'Netzwerkfehler' })
    expect(session.health.status).toBe('connected')
  })

  it('is a no-op for a connector that is not live', async () => {
    const manager = new TwinManager()
    await expect(manager.refreshConnector('nothing')).resolves.toBeUndefined()
  })
})
