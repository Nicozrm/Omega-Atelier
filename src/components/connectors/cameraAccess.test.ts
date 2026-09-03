import { describe, it, expect } from 'vitest'
import { cameraDevices, hasLiveView } from './CameraPanel'
import { createOnvifConnector, SimulatedOnvifTransport } from '@/connectors/onvif'
import { createEcosystemConnector, ECOSYSTEM_SPECS } from '@/connectors/ecosystem'
import { TwinManager } from '@/twin/twinManager'
import { deriveIntegrationState } from '@/twin/integrationState'
import type { Capability, Device } from '@/domain'

/**
 * Arenti: the login worked and there was no camera function.
 *
 * The connector discovered the camera all along — what was missing was any path
 * from "connected" to a picture. These tests pin the two halves of the repair:
 * discovery has to produce a real camera device, and the shortcut into the
 * camera view has to be derived from that device and from nothing else.
 */

const device = (id: string, caps: Capability[], metadata?: Record<string, string>): Device => ({
  id, connectorId: 'c', category: 'other', name: id, capabilities: caps,
  health: { reachability: 'online' }, ...(metadata ? { metadata } : {}),
})

const arentiConnector = (options?: ConstructorParameters<typeof SimulatedOnvifTransport>[1]) =>
  createOnvifConnector({
    id: 'onvif-live',
    label: 'Arenti Außenkamera',
    transport: new SimulatedOnvifTransport(undefined, options),
    cameras: [{
      id: 'sim-arenti', name: 'Arenti Außenkamera',
      host: '192.168.0.107', port: 8000, username: 'admin', password: 'secret',
    }],
    pollMs: 0,
  })

const descriptor = (make: () => ReturnType<typeof arentiConnector>) => ({
  label: 'Arenti Außenkamera', kind: 'onvif', make,
})

describe('Arenti login → camera discovery', () => {
  it('authenticates and discovers a real camera device', async () => {
    const manager = new TwinManager()
    await manager.addConnector(descriptor(() => arentiConnector()))

    const session = manager.view().sessions.find((s) => s.id === 'onvif-live')!
    expect(session.health.status).toBe('connected')
    expect(session.discovery).toMatchObject({ phase: 'ok', count: 1 })

    const discovered = manager.view().devices.filter((d) => d.connectorId === 'onvif-live')
    expect(discovered).toHaveLength(1)
    expect(discovered[0].category).toBe('camera')
    expect(discovered[0].metadata?.manufacturer).toBe('Arenti')
    // The resolution the camera really advertises, not a placeholder.
    expect(discovered[0].metadata?.resolution).toBe('2560 × 1440 · 15 FPS')
  })

  it('reaches `ready` with camera capability — the state the card renders', async () => {
    const manager = new TwinManager()
    await manager.addConnector(descriptor(() => arentiConnector()))
    const session = manager.view().sessions.find((s) => s.id === 'onvif-live')!
    const devices = manager.view().devices.filter((d) => d.connectorId === 'onvif-live')

    const state = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices })
    expect(state.phase).toBe('ready')
    expect(state.cameraCount).toBe(1)
    expect(state.capabilities.supportsCamera).toBe(true)
    expect(state.capabilities.supportsShortcuts).toBe(true)
  })

  it('a bridge that cannot reach the camera is an error, not a connection', async () => {
    const manager = new TwinManager()
    await manager.addConnector(descriptor(() => createOnvifConnector({
      id: 'onvif-live',
      transport: new SimulatedOnvifTransport(),
      // A camera id the simulated bridge does not know — the shape a wrong IP
      // or a wrong ONVIF port produces against a real bridge.
      cameras: [{ id: 'not-there', host: '10.0.0.9', username: 'admin', password: 'x' }],
      pollMs: 0,
    })))

    const session = manager.view().sessions.find((s) => s.id === 'onvif-live')!
    expect(session.health.status).toBe('error')
    const state = deriveIntegrationState({ health: session.health, discovery: session.discovery, devices: [] })
    expect(state.phase).toBe('error')
    // No camera anywhere, so no shortcut may be offered.
    expect(state.capabilities.supportsCamera).toBe(false)
  })

  it('re-checking after a connect discovers again without new credentials', async () => {
    const manager = new TwinManager()
    await manager.addConnector(descriptor(() => arentiConnector()))
    await manager.refreshConnector('onvif-live')

    const session = manager.view().sessions.find((s) => s.id === 'onvif-live')!
    expect(session.discovery).toMatchObject({ phase: 'ok', count: 1 })
    expect(manager.view().devices.filter((d) => d.connectorId === 'onvif-live')).toHaveLength(1)
  })
})

describe('the camera shortcut is gated on a real Camera capability', () => {
  it('lists only devices that actually expose a camera', () => {
    const devices = [
      device('lamp', [{ kind: 'OnOff', access: 'readWrite', on: true }]),
      device('cam', [{ kind: 'Camera', access: 'read', streaming: true }]),
      device('sensor', [{ kind: 'Motion', access: 'read', detected: false }]),
    ]
    expect(cameraDevices(devices).map((d) => d.id)).toEqual(['cam'])
  })

  it('offers no shortcut for a fleet without cameras', () => {
    const devices = [device('lamp', [{ kind: 'OnOff', access: 'readWrite', on: true }])]
    expect(cameraDevices(devices)).toHaveLength(0)
  })

  it('a camera name alone never counts — only the capability does', () => {
    // Named like a camera, categorised as one, but exposing nothing to show.
    const fake: Device = { ...device('Kamera Eingang', []), category: 'camera' }
    expect(cameraDevices([fake])).toHaveLength(0)
  })

  it('separates cameras that can show a picture from cameras that cannot', async () => {
    const manager = new TwinManager()
    await manager.addConnector(descriptor(() => arentiConnector()))
    const onvif = manager.view().devices.find((d) => d.connectorId === 'onvif-live')!
    // The ONVIF path carries a bridge and therefore a picture…
    expect(hasLiveView(onvif)).toBe(true)

    // …a camera from a source with no stream path does not, and must be
    // labelled rather than handed an empty viewer.
    const spec = ECOSYSTEM_SPECS.find((s) => s.id === 'eco-arenti')!
    const simulated = createEcosystemConnector(spec, { liveMs: 0 })
    await simulated.connect()
    const simulatedCameras = cameraDevices(await simulated.discover())
    expect(simulatedCameras.length).toBeGreaterThan(0)
    expect(simulatedCameras.every((c) => hasLiveView(c))).toBe(false)
    await simulated.disconnect()
  })
})
