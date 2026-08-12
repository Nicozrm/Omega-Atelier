import { describe, it, expect, vi } from 'vitest'
import { createGoveeClient, parseGoveeDevices } from './goveeClient'
import { createBrandConnector } from './brandConnector'
import { vendorHttpError } from './vendorErrors'
import { TwinManager } from '@/twin/twinManager'
import { deriveIntegrationState } from '@/twin/integrationState'
import { findCapability } from '@/domain'

/**
 * Govee's half of the shared cause.
 *
 * Reported from the running app: Govee showed "Verbunden, aber es wurden keine
 * Geräte gefunden". The connection state was right — the *reason* was missing,
 * because `list()` read `json.data ?? []` and never looked at Govee's `code`.
 * Govee answers HTTP 200 with `{"code": 401}` when it rejects an API key, so a
 * rejected key and an empty account produced byte-identical outcomes: zero
 * devices, no error, nothing to act on.
 *
 * This is exactly what `parseSwitchBotDevices` already guarded against, which is
 * why the diagnosis now lives in one module for both vendors.
 */

const envelope = (data: unknown[], extra: Record<string, unknown> = {}) => ({
  requestId: 'req-1',
  code: 200,
  msg: 'success',
  data,
  ...extra,
})

const lamp = {
  sku: 'H6159',
  device: 'AB:CD:EF:01',
  deviceName: 'Stehlampe',
  capabilities: [
    { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
    { type: 'devices.capabilities.range', instance: 'brightness' },
  ],
}

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

const client = (impl: typeof fetch) => createGoveeClient({ apiKey: 'key', fetchImpl: impl, pollMs: 0 })

describe('parseGoveeDevices — the envelope that used to be ignored', () => {
  it('reads a populated device list', () => {
    expect(parseGoveeDevices(envelope([lamp]))).toHaveLength(1)
  })

  it('an empty account parses as empty, not as an error', () => {
    expect(parseGoveeDevices(envelope([]))).toEqual([])
  })

  it('throws on a rejected API key even though HTTP said 200', () => {
    // The exact shape of the bug: 200 OK, code 401, no `data`.
    expect(() => parseGoveeDevices({ code: 401, msg: 'invalid api key' })).toThrow(/API-Key/)
  })

  it('names rate limiting rather than reporting an empty account', () => {
    expect(() => parseGoveeDevices({ code: 429 })).toThrow(/429/)
  })

  it('keeps Govee’s own text for codes it has no advice for', () => {
    expect(() => parseGoveeDevices({ code: 500, msg: 'server error' })).toThrow(/server error/)
  })

  it('tolerates an envelope with no code at all', () => {
    expect(parseGoveeDevices({ data: [lamp] })).toHaveLength(1)
  })
})

describe('the relay diagnosis is shared with SwitchBot', () => {
  it('identifies a relay deployed without --no-verify-jwt, for Govee too', () => {
    expect(vendorHttpError('Govee', 401, { message: 'Missing authorization header' }))
      .toContain('--no-verify-jwt')
  })

  it('names the vendor it could not reach', () => {
    expect(vendorHttpError('Govee', 502, { error: 'upstream unreachable' })).toContain('Govee')
  })
})

describe('Govee discovery — connector to twin', () => {
  it('a rejected key is an error state, not an empty account', async () => {
    const { impl } = fakeFetch([
      [/\/user\/devices$/, () => ({ body: { code: 401, msg: 'invalid api key' } })],
    ])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'Govee Cloud', kind: 'govee',
      make: () => createBrandConnector({ id: 'govee-live', label: 'Govee Cloud', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'govee-live')!
    expect(session.health.status).toBe('error')
    const derived = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices: [] })
    expect(derived.phase).toBe('error')
    // Previously this rendered as "keine Geräte" with no way to tell why.
    expect(derived.message).toMatch(/API-Key/)
  })

  it('a genuinely empty account says so, and offers a re-check', async () => {
    const { impl } = fakeFetch([[/\/user\/devices$/, () => ({ body: envelope([]) })]])
    const manager = new TwinManager()
    await manager.addConnector({
      label: 'Govee Cloud', kind: 'govee',
      make: () => createBrandConnector({ id: 'govee-live', label: 'Govee Cloud', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'govee-live')!
    const derived = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices: [] })
    expect(derived.phase).toBe('no-devices')
    expect(derived.message).toContain('Govee-Konto')
    expect(derived.canRecheck).toBe(true)
  })

  it('still lists and normalises a real account — no regression', async () => {
    const { impl } = fakeFetch([
      [/\/user\/devices$/, () => ({ body: envelope([lamp]) })],
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
      make: () => createBrandConnector({ id: 'govee-live', label: 'Govee Cloud', client: client(impl) }),
    })
    const session = manager.view().sessions.find((s) => s.id === 'govee-live')!
    const devices = manager.view().devices.filter((d) => d.connectorId === 'govee-live')
    expect(devices).toHaveLength(1)
    expect(findCapability(devices[0].capabilities, 'OnOff')).toMatchObject({ on: true })
    expect(findCapability(devices[0].capabilities, 'Brightness')).toMatchObject({ percent: 42 })
    expect(deriveIntegrationState({ health: session.health, discovery: session.discovery, devices }).phase)
      .toBe('ready')
  })

  it('a relay that swallows the call is attributed to the relay', async () => {
    const { impl } = fakeFetch([
      [/\/user\/devices$/, () => ({ status: 401, body: { message: 'Missing authorization header' } })],
    ])
    const c = createBrandConnector({ id: 'govee-live', label: 'Govee', client: client(impl) })
    await expect(c.connect()).rejects.toThrow(/--no-verify-jwt/)
  })
})
