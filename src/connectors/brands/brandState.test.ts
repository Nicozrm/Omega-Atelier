import { describe, it, expect, vi } from 'vitest'
import {
  createGoveeClient, goveeCapsFor, goveeCapsFromState, goveeEchoCapability, rgbIntToHex,
} from './goveeClient'
import { createSwitchBotClient, switchbotCapsFromStatus } from './switchbotClient'
import { findCapability } from '@/domain'

/**
 * The bug these cover, in the reporter's words: *"An geht, merkt der digital
 * twin nicht — deshalb gehen die auch nicht aus."*
 *
 * Both brand clients used to be write-only. They listed devices with invented
 * states (`on: false`, `percent: 100`) and never read the cloud back, which has
 * two consequences that compound:
 *
 *  1. `TwinManager` confirms a command by waiting for a device *update* of that
 *     capability. With no update the command times out and is marked `failed`,
 *     even though the lamp physically switched.
 *  2. The twin keeps `on: false` forever, so the toggle never flips and the
 *     next press sends `turnOn` again. The light can be switched on and never
 *     off — exactly the report.
 *
 * The mapping functions are pure and tested against recorded payload shapes;
 * the clients are driven through a fake `fetch`, because the part worth
 * protecting is the round trip *list → control → poll*, not any single call.
 */

// ── Recorded payload shapes ────────────────────────────────────

const GOVEE_DEVICES = {
  data: [{
    sku: 'H6159',
    device: 'AB:CD:EF:01',
    deviceName: 'Stehlampe',
    capabilities: [
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
      { type: 'devices.capabilities.range', instance: 'brightness' },
      { type: 'devices.capabilities.color_setting', instance: 'colorRgb' },
      { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK' },
    ],
  }],
}

const goveeState = (on: number, brightness = 60, rgb = 0xff8800) => ({
  payload: {
    sku: 'H6159',
    device: 'AB:CD:EF:01',
    capabilities: [
      { type: 'devices.capabilities.online', instance: 'online', state: { value: true } },
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: on } },
      { type: 'devices.capabilities.range', instance: 'brightness', state: { value: brightness } },
      { type: 'devices.capabilities.color_setting', instance: 'colorRgb', state: { value: rgb } },
    ],
  },
})

