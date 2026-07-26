/**
 * switchbotClient.ts — real SwitchBot Web-API v1.1 client.
 *
 * Auth is token + secret with an HMAC-SHA256 request signature (t + nonce),
 * computed via WebCrypto. Browsers are CORS-blocked against
 * api.switch-bot.com, so the base URL is overridable with a relay (see
 * docs/CONNECTOR_SETUP.md). Maps Bots, Locks, Meters, Plugs and Curtains onto
 * the neutral capabilities.
 */

import type { Capability, Device, DeviceCommand } from '@/domain'
import type { BrandClient } from './brandConnector'

const SB_BASE = 'https://api.switch-bot.com'

export interface SwitchBotClientOptions {
  token: string
  secret: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/** v1.1 signature: base64(HMAC-SHA256(secret, token + t + nonce)). Exported for tests. */
export async function switchbotSign(token: string, secret: string, t: string, nonce: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token + t + nonce))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

interface SbDevice {
  deviceId: string
  deviceName: string
  deviceType?: string
  remoteType?: string
}

export function switchbotCapsFor(type: string): { category: Device['category']; caps: Capability[] } {
  const t = type.toLowerCase()
  if (t.includes('lock')) return { category: 'lock', caps: [{ kind: 'Lock', access: 'readWrite', locked: true }] }
  if (t.includes('bot')) return { category: 'other', caps: [{ kind: 'OnOff', access: 'readWrite', on: false }] }
  if (t.includes('plug')) return { category: 'energy', caps: [{ kind: 'OnOff', access: 'readWrite', on: false }, { kind: 'Energy', access: 'read', watts: 0 }] }
  if (t.includes('curtain') || t.includes('blind')) return { category: 'cover', caps: [{ kind: 'Position', access: 'readWrite', percent: 100 }] }
  if (t.includes('meter') || t.includes('hub 2')) return { category: 'sensor', caps: [{ kind: 'Temperature', access: 'read', celsius: 21 }, { kind: 'Humidity', access: 'read', percent: 50 }] }
  return { category: 'other', caps: [{ kind: 'OnOff', access: 'readWrite', on: false }] }
}

/** Map a neutral command onto a SwitchBot command body (exported for tests). */
export function switchbotCommand(cmd: DeviceCommand): { command: string; parameter: string | number } {
  switch (cmd.capability) {
    case 'OnOff': return { command: cmd.payload.on ? 'turnOn' : 'turnOff', parameter: 'default' }
    case 'Lock': return { command: cmd.payload.locked ? 'lock' : 'unlock', parameter: 'default' }
    case 'Position': return { command: 'setPosition', parameter: `0,ff,${100 - Number(cmd.payload.percent)}` }
    case 'Brightness': return { command: 'setBrightness', parameter: Number(cmd.payload.percent) }
    default: throw new Error(`SwitchBot unterstützt Capability ${cmd.capability} nicht`)
  }
}

export function createSwitchBotClient(opts: SwitchBotClientOptions): BrandClient {
  const base = (opts.baseUrl?.replace(/\/+$/, '') || SB_BASE)
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)

  const authedHeaders = async (): Promise<Record<string, string>> => {
    const t = Date.now().toString()
    const nonce = crypto.randomUUID()
    return {
      Authorization: opts.token,
      t, nonce,
      sign: await switchbotSign(opts.token, opts.secret, t, nonce),
      'Content-Type': 'application/json',
    }
  }

  const list = async (): Promise<Device[]> => {
    const res = await doFetch(`${base}/v1.1/devices`, { headers: await authedHeaders() })
    if (!res.ok) throw new Error(`SwitchBot-API ${res.status} — Token/Secret/Relay prüfen`)
    const json = (await res.json()) as { body?: { deviceList?: SbDevice[] } }
    return (json.body?.deviceList ?? []).map((d) => {
      const { category, caps } = switchbotCapsFor(d.deviceType ?? d.remoteType ?? '')
      return {
        id: d.deviceId,
        connectorId: 'switchbot',
        name: d.deviceName || d.deviceId,
        category,
        capabilities: caps,
        metadata: { model: d.deviceType ?? 'SwitchBot' },
        health: { reachability: 'online' as const, lastSeen: new Date().toISOString() },
      }
    })
  }

  return {
    list,
    probe: async () => { await list() },
    control: async (cmd) => {
      const body = { ...switchbotCommand(cmd), commandType: 'command' }
      const res = await doFetch(`${base}/v1.1/devices/${encodeURIComponent(cmd.deviceId)}/commands`, {
        method: 'POST', headers: await authedHeaders(), body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`SwitchBot-Steuerung fehlgeschlagen (${res.status})`)
    },
  }
}
