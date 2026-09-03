/**
 * integrationState.ts — what an integration is *actually* doing, as one value.
 *
 * ## The rule this module exists to enforce
 *
 * `connected === true` says one thing only: a transport handshake succeeded.
 * It says nothing about whether the account listed devices, whether those
 * devices could be translated, or whether the feature the user came for — a
 * camera picture, a switchable lamp — exists at all. Every reported bug in this
 * area came from the UI treating that single boolean as "it works":
 *
 *   Arenti     "✓ Verbunden" and no camera anywhere
 *   SwitchBot  "✓ Verbunden" and an empty device list
 *   Tuya       "✓ Verbunden" and an empty device list
 *
 * So the phases are separated, and the capability flags are derived from the
 * devices that were *really* discovered — never from the brand. A camera
 * shortcut may only appear when a device with a `Camera` capability exists.
 *
 * Pure and dependency-free below the domain: this is the piece the tests pin
 * down, and the UI is a rendering of it.
 */

import { hasCapability, type ConnectorHealth, type Device } from '@/domain'

/**
 * Where an integration stands. Ordered from "nothing yet" to "usable"; `error`
 * and `no-devices` are terminal-until-retried, not steps on the way.
 */
export type IntegrationPhase =
  | 'disconnected'
  /** Handshake in flight. */
  | 'connecting'
  /** Credentials accepted; device discovery has not finished. */
  | 'authenticated'
  /** Discovery is running right now. */
  | 'discovering'
  /** Authenticated, discovery succeeded, at least one device is in the twin. */
  | 'ready'
  /** Authenticated, discovery succeeded, and the account is genuinely empty. */
  | 'no-devices'
  /** The connection or the discovery failed. `message` says which. */
  | 'error'

/** What this integration can actually do, derived from its real devices. */
export interface IntegrationCapabilities {
  /** At least one discovered device exposes a Camera capability. */
  supportsCamera: boolean
  /** At least one discovered device exposes a writable capability. */
  supportsControl: boolean
  /** Scenes need something a scene can act on. */
  supportsScenes: boolean
  /** A shortcut is only meaningful when there is something to jump to. */
  supportsShortcuts: boolean
}

export interface IntegrationState {
  phase: IntegrationPhase
  /** Devices this integration currently has in the twin. */
  deviceCount: number
  /** Of those, how many expose a Camera capability. */
  cameraCount: number
  /** Devices discovered but not translatable into any capability. */
  unsupportedCount: number
  /** The single line the card shows. Never invented — comes from the connector. */
  message?: string
  /** True when re-running discovery is a sensible action to offer ("Prüfen"). */
  canRecheck: boolean
  capabilities: IntegrationCapabilities
}

/** Outcome of the last discovery run, as tracked by the twin manager. */
export type DiscoveryPhase = 'idle' | 'running' | 'ok' | 'failed'

export interface DiscoveryState {
  phase: DiscoveryPhase
  /** Devices returned by the last successful run. */
  count: number
  error?: string
  /** ISO timestamp of the last completed run. */
  at?: string
}

export interface IntegrationStateInput {
  /** Undefined when the integration was never started in this session. */
  health?: ConnectorHealth
  discovery?: DiscoveryState
  /** The devices the twin currently holds for this connector. */
  devices: Device[]
}

const writable = (device: Device): boolean =>
  device.capabilities.some((c) => c.access === 'readWrite')

export function deriveCapabilities(devices: Device[]): IntegrationCapabilities {
  const supportsCamera = devices.some((d) => hasCapability(d.capabilities, 'Camera'))
  const supportsControl = devices.some(writable)
  return {
    supportsCamera,
    supportsControl,
    // A scene is a batch of commands; without a writable device it would be a
    // button that provably does nothing.
    supportsScenes: supportsControl,
    supportsShortcuts: supportsCamera || supportsControl,
  }
}

/**
 * Fold health + discovery + the real device set into one state.
 *
 * Precedence is deliberate. A transport error outranks everything (nothing
 * below it is trustworthy). A failed discovery outranks a successful
 * connection, because that is exactly the case the old UI reported as success.
 */
export function deriveIntegrationState(input: IntegrationStateInput): IntegrationState {
  const devices = input.devices
  const capabilities = deriveCapabilities(devices)
  const cameraCount = devices.filter((d) => hasCapability(d.capabilities, 'Camera')).length
  const unsupportedCount = devices.filter((d) => d.capabilities.length === 0).length
  const base = {
    deviceCount: devices.length,
    cameraCount,
    unsupportedCount,
    capabilities,
  }

  const status = input.health?.status
  const discovery = input.discovery

  if (!status || status === 'disconnected') {
    return { ...base, phase: 'disconnected', canRecheck: false }
  }

  if (status === 'error') {
    return {
      ...base,
      phase: 'error',
      message: input.health?.message ?? 'Verbindung fehlgeschlagen',
      // Retrying a broken transport is the user's job (credentials), not a
      // re-discovery — the card offers "Verbinden", not "Prüfen".
      canRecheck: false,
    }
  }

  if (status === 'connecting') {
    return { ...base, phase: 'connecting', canRecheck: false }
  }

  // status === 'connected' from here on: the transport is up. Everything that
  // follows is about whether the account produced anything usable.

  if (discovery?.phase === 'failed') {
    return {
      ...base,
      phase: 'error',
      message: discovery.error
        ?? 'Angemeldet, aber die Geräteabfrage ist fehlgeschlagen',
      // The credentials are proven good; re-running discovery is the right retry.
      canRecheck: true,
    }
  }

  if (discovery?.phase === 'running') {
    return { ...base, phase: 'discovering', canRecheck: false }
  }

  if (!discovery || discovery.phase === 'idle') {
    // Connected, nothing has asked for devices yet.
    return { ...base, phase: 'authenticated', message: input.health?.message, canRecheck: true }
  }

  if (devices.length === 0) {
    return {
      ...base,
      phase: 'no-devices',
      message: input.health?.message
        ?? 'Verbunden, aber es wurden keine Geräte gefunden',
      canRecheck: true,
    }
  }

  return { ...base, phase: 'ready', message: input.health?.message, canRecheck: true }
}

/** Short German label per phase — one place, so the wording cannot drift. */
export const PHASE_LABEL: Record<IntegrationPhase, string> = {
  disconnected: 'getrennt',
  connecting: 'verbinde …',
  authenticated: 'angemeldet',
  discovering: 'suche Geräte …',
  ready: 'einsatzbereit',
  'no-devices': 'keine Geräte',
  error: 'Fehler',
}

/** Traffic-light tone per phase, for badges and dots. */
export const PHASE_TONE: Record<IntegrationPhase, 'neutral' | 'progress' | 'warn' | 'ok' | 'error'> = {
  disconnected: 'neutral',
  connecting: 'progress',
  authenticated: 'progress',
  discovering: 'progress',
  ready: 'ok',
  'no-devices': 'warn',
  error: 'error',
}
