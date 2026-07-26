/**
 * brandConnector.ts — one generic Connector implementation for brand clouds.
 *
 * Every consumer ecosystem (Govee, SwitchBot, Tuya/Smart Life, Alexa, Lockin …)
 * boils down to the same shape: list devices, control a capability, optionally
 * stream/poll updates. This module implements the Connector contract ONCE over
 * that shape; each brand only supplies a `BrandClient` (real cloud client or
 * the in-memory simulator). The core never learns the vendor.
 */

import type {
  Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'

/** The minimal surface a brand backend must provide. */
export interface BrandClient {
  /** Enumerate devices (connectorId will be stamped by the connector). */
  list(): Promise<Device[]>
  /** Deliver one command toward the brand cloud / device. */
  control(cmd: DeviceCommand): Promise<void>
  /**
   * Optional live channel: invoke `onUpdate` whenever a device changes
   * (simulator ticks, or cloud polling). Returns an unsubscribe handle.
   */
  subscribe?(onUpdate: (update: DeviceUpdate) => void): Unsubscribe
  /** Optional connectivity probe run during connect(). */
  probe?(): Promise<void>
}

export interface BrandConnectorOptions {
  id: string
  label: string
  client: BrandClient
}

export function createBrandConnector(opts: BrandConnectorOptions): Connector {
  const { id, label, client } = opts
  let status: ConnectorStatus = 'disconnected'
  let lastSync: string | undefined
  let message: string | undefined
  let statusListener: ((health: ConnectorHealth) => void) | undefined
  let unsub: Unsubscribe | undefined

  const buildHealth = (): ConnectorHealth => ({ status, lastSync, message })
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    message = msg
    statusListener?.(buildHealth())
  }
  const stamp = (devices: Device[]): Device[] => devices.map((d) => ({ ...d, connectorId: id }))

  return {
    info: { id, label },

    async connect(): Promise<void> {
      setStatus('connecting')
      try {
        await client.probe?.()
        lastSync = new Date().toISOString()
        setStatus('connected')
      } catch (e) {
        setStatus('error', e instanceof Error ? e.message : 'Verbindung fehlgeschlagen')
        throw e
      }
    },

    async disconnect(): Promise<void> {
      unsub?.()
      unsub = undefined
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      const devices = stamp(await client.list())
      lastSync = new Date().toISOString()
      return devices
    },

    async synchronize(): Promise<Device[]> {
      const devices = stamp(await client.list())
      lastSync = new Date().toISOString()
      statusListener?.(buildHealth())
      return devices
    },

    subscribe(onUpdate: (update: DeviceUpdate) => void): Unsubscribe {
      unsub = client.subscribe?.(onUpdate)
      return () => { unsub?.(); unsub = undefined }
    },

    async publish(command: DeviceCommand): Promise<void> {
      await client.control(command)
    },

    health(): ConnectorHealth {
      return buildHealth()
    },

    onStatus(listener: (health: ConnectorHealth) => void): Unsubscribe {
      statusListener = listener
      return () => { statusListener = undefined }
    },
  }
}
