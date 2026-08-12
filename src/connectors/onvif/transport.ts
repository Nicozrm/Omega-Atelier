/**
 * transport.ts — ONVIF connector wire boundary.
 *
 * The browser never talks SOAP/ONVIF directly, and it never touches RTSP.
 * Production uses a small local ONVIF bridge running on a machine that can
 * reach the camera's LAN address; the bridge is also the thing that turns RTSP
 * into something a browser can display. Tests use the in-memory simulator.
 */

import { onvifBridgeBaseUrl } from './url'

export interface OnvifCameraConfig {
  id: string
  name?: string
  host: string
  port?: number
  username: string
  password: string
}

/**
 * What the bridge knows about PTZ.
 *
 * Deliberately three-valued. A camera that reports no PTZ service and faults on
 * `GetStatus` may still serve `ContinuousMove` — the Arenti does — so "we have
 * not proven it works" and "we have proven it does not" are different answers,
 * and only the second one may hide the controls.
 */
export type OnvifPtzSupport = 'available' | 'unavailable' | 'unknown'

export interface OnvifCameraInfo {
  id: string
  name: string
  host: string
  connected: boolean
  manufacturer?: string
  model?: string
  firmware?: string
  serialNumber?: string
  /** `false` only when PTZ is known to be absent. See `ptzSupport`. */
  ptz: boolean
  ptzSupport?: OnvifPtzSupport
  ptzMessage?: string
  snapshot: boolean
  stream: boolean
  profiles: Array<{ token: string; name?: string; width?: number; height?: number; fps?: number }>
  /** RTSP address as reported by ONVIF, credentials stripped. Never playable in a browser. */
  streamUri?: string
}

export interface OnvifPtzCommand {
  x?: number
  y?: number
  zoom?: number
  timeoutMs?: number
}

export interface OnvifPtzStatus {
  /** `false` when the camera does not implement `GetStatus` — not an error. */
  supported: boolean
  position?: { x?: number; y?: number; zoom?: number }
  moveStatus?: unknown
  utcTime?: string
  reason?: string
}

export interface OnvifPreset {
  token: string
  name?: string
}

/** How the bridge proposes to deliver a live picture for this camera. */
export interface OnvifStreamInfo {
  mode: 'webrtc' | 'mjpeg' | 'snapshot' | 'none'
  cameraId: string
  /** Present for `webrtc`: a local WHEP endpoint the browser negotiates with. */
  whepUrl?: string
  /** Present for `mjpeg`: bridge path to append a ticket to. */
  mjpegPath?: string
  snapshotPath?: string
  snapshot: boolean
  /** Informational only — the browser must never feed this to a media element. */
  rtspUri?: string
  reason?: string
}

/** Short-lived credential for URLs that a media element loads (no headers possible). */
export interface OnvifStreamTicket {
  ticket: string
  expiresInMs: number
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
  /** Which live-view path to use, and why, when there is none. */
  stream(id: string): Promise<OnvifStreamInfo>
  /** Mint a ticket for the MJPEG URL. */
  streamTicket(id: string): Promise<OnvifStreamTicket>
  /** One JPEG frame, fetched by the bridge with the camera's credentials. */
  snapshot(id: string): Promise<Blob>
  /** Absolute URL an `<img>` can load for the MJPEG multipart stream. */
  mjpegUrl(id: string, ticket: string): string
}

/**
 * HTTP transport to the local Omega ONVIF bridge.
 *
 * Example bridge URL:
 *   http://127.0.0.1:8787
 *
 * The bridge is deliberately separate because browser JavaScript cannot
 * reliably perform WS-Discovery/SOAP against arbitrary LAN cameras, and cannot
 * play RTSP at all.
 */
export class HttpOnvifTransport implements OnvifTransport {
  private readonly base: string
  private readonly token?: string

  constructor(baseUrl = 'http://127.0.0.1:8787', token?: string) {
    // Normalised, not trusted: a pasted `…/cameras/connect` would otherwise be
    // stored as the base and every route would be built on top of it.
    this.base = onvifBridgeBaseUrl(baseUrl) || 'http://127.0.0.1:8787'
    this.token = token
  }

  /** The normalised base URL this transport talks to. */
  get baseUrl(): string {
    return this.base
  }

  private headers(extra?: HeadersInit): Headers {
    const headers = new Headers(extra)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    return headers
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = this.headers(init.headers)
    headers.set('Content-Type', 'application/json')

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
    return result.presets ?? []
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

  async stream(id: string): Promise<OnvifStreamInfo> {
    return this.request<OnvifStreamInfo>(`/cameras/${encodeURIComponent(id)}/stream`)
  }

  async streamTicket(id: string): Promise<OnvifStreamTicket> {
    return this.request<OnvifStreamTicket>(`/cameras/${encodeURIComponent(id)}/stream/ticket`, {
      method: 'POST',
    })
  }

  async snapshot(id: string): Promise<Blob> {
    // Not `request()`: this answer is bytes, and the bearer token has to ride
    // along, which is exactly why an <img src> cannot fetch it directly.
    const response = await fetch(`${this.base}/cameras/${encodeURIComponent(id)}/snapshot`, {
      headers: this.headers(),
    })
    if (!response.ok) {
      let message = `ONVIF bridge HTTP ${response.status}`
      try {
        const body = await response.json() as { error?: string }
        if (body?.error) message = body.error
      } catch { /* keep the status message */ }
      throw new Error(message)
    }
    return response.blob()
  }

  mjpegUrl(id: string, ticket: string): string {
    return `${this.base}/cameras/${encodeURIComponent(id)}/stream.mjpeg?ticket=${encodeURIComponent(ticket)}`
  }
}
