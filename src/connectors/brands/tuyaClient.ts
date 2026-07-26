/**
 * tuyaClient.ts — real Tuya / Smart Life Cloud API v2 client.
 *
 * Tuya requires a signed request flow: fetch an access token, then sign every
 * business call with HMAC-SHA256 over
 *   clientId [+ accessToken] + t + stringToSign
 * where stringToSign = METHOD\n SHA256(body)\n \n path. Signing is done in the
 * browser with WebCrypto; the vendor-relay only forwards (Tuya sends no CORS).
 *
 * Devices come from the linked Smart-Life app account: GET /v1.0/users/{uid}/devices.
 * Status data-points (DP codes) are mapped onto the neutral capabilities,
 * including robot vacuums (category 'sd').
 */

import type { Capability, Device, DeviceCommand, DeviceCategory } from '@/domain'
import type { BrandClient } from './brandConnector'

export type TuyaRegion = 'eu' | 'us' | 'cn' | 'in'
const TUYA_HOST: Record<TuyaRegion, string> = {
  eu: 'https://openapi.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
}

export interface TuyaClientOptions {
  clientId: string
  secret: string
  /** Linked Smart-Life app account UID (Tuya IoT → Link App Account → user id). */
  uid: string
  region?: TuyaRegion
  /** Relay base (…/vendor-relay). Client routes to /tuya-<region> under it. */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** Tuya canonical stringToSign for a request (exported for tests). */
export async function tuyaStringToSign(method: string, path: string, body: string): Promise<string> {
  return `${method}\n${await sha256Hex(body)}\n\n${path}`
}

/** Compose + sign a Tuya request (exported for tests). Deterministic. */
export async function tuyaSign(opts: { clientId: string; secret: string; t: string; accessToken?: string; method: string; path: string; body?: string }): Promise<string> {
  const sts = await tuyaStringToSign(opts.method, opts.path, opts.body ?? '')
  const str = opts.clientId + (opts.accessToken ?? '') + opts.t + sts
  return hmacSha256Hex(opts.secret, str)
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined)

interface TuyaStatus { code: string; value: unknown }

function categoryOf(tuyaCategory: string): DeviceCategory {
  const c = tuyaCategory
  if (c === 'sd' || c === 'sweeper') return 'appliance'          // robot vacuum
  if (['dj', 'dd', 'dc', 'fwd', 'tgq', 'xdd', 'dsd', 'tyndj'].includes(c)) return 'light'
  if (['cz', 'pc', 'wkcz'].includes(c)) return 'energy'          // socket / power strip
  if (['kg', 'tdq', 'qt'].includes(c)) return 'other'            // switch
  if (['ms', 'jtmspro', 'mk'].includes(c)) return 'lock'
  if (['wk', 'wkf', 'ktkzq'].includes(c)) return 'climate'
  if (['cl', 'clkg'].includes(c)) return 'cover'                 // curtain
  if (['wsdcg', 'ldcg', 'zd', 'pir'].includes(c)) return 'sensor'
  return 'other'
}

/** Map a Tuya status[] + category to neutral capabilities. The DP codes used
 *  for writable capabilities are returned so control knows what to send. */
export function tuyaCapsFor(status: TuyaStatus[], category: string): { caps: Capability[]; codes: Record<string, string>; battery?: number } {
  const by = new Map(status.map((s) => [s.code, s.value]))
  const has = (c: string) => by.has(c)
  const codes: Record<string, string> = {}
  const caps: Capability[] = []
  const isVac = category === 'sd' || category === 'sweeper'

  // OnOff / power — pick the first present switch-like DP.
  const onCode = ['switch', 'switch_1', 'switch_led', 'power', 'power_go'].find(has)
  if (onCode) { codes.OnOff = onCode; caps.push({ kind: 'OnOff', access: 'readWrite', on: by.get(onCode) === true }) }
  else if (isVac) { codes.OnOff = 'power_go'; caps.push({ kind: 'OnOff', access: 'readWrite', on: false }) }

  // Brightness (Tuya 0..1000)
  const brCode = ['bright_value_v2', 'bright_value'].find(has)
  if (brCode) { codes.Brightness = brCode; caps.push({ kind: 'Brightness', access: 'readWrite', percent: Math.round(((num(by.get(brCode)) ?? 0) / 1000) * 100) }) }
  const ctCode = ['temp_value_v2', 'temp_value'].find(has)
  if (ctCode) { codes.ColorTemperature = ctCode; caps.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin: 4000, minKelvin: 2700, maxKelvin: 6500 }) }

  // Energy (Tuya cur_power in 0.1 W)
  if (has('cur_power')) caps.push({ kind: 'Energy', access: 'read', watts: Math.round((num(by.get('cur_power')) ?? 0) / 10) })

  // Battery
  const batCode = ['battery_percentage', 'electricity_left', 'residual_electricity'].find(has)
  const battery = batCode ? num(by.get(batCode)) : undefined

  // Vacuum activity
  if (isVac) {
    const modeCode = ['mode', 'status'].find(has)
    const raw = modeCode ? String(by.get(modeCode) ?? '') : ''
    const activity: 'idle' | 'cleaning' | 'returning' | 'docked' =
      // Returning must be tested before the generic "charg", otherwise
      // `chargego` / `goto_charge` (heading home) is mistaken for docked.
      /chargego|goto_?charge|going_home|to_charge|back_charge|return/i.test(raw) ? 'returning'
      : /charg|dock|complete|full/i.test(raw) ? 'docked'
      : /smart|auto|clean|work|mop|zone|spot|edge|spiral/i.test(raw) ? 'cleaning'
      : /stand|paus|idle|stop|sleep/i.test(raw) ? 'idle'
      : 'idle'
    codes.Vacuum = 'power_go'
    caps.push({ kind: 'Vacuum', access: 'readWrite', activity })
  }

  return { caps, codes, battery }
}

