/**
 * mapping.ts — Tuya ⇄ neutral domain translation.
 *
 * All Tuya-specific knowledge lives here, inside the connector: status codes,
 * category letters, the 0–1000 brightness scale, the HSV colour blob. The core
 * never sees a `switch_led` code or a `dj` category — a Tuya bulb becomes the
 * same neutral `[OnOff, Brightness, ColorTemperature, Color]` device an HA or
 * Matter bulb does.
 */

import type { Capability, Device, DeviceBattery, DeviceCategory } from '@/domain'
import type { DeviceCommand } from '@/domain'

/** One Tuya data point (status code + value). */
export interface TuyaStatus {
  code: string
  value: unknown
}

/** A Tuya device as returned by the device-list / detail endpoints. */
export interface TuyaDevice {
  id: string
  name: string
  /** Tuya product category, e.g. 'dj' (light), 'cz' (socket), 'sd' (vacuum). */
  category?: string
  online?: boolean
  status?: TuyaStatus[]
  /** Optional room/area label from the Tuya home. */
  room?: string
}

const asBool = (v: unknown): boolean => v === true || v === 'true' || v === 1
const asNum = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

const has = (s: TuyaStatus[], code: string): boolean => s.some((x) => x.code === code)
const val = (s: TuyaStatus[], ...codes: string[]): unknown => {
  for (const c of codes) { const f = s.find((x) => x.code === c); if (f) return f.value }
  return undefined
}

