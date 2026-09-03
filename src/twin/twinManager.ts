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
  DigitalTwinRuntime, findCapability,
  type Capability, type CapabilityKind, type Connector, type ConnectorHealth,
  type Device, type DeviceCommand, type Unsubscribe,
} from '@/domain'
import {
  restoredDevices, TWIN_STATE_VERSION,
  type SavedConnector, type TwinPersistedState,
} from './twinPersistence'
import type { DiscoveryState } from './integrationState'

export interface TwinSession {
  /** Connector id (= `connector.info.id`). */
  id: string
  label: string
  /** Opaque UI grouping/badge hint (e.g. 'home-assistant', 'mqtt'). */
  kind: string
  health: ConnectorHealth
  /**
   * The outcome of the last device discovery, tracked separately from the
   * transport health.
   *
   * These are two independent failures and the UI has to be able to tell them
   * apart: a connector can hold a perfectly valid session and still fail to
   * enumerate anything (wrong project scope, missing API subscription, an empty
   * account). Folding both into `health.status` is what made "verbunden" appear
   * over an empty device list with nothing to act on.
   */
  discovery: DiscoveryState
}

/**
 * Predictive state of a command in flight. `pending` = sent, not yet confirmed
 * by a device update (UI: soft amber pulse — "searching/connecting").
 * `failed` = transport rejected it or no confirmation arrived in time
 * (UI: graceful morph into the error state, never a hard popup).
 */
export type CommandPhase = 'pending' | 'failed'

/** View key of a tracked command. */
export const commandKey = (deviceId: string, capability: CapabilityKind): string =>
  `${deviceId}:${capability}`

export interface TwinView {
  devices: Device[]
  sessions: TwinSession[]
  /** Manual device→room overrides (opaque roomId; the manager never interprets it). */
  bindings: Record<string, string>
  /** In-flight / failed commands by `commandKey` — the latency mask the UI renders. */
  commands: Record<string, CommandPhase>
  /** Last applied scene key (opaque to the manager). */
  activeScene?: string
  /**
   * Sources that were connected in an earlier session and are not live now.
   * Credentials are never stored, so a live source needs reconnecting by hand;
   * this is what lets the UI offer that instead of forgetting it happened.
   */
  savedConnectors: SavedConnector[]
}

export interface ConnectorDescriptor {
  label: string
  kind: string
  make: () => Connector
}

type Listener = (view: TwinView) => void

/** No confirmation within this window ⇒ the command failed into the void. */
const COMMAND_TIMEOUT_MS = 5000
/** How long a failure stays visible before the control morphs back. */
const FAILURE_HOLD_MS = 4000

interface PendingCommand {
  phase: CommandPhase
  deviceId: string
  capability: CapabilityKind
  /**
   * The capability object at send time. Connectors emit fresh capability
   * objects on every update (`mergeCapabilities` keeps untouched kinds by
   * identity), so an identity change IS the device's confirmation.
   */
  before?: Capability
  timer: ReturnType<typeof setTimeout>
}

export class TwinManager {
  private runtime = new DigitalTwinRuntime()
  private connectors = new Map<string, Connector>()
  private sessions = new Map<string, TwinSession>()
  private bindings = new Map<string, string>()
  private pending = new Map<string, PendingCommand>()
  private activeScene: string | undefined
  private listeners = new Set<Listener>()
  private savedConnectors: SavedConnector[] = []

  constructor() {
    // One subscription point: device changes AND connector-status changes both
    // refresh the unified view. Device updates double as command confirmations.
    this.runtime.subscribe(() => {
      this.reconcilePending()
      this.emit()
    })
    this.runtime.subscribeStatus((ev) => this.updateHealth(ev.connectorId, ev.health))
  }

  view(): TwinView {
    return {
      devices: this.runtime.listDevices(),
      sessions: [...this.sessions.values()],
      bindings: Object.fromEntries(this.bindings),
      commands: Object.fromEntries([...this.pending].map(([k, p]) => [k, p.phase])),
      activeScene: this.activeScene,
      savedConnectors: this.savedConnectors.filter((c) => !this.connectors.has(c.id)),
    }
  }

