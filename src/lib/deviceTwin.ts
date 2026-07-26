/**
 * deviceTwin.ts — adapter from the plan's placed devices to the Device Domain.
 *
 * This lives OUTSIDE the core, on purpose: it is the kind of mapping a future
 * "local plan" connector would perform. It reads only neutral facts — the
 * device *category* and its current mode state — and derives a manufacturer-
 * neutral domain `Device` from generic capabilities. The legacy `brand` /
 * `ecosystem` / `protocol` fields are deliberately **never** carried into the
 * domain: in the twin, two lamps from different vendors are indistinguishable.
 */

import { DEVICES } from '@/data/devices'
import { modeStateFor } from '@/lib/modeState'
import type { PlacedDevice, DeviceCategory as LegacyCategory, ModeKey } from '@/types'
import type { Capability, Device, DeviceBattery, DeviceCategory } from '@/domain'

const CATALOG = new Map(DEVICES.map((d) => [d.id, d]))

/** Deterministic 0–1 pseudo value from an id (stable demo telemetry). */
function seeded(id: string, salt: string): number {
  let h = 2166136261
  const s = id + salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

const has = (text: string, ...keys: string[]) => keys.some((k) => text.includes(k))

interface Derived {
  category: DeviceCategory
  label: string
  capabilities: Capability[]
  battery: boolean
}

/** Map a legacy catalog entry to a neutral category + capability set. */
function derive(legacy: LegacyCategory, hint: string, id: string, ratedWatts?: number): Derived {
  switch (legacy) {
    case 'light':
      return {
        category: 'light', label: 'Leuchte', battery: false,
        capabilities: [
          { kind: 'OnOff', access: 'readWrite', on: false },
          { kind: 'Brightness', access: 'readWrite', percent: 0 },
          { kind: 'ColorTemperature', access: 'readWrite', kelvin: 2700, minKelvin: 2200, maxKelvin: 6500 },
          { kind: 'Color', access: 'readWrite', hex: '#ffd9a8' },
        ],
      }
    case 'lock':
      return {
        category: 'lock', label: 'Türschloss', battery: true,
        capabilities: [{ kind: 'Lock', access: 'readWrite', locked: true }],
      }
    case 'camera':
      return {
        category: 'camera', label: 'Kamera', battery: false,
        capabilities: [
          { kind: 'Camera', access: 'read', streaming: true },
          { kind: 'Motion', access: 'read', detected: seeded(id, 'm') > 0.7 },
        ],
      }
    case 'speaker':
      return {
        category: 'speaker', label: 'Lautsprecher', battery: false,
        capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
      }
    case 'outlet':
      return {
        category: 'energy', label: 'Steckdose', battery: false,
        capabilities: [
          { kind: 'OnOff', access: 'readWrite', on: true },
          { kind: 'Energy', access: 'read', watts: Math.round((ratedWatts ?? 10) * (0.3 + seeded(id, 'w') * 0.7)) },
        ],
      }
    case 'blind':
      return {
        category: 'cover', label: 'Rollladen', battery: true,
        capabilities: [{ kind: 'Position', access: 'readWrite', percent: Math.round(seeded(id, 'p') * 100) }],
      }
    case 'climate':
      return {
        category: 'climate', label: 'Heizungsthermostat', battery: true,
        capabilities: [
          { kind: 'Temperature', access: 'read', celsius: Math.round((19 + seeded(id, 't') * 5) * 10) / 10 },
          { kind: 'Position', access: 'readWrite', percent: Math.round(seeded(id, 'v') * 100) },
        ],
      }
    case 'appliance':
      if (has(hint, 'saug', 'vacuum', 'robot')) {
        return {
          category: 'appliance', label: 'Saugroboter', battery: true,
          capabilities: [{ kind: 'Vacuum', access: 'readWrite', activity: 'docked' }],
        }
      }
      return {
        category: 'appliance', label: 'Gerät', battery: false,
        capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
      }
    case 'sensor':
    case 'alarm': {
      if (has(hint, 'temp', 'klima', 'thermo', 'air', 'weather', 'wetter', 'humid', 'luft')) {
        return {
          category: 'sensor', label: 'Klimasensor', battery: true,
          capabilities: [
            { kind: 'Temperature', access: 'read', celsius: Math.round((19 + seeded(id, 't') * 5) * 10) / 10 },
            { kind: 'Humidity', access: 'read', percent: Math.round(40 + seeded(id, 'h') * 20) },
          ],
        }
      }
      return {
        category: 'sensor', label: 'Bewegungssensor', battery: true,
        capabilities: [{ kind: 'Motion', access: 'read', detected: seeded(id, 'm') > 0.6 }],
      }
    }
    case 'tv':
      return {
        category: 'appliance', label: 'Gerät', battery: false,
        capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
      }
    case 'hub':
      return { category: 'hub', label: 'Hub', battery: false, capabilities: [] }
    case 'irrigation':
      return {
        category: 'other', label: 'Bewässerung', battery: false,
        capabilities: [{ kind: 'OnOff', access: 'readWrite', on: false }],
      }
    default:
      return { category: 'other', label: 'Gerät', battery: false, capabilities: [] }
  }
}

/** Apply the active light mode state onto a light's capabilities. */
function applyLightState(caps: Capability[], placed: PlacedDevice, mode: ModeKey): Capability[] {
  const st = { ...modeStateFor('light', mode), ...(placed.modeState?.[mode] ?? {}) }
  const on = st.on === true || (typeof st.brightness === 'number' && st.brightness > 0)
  const brightness = typeof st.brightness === 'number' ? st.brightness : on ? 100 : 0
  const kelvin = typeof st.kelvin === 'number' ? st.kelvin : 2700
  return caps.map((c) => {
    if (c.kind === 'OnOff') return { ...c, on }
    if (c.kind === 'Brightness') return { ...c, percent: brightness }
    if (c.kind === 'ColorTemperature') return { ...c, kelvin }
    return c
  })
}

/** Convert a single placed device into a manufacturer-neutral domain device. */
export function placedToDevice(placed: PlacedDevice, mode: ModeKey, index = 0): Device {
  const entry = CATALOG.get(placed.deviceId)
  const legacy: LegacyCategory = entry?.category ?? 'other'
  const hint = `${entry?.name ?? ''} ${(entry?.tags ?? []).join(' ')}`.toLowerCase()
  const d = derive(legacy, hint, placed.id, entry?.power)

  let capabilities = d.capabilities
  if (d.category === 'light') capabilities = applyLightState(capabilities, placed, mode)

  const battery: DeviceBattery | undefined = d.battery
    ? { percent: Math.round(20 + seeded(placed.id, 'bat') * 80), charging: false }
    : undefined

  return {
    id: placed.id,
    connectorId: 'local-plan',
    roomId: placed.roomId,
    category: d.category,
    name: `${d.label} ${index + 1}`,
    capabilities,
    metadata: entry?.power ? { ratedWatts: String(entry.power) } : undefined,
    battery,
    health: {
      reachability: 'online',
      signal: Math.round((0.55 + seeded(placed.id, 'sig') * 0.45) * 100) / 100,
      lastSeen: new Date().toISOString(),
    },
  }
}

/** Build the full neutral device twin for a set of placed devices. */
export function planDevicesToTwin(devices: PlacedDevice[], mode: ModeKey): Device[] {
  const counters = new Map<string, number>()
  return devices.map((placed) => {
    const entry = CATALOG.get(placed.deviceId)
    const legacy: LegacyCategory = entry?.category ?? 'other'
    const hint = `${entry?.name ?? ''} ${(entry?.tags ?? []).join(' ')}`.toLowerCase()
    const label = derive(legacy, hint, placed.id, entry?.power).label
    const n = counters.get(label) ?? 0
    counters.set(label, n + 1)
    return placedToDevice(placed, mode, n)
  })
}
