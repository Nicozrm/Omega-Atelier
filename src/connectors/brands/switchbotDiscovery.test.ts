import { describe, it, expect, vi } from 'vitest'
import { createSwitchBotClient, parseSwitchBotDevices, switchbotHttpError } from './switchbotClient'
import { createBrandConnector } from './brandConnector'
import { createGoveeClient } from './goveeClient'
import { TwinManager } from '@/twin/twinManager'
import { deriveIntegrationState } from '@/twin/integrationState'
import { findCapability } from '@/domain'

/**
 * SwitchBot: "verbunden" and no devices.
 *
 * The chain that has to hold, and that these tests walk end to end:
 *
 *   authentication → API request → real devices returned → normalised →
 *   stored in the twin → visible as `ready` with a device count
 *
 * plus every way it can break, each of which must produce a *distinguishable*
 * state rather than the one sentence the card used to print for all of them.
 */

/** A recorded `/v1.1/devices` answer, in SwitchBot's real envelope. */
const envelope = (deviceList: unknown[], infraredRemoteList: unknown[] = []) => ({
  statusCode: 100,
  message: 'success',
  body: { deviceList, infraredRemoteList },
})

const bot = (deviceId: string, deviceName: string, deviceType = 'Bot') => ({ deviceId, deviceName, deviceType })

