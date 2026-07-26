/**
 * runtime.ts — the Digital Twin Runtime.
 *
 * The single live model of every device, fed only by Devices, Capabilities and
 * Connectors. Renderers, AI, automations, energy analyses and future
 * integrations read the twin exclusively through this runtime — never through a
 * vendor API. The runtime is pure orchestration: it never learns which ecosystem
 * a connector speaks, and routes every command to the connector that owns the
 * target device.
 */

import type { CapabilityKind } from './capabilities'
import type { Device } from './device'
import { mergeCapabilities } from './device'
import type { Connector, ConnectorHealth, DeviceCommand, DeviceUpdate, Unsubscribe } from './connector'

export interface TwinSnapshot {
  devices: Device[]
}

export type TwinListener = (snapshot: TwinSnapshot) => void

/** A connector-level health change, tagged with its connector. */
export interface ConnectorStatusEvent {
  connectorId: string
  health: ConnectorHealth
}
export type ConnectorStatusListener = (event: ConnectorStatusEvent) => void

export class DigitalTwinRuntime {
  private devices = new Map<string, Device>()
  private connectors = new Map<string, Connector>()
  private subscriptions = new Map<string, Unsubscribe>()
  private statusUnsubs = new Map<string, Unsubscribe>()
  private listeners = new Set<TwinListener>()
  private statusListeners = new Set<ConnectorStatusListener>()

  /** Replace the entire device set (e.g. from local plan data). */
  setDevices(devices: Device[]): void {
    this.devices = new Map(devices.map((d) => [d.id, d]))
    this.emit()
  }

  upsertDevice(device: Device): void {
    this.devices.set(device.id, device)
    this.emit()
  }

  removeDevice(id: string): void {
    if (this.devices.delete(id)) this.emit()
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id)
  }

  listDevices(): Device[] {
    return [...this.devices.values()]
  }

  devicesInRoom(roomId: string): Device[] {
    return this.listDevices().filter((d) => d.roomId === roomId)
  }

  /** Every device exposing a given capability — the query renderers / AI use. */
  devicesWith(kind: CapabilityKind): Device[] {
    return this.listDevices().filter((d) => d.capabilities.some((c) => c.kind === kind))
  }

  /** Merge a connector-reported update into the twin. */
  applyUpdate(update: DeviceUpdate): void {
    const current = this.devices.get(update.deviceId)
    if (!current) return
    const next: Device = {
      ...current,
      capabilities: update.capabilities
        ? mergeCapabilities(current.capabilities, update.capabilities)
        : current.capabilities,
      health: update.health ? { ...current.health, ...update.health } : current.health,
      battery: update.battery ?? current.battery,
      telemetry: update.telemetry
        ? { ...current.telemetry, ...update.telemetry }
        : current.telemetry,
    }
    this.devices.set(next.id, next)
    this.emit()
  }

  /**
   * Register a connector, adopt the devices it exposes, and stream its updates.
   * The runtime stays vendor-agnostic — it only speaks the Connector contract.
   */
  /**
   * Register a connector, adopt the devices it exposes, and stream its updates.
   * The runtime stays vendor-agnostic — it only speaks the Connector contract.
   */
  async registerConnector(connector: Connector): Promise<void> {
    this.wireStatus(connector) // capture connecting/connected transitions
    await connector.connect()
    const discovered = await connector.discover()
    this.adoptConnector(connector, discovered)
  }

  /**
   * Adopt a connector that is ALREADY connected: store it, stamp + register the
   * given devices, wire its update + status streams. Use this when the caller has
   * already driven connect()/discover() (e.g. a setup wizard) and must not
   * re-connect a live transport. `registerConnector` builds on this.
   *
   * The runtime stamps each device's `connectorId` with the owning connector's
   * id — a connector author cannot silently break command routing by forgetting.
   */
  adoptConnector(connector: Connector, devices: Device[]): void {
    const id = connector.info.id
    this.connectors.set(id, connector)
    this.wireStatus(connector)
    for (const d of devices) this.devices.set(d.id, this.stamp(d, id))
    if (!this.subscriptions.has(id)) {
      this.subscriptions.set(id, connector.subscribe((u) => this.applyUpdate(u)))
    }
    this.emitStatus(id, connector.health())
    this.emit()
  }

  /** Stamp a device with its owning connector id (no churn when already correct). */
  private stamp(device: Device, connectorId: string): Device {
    return device.connectorId === connectorId ? device : { ...device, connectorId }
  }

  /** Subscribe (once) to a connector's optional status channel and re-emit it. */
  private wireStatus(connector: Connector): void {
    const id = connector.info.id
    if (this.statusUnsubs.has(id) || !connector.onStatus) return
    this.statusUnsubs.set(id, connector.onStatus((health) => this.emitStatus(id, health)))
  }

  async removeConnector(id: string): Promise<void> {
    const statusUnsub = this.statusUnsubs.get(id)
    if (statusUnsub) statusUnsub()
    this.statusUnsubs.delete(id)
    const unsubscribe = this.subscriptions.get(id)
    if (unsubscribe) unsubscribe()
    this.subscriptions.delete(id)
    const connector = this.connectors.get(id)
    if (connector) await connector.disconnect()
    this.connectors.delete(id)
    for (const d of this.listDevices()) if (d.connectorId === id) this.devices.delete(d.id)
    this.emitStatus(id, { status: 'disconnected' })
    this.emit()
  }

  /** Route a command to the connector that owns the target device. */
  async command(cmd: DeviceCommand): Promise<void> {
    const device = this.devices.get(cmd.deviceId)
    if (!device) return
    const connector = this.connectors.get(device.connectorId)
    if (!connector) return
    await connector.publish(cmd)
  }

  /** Observe twin changes (renderers, inspector, automations). */
  subscribe(listener: TwinListener): Unsubscribe {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Observe connector-level health changes across all connectors (pushed). */
  subscribeStatus(listener: ConnectorStatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private emitStatus(connectorId: string, health: ConnectorHealth): void {
    for (const listener of this.statusListeners) listener({ connectorId, health })
  }

  private emit(): void {
    const snapshot: TwinSnapshot = { devices: this.listDevices() }
    for (const listener of this.listeners) listener(snapshot)
  }
}
