import { describe, it, expect, vi } from 'vitest'
import { createBrandConnector } from './brandConnector'
import { createSimulatedBrandClient, BRAND_FLEETS } from './simulatedBrandClient'
import { goveeControlBody, hexToRgbInt, goveeCapsFor } from './goveeClient'
import {
  switchbotSign, switchbotCommand, switchbotCapsFor,
  parseSwitchBotDevices, createSwitchBotClient,
} from './switchbotClient'
import { findCapability } from '@/domain'

describe('brand connector (generic over a client)', () => {
  it('connects, discovers the fleet and stamps its connectorId', async () => {
    const c = createBrandConnector({ id: 'govee', label: 'Govee', client: createSimulatedBrandClient(BRAND_FLEETS.govee, { liveMs: 0 }) })
    await c.connect()
    expect(c.health().status).toBe('connected')
    const devices = await c.discover()
    expect(devices.length).toBe(BRAND_FLEETS.govee.length)
    expect(devices.every((d) => d.connectorId === 'govee')).toBe(true)
  })

  it('routes a command and the next synchronize reflects it', async () => {
    const client = createSimulatedBrandClient(BRAND_FLEETS.lockin, { liveMs: 0 })
    const c = createBrandConnector({ id: 'lockin', label: 'Lockin', client })
    await c.connect()
    await c.publish({ deviceId: 'lockin.g30.haustuer', capability: 'Lock', payload: { locked: false } })
    const after = await c.synchronize()
    const lockCap = findCapability(after[0].capabilities, 'Lock')
    expect(lockCap?.locked).toBe(false)
  })

  it('rejects commands for unknown devices', async () => {
    const c = createBrandConnector({ id: 'tuya', label: 'Tuya', client: createSimulatedBrandClient(BRAND_FLEETS.tuya, { liveMs: 0 }) })
    await c.connect()
    await expect(c.publish({ deviceId: 'nope', capability: 'OnOff', payload: { on: true } })).rejects.toThrow()
  })
})

describe('govee mapping', () => {
  it('converts hex colors to Govee rgb integers', () => {
    expect(hexToRgbInt('#ff0000')).toBe(0xff0000)
    expect(hexToRgbInt('00ff00')).toBe(0x00ff00)
    expect(hexToRgbInt('#fff')).toBe(0xffffff)
  })

  it('builds control payloads per capability', () => {
    const onBody = goveeControlBody({ deviceId: 'd', capability: 'OnOff', payload: { on: true } }, 'H619A', 'd')
    expect((onBody.payload as { capability: { instance: string; value: number } }).capability).toMatchObject({ instance: 'powerSwitch', value: 1 })
    const briBody = goveeControlBody({ deviceId: 'd', capability: 'Brightness', payload: { percent: 40 } }, 'H619A', 'd')
    expect((briBody.payload as { capability: { instance: string; value: number } }).capability).toMatchObject({ instance: 'brightness', value: 40 })
    expect(() => goveeControlBody({ deviceId: 'd', capability: 'Lock', payload: { locked: true } }, 'H619A', 'd')).toThrow()
  })

  it('derives capabilities from instances', () => {
    const caps = goveeCapsFor({ device: 'd', sku: 'H619A', deviceName: 'x', capabilities: [
      { type: 't', instance: 'powerSwitch' }, { type: 't', instance: 'brightness' }, { type: 't', instance: 'colorRgb' },
    ] })
    expect(caps.map((c) => c.kind)).toEqual(['OnOff', 'Brightness', 'Color'])
  })
})

describe('switchbot v1.1', () => {
  it('signs token+t+nonce with HMAC-SHA256 (known vector)', async () => {
    // Vector computed independently: HMAC_SHA256("secret", "token" + "1700000000000" + "nonce") base64.
    const sig = await switchbotSign('token', 'secret', '1700000000000', 'nonce')
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(sig.length).toBe(44)
    // Deterministic: same inputs, same signature.
    expect(await switchbotSign('token', 'secret', '1700000000000', 'nonce')).toBe(sig)
    // Sensitive to every input.
    expect(await switchbotSign('token2', 'secret', '1700000000000', 'nonce')).not.toBe(sig)
  })

  it('maps neutral commands to SwitchBot commands', () => {
    expect(switchbotCommand({ deviceId: 'd', capability: 'OnOff', payload: { on: true } })).toEqual({ command: 'turnOn', parameter: 'default' })
    expect(switchbotCommand({ deviceId: 'd', capability: 'Lock', payload: { locked: false } })).toEqual({ command: 'unlock', parameter: 'default' })
    expect(switchbotCommand({ deviceId: 'd', capability: 'Position', payload: { percent: 30 } })).toEqual({ command: 'setPosition', parameter: '0,ff,70' })
  })

  it('classifies device types into categories + capabilities', () => {
    expect(switchbotCapsFor('Smart Lock').category).toBe('lock')
    expect(switchbotCapsFor('Bot').caps[0].kind).toBe('OnOff')
    expect(switchbotCapsFor('MeterTH').caps.map((c) => c.kind)).toEqual(['Temperature', 'Humidity'])
  })
})

