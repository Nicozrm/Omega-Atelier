import { describe, it, expect } from 'vitest'
import {
  isRelayHealthResponse, relayBaseUrl, vendorRelayUrl, RELAY_HEALTH_MESSAGE,
} from './relayUrl'
import { parseGoveeDevices } from './brands/goveeClient'
import { parseSwitchBotDevices } from './brands/switchbotClient'

/**
 * The reported failure, exactly.
 *
 * A relay URL was pasted carrying a tracking query string:
 *
 *     https://<ref>.supabase.co/functions/v1/vendor-relay?utm_source=…
 *
 * and the vendor segment was appended to that raw string, landing *inside* the
 * query. The relay therefore received a bare `/functions/v1/vendor-relay`,
 * which is its health route, and answered HTTP 200 with a self-test envelope.
 * No `data`, no `statusCode` — so Govee and SwitchBot both read zero devices
 * from a successful request and both cards said the account was empty. The
 * credentials were fine and the vendors were never contacted.
 */

const PASTED = 'https://suqbnksyfmzfhrfwuhrw.supabase.co/functions/v1/vendor-relay?utm_source=chatgpt.com'
const CLEAN = 'https://suqbnksyfmzfhrfwuhrw.supabase.co/functions/v1/vendor-relay'

/** What the relay's health route actually answers. */
const HEALTH = {
  ok: true,
  service: 'vendor-relay',
  vendors: ['govee', 'switchbot', 'tuya-eu', 'tuya-us', 'tuya-cn', 'tuya-in'],
  hint: 'Relay-URL in der App: der Teil bis einschliesslich /vendor-relay',
  time: '2026-08-12T20:00:00.000Z',
}

describe('relayBaseUrl — normalising what people actually paste', () => {
  it('strips a tracking query string', () => {
    expect(relayBaseUrl(PASTED)).toBe(CLEAN)
  })

  it('strips a fragment and trailing slashes', () => {
    expect(relayBaseUrl(`${CLEAN}/#section`)).toBe(CLEAN)
    expect(relayBaseUrl(`${CLEAN}///`)).toBe(CLEAN)
  })

  it('adds the scheme a bare host is missing', () => {
    expect(relayBaseUrl('ref.supabase.co/functions/v1/vendor-relay')).toBe(
      'https://ref.supabase.co/functions/v1/vendor-relay',
    )
  })

  it('strips a vendor segment copied out of a working curl', () => {
    expect(relayBaseUrl(`${CLEAN}/govee`)).toBe(CLEAN)
    expect(relayBaseUrl(`${CLEAN}/switchbot`)).toBe(CLEAN)
    expect(relayBaseUrl(`${CLEAN}/tuya-eu`)).toBe(CLEAN)
  })

  it('is empty for empty input', () => {
    expect(relayBaseUrl('')).toBe('')
    expect(relayBaseUrl('   ')).toBe('')
  })
})

describe('vendorRelayUrl — the segment must reach the path, not the query', () => {
  it('builds a usable URL from a pasted, query-laden one', () => {
    // The regression: string concatenation produced
    // `…/vendor-relay?utm_source=chatgpt.com/govee`.
    expect(vendorRelayUrl(PASTED, 'govee')).toBe(`${CLEAN}/govee`)
    expect(vendorRelayUrl(PASTED, 'switchbot')).toBe(`${CLEAN}/switchbot`)
  })

  it('never leaves a query string in front of the vendor segment', () => {
    const url = vendorRelayUrl(PASTED, 'govee')!
    expect(url).not.toContain('?')
    expect(new URL(url).pathname.endsWith('/govee')).toBe(true)
  })

  it('is undefined without a relay, so Govee can still go direct', () => {
    expect(vendorRelayUrl('', 'govee')).toBeUndefined()
  })
})

describe('the health self-test is recognised instead of read as an empty account', () => {
  it('identifies the envelope', () => {
    expect(isRelayHealthResponse(HEALTH)).toBe(true)
    expect(isRelayHealthResponse({ statusCode: 100, body: { deviceList: [] } })).toBe(false)
    expect(isRelayHealthResponse({ code: 200, data: [] })).toBe(false)
    expect(isRelayHealthResponse(null)).toBe(false)
    expect(isRelayHealthResponse('vendor-relay')).toBe(false)
  })

  it('Govee names it rather than reporting no devices', () => {
    // Before: `json.data ?? []` → [] → "das Govee-Konto liefert keine Geräte".
    expect(() => parseGoveeDevices(HEALTH)).toThrow(RELAY_HEALTH_MESSAGE)
  })

  it('SwitchBot names it rather than reporting no devices', () => {
    // Before: no `statusCode`, empty `body` → [] → "das SwitchBot-Konto liefert
    // keine Geräte — in der SwitchBot-App prüfen …", which sent the user to a
    // setting that was already correct.
    expect(() => parseSwitchBotDevices(HEALTH)).toThrow(RELAY_HEALTH_MESSAGE)
  })

  it('the message points at the query string, which is the actual cause', () => {
    expect(RELAY_HEALTH_MESSAGE).toContain('utm_source')
    expect(RELAY_HEALTH_MESSAGE).toContain('/functions/v1/vendor-relay')
  })

  it('a genuinely empty account is still reported as empty', () => {
    // The detection must not swallow the real empty case.
    expect(parseGoveeDevices({ code: 200, data: [] })).toEqual([])
    expect(parseSwitchBotDevices({ statusCode: 100, body: { deviceList: [] } })).toEqual([])
  })
})
