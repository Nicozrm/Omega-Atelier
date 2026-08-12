/**
 * goveeClient.ts — real Govee Developer-API client (OpenAPI v1).
 *
 * Talks to https://openapi.api.govee.com with the user's API key. Unlike the
 * other vendor clouds Govee *does* answer CORS preflights (verified: it returns
 * `access-control-allow-origin` for the app origin and `allow-headers: *`), so
 * the browser can reach it directly and the relay is optional here — the
 * `baseUrl` override exists for users who want everything behind one proxy.
 *
 * Maps Govee capability instances (powerSwitch / brightness / colorRgb /
 * colorTemperatureK) onto the neutral domain capabilities.
 *
 * ## Why this client reads state, and not just writes it
 *
 * The twin confirms a command by watching for a *device update* of the same
 * capability (`TwinManager.reconcilePending`). A client that only writes leaves
 * that confirmation to never arrive, and the consequences are worse than a
 * missing spinner:
 *
 *  - the command is marked `failed` after the timeout even though the lamp
 *    physically switched,
 *  - the twin keeps whatever `list()` invented — `on: false` — so the toggle
 *    never flips, and pressing it again sends `turnOn` a second time. The lamp
 *    can be switched on and never off.
 *
 * So state is read: once per `list()`, and then on a poll, because Govee offers
 * no push channel. Polling is the whole live path for this vendor.
 */

import type { Capability, Device, DeviceCommand, DeviceUpdate, Unsubscribe } from '@/domain'
import type { BrandClient } from './brandConnector'
import { errorBody, vendorHttpError } from './vendorErrors'
import { trace, traceError } from '../diagnostics'

const GOVEE_BASE = 'https://openapi.api.govee.com'

/** Trace/diagnostics key for this vendor. */
const TRACE = 'govee'

/**
 * How often device state is re-read, in ms.
 *
 * Govee's published rate limit is 10 000 requests per account per day. One poll
 * costs one request *per device*, so the ceiling is the device count: at 10 s a
 * five-lamp account spends 43 200 requests/day and would be throttled out by
 * mid-morning. 30 s costs 14 400 for one device, 4 800 each for three — and
 * keeps a manual switch at the wall visible within half a minute, which is the
 * point of the live channel.
 */
const POLL_MS = 30_000

interface GoveeCapabilityRef { type?: string; instance?: string }
interface GoveeDevice {
  device: string
  sku: string
  deviceName: string
  capabilities?: GoveeCapabilityRef[]
}
/** A capability as it comes back from the *state* endpoint. */
interface GoveeStateCapability extends GoveeCapabilityRef {
  state?: { value?: unknown } | unknown
}

export interface GoveeClientOptions {
  apiKey: string
  /** Relay/base override. Optional for Govee — it sends CORS headers itself. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Poll interval override, ms. 0 disables the live channel. */
  pollMs?: number
}

export function hexToRgbInt(hex: string): number {
  const h = hex.replace('#', '')
  return parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
}

/** Govee returns colours as a packed 24-bit integer. */
export function rgbIntToHex(value: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.round(value)))
  return `#${v.toString(16).padStart(6, '0')}`
}

/**
 * Does this capability reference mean *kind*?
 *
 * Matched on the instance name first and the capability `type` second. The type
 * is the robust half: Govee names instances per SKU family — a bulb reports
 * `colorRgb`, some strip lights report `segmentedColorRgb` — while the type
 * stays `devices.capabilities.color_setting` throughout. Keying only on the
 * instance is why colour and brightness silently failed to appear on hardware
 * whose instance names were not the ones spelled out here.
 */
function matches(c: GoveeCapabilityRef, instance: string, type: string): boolean {
  const i = (c.instance ?? '').toLowerCase()
  const t = (c.type ?? '').toLowerCase()
  if (i === instance.toLowerCase()) return true
  if (!t.endsWith(type.toLowerCase())) return false
  // The type alone is ambiguous for colour: `color_setting` carries both the
  // RGB and the Kelvin instance, so fall back to the instance's shape.
  if (type === 'color_setting') return i.includes(instance === 'colorRgb' ? 'rgb' : 'temperature')
  return true
}

const has = (caps: GoveeCapabilityRef[], instance: string, type: string): boolean =>
  caps.some((c) => matches(c, instance, type))