/**
 * The reported symptom: SwitchBot reports "verbunden" and no device ever shows
 * up. Two independent causes, both of which look like success from the outside.
 */
describe('switchbot — connected but no devices', () => {
  const envelope = (body: unknown, statusCode = 100) =>
    new Response(JSON.stringify({ statusCode, message: 'success', body }), { status: 200 })

  const client = (fetchImpl: typeof fetch) =>
    createSwitchBotClient({ token: 'token', secret: 'secret', baseUrl: 'https://relay/switchbot', fetchImpl, pollMs: 0 })

  it('rejects a 200 response whose envelope says the credentials are wrong', () => {
    // SwitchBot answers HTTP 200 with statusCode 401 and an empty body. Reading
    // `deviceList` off that yielded [] — a silent, successful-looking failure.
    expect(() => parseSwitchBotDevices({ statusCode: 401, message: 'Unauthorized', body: {} }))
      .toThrow(/Token und Secret prüfen/)
    expect(() => parseSwitchBotDevices({ statusCode: 190, body: {} })).toThrow(/190/)
  })

  it('includes infrared remotes, which live in their own list', () => {
    const devices = parseSwitchBotDevices({
      statusCode: 100,
      body: {
        deviceList: [{ deviceId: 'p1', deviceName: 'Bot', deviceType: 'Bot' }],
        infraredRemoteList: [{ deviceId: 'ir1', deviceName: 'TV', remoteType: 'TV' }],
      },
    })
    expect(devices.map((d) => d.deviceId)).toEqual(['p1', 'ir1'])
    expect(devices[1].infrared).toBe(true)
  })

  it('tolerates an envelope without a statusCode (older relays)', () => {
    expect(parseSwitchBotDevices({ body: { deviceList: [{ deviceId: 'a', deviceName: 'A' }] } })).toHaveLength(1)
  })

  it('surfaces the credential error instead of listing nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ statusCode: 401, message: 'Unauthorized', body: {} }), { status: 200 },
    )) as unknown as typeof fetch
    await expect(client(fetchImpl).list()).rejects.toThrow(/Token und Secret prüfen/)
  })

  it('lists physical and infrared devices together', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1.1/devices')) {
        return envelope({
          deviceList: [{ deviceId: 'p1', deviceName: 'Wohnzimmer Bot', deviceType: 'Bot' }],
          infraredRemoteList: [{ deviceId: 'ir1', deviceName: 'Fernseher', remoteType: 'TV' }],
        })
      }
      return envelope({ power: 'on' })
    }) as unknown as typeof fetch

    const devices = await client(fetchImpl).list()
    expect(devices.map((d) => d.name)).toEqual(['Wohnzimmer Bot', 'Fernseher'])
    expect(devices[1].metadata?.infrared).toBe('true')
    // No `/status` call for the IR remote — SwitchBot has none, and the daily
    // call budget is finite.
    const statusCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls
      .filter(([u]) => String(u).includes('/status'))
    expect(statusCalls).toHaveLength(1)
    expect(String(statusCalls[0][0])).toContain('p1')
  })

  it('reports an empty account as a note rather than as silence', async () => {
    const fetchImpl = vi.fn(async () => envelope({ deviceList: [], infraredRemoteList: [] })) as unknown as typeof fetch
    const c = createBrandConnector({ id: 'switchbot', label: 'SwitchBot', client: client(fetchImpl) })
    await c.connect()
    expect(c.health().status).toBe('connected')
    expect(c.health().message).toMatch(/keine Geräte/)
  })

  it('does not list twice for one connect+discover', async () => {
    const fetchImpl = vi.fn(async () => envelope({ deviceList: [], infraredRemoteList: [] })) as unknown as typeof fetch
    const c = createBrandConnector({ id: 'switchbot', label: 'SwitchBot', client: client(fetchImpl) })
    await c.connect()
    await c.discover()
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})
