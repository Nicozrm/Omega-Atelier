/**
 * tuyaConnector.ts — the real Tuya Cloud connector.
 *
 * Implements the EXISTING `Connector` contract and nothing more: the runtime
 * adopts it blind to the fact that it speaks Tuya. It signs every request
 * (HMAC-SHA256, see `signing.ts`), manages the access token + refresh, and
 * translates Tuya's data model to neutral capabilities (see `mapping.ts`).
 * Transport is injected, so the very same logic runs against the real Tuya
 * HTTPS API or the in-memory simulator.
 *
 * Tuya's basic OpenAPI has no push channel, so live updates come from polling
 * (a real Pulsar/MQTT subscription can later replace the poll without changing
 * the contract). Commands POST straight through and are confirmed by the next
 * poll — the same optimistic model the twin already masks.
 */

import type {
  Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'
import { signRequest, makeNonce } from './signing'
import type { TuyaTransport } from './transport'
import { mapTuyaDevicePassive, commandToTuya, type TuyaDevice } from './mapping'
import {
  deviceListPath, emptyAccountHint, isPaginated, parseDevicePage, tuyaErrorMessage,
} from './discovery'
import { trace, traceError } from '../diagnostics'

export interface TuyaConnectorOptions {
  id?: string
  label?: string
  transport: TuyaTransport
  /** Tuya IoT project Access ID / Client ID. */
  clientId: string
  /** Tuya IoT project Access Secret. */
  secret: string
  /**
   * The Tuya user id whose devices to expose. Tuya lists devices per linked
   * app-account user; the setup wizard captures it. Optional for the simulator.
   */
  uid?: string
  /** Poll interval for live updates, ms. Default 4000. */
  pollMs?: number
}

interface TokenState {
  accessToken: string
  refreshToken: string
  /** Epoch ms after which the token must be refreshed. */
  expiresAt: number
}

export function createTuyaConnector(opts: TuyaConnectorOptions): Connector {
  const id = opts.id ?? 'tuya-cloud'
  const label = opts.label ?? 'Tuya'
  const transport = opts.transport
  const pollMs = opts.pollMs ?? 4000

  let status: ConnectorStatus = 'disconnected'
  let message: string | undefined
  let lastSync: string | undefined
  let token: TokenState | undefined
  /** Only what the user configured — the listing scope they asked for. */
  const uid = opts.uid
  /** What the token grant volunteered. A fallback scope, never the primary. */
  let tokenUid: string | undefined
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  let statusListener: ((h: ConnectorHealth) => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  /** Last seen capability signature per device — poll only emits real changes. */
  const lastSig = new Map<string, string>()

  const buildHealth = (): ConnectorHealth => ({ status, message, lastSync })
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    message = msg
    statusListener?.(buildHealth())
  }

  /** Sign + send one request. Business requests fold in the access token. */
  async function call<T>(method: 'GET' | 'POST', path: string, body?: string, withToken = true) {
    const headers = await signRequest({
      clientId: opts.clientId,
      secret: opts.secret,
      method,
      path,
      body,
      t: Date.now().toString(),
      nonce: makeNonce(),
      accessToken: withToken ? token?.accessToken : undefined,
    })
    return transport.request<T>({ method, path, headers: headers as unknown as Record<string, string>, body })
  }

  async function ensureToken(): Promise<void> {
    if (token && Date.now() < token.expiresAt - 60_000) return
    const refreshing = Boolean(token)
    const grant = token
      ? `/v1.0/token/${token.refreshToken}`
      : '/v1.0/token?grant_type=1'
    const res = await call<{ access_token: string; refresh_token: string; expire_time: number; uid?: string }>('GET', grant, undefined, false)
    if (!res.success || !res.result) {
      const reason = tuyaErrorMessage(res.code, res.msg)
      traceError(id, 'auth', reason, { refreshing, code: res.code ?? -1 })
      throw new Error(reason)
    }
    token = {
      accessToken: res.result.access_token,
      refreshToken: res.result.refresh_token,
      expiresAt: Date.now() + res.result.expire_time * 1000,
    }
    /*
     * Tuya returns a uid with the token grant. It is kept as a *fallback*, not
     * adopted as the listing scope: for a simple-mode grant that uid is the
     * project owner, which is not necessarily a linked app account, and routing
     * straight to `/v1.0/users/{that}/devices` would answer empty for exactly
     * the projects the association endpoint serves correctly — the original bug
     * in a new costume. It is tried only after the primary listing found none.
     */
    if (res.result.uid) tokenUid = res.result.uid
    trace(id, 'auth', refreshing ? 'Access-Token erneuert' : 'Access-Token erhalten', {
      expiresInS: res.result.expire_time,
      uidFromToken: Boolean(!opts.uid && res.result.uid),
    })
  }

  /**
   * The message for a listing that produced nothing usable. Kept separate so
   * the connector can report "connected, but empty" without pretending it is
   * an error and without pretending it is a success.
   */
  let discoveryNote: string | undefined

  /** Read every page of one listing scope. */
  async function listScope(scope: string | undefined): Promise<TuyaDevice[]> {
    const raw: TuyaDevice[] = []
    let cursor: string | undefined
    let page = 0
    do {
      const path = deviceListPath(scope, cursor)
      const res = await call<unknown>('GET', path)
      if (!res.success) {
        const reason = tuyaErrorMessage(res.code, res.msg)
        traceError(id, 'request', reason, { path: path.split('?')[0], code: res.code ?? -1 })
        throw new Error(reason)
      }
      const parsed = parseDevicePage<TuyaDevice>(res.result)
      if (!parsed) {
        // Answering 200 with a shape we do not recognise is not an empty
        // account, and must never be reported as one.
        const reason = 'Tuya antwortet in einem unbekannten Format — '
          + 'Geräteliste konnte nicht gelesen werden'
        traceError(id, 'parse', reason, { path: path.split('?')[0] })
        throw new Error(reason)
      }
      trace(id, 'request', 'Geräteliste abgerufen', {
        path: path.split('?')[0], page, returned: parsed.devices.length,
      })
      raw.push(...parsed.devices)
      cursor = isPaginated(scope) ? parsed.nextCursor : undefined
      page++
    } while (cursor && page < 20) // bounded: a runaway cursor must not loop forever
    return raw
  }

  async function fetchDevices(): Promise<Device[]> {
    await ensureToken()

    let raw = await listScope(uid)

    /*
     * An empty primary listing is not yet an empty account. A project whose app
     * account is linked but not associated at project level lists nothing here
     * and everything under its own uid, so that scope is tried once before we
     * tell the user their account is empty. A failure of the fallback is not
     * worth reporting — the primary result stands.
     */
    if (raw.length === 0 && !uid && tokenUid) {
      try {
        raw = await listScope(tokenUid)
      } catch {
        raw = []
      }
    }

    /*
     * Every device Tuya returned becomes a device in the twin. The old code
     * dropped the ones whose data points it did not recognise, which is how a
     * successful discovery could still render an empty list.
     */
    const devices = raw.map((d) => mapTuyaDevicePassive(d, id))
    const unsupported = devices.filter((d) => d.capabilities.length === 0).length
    trace(id, 'normalize', 'Geräte in neutrale Domain übersetzt', {
      returned: raw.length, mapped: devices.length - unsupported, unsupported,
    })

    discoveryNote = raw.length === 0
      ? emptyAccountHint(uid)
      : unsupported > 0
        ? `${unsupported} von ${raw.length} Tuya-Geräten liefern keine bekannten Datenpunkte — `
          + 'sie erscheinen ohne Bedienelemente.'
        : undefined

    lastSync = new Date().toISOString()
    return devices
  }

  const sigOf = (d: Device): string => JSON.stringify(d.capabilities)

  async function poll(): Promise<void> {
    try {
      const devices = await fetchDevices()
      for (const d of devices) {
        const sig = sigOf(d)
        if (lastSig.get(d.id) !== sig) {
          lastSig.set(d.id, sig)
          onUpdate?.({ deviceId: d.id, capabilities: d.capabilities, health: d.health, battery: d.battery })
        }
      }
      if (status !== 'connected') setStatus('connected')
    } catch (e) {
      setStatus('error', e instanceof Error ? e.message : 'Tuya-Abfrage fehlgeschlagen')
    }
  }

  return {
    info: { id, label },

    /**
     * Authentication only. A valid token proves the credentials and the region,
     * and proves nothing at all about whether the project can see devices —
     * those are two different failures with two different fixes, so they are
     * two different steps here. Discovery reports its own outcome.
     */
    async connect(): Promise<void> {
      setStatus('connecting')
      try {
        await ensureToken()
        setStatus('connected')
      } catch (e) {
        setStatus('error', e instanceof Error ? e.message : 'Tuya-Verbindung fehlgeschlagen')
        throw e
      }
    },

    async disconnect(): Promise<void> {
      if (timer) { clearInterval(timer); timer = undefined }
      onUpdate = undefined
      token = undefined
      discoveryNote = undefined
      lastSig.clear()
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      const devices = await fetchDevices()
      for (const d of devices) lastSig.set(d.id, sigOf(d))
      // A note is not an error: the connection is real, the account is empty
      // (or partly untranslatable), and the card has to say which.
      if (status === 'connected') setStatus('connected', discoveryNote)
      trace(id, 'store', 'Geräte an den Twin übergeben', { count: devices.length })
      return devices
    },

    async synchronize(): Promise<Device[]> {
      const devices = await fetchDevices()
      if (status === 'connected') setStatus('connected', discoveryNote)
      return devices
    },

    subscribe(handler: (u: DeviceUpdate) => void): Unsubscribe {
      onUpdate = handler
      if (!timer) timer = setInterval(() => void poll(), pollMs)
      return () => {
        onUpdate = undefined
        if (timer) { clearInterval(timer); timer = undefined }
      }
    },

    async publish(command: DeviceCommand): Promise<void> {
      const tc = commandToTuya(command)
      if (!tc) return
      await ensureToken()
      const body = JSON.stringify({ commands: tc.commands })
      const res = await call<boolean>('POST', `/v1.0/devices/${tc.deviceId}/commands`, body)
      if (!res.success) throw new Error(res.msg ?? 'Tuya-Befehl abgelehnt')
      lastSync = new Date().toISOString()
    },

    health(): ConnectorHealth {
      return buildHealth()
    },

    onStatus(listener: (h: ConnectorHealth) => void): Unsubscribe {
      statusListener = listener
      return () => { if (statusListener === listener) statusListener = undefined }
    },
  }
}
