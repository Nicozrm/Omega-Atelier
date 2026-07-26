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
import { mapTuyaDevice, commandToTuya, type TuyaDevice } from './mapping'

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
  let uid = opts.uid
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
    const grant = token
      ? `/v1.0/token/${token.refreshToken}`
      : '/v1.0/token?grant_type=1'
    const res = await call<{ access_token: string; refresh_token: string; expire_time: number; uid?: string }>('GET', grant, undefined, false)
    if (!res.success || !res.result) {
      throw new Error(res.msg ?? 'Tuya-Token abgelehnt (Client-ID/Secret prüfen)')
    }
    token = {
      accessToken: res.result.access_token,
      refreshToken: res.result.refresh_token,
      expiresAt: Date.now() + res.result.expire_time * 1000,
    }
    if (!uid && res.result.uid) uid = res.result.uid
  }

  async function fetchDevices(): Promise<Device[]> {
    await ensureToken()
    const path = uid ? `/v1.0/users/${uid}/devices` : '/v1.0/devices'
    const res = await call<TuyaDevice[]>('GET', path)
    if (!res.success || !Array.isArray(res.result)) {
      throw new Error(res.msg ?? 'Geräteliste konnte nicht geladen werden')
    }
    lastSync = new Date().toISOString()
    return res.result.map((d) => mapTuyaDevice(d, id)).filter((d): d is Device => d !== null)
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
      lastSig.clear()
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      const devices = await fetchDevices()
      for (const d of devices) lastSig.set(d.id, sigOf(d))
      return devices
    },

    async synchronize(): Promise<Device[]> {
      return fetchDevices()
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
