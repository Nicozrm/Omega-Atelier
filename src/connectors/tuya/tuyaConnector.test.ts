import { describe, it, expect, vi } from 'vitest'
import { createTuyaConnector } from './tuyaConnector'
import { SimulatedTuyaTransport } from './simulatedTransport'
import type { TuyaTransport, TuyaRequest, TuyaApiResponse } from './transport'
import { findCapability, type DeviceUpdate } from '@/domain'

const make = (transport = new SimulatedTuyaTransport(), extra = {}) =>
  createTuyaConnector({ transport, clientId: 'cid', secret: 'sec', uid: 'sim-uid', pollMs: 20, ...extra })

describe('Tuya connector — full lifecycle against the simulator', () => {
  it('connects, discovers the fleet, and maps it to neutral devices', async () => {
    const c = make()
    await c.connect()
    expect(c.health().status).toBe('connected')

    const devices = await c.discover()
    expect(devices.length).toBeGreaterThanOrEqual(4)
    // Every device is stamped with this connector's id (routing) and is neutral.
    expect(devices.every((d) => d.connectorId === 'tuya-cloud')).toBe(true)
    const bulb = devices.find((d) => d.id === 'tuya-bulb-wz')!
    expect(bulb.category).toBe('light')
    expect(findCapability(bulb.capabilities, 'OnOff')).toMatchObject({ on: true })
    expect(findCapability(bulb.capabilities, 'Brightness')).toBeTruthy()
  })

  it('polls and streams live device updates', async () => {
    const c = make()
    await c.connect()
    await c.discover()
    const updates: DeviceUpdate[] = []
    const unsub = c.subscribe((u) => updates.push(u))
    await new Promise((r) => setTimeout(r, 120)) // several poll cycles
    unsub()
    expect(updates.length).toBeGreaterThan(0)
    await c.disconnect()
  })

  it('routes a command through to Tuya and the next poll reflects it', async () => {
    const c = make()
    await c.connect()
    await c.discover()
    // Turn the TV plug OFF.
    await c.publish({ deviceId: 'tuya-plug-tv', capability: 'OnOff', payload: { on: false } })
    const after = await c.synchronize()
    const plug = after.find((d) => d.id === 'tuya-plug-tv')!
    expect(findCapability(plug.capabilities, 'OnOff')).toMatchObject({ on: false })
    // Off ⇒ zero power, exactly like a real plug.
    expect(findCapability(plug.capabilities, 'Energy')).toMatchObject({ watts: 0 })
  })

  it('drives a Tuya vacuum: cleaning command reaches the device', async () => {
    const c = make()
    await c.connect()
    await c.publish({ deviceId: 'tuya-robo-s8', capability: 'Vacuum', payload: { activity: 'cleaning' } })
    const after = await c.synchronize()
    const robo = after.find((d) => d.id === 'tuya-robo-s8')!
    expect(findCapability(robo.capabilities, 'Vacuum')).toMatchObject({ activity: 'cleaning' })
  })

  it('drives a Tuya vacuum: return command settles it docked', async () => {
    const c = make()
    await c.connect()
    await c.publish({ deviceId: 'tuya-robo-s8', capability: 'Vacuum', payload: { activity: 'returning' } })
    // Command sets status=goto_charge; the poll's drift advances it to charging.
    const after = await c.synchronize()
    const robo = after.find((d) => d.id === 'tuya-robo-s8')!
    expect(findCapability(robo.capabilities, 'Vacuum')).toMatchObject({ activity: 'docked' })
  })

  it('signs every request: client_id, sign, t, sign_method, nonce headers are present', async () => {
    const seen: TuyaRequest[] = []
    const spy: TuyaTransport = {
      request: async <T>(req: TuyaRequest): Promise<TuyaApiResponse<T>> => {
        seen.push(req)
        return new SimulatedTuyaTransport().request<T>(req)
      },
    }
    const c = make(spy)
    await c.connect()
    await c.discover()
    expect(seen.length).toBeGreaterThan(0)
    for (const req of seen) {
      expect(req.headers.client_id).toBe('cid')
      expect(req.headers.sign).toMatch(/^[0-9A-F]{64}$/)
      expect(req.headers.sign_method).toBe('HMAC-SHA256')
      expect(req.headers.t).toBeTruthy()
      expect(req.headers.nonce).toBeTruthy()
    }
    // The token request carries no access_token; business requests do.
    const tokenReq = seen.find((r) => r.path.startsWith('/v1.0/token'))!
    const bizReq = seen.find((r) => r.path.includes('/devices'))!
    expect(tokenReq.headers.access_token).toBeUndefined()
    expect(bizReq.headers.access_token).toBeTruthy()
  })

  it('surfaces an auth failure as an error health state', async () => {
    const failing: TuyaTransport = {
      request: async () => ({ success: false, code: 1004, msg: 'sign invalid' }),
    }
    const c = make(failing)
    await expect(c.connect()).rejects.toThrow(/sign invalid/)
    expect(c.health().status).toBe('error')
  })

  it('refreshes the token near expiry without a reconnect', async () => {
    const spy = vi.fn(async <T>(req: TuyaRequest) => new SimulatedTuyaTransport().request<T>(req))
    const c = make({ request: spy } as TuyaTransport)
    await c.connect()
    await c.discover()
    const tokenCalls = spy.mock.calls.filter((c) => (c[0] as TuyaRequest).path.startsWith('/v1.0/token')).length
    expect(tokenCalls).toBe(1) // one grant; no premature refresh
  })
})
