import { describe, it, expect } from 'vitest'
import { deriveIntegrationState, deriveCapabilities, type DiscoveryState } from './integrationState'
import type { Capability, ConnectorHealth, Device } from '@/domain'

/**
 * The rule under test: a transport handshake is not a working integration.
 *
 * Every reported failure in this area — Arenti's missing camera, SwitchBot's
 * and Tuya's empty device lists — reached the user as "✓ Verbunden", because
 * that was the only thing the UI asked about. These tests pin the six states
 * apart and pin the capability flags to the devices that actually exist.
 */

const device = (id: string, caps: Capability[], extra: Partial<Device> = {}): Device => ({
  id,
  connectorId: 'x',
  category: 'other',
  name: id,
  capabilities: caps,
  health: { reachability: 'online' },
  ...extra,
})

const camera = (id = 'cam'): Device =>
  device(id, [{ kind: 'Camera', access: 'read', streaming: true }], { category: 'camera' })
const lamp = (id = 'lamp'): Device =>
  device(id, [{ kind: 'OnOff', access: 'readWrite', on: false }], { category: 'light' })
const sensor = (id = 'sensor'): Device =>
  device(id, [{ kind: 'Temperature', access: 'read', celsius: 21 }], { category: 'sensor' })
/** A device that was discovered but whose data points we could not translate. */
const opaque = (id = 'opaque'): Device => device(id, [])

const connected: ConnectorHealth = { status: 'connected' }
const ok = (count: number): DiscoveryState => ({ phase: 'ok', count, at: '2026-01-01T00:00:00Z' })

describe('deriveIntegrationState — the six phases', () => {
  it('is disconnected when the integration was never started', () => {
    expect(deriveIntegrationState({ devices: [] }).phase).toBe('disconnected')
  })

  it('is connecting during the handshake', () => {
    const s = deriveIntegrationState({ health: { status: 'connecting' }, devices: [] })
    expect(s.phase).toBe('connecting')
    expect(s.canRecheck).toBe(false)
  })

  it('is authenticated — not ready — once connected but before discovery ran', () => {
    const s = deriveIntegrationState({ health: connected, discovery: { phase: 'idle', count: 0 }, devices: [] })
    expect(s.phase).toBe('authenticated')
  })

  it('is discovering while the device query is in flight', () => {
    const s = deriveIntegrationState({ health: connected, discovery: { phase: 'running', count: 0 }, devices: [] })
    expect(s.phase).toBe('discovering')
    expect(s.canRecheck).toBe(false)
  })

  it('is ready only when discovery succeeded AND devices exist', () => {
    const s = deriveIntegrationState({ health: connected, discovery: ok(2), devices: [lamp(), sensor()] })
    expect(s.phase).toBe('ready')
    expect(s.deviceCount).toBe(2)
  })

  it('is no-devices — never ready — when the account is empty', () => {
    const s = deriveIntegrationState({ health: connected, discovery: ok(0), devices: [] })
    expect(s.phase).toBe('no-devices')
    expect(s.canRecheck).toBe(true)
  })

  it('is error when discovery failed, even though the transport says connected', () => {
    const s = deriveIntegrationState({
      health: connected,
      discovery: { phase: 'failed', count: 0, error: 'Tuya verweigert den Zugriff' },
      devices: [],
    })
    expect(s.phase).toBe('error')
    expect(s.message).toBe('Tuya verweigert den Zugriff')
    // Credentials are proven good, so re-running discovery is the right retry.
    expect(s.canRecheck).toBe(true)
  })

  it('is error — and offers no re-check — when the transport itself failed', () => {
    const s = deriveIntegrationState({
      health: { status: 'error', message: 'Token abgelehnt' },
      devices: [],
    })
    expect(s.phase).toBe('error')
    expect(s.canRecheck).toBe(false)
  })

  it('never reports ready on connected alone', () => {
    // The exact shape of the original bug: health says connected, nothing else.
    const s = deriveIntegrationState({ health: connected, devices: [] })
    expect(s.phase).not.toBe('ready')
  })
})

describe('capabilities are derived from real devices, never from the brand', () => {
  it('reports no camera support when no device exposes a Camera capability', () => {
    const caps = deriveCapabilities([lamp(), sensor()])
    expect(caps.supportsCamera).toBe(false)
  })

  it('reports camera support as soon as one real camera is present', () => {
    const caps = deriveCapabilities([lamp(), camera()])
    expect(caps.supportsCamera).toBe(true)
    expect(caps.supportsShortcuts).toBe(true)
  })

  it('reports no control for a read-only fleet', () => {
    const caps = deriveCapabilities([sensor(), camera()])
    expect(caps.supportsControl).toBe(false)
    expect(caps.supportsScenes).toBe(false)
    // A camera still earns a shortcut — there is somewhere to go.
    expect(caps.supportsShortcuts).toBe(true)
  })

  it('offers no shortcut at all for an empty integration', () => {
    const caps = deriveCapabilities([])
    expect(caps.supportsShortcuts).toBe(false)
    expect(caps.supportsCamera).toBe(false)
  })

  it('counts cameras, so the shortcut can be gated on the count', () => {
    const s = deriveIntegrationState({
      health: connected, discovery: ok(3), devices: [camera('a'), camera('b'), lamp()],
    })
    expect(s.cameraCount).toBe(2)
    expect(s.capabilities.supportsCamera).toBe(true)
  })
})

describe('devices that arrived but could not be translated', () => {
  it('counts them instead of hiding them, and still reports ready', () => {
    const s = deriveIntegrationState({
      health: connected, discovery: ok(3), devices: [lamp(), opaque('a'), opaque('b')],
    })
    // The whole point: they are in the twin, and the card can say how many.
    expect(s.deviceCount).toBe(3)
    expect(s.unsupportedCount).toBe(2)
    expect(s.phase).toBe('ready')
  })

  it('an integration of only untranslatable devices is ready, not empty', () => {
    // It really did discover something — reporting "no devices" would be false.
    const s = deriveIntegrationState({ health: connected, discovery: ok(2), devices: [opaque('a'), opaque('b')] })
    expect(s.phase).toBe('ready')
    expect(s.capabilities.supportsControl).toBe(false)
  })
})
