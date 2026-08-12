import { describe, it, expect } from 'vitest'
import { findCapability } from '@/domain'
import { createOnvifConnector } from './onvifConnector'
import { SimulatedOnvifTransport } from './simulatedTransport'

const config = {
  id: 'sim-arenti',
  name: 'Arenti Außenkamera',
  host: '192.168.0.107',
  port: 8000,
  username: 'admin',
  password: 'test',
}

describe('ONVIF connector — lifecycle and PTZ', () => {
  it('connects and discovers a neutral camera', async () => {
    // `cameras` ist nicht optional-im-Sinne-von-egal: `connect()` läuft über
    // genau diese Liste und ruft `transport.connect()` pro Eintrag auf. Ohne
    // sie bleibt die simulierte Kamera auf `connected: false`, und
    // `streaming` (= connected && stream) ist dann folgerichtig false.
    // Die übrigen Tests hier übergeben sie; dieser hatte sie vergessen.
    const c = createOnvifConnector({
      id: 'onvif',
      transport: new SimulatedOnvifTransport([config]),
      cameras: [config],
    })
    await c.connect()
    expect(c.health().status).toBe('connected')
    const devices = await c.discover()
    expect(devices).toHaveLength(1)
    expect(devices[0].category).toBe('camera')
    expect(findCapability(devices[0].capabilities, 'Camera')).toMatchObject({ streaming: true })
  })

  it('routes a PTZ command through the connector', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()

    await c.publish({
      deviceId: 'sim-arenti',
      capability: 'Camera',
      payload: { action: 'ptz', x: 1, y: 0, zoom: 0, timeoutMs: 500 },
    })

    const status = await transport.status('sim-arenti')
    expect(status.position?.x).toBeGreaterThan(0)
  })

  it('supports stop, presets and home', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()

    await c.publish({ deviceId: 'sim-arenti', capability: 'Camera', payload: { action: 'gotoPreset', token: 'preset-terrace' } })
    expect((await transport.status('sim-arenti')).position?.x).toBe(0.5)

    await c.publish({ deviceId: 'sim-arenti', capability: 'Camera', payload: { action: 'home' } })
    expect((await transport.status('sim-arenti')).position?.x).toBe(0)

    await c.publish({ deviceId: 'sim-arenti', capability: 'Camera', payload: { action: 'stop' } })
  })

  it('streams updates when the bridge reports a camera state change', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config], pollMs: 10 })
    await c.connect()
    const updates: unknown[] = []
    const unsub = c.subscribe((u) => updates.push(u))
    await new Promise((r) => setTimeout(r, 30))
    unsub()
    expect(updates.length).toBeGreaterThan(0)
  })
})

describe('ONVIF connector — PTZ availability is decided by ContinuousMove', () => {
  it('keeps PTZ offered when the camera does not implement GetStatus', async () => {
    // The Arenti's actual behaviour: GetStatus faults, ContinuousMove works.
    const transport = new SimulatedOnvifTransport([config], { statusSupported: false })
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()

    const status = await transport.status('sim-arenti')
    expect(status.supported).toBe(false)

    const [device] = await c.discover()
    expect(device.metadata?.ptzSupport).toBe('available')
    expect(device.metadata?.ptz).toBe('true')

    // And steering still works.
    await expect(c.publish({
      deviceId: 'sim-arenti', capability: 'Camera',
      payload: { action: 'ptz', x: 0.2, y: 0, zoom: 0, timeoutMs: 300 },
    })).resolves.toBeUndefined()
  })

  it('treats an undiscoverable PTZ service as "unknown", not as "no"', async () => {
    const transport = new SimulatedOnvifTransport([config], { ptz: 'unknown' })
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()
    const [device] = await c.discover()
    expect(device.metadata?.ptzSupport).toBe('unknown')
    // Unknown still offers the controls — only a proven refusal hides them.
    expect(device.metadata?.ptz).toBe('true')
  })

  it('marks PTZ unavailable once ContinuousMove itself refuses', async () => {
    const transport = new SimulatedOnvifTransport([config], { ptz: 'unavailable' })
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()

    const updates: Array<{ metadata?: Record<string, string> }> = []
    c.subscribe((u) => updates.push(u))

    await expect(c.publish({
      deviceId: 'sim-arenti', capability: 'Camera',
      payload: { action: 'ptz', x: 0.2 },
    })).rejects.toThrow(/not implemented/i)

    // The refusal is reported back as metadata, so the pad disappears at once.
    const last = updates.at(-1)
    expect(last?.metadata?.ptzSupport).toBe('unavailable')
    expect(last?.metadata?.ptz).toBe('false')
  })
})

describe('ONVIF connector — stream URI and live view', () => {
  it('carries the ONVIF-reported RTSP URI into device metadata, unaltered', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()
    const [device] = await c.discover()
    const reported = (await transport.get('sim-arenti')).streamUri
    expect(device.metadata?.stream).toBe(reported)
    // Whatever it is, it came from getStreamUri — not from host + a known path.
    expect(reported).toBe('rtsp://192.168.0.107:8554/Streaming/Channels/101')
  })

  it('never leaks the camera password into the device', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()
    const [device] = await c.discover()
    expect(JSON.stringify(device)).not.toContain(config.password)
  })

  it('reports resolution and frame rate for the card header', async () => {
    const transport = new SimulatedOnvifTransport([config])
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()
    const [device] = await c.discover()
    expect(device.metadata?.resolution).toBe('2560 × 1440 · 15 FPS')
  })

  it('falls back to the snapshot when the bridge cannot start a stream', async () => {
    const transport = new SimulatedOnvifTransport([config], { streamMode: 'snapshot' })
    const c = createOnvifConnector({ id: 'onvif', transport, cameras: [config] })
    await c.connect()
    const info = await transport.stream('sim-arenti')
    expect(info.mode).toBe('snapshot')
    expect(info.reason).toMatch(/nicht verfügbar/i)
    const blob = await transport.snapshot('sim-arenti')
    expect(blob.size).toBeGreaterThan(0)
  })
})