  /**
   * A snapshot worth keeping: which devices exist, what they are, where they
   * live, and which sources produced them. No capability *values* are treated
   * as meaningful here — see `persistableSignature` for why that matters.
   */
  serializeState(): TwinPersistedState {
    const live = [...this.sessions.values()].map((s) => ({ id: s.id, kind: s.kind, label: s.label }))
    const liveIds = new Set(live.map((c) => c.id))
    return {
      version: TWIN_STATE_VERSION,
      savedAt: new Date().toISOString(),
      bindings: Object.fromEntries(this.bindings),
      // Sources remembered from an earlier session stay remembered until the
      // user removes them; a reload must not quietly shorten the list.
      connectors: [...live, ...this.savedConnectors.filter((c) => !liveIds.has(c.id))],
      devices: this.runtime.listDevices(),
    }
  }

  /**
   * Bring a stored twin back. Devices return as `unknown` reachability: nothing
   * has spoken to them since the last session, and a green dot on a lamp that
   * was unplugged yesterday is a lie the UI should not tell.
   *
   * A connector that is already live wins — restoring must never overwrite a
   * device that a running connector is currently reporting.
   */
  restoreState(state: TwinPersistedState): void {
    for (const device of restoredDevices(state)) {
      if (this.connectors.has(device.connectorId)) continue
      if (this.runtime.getDevice(device.id)) continue
      this.runtime.upsertDevice(device)
    }
    for (const [deviceId, roomId] of Object.entries(state.bindings)) {
      if (!this.bindings.has(deviceId)) this.bindings.set(deviceId, roomId)
    }
    this.savedConnectors = state.connectors
    this.emit()
  }

  /** Forget a source the user no longer wants offered, and its devices with it. */
  forgetSavedConnector(id: string): void {
    this.savedConnectors = this.savedConnectors.filter((c) => c.id !== id)
    for (const device of this.runtime.listDevices()) {
      if (device.connectorId === id) this.runtime.removeDevice(device.id)
    }
    this.emit()
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
    this.sessions.set(id, {
      id, label: descriptor.label, kind: descriptor.kind,
      health: { status: 'connecting' },
      discovery: { phase: 'idle', count: 0 },
    })
    this.emit()
    // Pushed status during connect (before adoption hands the channel to the runtime).
    connector.onStatus?.((h) => this.updateHealth(id, h))

    try {
      await connector.connect()
    } catch (e) {
      /*
       * The handshake itself failed, so this connector never became live. It
       * has to leave the registry again — otherwise `isActive` reports true for
       * something the runtime never adopted, a second connect attempt returns
       * silently at the guard above, and `removeConnector` skips
       * `connector.disconnect()` because the runtime does not know it either.
       * The session stays, carrying the reason.
       */
      this.connectors.delete(id)
      try { await connector.disconnect() } catch { /* best effort */ }
      this.updateHealth(id, { status: 'error', message: e instanceof Error ? e.message : 'Verbindung fehlgeschlagen' })
      return
    }

    /*
     * Discovery is adopted either way. A connector that authenticated but could
     * not enumerate devices is still a live session: it owns a valid token, it
     * can poll itself back to health, and the user must be able to retry the
     * *discovery* without re-entering credentials. Previously a throw here left
     * the connector half-registered — in the manager, absent from the runtime,
     * never subscribed, and impossible to recover except by disconnecting.
     */
    this.setDiscovery(id, { phase: 'running', count: 0 })
    let devices: Device[] = []
    try {
      devices = await connector.discover()
      this.setDiscovery(id, { phase: 'ok', count: devices.length, at: new Date().toISOString() })
    } catch (e) {
      this.setDiscovery(id, {
        phase: 'failed',
        count: 0,
        error: e instanceof Error ? e.message : 'Geräteabfrage fehlgeschlagen',
        at: new Date().toISOString(),
      })
    }
    this.runtime.adoptConnector(connector, devices)
  }