/** Routes a fake fetch by URL and lets the test script each route's answer. */
function fakeFetch(handlers: Array<[RegExp, () => { status?: number; body: unknown }]>) {
  const calls: string[] = []
  const impl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    calls.push(href)
    const hit = handlers.find(([re]) => re.test(href))
    if (!hit) return new Response('{}', { status: 404 })
    const { status = 200, body } = hit[1]()
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const RELAY = 'https://project.supabase.co/functions/v1/vendor-relay/switchbot'

const client = (impl: typeof fetch) =>
  createSwitchBotClient({ token: 'token-value', secret: 'secret-value', baseUrl: RELAY, fetchImpl: impl, pollMs: 0 })

/* ── The envelope parser, against real response shapes ───────────────────── */

describe('parseSwitchBotDevices — the real response shape', () => {
  it('reads a populated deviceList', () => {
    const devices = parseSwitchBotDevices(envelope([bot('C1', 'Kaffee'), bot('C2', 'Rollo', 'Curtain3')]))
    expect(devices.map((d) => d.deviceId)).toEqual(['C1', 'C2'])
  })

  it('includes IR remotes behind a Hub, which live in a second array', () => {
    const devices = parseSwitchBotDevices(envelope([bot('C1', 'Bot')], [{ deviceId: 'IR1', deviceName: 'TV', remoteType: 'TV' }]))
    expect(devices).toHaveLength(2)
    expect(devices.find((d) => d.deviceId === 'IR1')?.infrared).toBe(true)
  })

  it('an empty account parses as empty, not as an error', () => {
    expect(parseSwitchBotDevices(envelope([]))).toEqual([])
  })

  it('throws on a rejected envelope even though HTTP said 200', () => {
    // SwitchBot answers 200 with the real outcome in `statusCode`.
    expect(() => parseSwitchBotDevices({ statusCode: 401, message: 'Unauthorized' })).toThrow(/Token und Secret/)
  })

  it('names a SwitchBot-side internal error as such', () => {
    expect(() => parseSwitchBotDevices({ statusCode: 190 })).toThrow(/190/)
  })
})

/* ── HTTP failures name the layer that refused ───────────────────────────── */

describe('switchbotHttpError — the errors that used to be swallowed', () => {
  it('identifies a relay deployed without --no-verify-jwt', () => {
    const msg = switchbotHttpError(401, { message: 'Missing authorization header' })
    expect(msg).toContain('--no-verify-jwt')
  })

  it('identifies a relay URL that is missing the function path', () => {
    expect(switchbotHttpError(404, { error: 'unknown vendor' })).toContain('vendor-relay')
  })

  it('passes the relay’s own upstream detail through', () => {
    const msg = switchbotHttpError(502, { error: 'upstream unreachable', detail: 'ETIMEDOUT' })
    expect(msg).toContain('ETIMEDOUT')
  })

  it('does not blame the credentials for a transport failure', () => {
    // The old code answered every status with "Token/Secret/Relay prüfen".
    expect(switchbotHttpError(502, { error: 'upstream unreachable' })).not.toMatch(/Token/)
  })
})

/* ── The full chain, through the connector ───────────────────────────────── */

describe('SwitchBot discovery — connector to twin', () => {
  it('one device: authenticated, listed, normalised, stored, rendered as ready', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ body: envelope([bot('C1', 'Kaffeemaschine')]) })],
      [/\/status$/, () => ({ body: { statusCode: 100, body: { power: 'on' } } })],
    ])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'SwitchBot Cloud',
      kind: 'switchbot',
      make: () => createBrandConnector({ id: 'switchbot-live', label: 'SwitchBot Cloud', client: client(impl) }),
    })

    const view = manager.view()
    const session = view.sessions.find((s) => s.id === 'switchbot-live')!
    expect(session.health.status).toBe('connected')
    expect(session.discovery).toMatchObject({ phase: 'ok', count: 1 })

    // Stored in the twin, stamped with the owning connector.
    const stored = view.devices.filter((d) => d.connectorId === 'switchbot-live')
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Kaffeemaschine')
    // Live status won over the type-derived default.
    expect(findCapability(stored[0].capabilities, 'OnOff')).toMatchObject({ on: true })

    // And the UI state the card renders from.
    const state = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices: stored })
    expect(state.phase).toBe('ready')
    expect(state.deviceCount).toBe(1)
  })

  it('several devices, including an IR remote behind a Hub', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({
        body: envelope(
          [bot('C1', 'Bot'), bot('C2', 'Vorhang', 'Curtain3'), bot('M1', 'Meter', 'Meter')],
          [{ deviceId: 'IR1', deviceName: 'Fernseher', remoteType: 'TV' }],
        ),
      })],
      [/\/status$/, () => ({ body: { statusCode: 100, body: { power: 'off' } } })],
    ])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'SwitchBot', kind: 'switchbot',
      make: () => createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) }),
    })
    const devices = manager.view().devices.filter((d) => d.connectorId === 'sb')
    expect(devices).toHaveLength(4)
    expect(devices.find((d) => d.id === 'IR1')?.metadata?.infrared).toBe('true')
  })

  it('zero devices: connected, but reported as no-devices — never as ready', async () => {
    const { impl } = fakeFetch([[/\/v1\.1\/devices$/, () => ({ body: envelope([]) })]])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'SwitchBot', kind: 'switchbot',
      make: () => createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'sb')!
    const state = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices: [] })
    expect(state.phase).toBe('no-devices')
    expect(state.message).toContain('SwitchBot-Konto')
    // And the user is offered the one action that can change it.
    expect(state.canRecheck).toBe(true)
  })

  it('invalid credentials surface as an error, not as a connection', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ body: { statusCode: 401, message: 'Unauthorized' } })],
    ])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'SwitchBot', kind: 'switchbot',
      make: () => createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'sb')!
    expect(session.health.status).toBe('error')
    expect(session.health.message).toMatch(/Token und Secret/)
    expect(deriveIntegrationState({ health: session.health, devices: [] }).phase).toBe('error')
  })

  it('an expired token is reported with SwitchBot’s own reason', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ body: { statusCode: 403, message: 'token expired' } })],
    ])
    const c = createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) })
    await expect(c.connect()).rejects.toThrow(/Token und Secret/)
    expect(c.health().status).toBe('error')
  })

  it('a relay that was deployed JWT-gated says so instead of blaming the token', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ status: 401, body: { message: 'Missing authorization header' } })],
    ])
    const c = createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) })
    await expect(c.connect()).rejects.toThrow(/--no-verify-jwt/)
  })

  it('an unreachable vendor is attributed to the vendor, with the relay’s detail', async () => {
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ status: 502, body: { error: 'upstream unreachable', detail: 'ECONNRESET' } })],
    ])
    const c = createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) })
    await expect(c.connect()).rejects.toThrow(/ECONNRESET/)
  })

  it('a failed discovery can be retried without re-entering credentials', async () => {
    // First listing fails, the second succeeds — exactly the "Erneut prüfen" path.
    let attempt = 0
    const { impl } = fakeFetch([
      [/\/v1\.1\/devices$/, () => {
        attempt++
        return attempt === 1
          ? { status: 502, body: { error: 'upstream unreachable' } }
          : { body: envelope([bot('C1', 'Kaffeemaschine')]) }
      }],
      [/\/status$/, () => ({ body: { statusCode: 100, body: { power: 'on' } } })],
    ])

    const manager = new TwinManager()
    await manager.addConnector({
      label: 'SwitchBot', kind: 'switchbot',
      make: () => createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) }),
    })
    // The connect probe failed, so this is an error state with no devices…
    expect(manager.view().devices.filter((d) => d.connectorId === 'sb')).toHaveLength(0)

    // …and reconnecting picks up the now-healthy endpoint.
    await manager.removeConnector('sb')
    await manager.addConnector({
      label: 'SwitchBot', kind: 'switchbot',
      make: () => createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'sb')!
    expect(session.discovery).toMatchObject({ phase: 'ok', count: 1 })
    expect(manager.view().devices.filter((d) => d.connectorId === 'sb')).toHaveLength(1)
  })

  it('does not spend a second listing between probe and discover', async () => {
    const { impl, calls } = fakeFetch([
      [/\/v1\.1\/devices$/, () => ({ body: envelope([bot('C1', 'Bot')]) })],
      [/\/status$/, () => ({ body: { statusCode: 100, body: { power: 'on' } } })],
    ])
    const c = createBrandConnector({ id: 'sb', label: 'SwitchBot', client: client(impl) })
    await c.connect()
    await c.discover()
    // One listing call, against a 10 000/day budget.
    expect(calls.filter((u) => /\/v1\.1\/devices$/.test(u))).toHaveLength(1)
  })
})