/** Map a neutral command to Tuya command(s), using the device's recorded DP codes. */
export function tuyaCommandFor(cmd: DeviceCommand, codes: Record<string, string>): Array<{ code: string; value: unknown }> {
  switch (cmd.capability) {
    case 'OnOff':
      return [{ code: codes.OnOff ?? 'switch', value: Boolean(cmd.payload.on) }]
    case 'Brightness':
      return [{ code: codes.Brightness ?? 'bright_value_v2', value: Math.round((Number(cmd.payload.percent) / 100) * 1000) }]
    case 'Vacuum': {
      const a = String(cmd.payload.activity ?? '')
      // Return-to-dock is `mode: chargego`; `seek` only makes the robot beep
      // to locate it — it does not send it home.
      if (/return|dock/i.test(a)) return [{ code: 'mode', value: 'chargego' }]
      if (/paus|idle|stop/i.test(a)) return [{ code: codes.Vacuum ?? 'power_go', value: false }]
      return [{ code: codes.Vacuum ?? 'power_go', value: true }]
    }
    default:
      throw new Error(`Tuya unterstützt Capability ${cmd.capability} nicht`)
  }
}

interface TuyaDevice { id: string; name: string; category: string; online?: boolean; status?: TuyaStatus[] }

export function createTuyaClient(opts: TuyaClientOptions): BrandClient {
  const region = opts.region ?? 'eu'
  const host = opts.baseUrl ? `${opts.baseUrl.replace(/\/+$/, '')}/tuya-${region}` : TUYA_HOST[region]
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)
  const codesById = new Map<string, Record<string, string>>()
  let token = ''
  let tokenExp = 0

  const getToken = async (): Promise<string> => {
    if (token && Date.now() < tokenExp) return token
    const path = '/v1.0/token?grant_type=1'
    const t = Date.now().toString()
    const sign = await tuyaSign({ clientId: opts.clientId, secret: opts.secret, t, method: 'GET', path })
    const res = await doFetch(host + path, { headers: { client_id: opts.clientId, sign, t, sign_method: 'HMAC-SHA256' } })
    if (!res.ok) throw new Error(`Tuya-Token ${res.status} — Client-ID/Secret/Region/Relay prüfen`)
    const j = (await res.json()) as { success?: boolean; msg?: string; result?: { access_token: string; expire_time: number } }
    if (!j.result?.access_token) throw new Error(`Tuya-Login abgelehnt: ${j.msg ?? 'unbekannt'}`)
    token = j.result.access_token
    tokenExp = Date.now() + (j.result.expire_time - 60) * 1000
    return token
  }

  const req = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const at = await getToken()
    const t = Date.now().toString()
    const bodyStr = body ? JSON.stringify(body) : ''
    const sign = await tuyaSign({ clientId: opts.clientId, secret: opts.secret, t, accessToken: at, method, path, body: bodyStr })
    const res = await doFetch(host + path, {
      method,
      headers: { client_id: opts.clientId, access_token: at, sign, t, sign_method: 'HMAC-SHA256', 'Content-Type': 'application/json' },
      body: bodyStr || undefined,
    })
    if (!res.ok) throw new Error(`Tuya-API ${res.status}`)
    return res.json()
  }

  const list = async (): Promise<Device[]> => {
    const j = (await req('GET', `/v1.0/users/${encodeURIComponent(opts.uid)}/devices`)) as { result?: TuyaDevice[] }
    return (j.result ?? []).map((d) => {
      const { caps, codes, battery } = tuyaCapsFor(d.status ?? [], d.category)
      codesById.set(d.id, codes)
      const dev: Device = {
        id: d.id,
        connectorId: 'tuya',
        name: d.name || d.id,
        category: categoryOf(d.category),
        capabilities: caps,
        metadata: { model: d.category },
        health: { reachability: d.online === false ? ('offline' as const) : ('online' as const), lastSeen: new Date().toISOString() },
      }
      if (battery !== undefined) dev.battery = { percent: battery }
      return dev
    })
  }

  return {
    list,
    probe: async () => { await getToken() },
    control: async (cmd) => {
      const codes = codesById.get(cmd.deviceId) ?? {}
      const commands = tuyaCommandFor(cmd, codes)
      await req('POST', `/v1.0/devices/${encodeURIComponent(cmd.deviceId)}/commands`, { commands })
    },
  }
}
