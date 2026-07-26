/**
 * simulatedTransport.ts — an in-memory Home Assistant backend.
 *
 * It speaks the authentic HA WebSocket message shapes (auth_required → auth_ok,
 * get_states result, subscribe_events + state_changed events, call_service) so
 * the connector's parsing, mapping and streaming are genuinely exercised — no
 * toy. It exists so the reference is self-contained: the visible feature and the
 * tests run end-to-end without a real Home Assistant instance or any hardware.
 * The same connector code, given `WebSocketHaTransport`, talks to a real HA.
 */

import type { HaEntityState, HaMessage, HaTransport } from './transport'

function seedEntities(): Record<string, HaEntityState> {
  const e = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HaEntityState => ({
    entity_id, state, attributes, last_updated: new Date().toISOString(),
  })
  const list = [
    e('light.wohnzimmer_decke', 'on', { friendly_name: 'Deckenlicht', area: 'Wohnzimmer', brightness: 180, color_temp_kelvin: 2700, rgb_color: [255, 214, 170] }),
    e('light.stehlampe', 'on', { friendly_name: 'Stehlampe', area: 'Wohnzimmer', brightness: 120, color_temp_kelvin: 3000 }),
    e('lock.haustuer', 'locked', { friendly_name: 'Haustür', area: 'Eingang', battery_level: 84 }),
    e('binary_sensor.flur_bewegung', 'off', { friendly_name: 'Bewegung Flur', area: 'Flur', device_class: 'motion', battery_level: 61 }),
    e('sensor.wohnzimmer_temperatur', '21.4', { friendly_name: 'Temperatur Wohnzimmer', area: 'Wohnzimmer', device_class: 'temperature', unit_of_measurement: '°C' }),
    e('sensor.wohnzimmer_luftfeuchte', '48', { friendly_name: 'Luftfeuchte Wohnzimmer', area: 'Wohnzimmer', device_class: 'humidity', unit_of_measurement: '%' }),
    e('cover.schlafzimmer_rollo', 'open', { friendly_name: 'Rollo Schlafzimmer', area: 'Schlafzimmer', current_position: 60 }),
    e('switch.steckdose_tv', 'on', { friendly_name: 'Steckdose TV', area: 'Wohnzimmer', current_power_w: 42 }),
    e('camera.eingang', 'streaming', { friendly_name: 'Kamera Eingang', area: 'Eingang' }),
  ]
  const map: Record<string, HaEntityState> = {}
  for (const s of list) map[s.entity_id] = s
  return map
}

export interface SimulatedHaOptions {
  /** Push an autonomous state_changed every N ms. 0 disables (deterministic tests). */
  liveMs?: number
  /** Token the simulated server will accept. Empty ⇒ accept any. */
  token?: string
}

export class SimulatedHaTransport implements HaTransport {
  private handler?: (message: HaMessage) => void
  private entities = seedEntities()
  private subscriptionId?: number
  private timer?: ReturnType<typeof setInterval>
  private rotation = 0
  private readonly liveMs: number

  constructor(opts: SimulatedHaOptions = {}) {
    this.liveMs = opts.liveMs ?? 2000
  }

  connect(): Promise<void> {
    this.emit({ type: 'auth_required', ha_version: '2024.12.0' })
    return Promise.resolve()
  }

  onMessage(handler: (message: HaMessage) => void): void {
    this.handler = handler
  }

  send(message: HaMessage): void {
    switch (message.type) {
      case 'auth':
        this.emit({ type: 'auth_ok', ha_version: '2024.12.0' })
        break
      case 'get_states':
        this.emit({ id: message.id, type: 'result', success: true, result: Object.values(this.entities) })
        break
      case 'subscribe_events':
        this.subscriptionId = message.id
        this.emit({ id: message.id, type: 'result', success: true })
        if (this.liveMs > 0 && !this.timer) {
          this.timer = setInterval(() => this.tick(), this.liveMs)
        }
        break
      case 'unsubscribe_events':
        this.stopTimer()
        this.emit({ id: message.id, type: 'result', success: true })
        break
      case 'call_service':
        this.applyService(message)
        this.emit({ id: message.id, type: 'result', success: true })
        break
    }
  }

  close(): void {
    this.stopTimer()
    this.handler = undefined
  }

  /** Perform one autonomous state change and push a state_changed event. Public
   *  so tests can drive liveness deterministically without timers. */
  tick(): void {
    const live = [
      'light.wohnzimmer_decke', 'sensor.wohnzimmer_temperatur',
      'binary_sensor.flur_bewegung', 'cover.schlafzimmer_rollo',
      'sensor.wohnzimmer_luftfeuchte', 'light.stehlampe',
    ]
    const id = live[this.rotation % live.length]
    this.rotation++
    this.mutate(id)
    this.pushStateChanged(id)
  }

  private mutate(entityId: string): void {
    const s = this.entities[entityId]
    if (!s) return
    const wander = (v: number, d: number, min: number, max: number) =>
      Math.min(max, Math.max(min, Math.round((v + (Math.random() * 2 - 1) * d) * 10) / 10))
    if (entityId.startsWith('light.')) {
      const b = typeof s.attributes.brightness === 'number' ? s.attributes.brightness : 150
      s.attributes.brightness = Math.round(wander(b, 40, 20, 255))
    } else if (entityId === 'sensor.wohnzimmer_temperatur') {
      s.state = String(wander(parseFloat(s.state), 0.4, 17, 25))
    } else if (entityId === 'sensor.wohnzimmer_luftfeuchte') {
      s.state = String(Math.round(wander(parseFloat(s.state), 2, 35, 65)))
    } else if (entityId === 'binary_sensor.flur_bewegung') {
      s.state = Math.random() > 0.6 ? 'on' : 'off'
    } else if (entityId.startsWith('cover.')) {
      const p = typeof s.attributes.current_position === 'number' ? s.attributes.current_position : 50
      s.attributes.current_position = Math.round(wander(p, 15, 0, 100))
    }
    s.last_updated = new Date().toISOString()
  }

  private applyService(message: HaMessage): void {
    const target = message.target as { entity_id?: string } | undefined
    const data = (message.service_data as Record<string, unknown>) ?? {}
    const entityId = target?.entity_id
    if (!entityId) return
    const s = this.entities[entityId]
    if (!s) return
    const service = String(message.service)
    if (service === 'turn_on') s.state = 'on'
    else if (service === 'turn_off') s.state = 'off'
    else if (service === 'lock') s.state = 'locked'
    else if (service === 'unlock') s.state = 'unlocked'
    if (typeof data.brightness_pct === 'number') s.attributes.brightness = Math.round((data.brightness_pct / 100) * 255)
    if (typeof data.color_temp_kelvin === 'number') s.attributes.color_temp_kelvin = data.color_temp_kelvin
    if (typeof data.position === 'number') s.attributes.current_position = data.position
    s.last_updated = new Date().toISOString()
    this.pushStateChanged(entityId)
  }

  private pushStateChanged(entityId: string): void {
    if (this.subscriptionId === undefined) return
    const s = this.entities[entityId]
    this.emit({
      id: this.subscriptionId,
      type: 'event',
      event: { event_type: 'state_changed', data: { entity_id: entityId, new_state: s, old_state: s } },
    })
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Deliver asynchronously, mirroring a real socket (avoids reentrancy). */
  private emit(message: HaMessage): void {
    const h = this.handler
    if (!h) return
    Promise.resolve().then(() => h(message))
  }
}
