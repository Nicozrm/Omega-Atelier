/**
 * simulatedTransport.ts — deterministic ONVIF/PTZ simulator.
 *
 * It exercises the exact same connector contract without a camera or LAN.
 */

import type {
  OnvifCameraConfig, OnvifCameraInfo, OnvifPtzCommand, OnvifPtzStatus,
  OnvifPreset, OnvifTransport,
} from './transport'

export class SimulatedOnvifTransport implements OnvifTransport {
  private cameras = new Map<string, OnvifCameraInfo>()
  private positions = new Map<string, { x: number; y: number; zoom: number }>()
  private presetMap = new Map<string, OnvifPreset[]>()

  constructor(cameras: OnvifCameraConfig[] = [{
    id: 'sim-arenti',
    name: 'Arenti Außenkamera',
    host: '192.168.0.107',
    port: 8000,
    username: 'admin',
    password: 'test',
  }]) {
    for (const c of cameras) {
      this.cameras.set(c.id, {
        id: c.id,
        name: c.name ?? c.id,
        host: c.host,
        connected: false,
        manufacturer: 'Arenti',
        model: 'Simulated PTZ',
        firmware: 'simulated',
        ptz: true,
        snapshot: true,
        stream: true,
        profiles: [{ token: 'PROFILE_000', name: 'Main', width: 2560, height: 1440, fps: 15 }],
        streamUri: `rtsp://${c.host}:8554/stream`,
      })
      this.positions.set(c.id, { x: 0, y: 0, zoom: 0 })
      this.presetMap.set(c.id, [
        { token: 'preset-entrance', name: 'Eingang' },
        { token: 'preset-terrace', name: 'Terrasse' },
      ])
    }
  }

  async connect(config: OnvifCameraConfig): Promise<OnvifCameraInfo> {
    const camera = this.cameras.get(config.id)
    if (!camera) throw new Error(`Simulierte Kamera nicht gefunden: ${config.id}`)
    camera.connected = true
    return { ...camera, profiles: [...camera.profiles] }
  }

  async disconnect(id: string): Promise<void> {
    const camera = this.cameras.get(id)
    if (camera) camera.connected = false
  }

  async list(): Promise<OnvifCameraInfo[]> {
    return [...this.cameras.values()].map((c) => ({ ...c, profiles: [...c.profiles] }))
  }

  async get(id: string): Promise<OnvifCameraInfo> {
    const camera = this.cameras.get(id)
    if (!camera) throw new Error(`Kamera nicht gefunden: ${id}`)
    return { ...camera, profiles: [...camera.profiles] }
  }

  async move(id: string, command: OnvifPtzCommand): Promise<void> {
    const camera = this.cameras.get(id)
    if (!camera?.connected) throw new Error('Kamera nicht verbunden')
    const p = this.positions.get(id)!
    p.x = Math.max(-1, Math.min(1, p.x + (command.x ?? 0) * 0.1))
    p.y = Math.max(-1, Math.min(1, p.y + (command.y ?? 0) * 0.1))
    p.zoom = Math.max(0, Math.min(1, p.zoom + (command.zoom ?? 0) * 0.1))
  }

  async stop(id: string): Promise<void> {
    if (!this.cameras.get(id)?.connected) throw new Error('Kamera nicht verbunden')
  }

  async status(id: string): Promise<OnvifPtzStatus> {
    const p = this.positions.get(id)
    if (!p) throw new Error(`Kamera nicht gefunden: ${id}`)
    return { position: { ...p }, moveStatus: { panTilt: 'IDLE', zoom: 'IDLE' }, utcTime: new Date().toISOString() }
  }

  async presets(id: string): Promise<OnvifPreset[]> {
    return [...(this.presetMap.get(id) ?? [])]
  }

  async gotoPreset(id: string, token: string): Promise<void> {
    if (!this.presetMap.get(id)?.some((p) => p.token === token)) throw new Error('Preset nicht gefunden')
    const p = this.positions.get(id)!
    if (token === 'preset-entrance') Object.assign(p, { x: 0, y: 0, zoom: 0 })
    if (token === 'preset-terrace') Object.assign(p, { x: 0.5, y: 0.1, zoom: 0.2 })
  }

  async home(id: string): Promise<void> {
    const p = this.positions.get(id)
    if (!p) throw new Error(`Kamera nicht gefunden: ${id}`)
    Object.assign(p, { x: 0, y: 0, zoom: 0 })
  }
}