/* ── Govee regression ────────────────────────────────────────────────────── */

describe('Govee is unaffected by the SwitchBot repair', () => {
  it('still lists, normalises and reaches ready through the same twin path', async () => {
    const { impl } = fakeFetch([
      [/\/user\/devices$/, () => ({
        body: {
          data: [{
            sku: 'H6159', device: 'AB:CD:EF:01', deviceName: 'Stehlampe',
            capabilities: [
              { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
              { type: 'devices.capabilities.range', instance: 'brightness' },
            ],
          }],
        },
      })],
      [/\/device\/state$/, () => ({
        body: {
          payload: {
            capabilities: [
              { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: 1 } },
              { type: 'devices.capabilities.range', instance: 'brightness', state: { value: 42 } },
            ],
          },
        },
      })],
    ])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'Govee Cloud', kind: 'govee',
      make: () => createBrandConnector({
        id: 'govee-live', label: 'Govee Cloud',
        client: createGoveeClient({ apiKey: 'key', fetchImpl: impl, pollMs: 0 }),
      }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'govee-live')!
    const devices = manager.view().devices.filter((d) => d.connectorId === 'govee-live')
    expect(session.health.status).toBe('connected')
    expect(devices).toHaveLength(1)
    expect(findCapability(devices[0].capabilities, 'OnOff')).toMatchObject({ on: true })
    expect(findCapability(devices[0].capabilities, 'Brightness')).toMatchObject({ percent: 42 })
    expect(deriveIntegrationState({ health: session.health, discovery: session.discovery, devices }).phase).toBe('ready')
  })
})