  /**
   * Re-run discovery for a live connector — the "Prüfen" action.
   *
   * This is a real device re-read, not a UI reset: it asks the connector for a
   * fresh snapshot, replaces that connector's devices in the twin (so devices
   * that disappeared actually disappear) and records the outcome.
   */
  async refreshConnector(id: string): Promise<void> {
    const connector = this.connectors.get(id)
    if (!connector) return
    const previous = this.sessions.get(id)?.discovery.count ?? 0
    this.setDiscovery(id, { phase: 'running', count: previous })
    try {
      const devices = await connector.synchronize()
      const keep = new Set(devices.map((d) => d.id))
      for (const device of this.runtime.listDevices()) {
        if (device.connectorId === id && !keep.has(device.id)) this.runtime.removeDevice(device.id)
      }
      this.runtime.adoptConnector(connector, devices)
      this.setDiscovery(id, { phase: 'ok', count: devices.length, at: new Date().toISOString() })
    } catch (e) {
      this.setDiscovery(id, {
        phase: 'failed',
        count: 0,
        error: e instanceof Error ? e.message : 'Geräteabfrage fehlgeschlagen',
        at: new Date().toISOString(),
      })
    }
  }

  /**
   * Remove one connector; the others (and their devices) stay live.
   *
   * Tolerant of a session without a live connector on purpose: a failed connect
   * leaves exactly that, and the user still has to be able to dismiss it.
   */
  async removeConnector(id: string): Promise<void> {
    if (!this.connectors.has(id) && !this.sessions.has(id)) return
    if (this.connectors.has(id)) await this.runtime.removeConnector(id)
    this.connectors.delete(id)
    this.sessions.delete(id)
    // Disconnecting is deliberate: it should not come back on the next reload.
    this.savedConnectors = this.savedConnectors.filter((c) => c.id !== id)
    this.emit()
  }

  private setDiscovery(id: string, discovery: DiscoveryState): void {
    const session = this.sessions.get(id)
    if (!session) return
    session.discovery = discovery
    this.emit()
  }

  /**
   * Route a command to the owning connector (by device.connectorId, in the
   * runtime) and track its predictive state: `pending` until the device's
   * next update of that capability confirms it, `failed` on transport
   * rejection or after the confirmation timeout — the UI masks the latency
   * instead of showing raw spinners or hard resets.
   */
  command(cmd: DeviceCommand, opts: { timeoutMs?: number; failureHoldMs?: number } = {}): Promise<void> {
    const key = commandKey(cmd.deviceId, cmd.capability)
    const device = this.runtime.getDevice(cmd.deviceId)
    const existing = this.pending.get(key)
    if (existing) clearTimeout(existing.timer)
    const holdMs = opts.failureHoldMs ?? FAILURE_HOLD_MS
    this.pending.set(key, {
      phase: 'pending',
      deviceId: cmd.deviceId,
      capability: cmd.capability,
      before: device ? findCapability(device.capabilities, cmd.capability) : undefined,
      timer: setTimeout(() => this.failCommand(key, holdMs), opts.timeoutMs ?? COMMAND_TIMEOUT_MS),
    })
    this.emit()
    // Transport rejections fail the command immediately; the returned promise
    // resolves either way (callers fire-and-forget, the view carries the state).
    return this.runtime.command(cmd).catch(() => this.failCommand(key, holdMs))
  }

  /** A device update for a tracked capability = confirmation; drop the mask. */
  private reconcilePending(): void {
    for (const [key, entry] of this.pending) {
      const device = this.runtime.getDevice(entry.deviceId)
      if (!device) {
        // Device left the twin (connector removed) — nothing to confirm against.
        clearTimeout(entry.timer)
        this.pending.delete(key)
        continue
      }
      if (entry.phase !== 'pending') continue
      if (findCapability(device.capabilities, entry.capability) !== entry.before) {
        clearTimeout(entry.timer)
        this.pending.delete(key)
      }
    }
  }

  private failCommand(key: string, holdMs: number): void {
    const entry = this.pending.get(key)
    if (!entry || entry.phase === 'failed') return
    clearTimeout(entry.timer)
    entry.phase = 'failed'
    // The failure stays visible briefly, then the control morphs back.
    entry.timer = setTimeout(() => {
      this.pending.delete(key)
      this.emit()
    }, holdMs)
    this.emit()
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
