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
