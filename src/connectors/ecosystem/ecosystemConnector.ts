/**
 * ecosystemConnector.ts — a generic, fully functional Connector for any
 * ecosystem spec from the catalog.
 *
 * One implementation serves every brand: it materialises the spec's fleet as
 * neutral domain Devices, streams believable live telemetry (temperature
 * drift, humidity wander, motion pulses, energy noise that follows OnOff),
 * and executes commands against its device state with the same linked-effect
 * semantics a real bridge shows (dimming to zero switches off, switching off
 * zeroes the load, …). The runtime never learns which brand it talks to —
 * exactly the connector contract's promise.
 */

import type {
  Capability, Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'
import { findCapability, mergeCapabilities } from '@/domain'
import type { EcosystemSpec } from './catalog'
import { demoVacuumMapBlob } from './vacuumMap'

export interface EcosystemConnectorOptions {
  /** Simulation tick in ms. Default 3500; tests pass something small. */
  liveMs?: number
}

interface Sim {
  /** Nominal load in W while the device is on (captured from the spec). */
  onWatts: number
  /** Ticks a motion sensor stays "detected" before falling back to idle. */
  motionHold: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function createEcosystemConnector(spec: EcosystemSpec, opts: EcosystemConnectorOptions = {}): Connector {
  const liveMs = opts.liveMs ?? 3500

  let status: ConnectorStatus = 'disconnected'
  let message: string | undefined
  let lastSync: string | undefined
  let statusListener: ((health: ConnectorHealth) => void) | undefined
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let tickIndex = 0

  const buildHealth = (): ConnectorHealth => ({ status, message, lastSync })
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    message = msg
    statusListener?.(buildHealth())
  }

  /* Materialise the fleet once; capabilities ARE the state (domain rule). */
  const devices: Device[] = spec.fleet.map((f) => {
    const caps = f.caps.map((c) => ({ ...c }))
    // A vacuum device carries its LiDAR map as telemetry — a real Tuya-format
    // blob the robot page decodes, exactly like a live robot would deliver.
    const isVacuum = caps.some((c) => c.kind === 'Vacuum')
    return {
      id: `${spec.id}:${f.key}`,
      connectorId: spec.id,
      category: f.category,
      name: f.name,
      capabilities: caps,
      ...(f.battery !== undefined ? { battery: { percent: f.battery } } : {}),
      ...(isVacuum ? { telemetry: { map: demoVacuumMapBlob() } } : {}),
      health: { reachability: 'online' as const, lastSeen: new Date().toISOString() },
      metadata: { ecosystem: spec.label },
    }
  })

  const sims = new Map<string, Sim>(devices.map((dev) => {
    const e = findCapability(dev.capabilities, 'Energy')
    const on = findCapability(dev.capabilities, 'OnOff')
    // Devices created "on" carry their live load; devices created "off" would
    // read 0 W — recover a plausible on-load from category for those.
    const fallback = dev.category === 'light' ? 9 : dev.category === 'speaker' ? 8 : dev.category === 'energy' ? 60 : 5
    const onWatts = e && (!on || on.on) && e.watts > 0 ? e.watts : fallback
    return [dev.id, { onWatts, motionHold: 0 }]
  }))

  const emit = (dev: Device, caps: Capability[]): void => {
    dev.capabilities = mergeCapabilities(dev.capabilities, caps)
    dev.health = { ...dev.health, lastSeen: new Date().toISOString() }
    lastSync = new Date().toISOString()
    onUpdate?.({ deviceId: dev.id, capabilities: caps, health: dev.health })
  }

  /** One believable telemetry step for one device. Returns true if it emitted. */
  const simulate = (dev: Device): boolean => {
    const sim = sims.get(dev.id)
    if (!sim) return false
    const changes: Capability[] = []
    const t = findCapability(dev.capabilities, 'Temperature')
    if (t) changes.push({ ...t, celsius: Math.round(clamp(t.celsius + (Math.random() - 0.5) * 0.4, 4, 34) * 10) / 10 })
    const h = findCapability(dev.capabilities, 'Humidity')
    if (h) changes.push({ ...h, percent: Math.round(clamp(h.percent + (Math.random() - 0.5) * 2, 25, 85)) })
    const m = findCapability(dev.capabilities, 'Motion')
    if (m) {
      if (m.detected) {
        sim.motionHold -= 1
        if (sim.motionHold <= 0) changes.push({ ...m, detected: false })
      } else if (Math.random() < 0.18) {
        sim.motionHold = 2
        changes.push({ ...m, detected: true })
      }
    }
    const e = findCapability(dev.capabilities, 'Energy')
    if (e) {
      const on = findCapability(dev.capabilities, 'OnOff')
      const base = !on || on.on ? sim.onWatts : 0
      const noisy = base > 0 ? Math.max(1, Math.round(base * (0.92 + Math.random() * 0.16))) : Math.random() < 0.5 ? 0 : 1
      if (noisy !== e.watts) changes.push({ ...e, watts: noisy })
    }
    // A commanded cleaning run keeps running (a real robot cleans for an hour);
    // the sim only completes the docking of a robot already heading home.
    const v = findCapability(dev.capabilities, 'Vacuum')
    if (v && v.activity === 'returning' && Math.random() < 0.35) {
      changes.push({ ...v, activity: 'docked' })
    }
    if (changes.length) emit(dev, changes)
    return changes.length > 0
  }

  const tick = (): void => {
    // Round-robin with a random second pick — lively without being noisy.
    const a = devices[tickIndex++ % devices.length]
    // Devices without drifting telemetry (locks, plain contacts) still prove
    // liveness: a real bridge heartbeats reachability, so this one does too.
    if (!simulate(a)) emit(a, [])
    const b = devices[Math.floor(Math.random() * devices.length)]
    if (b !== a) simulate(b)
  }

  return {
    info: { id: spec.id, label: spec.label },

    async connect(): Promise<void> {
      setStatus('connecting')
      await new Promise((r) => setTimeout(r, 0)) // yield like a real handshake
      lastSync = new Date().toISOString()
      if (!timer) timer = setInterval(tick, liveMs)
      setStatus('connected')
    },

    async disconnect(): Promise<void> {
      if (timer) { clearInterval(timer); timer = undefined }
      onUpdate = undefined
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      lastSync = new Date().toISOString()
      return devices
    },

    async synchronize(): Promise<Device[]> {
      lastSync = new Date().toISOString()
      return devices
    },

    subscribe(handler: (u: DeviceUpdate) => void): Unsubscribe {
      onUpdate = handler
      return () => { if (onUpdate === handler) onUpdate = undefined }
    },

    async publish(command: DeviceCommand): Promise<void> {
      const dev = devices.find((x) => x.id === command.deviceId)
      if (!dev) return
      const sim = sims.get(dev.id)
      const changes: Capability[] = []
      const p = command.payload

      switch (command.capability) {
        case 'OnOff': {
          const c = findCapability(dev.capabilities, 'OnOff')
          if (!c) return
          const on = Boolean(p.on)
          changes.push({ ...c, on })
          const e = findCapability(dev.capabilities, 'Energy')
          if (e && sim) changes.push({ ...e, watts: on ? sim.onWatts : 0 })
          break
        }
        case 'Brightness': {
          const c = findCapability(dev.capabilities, 'Brightness')
          if (!c) return
          const percent = clamp(Number(p.percent), 0, 100)
          changes.push({ ...c, percent })
          const on = findCapability(dev.capabilities, 'OnOff')
          if (on) changes.push({ ...on, on: percent > 0 }) // real bridges link these
          break
        }
        case 'ColorTemperature': {
          const c = findCapability(dev.capabilities, 'ColorTemperature')
          if (!c) return
          changes.push({ ...c, kelvin: clamp(Number(p.kelvin), c.minKelvin, c.maxKelvin) })
          break
        }
        case 'Color': {
          const c = findCapability(dev.capabilities, 'Color')
          if (!c || typeof p.hex !== 'string') return
          changes.push({ ...c, hex: p.hex })
          break
        }
        case 'Lock': {
          const c = findCapability(dev.capabilities, 'Lock')
          if (!c) return
          changes.push({ ...c, locked: Boolean(p.locked) })
          break
        }
        case 'Position': {
          const c = findCapability(dev.capabilities, 'Position')
          if (!c) return
          changes.push({ ...c, percent: clamp(Number(p.percent), 0, 100) })
          break
        }
        case 'Vacuum': {
          const c = findCapability(dev.capabilities, 'Vacuum')
          if (!c) return
          const activity = String(p.activity)
          if (activity === 'idle' || activity === 'cleaning' || activity === 'returning' || activity === 'docked') {
            changes.push({ ...c, activity })
          }
          break
        }
        default:
          return // read-only capabilities take no commands
      }
      if (changes.length) emit(dev, changes)
    },

    health(): ConnectorHealth {
      return buildHealth()
    },

    onStatus(listener: (health: ConnectorHealth) => void): Unsubscribe {
      statusListener = listener
      return () => { if (statusListener === listener) statusListener = undefined }
    },
  }
}
