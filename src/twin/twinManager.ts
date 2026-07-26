/**
 * twinManager.ts — the app-layer orchestrator for a *single* Digital Twin fed by
 * *multiple* connectors at once.
 *
 * It owns one shared `DigitalTwinRuntime` and a registry of active connector
 * sessions, and exposes a single subscription that the UI consumes. The runtime
 * already supports simultaneous connectors (per-connector subscriptions, status
 * and command routing by `connectorId`); this manager simply drives it and tracks
 * which connectors are live — so no core change was needed.
 *
 * This module depends ONLY on the domain. It never imports a concrete connector
 * or transport; callers pass a `make()` factory. That keeps the manager
 * vendor-agnostic and the connector catalog a UI concern.
 */

import {
  DigitalTwinRuntime,
  type Connector, type ConnectorHealth, type Device, type DeviceCommand, type Unsubscribe,
} from '@/domain'

export interface TwinSession {
  /** Connector id (= `connector.info.id`). */
  id: string
  label: string
  /** Opaque UI grouping/badge hint (e.g. 'home-assistant', 'mqtt'). */
  kind: string
  health: ConnectorHealth
}

export interface TwinView {
  devices: Device[]
  sessions: TwinSession[]
  /** Manual device→room overrides (opaque roomId; the manager never interprets it). */
  bindings: Record<string, string>
  /** Last applied scene key (opaque to the manager). */
  activeScene?: string
}

export interface ConnectorDescriptor {
  label: string
  kind: string
  make: () => Connector
}

type Listener = (view: TwinView) => void

export class TwinManager {
  private runtime = new DigitalTwinRuntime()
  private connectors = new Map<string, Connector>()
  private sessions = new Map<string, TwinSession>()
  private bindings = new Map<string, string>()
  private activeScene: string | undefined
  private listeners = new Set<Listener>()

  constructor() {
    // One subscription point: device changes AND connector-status changes both
    // refresh the unified view.
    this.runtime.subscribe(() => this.emit())
    this.runtime.subscribeStatus((ev) => this.updateHealth(ev.connectorId, ev.health))
  }

  view(): TwinView {
    return {
      devices: this.runtime.listDevices(),
      sessions: [...this.sessions.values()],
      bindings: Object.fromEntries(this.bindings),
      activeScene: this.activeScene,
    }
  }

  subscribe(listener: Listener): Unsubscribe {
    this.listeners.add(listener)
    listener(this.view())
    return () => {
      this.listeners.delete(listener)
    }
  }

  isActive(id: string): boolean {
    return this.connectors.has(id)
  }

  /** Build, connect and adopt a connector into the shared runtime. */
  async addConnector(descriptor: ConnectorDescriptor): Promise<void> {
    const connector = descriptor.make()
    const id = connector.info.id
    if (this.connectors.has(id)) return
    this.connectors.set(id, connector)
    this.sessions.set(id, { id, label: descriptor.label, kind: descriptor.kind, health: { status: 'connecting' } })
    this.emit()
    // Pushed status during connect (before adoption hands the channel to the runtime).
    connector.onStatus?.((h) => this.updateHealth(id, h))
    try {
      await connector.connect()
      const devices = await connector.discover()
      this.runtime.adoptConnector(connector, devices)
    } catch (e) {
      this.updateHealth(id, { status: 'error', message: e instanceof Error ? e.message : 'Verbindung fehlgeschlagen' })
    }
  }

  /** Remove one connector; the others (and their devices) stay live. */
  async removeConnector(id: string): Promise<void> {
    if (!this.connectors.has(id)) return
    await this.runtime.removeConnector(id)
    this.connectors.delete(id)
    this.sessions.delete(id)
    this.emit()
  }

  /** Route a command to the owning connector (by device.connectorId, in the runtime). */
  command(cmd: DeviceCommand): Promise<void> {
    return this.runtime.command(cmd)
  }

  /**
   * Apply a scene: fan a pre-computed command batch out across the runtime (which
   * routes each by connectorId) and record the active scene. The scene key is
   * opaque here; the command logic lives in the app-layer `scenes` module.
   */
  async applyScene(scene: string, cmds: DeviceCommand[]): Promise<void> {
    this.activeScene = scene
    this.emit()
    await Promise.all(cmds.map((c) => this.runtime.command(c)))
  }

  /** Manually assign a device to a plan room (opaque roomId), or clear it. */
  setBinding(deviceId: string, roomId: string): void {
    this.bindings.set(deviceId, roomId)
    this.emit()
  }

  clearBinding(deviceId: string): void {
    if (this.bindings.delete(deviceId)) this.emit()
  }

  private updateHealth(id: string, health: ConnectorHealth): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.health = health
    this.emit()
  }

  private emit(): void {
    const view = this.view()
    for (const listener of this.listeners) listener(view)
  }
}

let instance: TwinManager | null = null

/** The shared, app-wide twin — persists across overlay open/close within a session. */
export function twinManager(): TwinManager {
  if (!instance) instance = new TwinManager()
  return instance
}
