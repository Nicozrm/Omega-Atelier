/**
 * device.ts — the Device Domain.
 *
 * A general model for *arbitrary* devices — not lamps, not plugs, but anything a
 * connector can expose. A device is identified, located in a room, owned by a
 * connector, and described entirely by its capabilities. No UI, no renderer, no
 * connector implementation, no manufacturer concept lives here.
 */

import type { Capability, CapabilityByKind, CapabilityKind } from './capabilities'
import { findCapability, hasCapability } from './capabilities'

/** Neutral device category — a coarse role, never a product or brand. */
export type DeviceCategory =
  | 'light'
  | 'lock'
  | 'sensor'
  | 'climate'
  | 'camera'
  | 'cover'
  | 'energy'
  | 'appliance'
  | 'speaker'
  | 'hub'
  | 'other'

export type Reachability = 'online' | 'offline' | 'unknown'

export interface DeviceHealth {
  reachability: Reachability
  /** Signal quality 0–1, if known. */
  signal?: number
  /** ISO timestamp of the last contact. */
  lastSeen?: string
}

export interface DeviceBattery {
  /** 0–100 %. Absent ⇒ mains-powered. */
  percent: number
  charging?: boolean
}

export type TelemetryValue = number | string | boolean
export type DeviceTelemetry = Record<string, TelemetryValue>

export interface Device {
  id: string
  /**
   * The connector that owns this device. An opaque id — the core never learns
   * which ecosystem the connector speaks.
   */
  connectorId: string
  /** Logical room (refs the plan's room id). */
  roomId?: string
  category: DeviceCategory
  /** Display name — generic or user-given, never a vendor concept in the core. */
  name: string
  /**
   * The complete, manufacturer-neutral description of what the device does and
   * its current values. Capabilities ARE the device state — there is no second,
   * parallel state store to drift out of sync.
   */
  capabilities: Capability[]
  /** Opaque key/value metadata (firmware, model class …). Never interpreted by the core. */
  metadata?: Record<string, string>
  telemetry?: DeviceTelemetry
  battery?: DeviceBattery
  health: DeviceHealth
}

/** Does the device expose the given capability? */
export function deviceHasCapability(d: Device, kind: CapabilityKind): boolean {
  return hasCapability(d.capabilities, kind)
}

/** Typed capability lookup on a device. */
export function deviceCapability<K extends CapabilityKind>(
  d: Device,
  kind: K,
): CapabilityByKind[K] | undefined {
  return findCapability(d.capabilities, kind)
}

/**
 * A flat snapshot of the device's state, projected from its capabilities. This
 * is a *view*, never a stored duplicate — capabilities remain the single source
 * of truth for state.
 */
export function deviceState(d: Device): Record<string, TelemetryValue> {
  const state: Record<string, TelemetryValue> = {}
  for (const c of d.capabilities) {
    switch (c.kind) {
      case 'OnOff': state.on = c.on; break
      case 'Brightness': state.brightness = c.percent; break
      case 'ColorTemperature': state.kelvin = c.kelvin; break
      case 'Color': state.color = c.hex; break
      case 'Lock': state.locked = c.locked; break
      case 'Position': state.position = c.percent; break
      case 'Temperature': state.temperature = c.celsius; break
      case 'Humidity': state.humidity = c.percent; break
      case 'Motion': state.motion = c.detected; break
      case 'Energy': state.watts = c.watts; break
      case 'Camera': state.streaming = c.streaming; break
      case 'Vacuum': state.activity = c.activity; break
    }
  }
  return state
}

/**
 * Merge incoming capabilities into a base set: a capability of the same kind
 * replaces the existing one, a new kind is appended. (A device carries at most
 * one capability per kind.)
 */
export function mergeCapabilities(base: Capability[], incoming: Capability[]): Capability[] {
  const byKind = new Map<CapabilityKind, Capability>(base.map((c) => [c.kind, c]))
  for (const c of incoming) byKind.set(c.kind, c)
  return [...byKind.values()]
}
