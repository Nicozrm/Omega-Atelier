import { describe, it, expect } from 'vitest'
import {
  deviceListPath, emptyAccountHint, isPaginated, parseDevicePage, tuyaErrorMessage,
} from './discovery'
import { createTuyaConnector } from './tuyaConnector'
import type { TuyaApiResponse, TuyaRequest, TuyaTransport } from './transport'
import { mapTuyaDevicePassive } from './mapping'
import { findCapability } from '@/domain'

/**
 * Tuya authenticated and listed nothing. These tests pin the two halves of why.
 *
 *  1. Without a UID the connector asked `GET /v1.0/devices`, which is not an
 *     account listing — Tuya needs `device_ids`/`schema` there. Since the setup
 *     UI calls the UID optional, that was the default path for a fresh project.
 *  2. The endpoint that *does* list a project's devices answers with a nested,
 *     paginated envelope, which the old `Array.isArray(result)` check rejected.
 */

describe('deviceListPath — which endpoint actually lists devices', () => {
  it('uses the per-user endpoint when a UID is configured', () => {
    expect(deviceListPath('uid-42')).toBe('/v1.0/users/uid-42/devices')
  })

  it('uses the project association endpoint when no UID is configured', () => {
    // The regression: this used to be `/v1.0/devices`, which lists nothing.
    expect(deviceListPath(undefined)).toContain('/v1.0/iot-01/associated-users/devices')
    expect(deviceListPath(undefined)).not.toBe('/v1.0/devices')
  })

  it('carries the pagination cursor only on the paginated endpoint', () => {
    expect(deviceListPath(undefined, 'row-9')).toContain('last_row_key=row-9')
    expect(deviceListPath('uid-42', 'row-9')).not.toContain('last_row_key')
    expect(isPaginated(undefined)).toBe(true)
    expect(isPaginated('uid-42')).toBe(false)
  })

  it('url-encodes a UID rather than splicing it into the path raw', () => {
    expect(deviceListPath('a/b')).toBe('/v1.0/users/a%2Fb/devices')
  })
})

describe('parseDevicePage — both shapes Tuya answers with', () => {
  it('reads the bare array of the per-user endpoint', () => {
    const page = parseDevicePage<{ id: string }>([{ id: 'a' }, { id: 'b' }])
    expect(page?.devices).toHaveLength(2)
    expect(page?.nextCursor).toBeUndefined()
  })

  it('reads the nested envelope of the association endpoint', () => {
    const page = parseDevicePage<{ id: string }>({ devices: [{ id: 'a' }], has_more: false, total: 1 })
    expect(page?.devices).toHaveLength(1)
  })

  it('exposes the cursor only when there really is another page', () => {
    expect(parseDevicePage({ devices: [], has_more: true, last_row_key: 'k' })?.nextCursor).toBe('k')
    expect(parseDevicePage({ devices: [], has_more: false, last_row_key: 'k' })?.nextCursor).toBeUndefined()
  })

  it('distinguishes an empty account from an unreadable answer', () => {
    // Empty is a valid page…
    expect(parseDevicePage({ devices: [], has_more: false })?.devices).toEqual([])
    // …a shape we do not understand is not, and must not read as "no devices".
    expect(parseDevicePage({ result: 'surprise' })).toBeNull()
    expect(parseDevicePage(null)).toBeNull()
    expect(parseDevicePage('nope')).toBeNull()
  })
})

describe('tuyaErrorMessage — naming the setup step that is missing', () => {
  it('explains a permission denial as the missing IoT-Core subscription', () => {
    expect(tuyaErrorMessage(1106, 'permission deny')).toContain('IoT Core')
  })

  it('points a signature rejection at the credentials', () => {
    expect(tuyaErrorMessage(1004, 'sign invalid')).toContain('Access Secret')
  })

  it('keeps Tuya’s own text for codes it has no advice for', () => {
    expect(tuyaErrorMessage(9999, 'something new')).toContain('something new')
  })

  it('empty-account advice depends on how we asked', () => {
    expect(emptyAccountHint('uid-1')).toContain('UID')
    expect(emptyAccountHint(undefined)).toContain('Link App Account')
  })
})

/* ── The connector, end to end, against a scripted transport ─────────────── */

interface Scripted { path: string; method: string }

/**
 * A transport that answers the token grant and one scripted device listing.
 * Records every path so the test can assert which endpoint was actually used.
 */
