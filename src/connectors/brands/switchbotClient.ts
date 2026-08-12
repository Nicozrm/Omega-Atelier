/**
 * switchbotClient.ts — real SwitchBot Web-API v1.1 client.
 *
 * Auth is token + secret with an HMAC-SHA256 request signature (t + nonce),
 * computed via WebCrypto. Maps Bots, Locks, Meters, Plugs and Curtains onto
 * the neutral capabilities.
 *
 * ## The relay is mandatory here, unlike Govee
 *
 * `api.switch-bot.com` is unreachable from a browser, and no change to the auth
 * scheme fixes that. Measured against the live endpoint:
 *
 *   OPTIONS /v1.1/devices          → 404 "no Route matched with those values"
 *   (and no `access-control-allow-origin` on any response)
 *
 * Two independent blocks follow. The gateway does not implement the preflight
 * at all, and every request carries `Authorization`, which is not a
 * CORS-safelisted header and therefore always *triggers* a preflight — so the
 * browser never even sends the real request. Even if it did, the response
 * carries no `allow-origin`, so the result could not be read.
 *
 * This is why "just use the API key without the secret" does not help: the
 * older token-only scheme sends the same `Authorization` header and is blocked
 * identically. The signature is not the obstacle; the missing CORS layer is.
 * Hence `baseUrl` → the relay in `supabase/functions/vendor-relay`.
 *
 * Govee is the opposite case and needs no relay — see `goveeClient`.
 */

import type { Capability, Device, DeviceCommand, DeviceUpdate, Unsubscribe } from '@/domain'
import type { BrandClient } from './brandConnector'

const SB_BASE = 'https://api.switch-bot.com'

/**
 * Status poll interval, ms. SwitchBot allows 10 000 calls/day per token and has
 * no push channel, so the same arithmetic as Govee applies: one call per device
 * per tick.
 */
const POLL_MS = 30_000

export interface SwitchBotClientOptions {
  token: string
  secret: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Poll interval override, ms. 0 disables the live channel. */
  pollMs?: number
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

/**
 * Fold a `/status` body onto the neutral capabilities.
 *
 * Pure and exported: this response differs per device type and is the piece no
 * test of ours can pin down from the outside, so it is the piece worth testing
 * against recorded payloads.
 */
export function switchbotCapsFromStatus(body: Record<string, unknown>): Capability[] {
  const caps: Capability[] = []
  if (typeof body.power === 'string') {
    caps.push({ kind: 'OnOff', access: 'readWrite', on: body.power.toLowerCase() === 'on' })
  }
  if (typeof body.brightness === 'number') {
    caps.push({ kind: 'Brightness', access: 'readWrite', percent: Math.round(body.brightness) })
  }
  if (typeof body.lockState === 'string') {
    caps.push({ kind: 'Lock', access: 'readWrite', locked: body.lockState.toLowerCase() === 'locked' })
  }
  if (typeof body.slidePosition === 'number') {
    // SwitchBot counts 0 = fully open; the neutral capability counts 0 = closed.
    caps.push({ kind: 'Position', access: 'readWrite', percent: 100 - Math.round(body.slidePosition) })
  }
  if (typeof body.temperature === 'number') {
    caps.push({ kind: 'Temperature', access: 'read', celsius: body.temperature })
  }
  if (typeof body.humidity === 'number') {
    caps.push({ kind: 'Humidity', access: 'read', percent: Math.round(body.humidity) })
  }
  return caps
}

/**
 * Turn a failed `fetch` into a message that names the actual cause.
 *
 * A browser reports a blocked cross-origin request as a bare `TypeError`
 * ("Load failed" in Safari, "Failed to fetch" in Chrome) — indistinguishable
 * from the server being down, and useless to a user who is looking at valid
 * credentials. Since SwitchBot *always* needs the relay, that is the answer
 * worth printing.
 */
function transportError(e: unknown, relayed: boolean): Error {
  if (e instanceof TypeError) {
    return new Error(
      relayed
        ? 'Relay nicht erreichbar — URL prüfen und ob die Function deployt ist'
        : 'SwitchBot ist ohne Relay nicht aus dem Browser erreichbar (CORS) — Relay-URL eintragen',
    )
  }
  return e instanceof Error ? e : new Error('SwitchBot-Anfrage fehlgeschlagen')
}

export function createSwitchBotClient(opts: SwitchBotClientOptions): BrandClient {
  const base = (opts.baseUrl?.replace(/\/+$/, '') || SB_BASE)
  const relayed = !!opts.baseUrl
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)
  const pollMs = opts.pollMs ?? POLL_MS
  const known = new Set<string>()
  const lastSeen = new Map<string, string>()

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

