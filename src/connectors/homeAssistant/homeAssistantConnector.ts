/**
 * homeAssistantConnector.ts — the reference connector.
 *
 * It implements the EXISTING `Connector` contract and nothing more: no core
 * change, no special case, no manufacturer concept leaking out. The runtime
 * adopts it blind to the fact that it speaks Home Assistant. Transport is
 * injected, so the very same logic runs against a real HA WebSocket or the
 * in-memory simulator.
 */

import type {
  Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'
import type { HaMessage, HaTransport, HaEntityState } from './transport'
import { commandToCallService, mapEntityToDevice } from './mapping'

export interface HaConnectorOptions {
  id?: string
  label?: string
  transport: HaTransport
  /** Long-lived access token (real HA). Ignored by the simulator. */
  token?: string
}

export function createHomeAssistantConnector(opts: HaConnectorOptions): Connector {
  const id = opts.id ?? 'home-assistant'
  const label = opts.label ?? 'Home Assistant'
  const transport = opts.transport

  let status: ConnectorStatus = 'disconnected'
  let lastSync: string | undefined
  let message: string | undefined
  let counter = 0
  const pending = new Map<number, (msg: HaMessage) => void>()
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  let subId: number | undefined
  let authResolve: (() => void) | undefined
  let authReject: ((e: Error) => void) | undefined
  let statusListener: ((health: ConnectorHealth) => void) | undefined

  const buildHealth = (): ConnectorHealth => ({ status, lastSync, message })
  /** Update status and PUSH it to any status subscriber (event-driven health). */
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    if (msg !== undefined) message = msg
    statusListener?.(buildHealth())
  }

  transport.onMessage((msg) => {
    switch (msg.type) {
      case 'auth_required':
        transport.send({ type: 'auth', access_token: opts.token ?? '' })
        break
      case 'auth_ok':
        lastSync = new Date().toISOString()
        setStatus('connected')
        authResolve?.()
        break
      case 'auth_invalid':
        setStatus('error', typeof msg.message === 'string' ? msg.message : 'Authentifizierung abgelehnt')
        authReject?.(new Error(message))
        break
      case 'result': {
        if (typeof msg.id === 'number') {
          pending.get(msg.id)?.(msg)
          pending.delete(msg.id)
        }
        break
      }
      case 'event': {
        const event = msg.event as { event_type?: string; data?: { new_state?: HaEntityState } } | undefined
        if (event?.event_type === 'state_changed' && event.data?.new_state && onUpdate) {
          const dev = mapEntityToDevice(event.data.new_state, id)
          if (dev) onUpdate({ deviceId: dev.id, capabilities: dev.capabilities, health: dev.health, battery: dev.battery })
        }
        break
      }
    }
  })

  const request = (type: string, extra: Record<string, unknown> = {}): Promise<HaMessage> => {
    const reqId = ++counter
    return new Promise((resolve) => {
      pending.set(reqId, resolve)
      transport.send({ id: reqId, type, ...extra })
    })
  }

  const toDevices = (result: unknown): Device[] => {
    if (!Array.isArray(result)) return []
    return (result as HaEntityState[]).map((s) => mapEntityToDevice(s, id)).filter((d): d is Device => d !== null)
  }

  return {
    info: { id, label },

    async connect(): Promise<void> {
      setStatus('connecting')
      const authed = new Promise<void>((resolve, reject) => {
        authResolve = resolve
        authReject = reject
      })
      await transport.connect()
      await authed // auth_ok pushes 'connected' + lastSync
    },

    async disconnect(): Promise<void> {
      transport.close()
      onUpdate = undefined
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      const res = await request('get_states')
      lastSync = new Date().toISOString()
      return toDevices(res.result)
    },

    async synchronize(): Promise<Device[]> {
      const res = await request('get_states')
      lastSync = new Date().toISOString()
      return toDevices(res.result)
    },

    subscribe(handler: (update: DeviceUpdate) => void): Unsubscribe {
      onUpdate = handler
      const reqId = ++counter
      subId = reqId
      pending.set(reqId, () => { /* subscribe ack */ })
      transport.send({ id: reqId, type: 'subscribe_events', event_type: 'state_changed' })
      return () => {
        onUpdate = undefined
        if (subId !== undefined) {
          const uid = ++counter
          transport.send({ id: uid, type: 'unsubscribe_events', subscription: subId })
          subId = undefined
        }
      }
    },

    async publish(command: DeviceCommand): Promise<void> {
      const cs = commandToCallService(command)
      if (!cs) return
      await request('call_service', {
        domain: cs.domain,
        service: cs.service,
        service_data: cs.service_data,
        target: { entity_id: cs.entity_id },
      })
      lastSync = new Date().toISOString()
    },

    health(): ConnectorHealth {
      return buildHealth()
    },

    onStatus(listener: (health: ConnectorHealth) => void): Unsubscribe {
      statusListener = listener
      return () => {
        if (statusListener === listener) statusListener = undefined
      }
    },
  }
}
