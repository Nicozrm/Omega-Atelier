/**
 * transport.ts — the MQTT wire transport.
 *
 * MQTT is a pure publish/subscribe transport with NO built-in device schema —
 * the opposite of Home Assistant's structured hub. This is the harder test of
 * the capability model: structure must be *derived* from a convention layer.
 *
 * As with the HA connector, network logic lives ONLY here, inside the connector
 * module. The connector talks to an `MqttTransport`; the self-contained demo and
 * tests use an in-memory broker (`simulatedBroker.ts`). A production deployment
 * wires a standard MQTT-over-WebSocket client (e.g. mqtt.js) implementing this
 * same interface — deliberately a library concern, since hand-rolling MQTT packet
 * framing has no place in a reference. The transport seam absorbs that difference.
 */

export interface MqttMessage {
  topic: string
  payload: string
  retained?: boolean
}

export type MqttConnectionState = 'connected' | 'disconnected' | 'error'

export interface MqttTransport {
  connect(): Promise<void>
  /** Subscribe to an MQTT topic filter (supports `+` and `#` wildcards). */
  subscribe(topicFilter: string): void
  /** Publish a payload to a topic. */
  publish(topic: string, payload: string): void
  /** Register the single inbound-message handler. */
  onMessage(handler: (message: MqttMessage) => void): void
  /** Transport-level connection events (broker up/down) — feeds `onStatus`. */
  onConnectionChange(handler: (state: MqttConnectionState) => void): void
  close(): void
}

/** MQTT topic-filter matching: `+` matches one level, `#` matches the rest. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true
    if (f[i] === '+') {
      if (t[i] === undefined) return false
      continue
    }
    if (f[i] !== t[i]) return false
  }
  return f.length === t.length
}