/** Routes a fake fetch by URL; records every call for assertions. */
function fakeFetch(routes: Array<[RegExp, () => unknown]>) {
  const calls: string[] = []
  const impl = vi.fn(async (url: string | URL | Request) => {
    const href = String(url)
    calls.push(href)
    const hit = routes.find(([re]) => re.test(href))
    if (!hit) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(hit[1]()), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

// ── Govee ──────────────────────────────────────────────────────

describe('govee state mapping', () => {
  it('reads power, brightness and colour out of a state response', () => {
    const caps = goveeCapsFromState(goveeState(1, 42, 0x00ff00).payload.capabilities)
    expect(findCapability(caps, 'OnOff')?.on).toBe(true)
    expect(findCapability(caps, 'Brightness')?.percent).toBe(42)
    expect(findCapability(caps, 'Color')?.hex).toBe('#00ff00')
  })

  it('accepts the several shapes Govee uses for a value', () => {
    const on = (state: unknown) =>
      findCapability(goveeCapsFromState([{ instance: 'powerSwitch', type: 'devices.capabilities.on_off', state }]), 'OnOff')?.on
    expect(on({ value: 1 })).toBe(true)
    expect(on({ value: true })).toBe(true)
    expect(on({ value: 0 })).toBe(false)
    expect(on(1)).toBe(true) // bare value, no wrapper
  })

  it('drops a zero colour temperature — that means "not in white mode"', () => {
    const caps = goveeCapsFromState([
      { instance: 'colorTemperatureK', type: 'devices.capabilities.color_setting', state: { value: 0 } },
    ])
    expect(findCapability(caps, 'ColorTemperature')).toBeUndefined()
  })

  it('round-trips a packed rgb integer', () => {
    expect(rgbIntToHex(0xff0000)).toBe('#ff0000')
    expect(rgbIntToHex(0)).toBe('#000000')
    expect(rgbIntToHex(0xffffff)).toBe('#ffffff')
  })

  /**
   * The reason colour and brightness were missing on real hardware: Govee names
   * the instance per SKU family, and only the `type` is stable across them.
   */
  it('recognises a capability by type when the instance name differs', () => {
    const caps = goveeCapsFor({
      device: 'd', sku: 'H61A0', deviceName: 'Lichtband',
      capabilities: [
        { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
        { type: 'devices.capabilities.range', instance: 'brightnessLevel' },
        { type: 'devices.capabilities.color_setting', instance: 'segmentedColorRgb' },
      ],
    })
    expect(caps.map((c) => c.kind)).toEqual(['OnOff', 'Brightness', 'Color'])
  })

  it('echoes the capability a command intended', () => {
    expect(goveeEchoCapability({ deviceId: 'd', capability: 'OnOff', payload: { on: true } }))
      .toMatchObject({ kind: 'OnOff', on: true })
    expect(goveeEchoCapability({ deviceId: 'd', capability: 'Color', payload: { hex: '#112233' } }))
      .toMatchObject({ kind: 'Color', hex: '#112233' })
    expect(goveeEchoCapability({ deviceId: 'd', capability: 'Lock', payload: { locked: true } })).toBeNull()
  })
})

describe('govee client round trip', () => {
  it('lists a lamp with its REAL state, not an invented one', async () => {
    const { impl } = fakeFetch([
      [/user\/devices/, () => GOVEE_DEVICES],
      [/device\/state/, () => goveeState(1, 60)],
    ])
    const client = createGoveeClient({ apiKey: 'k', fetchImpl: impl })
    const [device] = await client.list()
    // The regression: this used to be `false` no matter what the lamp was doing.
    expect(findCapability(device.capabilities, 'OnOff')?.on).toBe(true)
    expect(findCapability(device.capabilities, 'Brightness')?.percent).toBe(60)
  })

  it('keeps declared capabilities the state response omits', async () => {
    const { impl } = fakeFetch([
      [/user\/devices/, () => GOVEE_DEVICES],
      // No colorTemperatureK in the state — the device still supports it.
      [/device\/state/, () => goveeState(0)],
    ])
    const [device] = await createGoveeClient({ apiKey: 'k', fetchImpl: impl }).list()
    expect(device.capabilities.map((c) => c.kind)).toContain('ColorTemperature')
  })

  it('survives a state endpoint that fails, falling back to the declaration', async () => {
    const { impl } = fakeFetch([[/user\/devices/, () => GOVEE_DEVICES]]) // state → 404
    const [device] = await createGoveeClient({ apiKey: 'k', fetchImpl: impl }).list()
    expect(device.capabilities.map((c) => c.kind)).toEqual(['OnOff', 'Brightness', 'Color', 'ColorTemperature'])
  })

  it('polls and reports a change made outside the app', async () => {
    let on = 0
    const { impl } = fakeFetch([
      [/user\/devices/, () => GOVEE_DEVICES],
      [/device\/state/, () => goveeState(on)],
    ])
    const client = createGoveeClient({ apiKey: 'k', fetchImpl: impl, pollMs: 5 })
    await client.list()

    const updates: string[] = []
    const stop = client.subscribe!((u) => {
      updates.push(String(findCapability(u.capabilities ?? [], 'OnOff')?.on))
    })
    // Somebody hits the physical switch.
    on = 1
    await vi.waitFor(() => expect(updates).toContain('true'), { timeout: 2000 })
    stop()
  })

  it('does not emit when nothing changed', async () => {
    const { impl } = fakeFetch([
      [/user\/devices/, () => GOVEE_DEVICES],
      [/device\/state/, () => goveeState(1)],
    ])
    const client = createGoveeClient({ apiKey: 'k', fetchImpl: impl, pollMs: 5 })
    await client.list()
    const updates: unknown[] = []
    const stop = client.subscribe!((u) => updates.push(u))
    await new Promise((r) => setTimeout(r, 60))
    stop()
    expect(updates).toEqual([])
  })

  it('names the missing SKU instead of letting Govee reject the call', async () => {
    const { impl } = fakeFetch([[/device\/control/, () => ({})]])
    const client = createGoveeClient({ apiKey: 'k', fetchImpl: impl })
    // No list() ran, so no SKU is known for this id.
    await expect(client.control({ deviceId: 'unknown', capability: 'OnOff', payload: { on: true } }))
      .rejects.toThrow(/neu synchronisieren/)
  })

  it('reports a blocked request as network/CORS rather than a bare TypeError', async () => {
    const impl = (async () => { throw new TypeError('Load failed') }) as unknown as typeof fetch
    await expect(createGoveeClient({ apiKey: 'k', fetchImpl: impl }).list())
      .rejects.toThrow(/Netzwerk\/CORS/)
  })
})

// ── SwitchBot ──────────────────────────────────────────────────

describe('switchbot status mapping', () => {
  it('reads power and brightness', () => {
    const caps = switchbotCapsFromStatus({ power: 'on', brightness: 70 })
    expect(findCapability(caps, 'OnOff')?.on).toBe(true)
    expect(findCapability(caps, 'Brightness')?.percent).toBe(70)
  })

  it('inverts the curtain position — SwitchBot counts 0 as fully open', () => {
    expect(findCapability(switchbotCapsFromStatus({ slidePosition: 0 }), 'Position')?.percent).toBe(100)
    expect(findCapability(switchbotCapsFromStatus({ slidePosition: 100 }), 'Position')?.percent).toBe(0)
  })

  it('reads a meter and a lock', () => {
    const meter = switchbotCapsFromStatus({ temperature: 21.4, humidity: 48 })
    expect(findCapability(meter, 'Temperature')?.celsius).toBe(21.4)
    expect(findCapability(switchbotCapsFromStatus({ lockState: 'locked' }), 'Lock')?.locked).toBe(true)
    expect(findCapability(switchbotCapsFromStatus({ lockState: 'unlocked' }), 'Lock')?.locked).toBe(false)
  })

  it('ignores fields it does not model', () => {
    expect(switchbotCapsFromStatus({ battery: 90, version: 'V1.2' })).toEqual([])
  })
})

describe('switchbot client', () => {
  it('lists a bot with its real power state', async () => {
    const { impl } = fakeFetch([
      [/v1\.1\/devices$/, () => ({ body: { deviceList: [{ deviceId: 'B1', deviceName: 'Bot', deviceType: 'Bot' }] } })],
      [/v1\.1\/devices\/B1\/status/, () => ({ body: { power: 'on' } })],
    ])
    const [device] = await createSwitchBotClient({ token: 't', secret: 's', fetchImpl: impl }).list()
    expect(findCapability(device.capabilities, 'OnOff')?.on).toBe(true)
  })

  /**
   * Measured against the live endpoint: `api.switch-bot.com` answers OPTIONS
   * with 404 and sends no `access-control-allow-origin`, so a browser can never
   * reach it directly. A bare "Load failed" sends the user hunting through
   * valid credentials; the message has to name the relay.
   */
  it('says the relay is missing when the browser blocks the request', async () => {
    const impl = (async () => { throw new TypeError('Load failed') }) as unknown as typeof fetch
    await expect(createSwitchBotClient({ token: 't', secret: 's', fetchImpl: impl }).list())
      .rejects.toThrow(/ohne Relay/)
  })

  it('blames the relay itself once one is configured', async () => {
    const impl = (async () => { throw new TypeError('Load failed') }) as unknown as typeof fetch
    await expect(createSwitchBotClient({ token: 't', secret: 's', baseUrl: 'https://x/relay/switchbot', fetchImpl: impl }).list())
      .rejects.toThrow(/Relay nicht erreichbar/)
  })
})