/** Tuya HSV colour blob → hex. Tuya H:0–360, S/V:0–1000. */
function tuyaColourToHex(v: unknown): string | undefined {
  let hsv: { h?: number; s?: number; v?: number } | undefined
  if (typeof v === 'string') { try { hsv = JSON.parse(v) } catch { return undefined } }
  else if (v && typeof v === 'object') hsv = v as { h?: number; s?: number; v?: number }
  if (!hsv || hsv.h === undefined) return undefined
  const h = hsv.h / 360, s = (hsv.s ?? 1000) / 1000, val01 = (hsv.v ?? 1000) / 1000
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = val01 * (1 - s), q = val01 * (1 - f * s), t = val01 * (1 - (1 - f) * s)
  const [r, g, b] = [[val01, t, p], [q, val01, p], [p, val01, t], [p, q, val01], [t, p, val01], [val01, p, q]][i % 6]
  const hx = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

type VacuumActivity = 'idle' | 'cleaning' | 'returning' | 'docked'

// Tuya robot-vacuum (category 'sd') state vocabulary. Real robots report their
// live state through the `status` enum; cheaper ones only expose `mode` (the
// cleaning mode) and/or `power_go` (the start/pause switch) — we read all three.
const VAC_CLEANING = new Set([
  'cleaning', 'smart', 'smart_clean', 'zone_clean', 'single_clean', 'pick_zone_clean',
  'selectroom', 'spot', 'spiral', 'edge', 'wall_follow', 'random', 'mop', 'part', 'pose',
  'curpoint', 'point',
])
const VAC_RETURNING = new Set([
  'goto_charge', 'chargego', 'going_home', 'to_charge', 'back_charge', 'return', 'go_charging',
])
const VAC_DOCKED = new Set([
  'charging', 'charge_done', 'charge_finish', 'chargecompleted', 'completed', 'fullcharge', 'sleep',
])
const VAC_IDLE = new Set(['standby', 'paused', 'pause', 'stop', 'idle'])

/** Vacuum-defining data points — their presence marks the device as a robot. */
const VAC_HINT_CODES = ['power_go', 'clean_record', 'clean_area', 'clean_time', 'seek', 'suction', 'fan_speed', 'direction_control']

/**
 * Classify a Tuya vacuum's live state into a neutral activity, or undefined
 * when the status array isn't a robot vacuum's. Prefers the authoritative
 * `status` enum, then the `power_go` switch, then the legacy `mode` overload.
 */
function mapVacuumActivity(status: TuyaStatus[]): VacuumActivity | undefined {
  const looksVacuum = VAC_HINT_CODES.some((c) => has(status, c))

  const st = val(status, 'status')
  if (typeof st === 'string') {
    const s = st.toLowerCase()
    if (VAC_RETURNING.has(s)) return 'returning'
    if (VAC_DOCKED.has(s)) return 'docked'
    if (VAC_CLEANING.has(s)) return 'cleaning'
    if (VAC_IDLE.has(s)) return 'idle'
    if (looksVacuum) return 'idle' // recognised as a vacuum, unknown state string
  }

  if (has(status, 'power_go')) return asBool(val(status, 'power_go')) ? 'cleaning' : 'idle'

  // Legacy: cheap robots overload the cleaning-mode DP for their state.
  if (has(status, 'mode')) {
    const m = val(status, 'mode')
    if (m === 'standby') return 'docked'
    if (m === 'chargego') return 'returning'
    if (m === 'smart' || has(status, 'clean_record')) return 'cleaning'
  }

  if (looksVacuum) return 'idle'
  return undefined
}

/** Map a Tuya status array to neutral capabilities. */
export function mapStatusToCapabilities(status: TuyaStatus[]): Capability[] {
  const caps: Capability[] = []

  const onCode = ['switch_led', 'switch_1', 'switch', 'switch_on'].find((c) => has(status, c))
  if (onCode) caps.push({ kind: 'OnOff', access: 'readWrite', on: asBool(val(status, onCode)) })

  const bright = asNum(val(status, 'bright_value_v2', 'bright_value'))
  if (bright !== undefined) {
    // Tuya brightness is 10–1000 (v1) or 0–1000 (v2); normalise to 0–100 %.
    caps.push({ kind: 'Brightness', access: 'readWrite', percent: Math.round((bright / 1000) * 100) })
  }

  const temp = asNum(val(status, 'temp_value_v2', 'temp_value'))
  if (temp !== undefined) {
    // 0–1000 cold→warm scale mapped onto a 2700–6500 K range.
    const kelvin = Math.round(2700 + (temp / 1000) * (6500 - 2700))
    caps.push({ kind: 'ColorTemperature', access: 'readWrite', kelvin, minKelvin: 2700, maxKelvin: 6500 })
  }

  const hex = tuyaColourToHex(val(status, 'colour_data_v2', 'colour_data'))
  if (hex) caps.push({ kind: 'Color', access: 'readWrite', hex })

  if (has(status, 'lock_motor_state') || has(status, 'closed_opened')) {
    caps.push({ kind: 'Lock', access: 'readWrite', locked: asBool(val(status, 'lock_motor_state', 'closed_opened')) })
  }

  const pos = asNum(val(status, 'percent_control', 'position'))
  if (pos !== undefined) caps.push({ kind: 'Position', access: 'readWrite', percent: Math.round(pos) })

  const t = asNum(val(status, 'va_temperature', 'temp_current'))
  if (t !== undefined) caps.push({ kind: 'Temperature', access: 'read', celsius: Math.round((t / 10) * 10) / 10 })

  const hum = asNum(val(status, 'va_humidity', 'humidity_value'))
  if (hum !== undefined) caps.push({ kind: 'Humidity', access: 'read', percent: Math.round(hum) })

  if (has(status, 'pir') || has(status, 'presence_state')) {
    const p = val(status, 'pir', 'presence_state')
    caps.push({ kind: 'Motion', access: 'read', detected: p === 'pir' || p === 'presence' || asBool(p) })
  }

  const power = asNum(val(status, 'cur_power'))
  if (power !== undefined) caps.push({ kind: 'Energy', access: 'read', watts: Math.round(power / 10) })

  const vacActivity = mapVacuumActivity(status)
  if (vacActivity) caps.push({ kind: 'Vacuum', access: 'readWrite', activity: vacActivity })

  return caps
}

/** Coarse neutral category from Tuya's product-category letters. */
function categoryOf(cat: string | undefined, caps: Capability[]): DeviceCategory {
  switch (cat) {
    case 'dj': case 'dd': case 'dc': case 'xdd': return 'light'
    case 'kg': case 'cz': case 'pc': return 'energy'
    case 'ms': case 'jtmspro': return 'lock'
    case 'cl': case 'clkg': return 'cover'
    case 'wk': case 'wkf': return 'climate'
    case 'wsdcg': case 'pir': case 'mcs': return 'sensor'
    case 'sp': return 'camera'
    case 'sd': case 'sweeper': return 'appliance'
  }
  // Fall back to what the capabilities imply.
  if (caps.some((c) => c.kind === 'Vacuum')) return 'appliance'
  if (caps.some((c) => c.kind === 'Lock')) return 'lock'
  if (caps.some((c) => c.kind === 'Camera')) return 'camera'
  if (caps.some((c) => c.kind === 'Brightness' || c.kind === 'Color')) return 'light'
  if (caps.some((c) => c.kind === 'Temperature' || c.kind === 'Motion')) return 'sensor'
  return 'other'
}

/** Map a Tuya device to a full neutral domain device (or null if unmappable). */
export function mapTuyaDevice(d: TuyaDevice, connectorId: string): Device | null {
  const caps = mapStatusToCapabilities(d.status ?? [])
  if (caps.length === 0) return null
  const batteryPct = asNum(val(d.status ?? [], 'battery_percentage', 'residual_electricity'))
  const dev: Device = {
    id: d.id,
    connectorId,
    category: categoryOf(d.category, caps),
    name: d.name || d.id,
    capabilities: caps,
    health: { reachability: d.online === false ? 'offline' : 'online', lastSeen: new Date().toISOString() },
  }
  if (batteryPct !== undefined) {
    const b: DeviceBattery = { percent: Math.round(batteryPct) }
    dev.battery = b
  }
  if (d.room) dev.metadata = { room: d.room }
  return dev
}

/** A Tuya command to POST to `/v1.0/devices/{id}/commands`. */
export interface TuyaCommand {
  deviceId: string
  commands: TuyaStatus[]
}

/** Map a neutral command to Tuya command codes (or null if not controllable). */
export function commandToTuya(cmd: DeviceCommand): TuyaCommand | null {
  const p = cmd.payload
  const commands: TuyaStatus[] = []
  switch (cmd.capability) {
    case 'OnOff':
      commands.push({ code: 'switch_led', value: Boolean(p.on) }, { code: 'switch_1', value: Boolean(p.on) })
      break
    case 'Brightness':
      commands.push({ code: 'bright_value_v2', value: Math.round((Number(p.percent) / 100) * 1000) })
      break
    case 'ColorTemperature': {
      const k = Number(p.kelvin)
      const scaled = Math.round(((k - 2700) / (6500 - 2700)) * 1000)
      commands.push({ code: 'temp_value_v2', value: Math.max(0, Math.min(1000, scaled)) })
      break
    }
    case 'Lock':
      commands.push({ code: 'lock_motor_state', value: Boolean(p.locked) })
      break
    case 'Position':
      commands.push({ code: 'percent_control', value: Math.round(Number(p.percent)) })
      break
    case 'Vacuum': {
      // Canonical Tuya robot-vacuum control: `power_go` starts/pauses cleaning,
      // `mode: chargego` sends it home. (The old code set `mode: standby` to
      // stop — but standby is a reported *state*, not a command a robot obeys.)
      if (p.activity === 'cleaning') commands.push({ code: 'power_go', value: true })
      else if (p.activity === 'returning' || p.activity === 'docked') commands.push({ code: 'mode', value: 'chargego' })
      else commands.push({ code: 'power_go', value: false }) // idle → pause
      break
    }
    default:
      return null
  }
  return { deviceId: cmd.deviceId, commands }
}