  /** Live status of one device, or `null` when SwitchBot will not say. */
  const readStatus = async (deviceId: string): Promise<Capability[] | null> => {
    try {
      const res = await doFetch(`${base}/v1.1/devices/${encodeURIComponent(deviceId)}/status`, {
        headers: await authedHeaders(),
      })
      if (!res.ok) return null
      const json = (await res.json()) as { body?: Record<string, unknown> }
      const caps = json.body ? switchbotCapsFromStatus(json.body) : []
      return caps.length ? caps : null
    } catch {
      // One unreadable device must not fail the whole listing.
      return null
    }
  }

  /** Real status wins over the type-derived default; anything absent keeps it. */
  const merge = (declared: Capability[], actual: Capability[] | null): Capability[] => {
    if (!actual?.length) return declared
    const byKind = new Map(actual.map((c) => [c.kind, c]))
    const merged = declared.map((c) => byKind.get(c.kind) ?? c)
    for (const c of actual) if (!merged.some((m) => m.kind === c.kind)) merged.push(c)
    return merged
  }

  const list = async (): Promise<Device[]> => {
    let res: Response
    try {
      res = await doFetch(`${base}/v1.1/devices`, { headers: await authedHeaders() })
    } catch (e) {
      throw transportError(e, relayed)
    }
    if (!res.ok) throw new Error(`SwitchBot-API ${res.status} — Token/Secret/Relay prüfen`)
    const json = (await res.json()) as { body?: { deviceList?: SbDevice[] } }
    const raw = json.body?.deviceList ?? []
    for (const d of raw) known.add(d.deviceId)

    const states = await Promise.all(raw.map((d) => readStatus(d.deviceId)))

    return raw.map((d, i) => {
      const { category, caps } = switchbotCapsFor(d.deviceType ?? d.remoteType ?? '')
      const capabilities = merge(caps, states[i])
      // Same basis as the poll compares on — see the note in `goveeClient`.
      lastSeen.set(d.deviceId, JSON.stringify(states[i] ?? []))
      return {
        id: d.deviceId,
        connectorId: 'switchbot',
        name: d.deviceName || d.deviceId,
        category,
        capabilities,
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
      let res: Response
      try {
        res = await doFetch(`${base}/v1.1/devices/${encodeURIComponent(cmd.deviceId)}/commands`, {
          method: 'POST', headers: await authedHeaders(), body: JSON.stringify(body),
        })
      } catch (e) {
        throw transportError(e, relayed)
      }
      if (!res.ok) throw new Error(`SwitchBot-Steuerung fehlgeschlagen (${res.status})`)
    },

    /** Same reasoning as Govee: no push channel, so the live path is a poll. */
    subscribe: (onUpdate: (u: DeviceUpdate) => void): Unsubscribe => {
      if (pollMs <= 0) return () => {}
      let stopped = false
      const tick = async (): Promise<void> => {
        for (const deviceId of [...known]) {
          if (stopped) return
          const caps = await readStatus(deviceId)
          if (!caps?.length) continue
          const key = JSON.stringify(caps)
          if (lastSeen.get(deviceId) === key) continue
          lastSeen.set(deviceId, key)
          onUpdate({
            deviceId,
            capabilities: caps,
            health: { reachability: 'online', lastSeen: new Date().toISOString() },
          })
        }
      }
      const timer = setInterval(() => { void tick() }, pollMs)
      return () => { stopped = true; clearInterval(timer) }
    },
  }
}
