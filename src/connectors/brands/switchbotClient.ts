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
import { trace, traceError } from '../diagnostics'

const SB_BASE = 'https://api.switch-bot.com'

/** Trace/diagnostics key for this vendor. */
const TRACE = 'switchbot'

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
  /** True for entries from `infraredRemoteList` — they have no `/status`. */
  infrared?: boolean
}

/** SwitchBot's envelope around every answer. */
interface SbEnvelope {
  statusCode?: number
  message?: string
  body?: {
    deviceList?: SbDevice[]
    infraredRemoteList?: SbDevice[]
  }
}

/** What SwitchBot's numeric status codes mean where it matters to a user. */
function switchbotStatusMessage(code: number, message?: string): string {
  if (code === 401 || code === 403) {
    return 'SwitchBot lehnt die Anmeldung ab — Token und Secret prüfen. '
      + '(Die Signatur enthält einen Zeitstempel: eine stark falsch gehende Systemuhr führt zum selben Fehler.)'
  }
  if (code === 190) return 'SwitchBot meldet einen internen Fehler (190) — später erneut versuchen'
  return `SwitchBot-API meldet Status ${code}${message ? `: ${message}` : ''}`
}

/**
 * Unwrap a `/v1.1/devices` answer.
 *
 * The bug this exists for: SwitchBot answers **HTTP 200** even when it rejects
 * the credentials, and puts the real outcome in `statusCode` with an empty
 * `body`. Reading `body.deviceList` straight off that produced an empty array,
 * so the connector connected successfully and showed no devices — no error
 * anywhere, and nothing to act on.
 *
 * The second half: an account whose devices are IR remotes behind a Hub has
 * them in `infraredRemoteList`, not `deviceList`. Those were dropped entirely.
 */
