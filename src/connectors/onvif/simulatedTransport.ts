/**
 * simulatedTransport.ts — deterministic ONVIF/PTZ simulator.
 *
 * It exercises the exact same connector contract without a camera or LAN,
 * including the awkward cases a real camera produces: PTZ that only reveals
 * itself through `ContinuousMove`, and a `GetStatus` that is not implemented.
 */

import type {
  OnvifCameraConfig, OnvifCameraInfo, OnvifPtzCommand, OnvifPtzStatus, OnvifPtzSupport,
  OnvifPreset, OnvifStreamInfo, OnvifStreamTicket, OnvifTransport,
} from './transport'

export interface SimulatedOnvifOptions {
  /** How the simulated camera answers `ContinuousMove`. Default: it works. */
  ptz?: OnvifPtzSupport
  /** Simulate a camera whose `GetStatus` faults with "Action Not Implemented". */
  statusSupported?: boolean
  /** Which live-view mode the simulated bridge offers. */
  streamMode?: OnvifStreamInfo['mode']
}

const NOT_IMPLEMENTED = 'ONVIF SOAP Fault: Action Not Implemented'

export class SimulatedOnvifTransport implements OnvifTransport {
  private cameras = new Map<string, OnvifCameraInfo>()
  private positions = new Map<string, { x: number; y: number; zoom: number }>()
  private presetMap = new Map<string, OnvifPreset[]>()
  private readonly opts: Required<SimulatedOnvifOptions>

  constructor(
    cameras: OnvifCameraConfig[] = [{
      id: 'sim-arenti',
      name: 'Arenti Außenkamera',
      host: '192.168.0.107',
      port: 8000,
      username: 'admin',
      password: 'test',
    }],
    options: SimulatedOnvifOptions = {},
  ) {
    this.opts = {
      ptz: options.ptz ?? 'available',
      statusSupported: options.statusSupported ?? true,
      streamMode: options.streamMode ?? 'mjpeg',
    }

    for (const c of cameras) {
      this.cameras.set(c.id, {
        id: c.id,
        name: c.name ?? c.id,
        host: c.host,
        connected: false,
        manufacturer: 'Arenti',
        model: 'Simulated PTZ',
        firmware: 'simulated',
        ptz: this.opts.ptz !== 'unavailable',
        ptzSupport: this.opts.ptz,
        snapshot: true,
        stream: true,
        profiles: [
          { token: 'PROFILE_000', name: 'Main', width: 2560, height: 1440, fps: 15 },
          { token: 'PROFILE_001', name: 'Sub', width: 640, height: 360, fps: 15 },
        ],
        // As ONVIF would report it — never assembled from the host.
        streamUri: `rtsp://${c.host}:8554/Streaming/Channels/101`,
      })
      this.positions.set(c.id, { x: 0, y: 0, zoom: 0 })
      this.presetMap.set(c.id, [
        { token: 'preset-entrance', name: 'Eingang' },
        { token: 'preset-terrace', name: 'Terrasse' },
      ])
    }
  }

  private view(camera: OnvifCameraInfo): OnvifCameraInfo {
    return { ...camera, profiles: [...camera.profiles] }
  }

  async connect(config: OnvifCameraConfig): Promise<OnvifCameraInfo> {
    const camera = this.cameras.get(config.id)
    if (!camera) throw new Error(`Simulierte Kamera nicht gefunden: ${config.id}`)
    camera.connected = true
    return this.view(camera)
  }

  async disconnect(id: string): Promise<void> {
    const camera = this.cameras.get(id)
    if (camera) camera.connected = false
  }

  async list(): Promise<OnvifCameraInfo[]> {
    return [...this.cameras.values()].map((c) => this.view(c))
  }

  async get(id: string): Promise<OnvifCameraInfo> {
    const camera = this.cameras.get(id)
    if (!camera) throw new Error(`Kamera nicht gefunden: ${id}`)
    return this.view(camera)
  }

  async move(id: string, command: OnvifPtzCommand): Promise<void> {
    const camera = this.cameras.get(id)
    if (!camera?.connected) throw new Error('Kamera nicht verbunden')
    if (this.opts.ptz === 'unavailable') {
      // Same shape as a real refusal: the camera answers, and the answer is no.
      camera.ptz = false
      camera.ptzSupport = 'unavailable'
      throw new Error(NOT_IMPLEMENTED)
    }
    camera.ptzSupport = 'available'
    camera.ptz = true
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
    if (!this.opts.statusSupported) return { supported: false, reason: NOT_IMPLEMENTED }
    return {
      supported: true,
      position: { ...p },
      moveStatus: { panTilt: 'IDLE', zoom: 'IDLE' },
      utcTime: new Date().toISOString(),
    }
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

  async stream(id: string): Promise<OnvifStreamInfo> {
    const camera = await this.get(id)
    const mode = this.opts.streamMode
    return {
      mode,
      cameraId: id,
      snapshot: camera.snapshot,
      rtspUri: camera.streamUri,
      whepUrl: mode === 'webrtc' ? 'http://127.0.0.1:1984/api/webrtc?src=sim' : undefined,
      mjpegPath: mode === 'mjpeg' ? `/cameras/${id}/stream.mjpeg` : undefined,
      snapshotPath: camera.snapshot ? `/cameras/${id}/snapshot` : undefined,
      reason: mode === 'snapshot'
        ? 'ffmpeg nicht gefunden — Live-Stream nicht verfügbar, Snapshot wird verwendet'
        : mode === 'none' ? 'Kamera liefert weder Stream noch Snapshot' : undefined,
    }
  }

  async streamTicket(id: string): Promise<OnvifStreamTicket> {
    await this.get(id)
    return { ticket: `sim-ticket-${id}`, expiresInMs: 120_000 }
  }

  async snapshot(id: string): Promise<Blob> {
    await this.get(id)
    // A two-byte JPEG SOI marker is enough to prove the path carries bytes.
    return new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
  }

  mjpegUrl(id: string, ticket: string): string {
    return `http://127.0.0.1:8787/cameras/${id}/stream.mjpeg?ticket=${ticket}`
  }
}
