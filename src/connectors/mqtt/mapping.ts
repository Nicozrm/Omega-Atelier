/**
 * mapping.ts — Homie (MQTT convention) ⇄ neutral domain translation.
 *
 * MQTT delivers no device schema, only topics + payloads. The Homie convention
 * makes devices self-describing through retained descriptor topics
 * (`$datatype`, `$settable`, `$unit`). This layer derives neutral capabilities
 * from (node, property, datatype, unit) — disambiguating purely by datatype
 * where a property name is ambiguous (e.g. a boolean `power` is OnOff, a float
 * `power` in watts is Energy). All MQTT/Homie knowledge lives here, inside the
 * connector; the core never sees a topic.
 */

import type { Capability, CapabilityKind, Device, DeviceCategory } from '@/domain'
import { findCapability } from '@/domain'

interface Property {
  node: string
  prop: string
  datatype: string
  unit: string
  settable: boolean
  value: string
}

export interface ParsedHomie {
  devices: Device[]
  /** deviceId → capability kind → the Homie value topic to command (`…/set`). */
  commandTopics: Map<string, Map<CapabilityKind, string>>
}

const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)))

function rgbToHex(value: string): string | undefined {
  const parts = value.split(',').map((n) => parseInt(n, 10))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return undefined
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${h(parts[0])}${h(parts[1])}${h(parts[2])}`
}

/** Map one Homie property to a neutral capability (datatype-driven). */
function mapProperty(p: Property): Capability | null {
  const node = p.node.toLowerCase()
  const prop = p.prop.toLowerCase()
  const num = parseFloat(p.value)

  if (p.datatype === 'boolean') {
    const on = p.value === 'true'
    if (node === 'lock') return { kind: 'Lock', access: 'readWrite', locked: on }
    if (['motion', 'presence', 'occupancy'].includes(prop)) return { kind: 'Motion', access: 'read', detected: on }
    if (['power', 'on', 'state'].includes(prop)) return { kind: 'OnOff', access: 'readWrite', on }
    return null
  }
  if (p.datatype === 'enum') {
    if (node === 'lock') return { kind: 'Lock', access: 'readWrite', locked: p.value === 'locked' || p.value === 'true' }
    return null
  }
  if (p.datatype === 'color') {
    const hex = rgbToHex(p.value)
    return hex ? { kind: 'Color', access: 'readWrite', hex } : null
  }
  if (p.datatype === 'integer' || p.datatype === 'float') {
    if (['brightness', 'intensity', 'level'].includes(prop)) return { kind: 'Brightness', access: 'readWrite', percent: clampPct(num) }
    if (['color-temperature', 'colortemp', 'cct'].includes(prop)) return { kind: 'ColorTemperature', access: 'readWrite', kelvin: Math.round(num), minKelvin: 2200, maxKelvin: 6500 }
    if (['temperature', 'temp'].includes(prop)) return { kind: 'Temperature', access: 'read', celsius: Math.round(num * 10) / 10 }
    if (prop === 'humidity') return { kind: 'Humidity', access: 'read', percent: clampPct(num) }
    if (prop === 'position') return { kind: 'Position', access: 'readWrite', percent: clampPct(num) }
    if (['watts', 'energy'].includes(prop) || (prop === 'power' && p.unit === 'W')) return { kind: 'Energy', access: 'read', watts: Math.round(num) }
  }
  return null
}

const CATEGORY_PRIORITY: [string, DeviceCategory][] = [
  ['lock', 'lock'], ['camera', 'camera'], ['cover', 'cover'],
  ['light', 'light'], ['switch', 'energy'], ['sensor', 'sensor'],
]

function categoryFromNodes(nodes: Set<string>): DeviceCategory {
  for (const [node, cat] of CATEGORY_PRIORITY) if (nodes.has(node)) return cat
  return 'other'
}

/** Parse a retained Homie topic map into neutral devices + command topics. */
export function parseHomieDevices(topics: Map<string, string>, connectorId: string): ParsedHomie {
  // Collect value topics + their descriptors, grouped by device id.
  const props = new Map<string, Property[]>() // deviceId → properties
  const names = new Map<string, string>()
  const rooms = new Map<string, string>()

  for (const [topic, value] of topics) {
    const seg = topic.split('/')
    if (seg[0] !== 'homie') continue
    if (seg.length === 3 && seg[2] === '$name') {
      names.set(seg[1], value)
      continue
    }
    if (seg.length === 3 && seg[2] === '$room') {
      rooms.set(seg[1], value)
      continue
    }
    // value topic: homie/<id>/<node>/<prop>  (4 segments, last not a $descriptor)
    if (seg.length === 4 && !seg[3].startsWith('$')) {
      const deviceId = seg[1]
      const node = seg[2]
      const prop = seg[3]
      const get = (suffix: string) => topics.get(`${topic}/${suffix}`) ?? ''
      const property: Property = {
        node, prop,
        datatype: get('$datatype') || 'string',
        unit: get('$unit'),
        settable: get('$settable') === 'true',
        value,
      }
      const list = props.get(deviceId) ?? []
      list.push(property)
      props.set(deviceId, list)
    }
  }

  const devices: Device[] = []
  const commandTopics = new Map<string, Map<CapabilityKind, string>>()

  for (const [deviceId, list] of props) {
    const caps: Capability[] = []
    const cmd = new Map<CapabilityKind, string>()
    const nodes = new Set<string>()
    for (const p of list) {
      nodes.add(p.node.toLowerCase())
      const cap = mapProperty(p)
      if (!cap) continue
      // a device carries at most one capability per kind; first wins
      if (caps.some((c) => c.kind === cap.kind)) continue
      caps.push(cap)
      cmd.set(cap.kind, `homie/${deviceId}/${p.node}/${p.prop}`)
    }
    if (caps.length === 0) continue
    // A device powered solely through its own switch draws ~0 W when off.
    const onoff = findCapability(caps, 'OnOff')
    const energy = findCapability(caps, 'Energy')
    if (onoff && !onoff.on && energy) energy.watts = 0
    const device: Device = {
      id: deviceId,
      connectorId,
      category: categoryFromNodes(nodes),
      name: names.get(deviceId) ?? deviceId,
      capabilities: caps,
      health: { reachability: 'online', lastSeen: new Date().toISOString() },
    }
    const room = rooms.get(deviceId)
    if (room) device.metadata = { room }
    devices.push(device)
    commandTopics.set(deviceId, cmd)
  }

  return { devices, commandTopics }
}

/** Map a neutral command to a Homie set-topic + payload (or null). */
export function commandToHomie(
  capability: CapabilityKind,
  payload: Record<string, number | string | boolean>,
  valueTopic: string,
): { topic: string; payload: string } | null {
  const topic = `${valueTopic}/set`
  switch (capability) {
    case 'OnOff': return { topic, payload: payload.on ? 'true' : 'false' }
    case 'Lock': return { topic, payload: payload.locked ? 'true' : 'false' }
    case 'Brightness': return { topic, payload: String(Number(payload.percent)) }
    case 'ColorTemperature': return { topic, payload: String(Number(payload.kelvin)) }
    case 'Position': return { topic, payload: String(Number(payload.percent)) }
    default: return null
  }
}
