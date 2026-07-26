/**
 * mapping.ts — Home Assistant ⇄ neutral domain translation.
 *
 * All Home-Assistant-specific knowledge lives here, inside the connector. The
 * core never sees an entity_id, a service name or an HA attribute. Two lamps
 * exposed by HA — whatever their real brand — become the same neutral
 * `[OnOff, Brightness, ColorTemperature, Color]` device.
 */

import type { Capability, Device, DeviceBattery, DeviceCategory } from '@/domain'
import type { DeviceCommand } from '@/domain'
import type { HaEntityState } from './transport'

function domainOf(entityId: string): string {
  return entityId.split('.')[0]
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

function rgbToHex(rgb: unknown): string | undefined {
  if (!Array.isArray(rgb) || rgb.length < 3) return undefined
  const [r, g, b] = rgb as number[]
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Map an HA entity state to neutral capabilities. */
export function mapStateToCapabilities(s: HaEntityState): Capability[] {
  const d = domainOf(s.entity_id)
  const a = s.attributes
  const caps: Capability[] = []

  switch (d) {
    case 'light': {
      caps.push({ kind: 'OnOff', access: 'readWrite', on: s.state === 'on' })
      const brightness = num(a.brightness)
      caps.push({ kind: 'Brightness', access: 'readWrite', percent: brightness !== undefined ? Math.round((brightness / 255) * 100) : s.state === 'on' ? 100 : 0 })
      const kelvin = num(a.color_temp_kelvin) ?? (num(a.color_temp) ? Math.round(1e6 / (num(a.color_temp) as number)) : 2700)
      caps.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin, minKelvin: num(a.min_color_temp_kelvin) ?? 2200, maxKelvin: num(a.max_color_temp_kelvin) ?? 6500 })
      const hex = rgbToHex(a.rgb_color)
      if (hex) caps.push({ kind: 'Color', access: 'readWrite', hex })
      break
    }
    case 'switch':
    case 'input_boolean': {
      caps.push({ kind: 'OnOff', access: 'readWrite', on: s.state === 'on' })
      const w = num(a.current_power_w)
      if (w !== undefined) caps.push({ kind: 'Energy', access: 'read', watts: s.state === 'on' ? Math.round(w) : 0 })
      break
    }
    case 'lock':
      caps.push({ kind: 'Lock', access: 'readWrite', locked: s.state === 'locked' })
      break
    case 'cover': {
      const p = num(a.current_position)
      caps.push({ kind: 'Position', access: 'readWrite', percent: p !== undefined ? p : s.state === 'open' ? 100 : 0 })
      break
    }
    case 'binary_sensor':
      caps.push({ kind: 'Motion', access: 'read', detected: s.state === 'on' })
      break
    case 'sensor': {
      const dc = String(a.device_class ?? '')
      const value = parseFloat(s.state)
      if (dc === 'humidity') caps.push({ kind: 'Humidity', access: 'read', percent: Number.isFinite(value) ? value : 0 })
      else if (dc === 'temperature' || a.unit_of_measurement === '°C') caps.push({ kind: 'Temperature', access: 'read', celsius: Number.isFinite(value) ? value : 0 })
      break
    }
    case 'climate': {
      const t = num(a.current_temperature)
      if (t !== undefined) caps.push({ kind: 'Temperature', access: 'read', celsius: t })
      break
    }
    case 'camera':
      caps.push({ kind: 'Camera', access: 'read', streaming: s.state === 'streaming' || s.state === 'recording' })
      break
    case 'vacuum': {
      const map: Record<string, 'idle' | 'cleaning' | 'returning' | 'docked'> = {
        cleaning: 'cleaning', returning: 'returning', docked: 'docked', idle: 'idle',
      }
      caps.push({ kind: 'Vacuum', access: 'readWrite', activity: map[s.state] ?? 'idle' })
      break
    }
  }
  return caps
}

function categoryOf(entityId: string): DeviceCategory {
  switch (domainOf(entityId)) {
    case 'light': return 'light'
    case 'lock': return 'lock'
    case 'cover': return 'cover'
    case 'binary_sensor':
    case 'sensor': return 'sensor'
    case 'climate': return 'climate'
    case 'camera': return 'camera'
    case 'switch':
    case 'input_boolean': return 'energy'
    case 'vacuum': return 'appliance'
    default: return 'other'
  }
}

/** Map an HA entity to a full neutral domain device (or null if unmappable). */
export function mapEntityToDevice(s: HaEntityState, connectorId: string): Device | null {
  const caps = mapStateToCapabilities(s)
  if (caps.length === 0 && categoryOf(s.entity_id) === 'other') return null
  const battery = num(s.attributes.battery_level)
  const dev: Device = {
    id: s.entity_id,
    connectorId,
    category: categoryOf(s.entity_id),
    name: typeof s.attributes.friendly_name === 'string' ? s.attributes.friendly_name : s.entity_id,
    capabilities: caps,
    health: {
      reachability: s.state === 'unavailable' ? 'offline' : 'online',
      lastSeen: s.last_updated ?? new Date().toISOString(),
    },
  }
  if (battery !== undefined) {
    const b: DeviceBattery = { percent: battery }
    dev.battery = b
  }
  if (typeof s.attributes.area === 'string') dev.metadata = { room: s.attributes.area }
  return dev
}

export interface CallService {
  domain: string
  service: string
  service_data: Record<string, number | string | boolean>
  entity_id: string
}

/** Map a neutral command to an HA call_service (or null if not controllable). */
export function commandToCallService(cmd: DeviceCommand): CallService | null {
  const domain = domainOf(cmd.deviceId)
  const p = cmd.payload
  switch (cmd.capability) {
    case 'OnOff':
      return { domain, service: p.on ? 'turn_on' : 'turn_off', service_data: {}, entity_id: cmd.deviceId }
    case 'Brightness':
      return { domain: 'light', service: 'turn_on', service_data: { brightness_pct: Number(p.percent) }, entity_id: cmd.deviceId }
    case 'ColorTemperature':
      return { domain: 'light', service: 'turn_on', service_data: { color_temp_kelvin: Number(p.kelvin) }, entity_id: cmd.deviceId }
    case 'Lock':
      return { domain: 'lock', service: p.locked ? 'lock' : 'unlock', service_data: {}, entity_id: cmd.deviceId }
    case 'Position':
      return { domain: 'cover', service: 'set_cover_position', service_data: { position: Number(p.percent) }, entity_id: cmd.deviceId }
    default:
      return null
  }
}