export function parseSwitchBotDevices(json: SbEnvelope): SbDevice[] {
  const code = json?.statusCode
  if (typeof code === 'number' && code !== 100) {
    throw new Error(switchbotStatusMessage(code, json.message))
  }
  const physical = json?.body?.deviceList ?? []
  const infrared = (json?.body?.infraredRemoteList ?? []).map((d) => ({ ...d, infrared: true }))
  return [...physical, ...infrared]
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

/**
 * What a non-2xx answer actually said.
 *
 * The old code turned every failing status into the same sentence — "Token/
 * Secret/Relay prüfen" — which is wrong more often than it is right, and sends
 * the user to inspect credentials that are usually fine. Three of the four
 * common causes are not credentials at all:
 *
 *   401 + a Supabase gateway body  the relay was deployed *without*
 *                                  `--no-verify-jwt`, so the call never left
 *                                  Supabase and SwitchBot never saw it
 *   404 `unknown vendor`           the relay URL is missing `/vendor-relay`
 *   502 `upstream unreachable`     the relay reached out and SwitchBot did not
 *                                  answer — with the relay's own detail text
 *
 * The body is parsed rather than guessed at, so the message names the layer
 * that actually refused.
 */
export function switchbotHttpError(status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : undefined
  const relayError = typeof record?.error === 'string' ? record.error : undefined
  const detail = typeof record?.detail === 'string' ? record.detail : undefined

  if (relayError === 'upstream unreachable') {
    return `Das Relay erreicht die SwitchBot-Cloud nicht${detail ? ` (${detail})` : ''}`
  }
  if (relayError === 'unknown vendor') {
    return 'Die Relay-URL zeigt nicht auf die Relay-Funktion — sie muss auf '
      + '/functions/v1/vendor-relay enden (ohne Vendor-Segment).'
  }
  if (status === 401 || status === 403) {
    // Supabase answers a JWT-gated function with its own envelope; SwitchBot's
    // own rejections arrive as HTTP 200 with statusCode 401 in the body, never
    // as a bare HTTP 401. So an HTTP 401 here is almost always the gateway.
    const gateway = typeof record?.message === 'string' ? record.message : undefined
    if (gateway && /jwt|authorization/i.test(gateway)) {
      return 'Das Relay verlangt einen Supabase-JWT — die Function muss mit '
        + '`--no-verify-jwt` deployt werden, sonst erreicht keine Anfrage SwitchBot.'
    }
    return `Relay oder Gateway lehnt die Anfrage ab (${status})${gateway ? `: ${gateway}` : ''}`
  }
  if (status === 404) {
    return 'Relay-Route nicht gefunden (404) — Relay-URL prüfen und ob die Function deployt ist'
  }
  return `SwitchBot-Anfrage fehlgeschlagen (HTTP ${status})${relayError ? `: ${relayError}` : ''}`
}

/** Read a failed response's body without letting a parse error mask the status. */
async function errorBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    if (!text) return undefined
    try { return JSON.parse(text) } catch { return { error: text.slice(0, 200) } }
  } catch {
    return undefined
  }
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
    trace(TRACE, 'request', 'Geräteliste angefragt', { relayed, path: '/v1.1/devices' })
    try {
      res = await doFetch(`${base}/v1.1/devices`, { headers: await authedHeaders() })
    } catch (e) {
      const err = transportError(e, relayed)
      traceError(TRACE, 'request', err.message, { relayed })
      throw err
    }
    if (!res.ok) {
      const reason = switchbotHttpError(res.status, await errorBody(res))
      traceError(TRACE, 'request', reason, { status: res.status, relayed })
      throw new Error(reason)
    }

    // Throws with SwitchBot's own reason when the envelope says "no", even
    // though the HTTP layer said 200.
    const envelope = (await res.json()) as SbEnvelope
    let raw: SbDevice[]
    try {
      raw = parseSwitchBotDevices(envelope)
    } catch (e) {
      traceError(TRACE, 'parse', e instanceof Error ? e.message : 'Antwort abgelehnt', {
        statusCode: envelope?.statusCode ?? -1,
      })
      throw e
    }
    trace(TRACE, 'parse', 'SwitchBot-Envelope gelesen', {
      statusCode: envelope?.statusCode ?? 100,
      physical: envelope?.body?.deviceList?.length ?? 0,
      infrared: envelope?.body?.infraredRemoteList?.length ?? 0,
    })
    for (const d of raw) known.add(d.deviceId)

    // IR remotes are write-only — SwitchBot has no `/status` for them, and
    // asking burns a call per device against the 10 000/day budget.
    const states = await Promise.all(raw.map((d) => (d.infrared ? Promise.resolve(null) : readStatus(d.deviceId))))
    trace(TRACE, 'normalize', 'Geräte in neutrale Domain übersetzt', {
      devices: raw.length,
      withLiveStatus: states.filter((s) => s !== null).length,
    })

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
        metadata: {
          model: d.deviceType ?? d.remoteType ?? 'SwitchBot',
          ...(d.infrared ? { infrared: 'true' } : {}),
        },
        health: { reachability: 'online' as const, lastSeen: new Date().toISOString() },
      }
    })
  }

  /**
   * `connect()` probes and the runtime then discovers, back to back. Without
   * this, that is two full listings plus two status calls per device before a
   * single card appears — against a 10 000 calls/day budget.
   */
  let inFlight: Promise<Device[]> | undefined
  const listOnce = (): Promise<Device[]> => {
    if (inFlight) return inFlight
    inFlight = list().finally(() => { inFlight = undefined })
    return inFlight
  }
  let recent: { at: number; devices: Device[] } | undefined
  const listShared = async (): Promise<Device[]> => {
    if (recent && Date.now() - recent.at < 2000) return recent.devices
    const devices = await listOnce()
    recent = { at: Date.now(), devices }
    return devices
  }

  return {
    list: listShared,

    /**
     * Report an empty account as a *note*, not as silence. "Verbunden" with
     * zero devices and no explanation was the confusing half of the original
     * bug; the credentials case now throws above, and this covers the rest.
     */
    probe: async () => {
      const devices = await listShared()
      trace(TRACE, 'auth', 'Signatur akzeptiert, Konto gelesen', { devices: devices.length })
      if (devices.length === 0) {
        return {
          message: 'Verbunden, aber das SwitchBot-Konto liefert keine Geräte — '
            + 'in der SwitchBot-App prüfen, ob der Cloud-Dienst für die Geräte aktiviert ist.',
        }
      }
      return undefined
    },

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
      if (!res.ok) {
        const reason = switchbotHttpError(res.status, await errorBody(res))
        traceError(TRACE, 'command', reason, { status: res.status })
        throw new Error(reason)
      }
      trace(TRACE, 'command', 'Befehl angenommen', { capability: cmd.capability })
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