export function goveeCapsFor(d: GoveeDevice): Capability[] {
  const caps = d.capabilities ?? []
  const out: Capability[] = []
  if (caps.length === 0 || has(caps, 'powerSwitch', 'on_off')) {
    out.push({ kind: 'OnOff', access: 'readWrite', on: false })
  }
  if (has(caps, 'brightness', 'range')) out.push({ kind: 'Brightness', access: 'readWrite', percent: 100 })
  if (has(caps, 'colorRgb', 'color_setting')) out.push({ kind: 'Color', access: 'readWrite', hex: '#ffffff' })
  if (has(caps, 'colorTemperatureK', 'color_setting')) {
    out.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin: 4000, minKelvin: 2000, maxKelvin: 9000 })
  }
  return out
}

/** Unwrap `{ state: { value } }`, `{ state: value }` or a bare value. */
function stateValue(c: GoveeStateCapability): unknown {
  const s = c.state
  if (s && typeof s === 'object' && 'value' in (s as Record<string, unknown>)) {
    return (s as { value: unknown }).value
  }
  return s
}

/**
 * Fold a state response onto the neutral capabilities.
 *
 * Exported and pure so the mapping can be tested against recorded payloads —
 * the shape of this response is the part no unit test of ours can guarantee,
 * and the part most likely to change under us.
 */
export function goveeCapsFromState(state: GoveeStateCapability[]): Capability[] {
  const caps: Capability[] = []
  for (const c of state) {
    const v = stateValue(c)
    if (matches(c, 'powerSwitch', 'on_off')) {
      caps.push({ kind: 'OnOff', access: 'readWrite', on: v === 1 || v === true || v === '1' })
    } else if (matches(c, 'brightness', 'range')) {
      const n = Number(v)
      if (Number.isFinite(n)) caps.push({ kind: 'Brightness', access: 'readWrite', percent: Math.round(n) })
    } else if (matches(c, 'colorRgb', 'color_setting')) {
      const n = Number(v)
      if (Number.isFinite(n)) caps.push({ kind: 'Color', access: 'readWrite', hex: rgbIntToHex(n) })
    } else if (matches(c, 'colorTemperatureK', 'color_setting')) {
      const n = Number(v)
      // Govee reports 0 for "not in white mode" — not a temperature.
      if (Number.isFinite(n) && n > 0) {
        caps.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin: Math.round(n), minKelvin: 2000, maxKelvin: 9000 })
      }
    }
  }
  return caps
}