function scriptedTransport(listing: TuyaApiResponse<unknown>, opts: { uid?: string } = {}) {
  const calls: Scripted[] = []
  const transport: TuyaTransport = {
    async request<T>(req: TuyaRequest): Promise<TuyaApiResponse<T>> {
      calls.push({ path: req.path, method: req.method })
      if (req.path.startsWith('/v1.0/token')) {
        return {
          success: true,
          result: { access_token: 'tok', refresh_token: 'ref', expire_time: 7200, ...(opts.uid ? { uid: opts.uid } : {}) },
        } as TuyaApiResponse<T>
      }
      return listing as TuyaApiResponse<T>
    },
  }
  return { transport, calls }
}

const connector = (transport: TuyaTransport, uid?: string) =>
  createTuyaConnector({ transport, clientId: 'client-id', secret: 'secret', uid, pollMs: 0 })

describe('Tuya connector — authentication and discovery are separate states', () => {
  it('connect() proves the credentials and nothing else', async () => {
    const { transport, calls } = scriptedTransport({ success: true, result: [] })
    const c = connector(transport, 'uid-1')
    await c.connect()
    expect(c.health().status).toBe('connected')
    // Only the token was fetched — no device listing yet.
    expect(calls.every((x) => x.path.startsWith('/v1.0/token'))).toBe(true)
  })

  it('connect() fails with Tuya’s actual reason when the credentials are wrong', async () => {
    const transport: TuyaTransport = {
      async request() { return { success: false, code: 1004, msg: 'sign invalid' } },
    }
    const c = connector(transport, 'uid-1')
    await expect(c.connect()).rejects.toThrow(/Access Secret/)
    expect(c.health().status).toBe('error')
  })

  it('discovers a real fleet through the per-user endpoint when a UID is set', async () => {
    const { transport, calls } = scriptedTransport({
      success: true,
      result: [
        { id: 'bulb', name: 'Lampe', category: 'dj', online: true, status: [{ code: 'switch_led', value: true }] },
      ],
    })
    const c = connector(transport, 'uid-1')
    await c.connect()
    const devices = await c.discover()
    expect(devices).toHaveLength(1)
    expect(findCapability(devices[0].capabilities, 'OnOff')).toMatchObject({ on: true })
    expect(calls.some((x) => x.path === '/v1.0/users/uid-1/devices')).toBe(true)
  })

  it('discovers through the association endpoint — and its nested envelope — without a UID', async () => {
    const { transport, calls } = scriptedTransport({
      success: true,
      result: {
        devices: [
          { id: 'plug', name: 'Steckdose', category: 'cz', online: true, status: [{ code: 'switch_1', value: false }] },
        ],
        has_more: false,
      },
    })
    const c = connector(transport, undefined)
    await c.connect()
    const devices = await c.discover()
    // Both halves of the old bug: right endpoint, and its envelope parsed.
    expect(calls.some((x) => x.path.startsWith('/v1.0/iot-01/associated-users/devices'))).toBe(true)
    expect(devices).toHaveLength(1)
    expect(devices[0].name).toBe('Steckdose')
  })

  it('falls back to the token’s UID only after the project listing found nothing', async () => {
    const { transport, calls } = scriptedTransport({ success: true, result: [] }, { uid: 'uid-from-token' })
    const c = connector(transport, undefined)
    await c.connect()
    await c.discover()
    const paths = calls.map((x) => x.path)
    // Project scope first…
    expect(paths.findIndex((p) => p.startsWith('/v1.0/iot-01/associated-users/devices')))
      .toBeLessThan(paths.findIndex((p) => p === '/v1.0/users/uid-from-token/devices'))
  })

  it('does not consult the token’s UID when the project listing already worked', async () => {
    // The token uid of a simple-mode grant is the project owner, which is not
    // necessarily a linked app account — routing to it first would answer empty
    // for exactly the projects the association endpoint serves correctly.
    const { transport, calls } = scriptedTransport({
      success: true,
      result: { devices: [{ id: 'a', name: 'A', category: 'cz', status: [{ code: 'switch_1', value: true }] }], has_more: false },
    }, { uid: 'uid-from-token' })
    const c = connector(transport, undefined)
    await c.connect()
    expect(await c.discover()).toHaveLength(1)
    expect(calls.some((x) => x.path === '/v1.0/users/uid-from-token/devices')).toBe(false)
  })

  it('a configured UID always wins — the fallback never overrides it', async () => {
    const { transport, calls } = scriptedTransport({ success: true, result: [] }, { uid: 'uid-from-token' })
    const c = connector(transport, 'uid-configured')
    await c.connect()
    await c.discover()
    expect(calls.some((x) => x.path === '/v1.0/users/uid-configured/devices')).toBe(true)
    expect(calls.some((x) => x.path.includes('uid-from-token'))).toBe(false)
  })

  it('follows pagination on the association endpoint', async () => {
    let page = 0
    const transport: TuyaTransport = {
      async request<T>(req: TuyaRequest): Promise<TuyaApiResponse<T>> {
        if (req.path.startsWith('/v1.0/token')) {
          return { success: true, result: { access_token: 't', refresh_token: 'r', expire_time: 7200 } } as TuyaApiResponse<T>
        }
        page++
        return {
          success: true,
          result: page === 1
            ? { devices: [{ id: 'a', name: 'A', category: 'cz', status: [{ code: 'switch_1', value: true }] }], has_more: true, last_row_key: 'k1' }
            : { devices: [{ id: 'b', name: 'B', category: 'cz', status: [{ code: 'switch_1', value: true }] }], has_more: false },
        } as TuyaApiResponse<T>
      },
    }
    const c = connector(transport, undefined)
    await c.connect()
    const devices = await c.discover()
    expect(devices.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('reports the real error when discovery is refused after a good login', async () => {
    const { transport } = scriptedTransport({ success: false, code: 1106, msg: 'permission deny' })
    const c = connector(transport, 'uid-1')
    await c.connect() // authentication succeeds…
    await expect(c.discover()).rejects.toThrow(/IoT Core/) // …discovery does not.
  })

  it('refuses to read an unrecognised answer as an empty account', async () => {
    const { transport } = scriptedTransport({ success: true, result: { unexpected: true } })
    const c = connector(transport, 'uid-1')
    await c.connect()
    await expect(c.discover()).rejects.toThrow(/unbekannten Format/)
  })

  it('an empty account discovers cleanly and says why it is empty', async () => {
    const { transport } = scriptedTransport({ success: true, result: [] })
    const c = connector(transport, 'uid-1')
    await c.connect()
    expect(await c.discover()).toEqual([])
    // Not an error — a connected connector with an explanation attached.
    expect(c.health().status).toBe('connected')
    expect(c.health().message).toContain('keine Geräte')
  })
})

describe('Tuya devices are never silently dropped', () => {
  it('keeps a device whose data points we cannot translate', () => {
    // A camera, a gateway, a doorbell — anything outside the DP vocabulary.
    const device = mapTuyaDevicePassive(
      { id: 'cam-1', name: 'Türklingel', category: 'sp', online: true, status: [{ code: 'unknown_dp', value: 1 }] },
      'tuya',
    )
    expect(device.id).toBe('cam-1')
    expect(device.capabilities).toEqual([])
    expect(device.metadata?.unsupported).toBe('true')
    expect(device.metadata?.tuyaCategory).toBe('sp')
  })

  it('a fleet of untranslatable devices still reaches the twin', async () => {
    const { transport } = scriptedTransport({
      success: true,
      result: [
        { id: 'x', name: 'Gateway', category: 'wg2', online: true, status: [] },
        { id: 'y', name: 'Kamera', category: 'sp', online: true, status: [{ code: 'nope', value: 0 }] },
      ],
    })
    const c = connector(transport, 'uid-1')
    await c.connect()
    const devices = await c.discover()
    // Previously: both filtered out, list empty, connector reported "connected".
    expect(devices.map((d) => d.id)).toEqual(['x', 'y'])
    expect(c.health().message).toContain('keine bekannten Datenpunkte')
  })

  it('still maps the devices it does understand, alongside the ones it does not', async () => {
    const { transport } = scriptedTransport({
      success: true,
      result: [
        { id: 'lamp', name: 'Lampe', category: 'dj', online: true, status: [{ code: 'switch_led', value: true }] },
        { id: 'mystery', name: 'Unbekannt', online: true, status: [] },
      ],
    })
    const c = connector(transport, 'uid-1')
    await c.connect()
    const devices = await c.discover()
    expect(devices).toHaveLength(2)
    expect(findCapability(devices[0].capabilities, 'OnOff')).toBeTruthy()
    expect(devices[1].capabilities).toEqual([])
  })
})
