/**
 * simulatedBroker.ts — an in-memory MQTT broker speaking the Homie convention.
 *
 * Implements genuine broker semantics — retained topic store, wildcard
 * subscription delivery, publish routing, and `…/set` command round-trip — so
 * the connector's discovery, streaming and publishing are exercised for real
 * without an external broker. A production deployment swaps in a standard
 * MQTT-over-WebSocket client implementing `MqttTransport`; this code never runs
 * there.
 */

import type { MqttConnectionState, MqttMessage, MqttTransport } from './transport'
import { topicMatches } from './transport'

function seedTopics(): Map<string, string> {
  const t = new Map<string, string>()
  const dev = (id: string, name: string, room: string) => {
    t.set(`homie/${id}/$name`, name)
    t.set(`homie/${id}/$room`, room)
  }
  const prop = (id: string, node: string, p: string, value: string, datatype: string, settable: boolean, unit = '') => {
    const base = `homie/${id}/${node}/${p}`
    t.set(base, value)
    t.set(`${base}/$datatype`, datatype)
    t.set(`${base}/$settable`, String(settable))
    if (unit) t.set(`${base}/$unit`, unit)
  }

  dev('wohnzimmer-decke', 'Deckenlicht', 'Wohnzimmer')
  prop('wohnzimmer-decke', 'light', 'power', 'true', 'boolean', true)
  prop('wohnzimmer-decke', 'light', 'brightness', '72', 'integer', true, '%')
  prop('wohnzimmer-decke', 'light', 'color-temperature', '2700', 'integer', true, 'K')
  prop('wohnzimmer-decke', 'light', 'color', '255,214,170', 'color', true)

  dev('haustuer', 'Haustür', 'Eingang')
  prop('haustuer', 'lock', 'state', 'true', 'boolean', true)

  dev('flur-sensor', 'Bewegung Flur', 'Flur')
  prop('flur-sensor', 'motion', 'presence', 'false', 'boolean', false)

  dev('klima', 'Klima Wohnzimmer', 'Wohnzimmer')
  prop('klima', 'sensor', 'temperature', '21.4', 'float', false, '°C')
  prop('klima', 'sensor', 'humidity', '48', 'float', false, '%')

  dev('rollo', 'Rollo Schlafzimmer', 'Schlafzimmer')
  prop('rollo', 'cover', 'position', '60', 'integer', true, '%')

  dev('steckdose-tv', 'Steckdose TV', 'Wohnzimmer')
  prop('steckdose-tv', 'switch', 'power', 'true', 'boolean', true)
  prop('steckdose-tv', 'switch', 'watts', '42', 'float', false, 'W')

  return t
}

export interface SimulatedBrokerOptions {
  /** Publish an autonomous value change every N ms. 0 disables (tests). */
  liveMs?: number
}

export class SimulatedMqttBroker implements MqttTransport {
  private retained = seedTopics()
  private filters: string[] = []
  private messageHandler?: (m: MqttMessage) => void
  private connectionHandler?: (s: MqttConnectionState) => void
  private timer?: ReturnType<typeof setInterval>
  private rotation = 0
  private readonly liveMs: number

  constructor(opts: SimulatedBrokerOptions = {}) {
    this.liveMs = opts.liveMs ?? 2000
  }

  connect(): Promise<void> {
    this.emitConnection('connected')
    if (this.liveMs > 0 && !this.timer) this.timer = setInterval(() => this.tick(), this.liveMs)
    return Promise.resolve()
  }

  subscribe(topicFilter: string): void {
    this.filters.push(topicFilter)
    // Deliver all retained topics matching the new subscription (broker semantics).
    for (const [topic, payload] of this.retained) {
      if (topicMatches(topicFilter, topic)) this.deliver({ topic, payload, retained: true })
    }
  }

  publish(topic: string, payload: string): void {
    // A command on `…/set` updates the underlying value topic and re-publishes it.
    if (topic.endsWith('/set')) {
      const valueTopic = topic.slice(0, -'/set'.length)
      if (this.retained.has(valueTopic)) {
        this.retained.set(valueTopic, payload)
        this.route(valueTopic, payload)
      }
      return
    }
    this.retained.set(topic, payload)
    this.route(topic, payload)
  }

  onMessage(handler: (m: MqttMessage) => void): void {
    this.messageHandler = handler
  }

  onConnectionChange(handler: (s: MqttConnectionState) => void): void {
    this.connectionHandler = handler
  }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.messageHandler = undefined
    this.emitConnection('disconnected')
  }

  /** One autonomous value change (public for deterministic tests). */
  tick(): void {
    const live: [string, () => string][] = [
      ['homie/wohnzimmer-decke/light/brightness', () => String(Math.round(20 + Math.random() * 80))],
      ['homie/klima/sensor/temperature', () => String(Math.round((19 + Math.random() * 5) * 10) / 10)],
      ['homie/flur-sensor/motion/presence', () => (Math.random() > 0.6 ? 'true' : 'false')],
      ['homie/rollo/cover/position', () => String(Math.round(Math.random() * 100))],
    ]
    const [topic, gen] = live[this.rotation % live.length]
    this.rotation++
    const payload = gen()
    this.retained.set(topic, payload)
    this.route(topic, payload)
  }

  private route(topic: string, payload: string): void {
    if (this.filters.some((f) => topicMatches(f, topic))) this.deliver({ topic, payload })
  }

  private deliver(message: MqttMessage): void {
    const h = this.messageHandler
    if (h) Promise.resolve().then(() => h(message))
  }

  private emitConnection(state: MqttConnectionState): void {
    const h = this.connectionHandler
    if (h) Promise.resolve().then(() => h(state))
  }
}
