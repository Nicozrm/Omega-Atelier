/**
 * connector.ts — the Connector contract.
 *
 * A Connector is the ONLY bridge between this manufacturer-neutral core and a
 * concrete ecosystem (Matter, Home Assistant, MQTT, Alexa, Apple Home, Google
 * Home, SwitchBot, Govee, Lockin, Tuya / Smart Life, Arenti, Osaio, …). The core
 * declares the contract; every integration implements it OUTSIDE the core.
 * Nothing here names a vendor or a network technology — only neutral verbs and
 * neutral data.
 *
 * This file is interfaces only: no implementation, no network call, no
 * manufacturer type.
 */

import type { Capability, CapabilityKind } from './capabilities'
import type { Device, DeviceBattery, DeviceHealth, DeviceTelemetry } from './device'

export interface ConnectorInfo {
  id: string
  /** Human label, provided by the connector — not by the core. */
  label: string
}

export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectorHealth {
  status: ConnectorStatus
  message?: string
  /** ISO timestamp of the last successful synchronise. */
  lastSync?: string
}

/** A change a connector reports for one device (neutral data). */
export interface DeviceUpdate {
  deviceId: string
  /** Capability values to merge — a capability of the same kind replaces. */
  capabilities?: Capability[]
  health?: Partial<DeviceHealth>
  battery?: DeviceBattery
  telemetry?: DeviceTelemetry
}

/** A command the runtime sends toward a device capability (neutral data). */
export interface DeviceCommand {
  deviceId: string
  capability: CapabilityKind
  /** Desired values shaped per capability, e.g. `{ on: true }` or `{ percent: 40 }`. */
  payload: Record<string, number | string | boolean>
}

export type Unsubscribe = () => void

/**
 * The contract every ecosystem integration implements — and the *only* surface
 * the runtime ever talks to. A new manufacturer is added solely by providing a
 * `Connector`; the core is never touched.
 */
export interface Connector {
  readonly info: ConnectorInfo
  /** Enumerate the devices this integration exposes. */
  discover(): Promise<Device[]>
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** Pull a fresh snapshot of all owned devices. */
  synchronize(): Promise<Device[]>
  /** Stream device updates; returns an unsubscribe handle. */
  subscribe(onUpdate: (update: DeviceUpdate) => void): Unsubscribe
  /** Deliver a command toward a device. */
  publish(command: DeviceCommand): Promise<void>
  /** Current connector health (always available; safe to poll). */
  health(): ConnectorHealth
  /**
   * OPTIONAL event channel for *connector-level* health changes — connecting,
   * connected, dropped, reconnected, error. A real transport can fail at any
   * moment; connectors that can detect this should push it here instead of
   * forcing consumers to poll `health()`. If absent, the runtime falls back to
   * `health()` snapshots. Returns an unsubscribe handle.
   */
  onStatus?(listener: (health: ConnectorHealth) => void): Unsubscribe
}