/** Map a neutral command onto Govee's control payload (exported for tests). */
export function goveeControlBody(cmd: DeviceCommand, sku: string, device: string): Record<string, unknown> {
  const cap =
    cmd.capability === 'OnOff' ? { type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: cmd.payload.on ? 1 : 0 }
    : cmd.capability === 'Brightness' ? { type: 'devices.capabilities.range', instance: 'brightness', value: Number(cmd.payload.percent) }
    : cmd.capability === 'Color' ? { type: 'devices.capabilities.color_setting', instance: 'colorRgb', value: hexToRgbInt(String(cmd.payload.hex)) }
    : cmd.capability === 'ColorTemperature' ? { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', value: Number(cmd.payload.kelvin) }
    : null
  if (!cap) throw new Error(`Govee unterstützt Capability ${cmd.capability} nicht`)
  return { requestId: crypto.randomUUID(), payload: { sku, device, capability: cap } }
}

/**
 * The capability a command *intends*, so a successful write can be echoed back
 * to the twin immediately instead of waiting up to a poll interval.
 *
 * This is not a guess about the lamp: the API call was accepted, and Govee has
 * no partial success on a single capability. The next poll overwrites it with
 * ground truth either way.
 */
export function goveeEchoCapability(cmd: DeviceCommand): Capability | null {
  switch (cmd.capability) {
    case 'OnOff': return { kind: 'OnOff', access: 'readWrite', on: Boolean(cmd.payload.on) }
    case 'Brightness': return { kind: 'Brightness', access: 'readWrite', percent: Number(cmd.payload.percent) }
    case 'Color': return { kind: 'Color', access: 'readWrite', hex: String(cmd.payload.hex) }
    case 'ColorTemperature':
      return { kind: 'ColorTemperature', access: 'readWrite', kelvin: Number(cmd.payload.kelvin), minKelvin: 2000, maxKelvin: 9000 }
    default: return null
  }
}

/** Govee's envelope around every answer. */
interface GoveeEnvelope {
  code?: number
  msg?: string
  message?: string
  data?: GoveeDevice[]
}

/**
 * Unwrap `/router/api/v1/user/devices`.
 *
 * The bug this exists for is Govee's half of the shared one: it answers **HTTP
 * 200** when it rejects the API key and puts the real outcome in `code`, with
 * no `data`. Reading `json.data ?? []` off that produced an empty array, so the
 * connector connected successfully and listed nothing — no error anywhere, and
 * a user staring at a valid-looking key with no way to tell a rejected request
 * from an account that genuinely has no devices.
 *
 * SwitchBot does the same thing with `statusCode`; see `parseSwitchBotDevices`.
 */
export function parseGoveeDevices(json: GoveeEnvelope): GoveeDevice[] {
  const code = json?.code
  if (typeof code === 'number' && code !== 200 && code !== 0) {
    const detail = json.msg ?? json.message
    if (code === 401 || code === 403) {
      throw new Error(
        'Govee lehnt den API-Key ab — Key in der Govee-Home-App unter '
        + '„Über uns → API-Key" neu anfordern.'
        + (detail ? ` (${detail})` : ''),
      )
    }
    if (code === 429) {
      throw new Error('Govee drosselt die Anfragen (429) — Tageslimit erreicht, später erneut versuchen')
    }
    throw new Error(`Govee-API meldet Code ${code}${detail ? `: ${detail}` : ''}`)
  }
  return json?.data ?? []
}

/** Turn a failed `fetch` into a message that names the actual cause. */
function transportError(e: unknown): Error {
  if (e instanceof TypeError) {
    return new Error('Govee nicht erreichbar (Netzwerk/CORS) — Relay-URL prüfen')
  }
  return e instanceof Error ? e : new Error('Govee-Anfrage fehlgeschlagen')
}

export function createGoveeClient(opts: GoveeClientOptions): BrandClient {
  const base = (opts.baseUrl?.replace(/\/+$/, '') || GOVEE_BASE)
  const doFetch = opts.fetchImpl ?? fetch.bind(globalThis)
  const headers = { 'Govee-API-Key': opts.apiKey, 'Content-Type': 'application/json' }
  const pollMs = opts.pollMs ?? POLL_MS
  // device id → sku, needed by both the control and the state call.
  const skuOf = new Map<string, string>()
  // Last capabilities seen per device, so a poll only emits real changes.
  const lastSeen = new Map<string, string>()

  /** Current state of one device, or `null` when Govee will not say. */
  const readState = async (device: string, sku: string): Promise<Capability[] | null> => {
    try {
      const res = await doFetch(`${base}/router/api/v1/device/state`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId: crypto.randomUUID(), payload: { sku, device } }),
      })
      if (!res.ok) return null
      const json = (await res.json()) as { payload?: { capabilities?: GoveeStateCapability[] } }
      const caps = json.payload?.capabilities
      return caps ? goveeCapsFromState(caps) : null
    } catch {
      // A single unreadable device must not fail the whole listing.
      return null
    }
  }

  /**
   * Merge real state over the declared capabilities: the declaration says what
   * the device *can* do, the state says what it is doing. Anything the state
   * omits keeps its declared default rather than disappearing from the UI.
   */
  const merge = (declared: Capability[], actual: Capability[] | null): Capability[] => {
    if (!actual?.length) return declared
    const byKind = new Map(actual.map((c) => [c.kind, c]))
    const merged = declared.map((c) => byKind.get(c.kind) ?? c)
    for (const c of actual) if (!merged.some((m) => m.kind === c.kind)) merged.push(c)
    return merged
  }

  const list = async (): Promise<Device[]> => {
    let res: Response
    trace(TRACE, 'request', 'Geräteliste angefragt', { relayed: !!opts.baseUrl })
    try {
      res = await doFetch(`${base}/router/api/v1/user/devices`, { headers })
    } catch (e) {
      const err = transportError(e)
      traceError(TRACE, 'request', err.message)
      throw err
    }
    if (!res.ok) {
      const reason = vendorHttpError('Govee', res.status, await errorBody(res))
      traceError(TRACE, 'request', reason, { status: res.status })
      throw new Error(reason)
    }

    const envelope = (await res.json()) as GoveeEnvelope
    let raw: GoveeDevice[]
    try {
      // Throws with Govee's own reason when the envelope says "no", even though
      // the HTTP layer said 200.
      raw = parseGoveeDevices(envelope)
    } catch (e) {
      traceError(TRACE, 'parse', e instanceof Error ? e.message : 'Antwort abgelehnt', {
        code: envelope?.code ?? -1,
      })
      throw e
    }
    trace(TRACE, 'parse', 'Govee-Envelope gelesen', {
      code: envelope?.code ?? 200,
      devices: raw.length,
    })
    for (const d of raw) skuOf.set(d.device, d.sku)

    // State is read per device and in parallel: serial reads would make the
    // first render wait on the slowest lamp times the device count.
    const states = await Promise.all(raw.map((d) => readState(d.device, d.sku)))

    return raw.map((d, i) => {
      const capabilities = merge(goveeCapsFor(d), states[i])
      // Cached on the *state-derived* set, not the merged one: the poll compares
      // against what `readState` returns, and comparing a merged list to a raw
      // one differs on every tick — every poll would report a phantom change.
      lastSeen.set(d.device, JSON.stringify(states[i] ?? []))
      return {
        id: d.device,
        connectorId: 'govee',
        name: d.deviceName || d.sku,
        category: 'light' as const,
        capabilities,
        metadata: { model: d.sku },
        health: { reachability: 'online' as const, lastSeen: new Date().toISOString() },
      }
    })
  }

  return {
    list,

    /**
     * Report an empty account as a *note*, not as silence — the same contract
     * SwitchBot's probe already had. A rejected key now throws above, so this
     * message only ever describes an account that really is empty.
     */
    probe: async () => {
      const devices = await list()
      trace(TRACE, 'auth', 'API-Key akzeptiert, Konto gelesen', { devices: devices.length })
      if (devices.length === 0) {
        return {
          message: 'Verbunden, aber das Govee-Konto liefert keine Geräte — '
            + 'in der Govee-Home-App prüfen, ob die Geräte dem Konto zugeordnet '
            + 'und über die Cloud-API freigegeben sind.',
        }
      }
      return undefined
    },

    control: async (cmd) => {
      const sku = skuOf.get(cmd.deviceId)
      if (!sku) {
        // Govee keys control by SKU *and* id; without the SKU the call would be
        // rejected with a generic 400. Say what is actually missing.
        throw new Error('Govee-Gerät unbekannt — bitte neu synchronisieren')
      }
      let res: Response
      try {
        res = await doFetch(`${base}/router/api/v1/device/control`, {
          method: 'POST', headers, body: JSON.stringify(goveeControlBody(cmd, sku, cmd.deviceId)),
        })
      } catch (e) {
        throw transportError(e)
      }
      if (!res.ok) throw new Error(`Govee-Steuerung fehlgeschlagen (${res.status})`)
      // Fold the accepted write into the cache so the next poll does not report
      // it as a change the user did not make.
      const echo = goveeEchoCapability(cmd)
      if (echo) {
        const prev = lastSeen.get(cmd.deviceId)
        if (prev) {
          const caps = (JSON.parse(prev) as Capability[]).map((c) => (c.kind === echo.kind ? echo : c))
          lastSeen.set(cmd.deviceId, JSON.stringify(caps))
        }
      }
    },

    /**
     * The live channel. Govee has no push, so this polls — and only emits when
     * something actually changed, so a quiet house produces no twin churn.
     */
    subscribe: (onUpdate: (u: DeviceUpdate) => void): Unsubscribe => {
      if (pollMs <= 0) return () => {}
      let stopped = false
      const tick = async (): Promise<void> => {
        for (const [device, sku] of [...skuOf]) {
          if (stopped) return
          const caps = await readState(device, sku)
          if (!caps?.length) continue
          const key = JSON.stringify(caps)
          if (lastSeen.get(device) === key) continue
          lastSeen.set(device, key)
          onUpdate({
            deviceId: device,
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
