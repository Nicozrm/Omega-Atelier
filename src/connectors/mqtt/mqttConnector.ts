/**
 * mqttConnector.ts — the second reference connector.
 *
 * It implements the SAME (hardened) `Connector` contract as the Home Assistant
 * connector — including the optional `onStatus` channel and benefiting from the
 * runtime's `connectorId` auto-stamping — but over a fundamentally different
 * transport: schemaless MQTT pub/sub, with structure derived from the Homie
 * convention. No core change; no manufacturer/network logic outside this module;
 * the runtime never learns it speaks MQTT.
 */

import type {
  CapabilityKind, Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'
import type { MqttConnectionState, MqttMessage, MqttTransport } from './transport'
import { commandToHomie, parseHomieDevices } from './mapping'

export interface MqttConnectorOptions {
  id?: string
  label?: string
  transport: MqttTransport
  /** Root topic filter to discover under. Defaults to the Homie root. */
  rootFilter?: string
}

const mapState = (s: MqttConnectionState): ConnectorStatus =>
  s === 'connected' ? 'connected' : s === 'error' ? 'error' : 'disconnected'

export function createMqttConnector(opts: MqttConnectorOptions): Connector {
  const id = opts.id ?? 'mqtt'
  const label = opts.label ?? 'MQTT (Homie)'
  const transport = opts.transport
  const rootFilter = opts.rootFilter ?? 'homie/#'

  let status: ConnectorStatus = 'disconnected'
  let lastSync: string | undefined
  let message: string | undefined
  let statusListener: ((health: ConnectorHealth) => void) | undefined
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  let subscribed = false

  const topics = new Map<string, string>()
  let commandTopics = new Map<string, Map<CapabilityKind, string>>()

  const buildHealth = (): ConnectorHealth => ({ status, lastSync, message })
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    if (msg !== undefined) message = msg
    statusListener?.(buildHealth())
  }

  const handleMessage = (msg: MqttMessage): void => {
    topics.set(msg.topic, msg.payload)
    if (!onUpdate) return
    const seg = msg.topic.split('/')
    // Only react to value topics: homie/<id>/<node>/<prop> (not a $descriptor).
    if (seg[0] !== 'homie' || seg.length !== 4 || seg[3].startsWith('$')) return
    const parsed = parseHomieDevices(topics, id)
    commandTopics = parsed.commandTopics
    const dev = parsed.devices.find((d) => d.id === seg[1])
    if (dev) onUpdate({ deviceId: dev.id, capabilities: dev.capabilities, health: dev.health })
  }

  transport.onMessage(handleMessage)
  transport.onConnectionChange((s) => setStatus(mapState(s)))

  const ensureSubscribed = (): void => {
    if (subscribed) return
    transport.subscribe(rootFilter)
    subscribed = true
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  const snapshot = async (): Promise<Device[]> => {
    ensureSubscribed()
    await flush() // let retained topics arrive (broker semantics)
    const parsed = parseHomieDevices(topics, id)
    commandTopics = parsed.commandTopics
    lastSync = new Date().toISOString()
    return parsed.devices
  }

  return {
    info: { id, label },

    async connect(): Promise<void> {
      setStatus('connecting')
      await transport.connect()
      ensureSubscribed()
      lastSync = new Date().toISOString()
      setStatus('connected')
    },

    async disconnect(): Promise<void> {
      onUpdate = undefined
      transport.close()
      setStatus('disconnected')
    },

    discover(): Promise<Device[]> {
      return snapshot()
    },

    synchronize(): Promise<Device[]> {
      return snapshot()
    },

    subscribe(handler: (update: DeviceUpdate) => void): Unsubscribe {
      onUpdate = handler
      return () => {
        onUpdate = undefined
      }
    },

    async publish(command: DeviceCommand): Promise<void> {
      const valueTopic = commandTopics.get(command.deviceId)?.get(command.capability)
      if (!valueTopic) return
      const out = commandToHomie(command.capability, command.payload, valueTopic)
      if (out) transport.publish(out.topic, out.payload)
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
