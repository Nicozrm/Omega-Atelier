/**
 * transport.ts — ONVIF connector wire boundary.
 *
 * The browser never talks SOAP/ONVIF directly. Production uses a small local
 * ONVIF bridge running on a machine that can reach the camera's LAN address.
 * Tests use the in-memory simulator.
 */

export interface OnvifCameraConfig {
  id: string
  name?: string
  host: string
  port?: number
  username: string
  password: string
}

export interface OnvifCameraInfo {
  id: string
  name: string
  host: string
  connected: boolean
  manufacturer?: string
  model?: string
  firmware?: string
  serialNumber?: string
  ptz: boolean
  snapshot: boolean
  stream: boolean
  profiles: Array<{ token: string; name?: string; width?: number; height?: number; fps?: number }>
  streamUri?: string
}

export interface OnvifPtzCommand {
  x?: number
  y?: number
  zoom?: number
  timeoutMs?: number
}

export interface OnvifPtzStatus {
  position?: { x?: number; y?: number; zoom?: number }
  moveStatus?: unknown
  utcTime?: string
}

export interface OnvifPreset {
  token: string
  name?: string
}

export interface OnvifTransport {
  connect(config: OnvifCameraConfig): Promise<OnvifCameraInfo>
  disconnect(id: string): Promise<void>
  list(): Promise<OnvifCameraInfo[]>
  get(id: string): Promise<OnvifCameraInfo>
  move(id: string, command: OnvifPtzCommand): Promise<void>
  stop(id: string): Promise<void>
  status(id: string): Promise<OnvifPtzStatus>
  presets(id: string): Promise<OnvifPreset[]>
  gotoPreset(id: string, token: string): Promise<void>
  home(id: string): Promise<void>
}

/**
 * HTTP transport to the local Omega ONVIF bridge.
 *
 * Example bridge URL:
 *   http://127.0.0.1:8787
 *
 * The bridge is deliberately separate because browser JavaScript cannot
 * reliably perform WS-Discovery/SOAP against arbitrary LAN cameras.
 */
export class HttpOnvifTransport implements OnvifTransport {
  private readonly base: string
  private readonly token?: string

  constructor(baseUrl = 'http://127.0.0.1:8787', token?: string) {
    this.base = baseUrl.replace(/\/+$/, '')
    this.token = token
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Content-Type', 'application/json')
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)

    const response = await fetch(`${this.base}${path}`, { ...init, headers })
    const text = await response.text()
    let body: unknown
    try { body = text ? JSON.parse(text) : undefined } catch { body = text }

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String((body as { error: unknown }).error)
          : `ONVIF bridge HTTP ${response.status}`
      throw new Error(message)
    }

    return body as T
  }

  async connect(config: OnvifCameraConfig): Promise<OnvifCameraInfo> {
    return this.request<OnvifCameraInfo>('/cameras/connect', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  }

  async disconnect(id: string): Promise<void> {
    await this.request(`/cameras/${encodeURIComponent(id)}/disconnect`, { method: 'POST' })
  }

  async list(): Promise<OnvifCameraInfo[]> {
    const result = await this.request<{ cameras: OnvifCameraInfo[] }>('/cameras')
    return result.cameras
  }

  async get(id: string): Promise<OnvifCameraInfo> {
    return this.request<OnvifCameraInfo>(`/cameras/${encodeURIComponent(id)}`)
  }

  async move(id: string, command: OnvifPtzCommand): Promise<void> {
    await this.request(`/cameras/${encodeURIComponent(id)}/ptz/move`, {
      method: 'POST',
      body: JSON.stringify(command),
    })
  }

  async stop(id: string): Promise<void> {
    await this.request(`/cameras/${encodeURIComponent(id)}/ptz/stop`, { method: 'POST' })
  }

  async status(id: string): Promise<OnvifPtzStatus> {
    return this.request<OnvifPtzStatus>(`/cameras/${encodeURIComponent(id)}/ptz/status`)
  }

  async presets(id: string): Promise<OnvifPreset[]> {
    const result = await this.request<{ presets: OnvifPreset[] }>(
      `/cameras/${encodeURIComponent(id)}/ptz/presets`,
    )
    return result.presets
  }

  async gotoPreset(id: string, token: string): Promise<void> {
    await this.request(`/cameras/${encodeURIComponent(id)}/ptz/preset`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  async home(id: string): Promise<void> {
    await this.request(`/cameras/${encodeURIComponent(id)}/ptz/home`, { method: 'POST' })
  }
}
