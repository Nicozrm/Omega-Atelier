import { describe, it, expect } from 'vitest'
import { relayBaseUrl, tuyaRelayUrl, tuyaDirectUrl } from './relay'
import { HttpTuyaTransport, TUYA_ENDPOINTS } from './transport'

const RELAY = 'https://abcdef.supabase.co/functions/v1/vendor-relay'

describe('relayBaseUrl', () => {
  it('keeps a clean relay URL as it is', () => {
    expect(relayBaseUrl(RELAY)).toBe(RELAY)
  })

  it('trims whitespace and trailing slashes', () => {
    expect(relayBaseUrl(`  ${RELAY}///  `)).toBe(RELAY)
  })

  it('strips a vendor segment the user copied out of a working call', () => {
    expect(relayBaseUrl(`${RELAY}/tuya-eu`)).toBe(RELAY)
    expect(relayBaseUrl(`${RELAY}/switchbot/`)).toBe(RELAY)
    expect(relayBaseUrl(`${RELAY}/govee`)).toBe(RELAY)
  })

  it('assumes https for a bare host — a relay is always hosted', () => {
    expect(relayBaseUrl('abcdef.supabase.co/functions/v1/vendor-relay')).toBe(RELAY)
  })

  it('drops query and fragment', () => {
    expect(relayBaseUrl(`${RELAY}?x=1#y`)).toBe(RELAY)
  })

  it('is empty for empty input', () => {
    expect(relayBaseUrl('   ')).toBe('')
  })
})

describe('tuyaRelayUrl', () => {
  it('routes each region to its own relay vendor segment', () => {
    expect(tuyaRelayUrl(RELAY, 'eu')).toBe(`${RELAY}/tuya-eu`)
    expect(tuyaRelayUrl(RELAY, 'us')).toBe(`${RELAY}/tuya-us`)
    expect(tuyaRelayUrl(RELAY, 'cn')).toBe(`${RELAY}/tuya-cn`)
    expect(tuyaRelayUrl(RELAY, 'in')).toBe(`${RELAY}/tuya-in`)
  })

  it('names a segment the relay function actually knows', () => {
    // The relay maps `tuya-<region>` onto Tuya's data centres; a region added
    // here without a matching upstream would 404 with "unknown vendor".
    for (const region of Object.keys(TUYA_ENDPOINTS) as Array<keyof typeof TUYA_ENDPOINTS>) {
      expect(tuyaRelayUrl(RELAY, region)).toMatch(/\/tuya-(eu|us|cn|in)$/)
    }
  })

  it('re-attaches the region even when one was pasted in', () => {
    // Pasting the `eu` URL while `us` is selected must follow the selection.
    expect(tuyaRelayUrl(`${RELAY}/tuya-eu`, 'us')).toBe(`${RELAY}/tuya-us`)
  })

  it('is undefined without a relay, which keeps the direct path available', () => {
    expect(tuyaRelayUrl('', 'eu')).toBeUndefined()
    expect(tuyaRelayUrl('   ', 'eu')).toBeUndefined()
  })
})

describe('the transport accepts either', () => {
  it('addresses the data centre directly when given a region', async () => {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      await new HttpTuyaTransport('eu').request({ method: 'GET', path: '/v1.0/token', headers: {} })
      expect(calls[0]).toBe(`${tuyaDirectUrl('eu')}/v1.0/token`)
    } finally {
      globalThis.fetch = original
    }
  })

  it('addresses the relay when given its URL', async () => {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as unknown as typeof fetch
    try {
      const base = tuyaRelayUrl(RELAY, 'eu')!
      await new HttpTuyaTransport(base).request({ method: 'GET', path: '/v1.0/token', headers: {} })
      expect(calls[0]).toBe(`${RELAY}/tuya-eu/v1.0/token`)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('a blocked request names the actual cause', () => {
  const withFetch = async (impl: () => Promise<Response>, run: () => Promise<void>) => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => impl()) as unknown as typeof fetch
    try { await run() } finally { globalThis.fetch = original }
  }

  it('points at the missing relay when the browser blocks the direct call', async () => {
    await withFetch(
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => {
        const res = await new HttpTuyaTransport('eu').request({ method: 'GET', path: '/v1.0/token', headers: {} })
        expect(res.success).toBe(false)
        expect(res.msg).toMatch(/ohne Relay/)
      },
    )
  })

  it('points at the relay itself when the relay is the one that failed', async () => {
    await withFetch(
      () => Promise.reject(new TypeError('Failed to fetch')),
      async () => {
        const res = await new HttpTuyaTransport(tuyaRelayUrl(RELAY, 'eu')!).request({ method: 'GET', path: '/v1.0/token', headers: {} })
        expect(res.success).toBe(false)
        expect(res.msg).toMatch(/Relay nicht erreichbar/)
      },
    )
  })

  it('still reports an HTTP status as one', async () => {
    await withFetch(
      () => Promise.resolve(new Response('nope', { status: 502 })),
      async () => {
        const res = await new HttpTuyaTransport('eu').request({ method: 'GET', path: '/v1.0/token', headers: {} })
        expect(res).toMatchObject({ success: false, code: 502 })
      },
    )
  })
})
