#!/usr/bin/env node
/**
 * OMEGA Atelier — local ONVIF bridge.
 *
 * Why this exists:
 * The deployed Vite app runs in a browser. Browsers cannot reliably perform
 * WS-Discovery UDP multicast or authenticated ONVIF SOAP against arbitrary
 * 192.168.x.x cameras, and they cannot play RTSP at all. This tiny local
 * service does both jobs and exposes a deliberately small HTTP API to the
 * browser-side ONVIF connector.
 *
 * Install:
 *   npm install
 *
 * Run:
 *   OMEGA_ONVIF_BRIDGE_TOKEN="change-me" node tools/onvif-bridge/server.mjs
 *
 * Defaults:
 *   host 127.0.0.1
 *   port 8787
 *
 * To make it reachable from another device on the LAN:
 *   OMEGA_ONVIF_BRIDGE_HOST=0.0.0.0
 * and use the LAN address of this machine as the connector bridge URL.
 *
 * The bridge stores camera credentials only in process memory. It never
 * returns them through its API — not in a camera view, not inside a stream or
 * snapshot URI (see `sanitizeUri`).
 *
 * ── The live-picture path ────────────────────────────────────────────────
 *
 *   Arenti → RTSP → this bridge → WebRTC (preferred) or MJPEG → browser
 *
 * The RTSP URI is never handed to the browser as something to play; it is
 * asked for over ONVIF `GetStreamUri` (never guessed, never hard-coded) and
 * consumed here.
 *
 *   WebRTC   Lowest latency. Used when a local WHEP endpoint is configured
 *            (go2rtc / MediaMTX on the same machine) via
 *            OMEGA_ONVIF_WEBRTC_WHEP. The browser negotiates directly with
 *            that local endpoint; no camera credentials are involved.
 *   MJPEG    The zero-infrastructure fallback: ffmpeg remuxes RTSP into
 *            `multipart/x-mixed-replace`, which an <img> plays natively.
 *   Snapshot Last resort, and always available: the ONVIF snapshot URI,
 *            fetched here with digest/basic auth and relayed as JPEG bytes.
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────
//  Pure helpers — exported because they carry the rules worth testing.
// ─────────────────────────────────────────────────────────────────────────

export const clamp = (v, min, max) =>
  Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : 0))

/**
 * Strip any `user:pass@` userinfo out of a URI.
 *
 * Some cameras answer `GetStreamUri` / `GetSnapshotUri` with the credentials
 * already embedded. Handing that straight to the browser would leak the ONVIF
 * password into a device metadata field, so every URI that leaves this process
 * goes through here first.
 */
export function sanitizeUri(uri) {
  if (typeof uri !== 'string' || !uri) return undefined
  return uri.replace(/^([a-zA-Z][\w+.-]*:\/\/)[^/@]*@/, '$1')
}

/** Put the ONVIF credentials back into an RTSP URI — bridge-side only. */
export function withRtspCredentials(uri, username, password) {
  const clean = sanitizeUri(uri)
  if (!clean || !username) return clean
  const m = /^([a-zA-Z][\w+.-]*:\/\/)(.*)$/.exec(clean)
  if (!m) return clean
  const cred = `${encodeURIComponent(username)}:${encodeURIComponent(password ?? '')}`
  return `${m[1]}${cred}@${m[2]}`
}

/**
 * Does this ONVIF error mean "the camera does not implement this operation"?
 *
 * The Arenti answers `GetStatus` with `ONVIF SOAP Fault: Action Not
 * Implemented` and reports no PTZ service in its capabilities — yet
 * `ContinuousMove` may still work. So a missing capability or an unimplemented
 * `GetStatus` must never be treated as "PTZ is impossible"; only a
 * `ContinuousMove` that answers like this does.
 */
export function isUnsupportedOperation(error) {
  const msg = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  return (
    msg.includes('not implemented') ||
    msg.includes('notimplemented') ||
    msg.includes('actionnotsupported') ||
    msg.includes('action not supported') ||
    msg.includes('not supported') ||
    msg.includes('optionalaction') ||
    msg.includes('no ptz') ||
    msg.includes('ptz service') ||
    msg.includes('nosuchservice')
  )
}

/** Build an HTTP `Authorization: Digest …` value for one request. */
export function digestAuthHeader({ challenge, username, password, method, uri, cnonce, nc = '00000001' }) {
  const params = {}
  for (const part of challenge.replace(/^Digest\s+/i, '').matchAll(/(\w+)="?([^",]*)"?/g)) {
    params[part[1].toLowerCase()] = part[2]
  }
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
  const realm = params.realm ?? ''
  const nonce = params.nonce ?? ''
  const qop = (params.qop ?? '').split(',')[0].trim()
  const ha1 = md5(`${username}:${realm}:${password}`)
  const ha2 = md5(`${method}:${uri}`)
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`)

  const fields = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ]
  if (params.opaque) fields.push(`opaque="${params.opaque}"`)
  if (qop) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`)
  return `Digest ${fields.join(', ')}`
}

/**
 * Decide which live-view mode the browser should try.
 *
 * WebRTC first (latency), MJPEG second (works with nothing but ffmpeg),
 * snapshot last — and `none` never happens silently: the reason travels with
 * it so the UI can say why instead of showing a black rectangle.
 */
export function pickStreamMode({ whepUrl, ffmpeg, streamUri, snapshot }) {
  if (whepUrl) return { mode: 'webrtc', whepUrl }
  if (streamUri && ffmpeg) return { mode: 'mjpeg' }
  if (snapshot) {
    return {
      mode: 'snapshot',
      reason: streamUri
        ? 'ffmpeg nicht gefunden — Live-Stream nicht verfügbar, Snapshot wird verwendet'
        : 'Kamera liefert keine RTSP-Adresse — Snapshot wird verwendet',
    }
  }
  return {
    mode: 'none',
    reason: streamUri
      ? 'ffmpeg nicht gefunden und kein ONVIF-Snapshot verfügbar'
      : 'Kamera liefert weder Stream noch Snapshot',
  }
}

/** Resolve the WHEP template for one camera id (`{id}` is substituted). */
export function whepUrlFor(template, id) {
  if (!template) return undefined
  return template.includes('{id}')
    ? template.replaceAll('{id}', encodeURIComponent(id))
    : template
}

// ─────────────────────────────────────────────────────────────────────────
//  ffmpeg discovery
// ─────────────────────────────────────────────────────────────────────────

/** Probe once whether ffmpeg exists on PATH; the answer is cached. */
export function createFfmpegProbe(bin = 'ffmpeg', spawnImpl = spawn) {
  let cached
  return () => {
    if (cached) return cached
    cached = new Promise((resolve) => {
      let child
      try {
        child = spawnImpl(bin, ['-version'], { stdio: 'ignore' })
      } catch {
        resolve(false)
        return
      }
      child.once('error', () => resolve(false))
      child.once('exit', (code) => resolve(code === 0))
    })
    return cached
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Authenticated snapshot fetch (digest, then basic)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET an ONVIF snapshot URI, answering whichever auth challenge comes back.
 *
 * Cameras split roughly evenly between digest and basic here, and the ONVIF
 * spec does not settle it, so the first request goes out unauthenticated and
 * the challenge decides. Credentials never leave this function.
 */
export async function fetchSnapshot(uri, { username, password, fetchImpl = fetch } = {}) {
  const first = await fetchImpl(uri)
  if (first.status !== 401) return first

  const challenge = first.headers.get('www-authenticate') ?? ''
  // Drain the 401 body so the socket can be reused.
  try { await first.arrayBuffer() } catch { /* ignore */ }

  if (/^digest/i.test(challenge)) {
    const target = new URL(uri)
    return fetchImpl(uri, {
      headers: {
        Authorization: digestAuthHeader({
          challenge,
          username,
          password: password ?? '',
          method: 'GET',
          uri: target.pathname + target.search,
          cnonce: crypto.randomBytes(8).toString('hex'),
        }),
      },
    })
  }

  const basic = Buffer.from(`${username}:${password ?? ''}`).toString('base64')
  return fetchImpl(uri, { headers: { Authorization: `Basic ${basic}` } })
}

// ─────────────────────────────────────────────────────────────────────────
//  Bridge core
// ─────────────────────────────────────────────────────────────────────────

const STREAM_TICKET_TTL_MS = 120_000

/**
 * Bridge protocol version, reported by `/health`.
 *
 * Bumped when routes are added or their shapes change, so the app can tell a
 * bridge that is missing a route from a bridge that is broken. `2` is the first
 * build with the live-view routes (`/stream`, `/stream/ticket`,
 * `/stream.mjpeg`, `/snapshot`); anything older answers `/health` without a
 * `version` field at all, which is exactly how the app recognises it.
 */
export const BRIDGE_VERSION = 2

/**
 * Build a bridge instance.
 *
 * Everything the outside world touches is injectable, which is what makes the
 * routes testable without a camera: `Cam`, `fetchImpl`, `spawnImpl`.
 */
export function createBridge(options = {}) {
  const {
    token = '',
    origin = '*',
    Cam = null,
    fetchImpl = (...a) => fetch(...a),
    spawnImpl = spawn,
    ffmpegBin = 'ffmpeg',
    whepTemplate = '',
    ptzProbe = true,
    mjpegFps = 12,
    mjpegQuality = 6,
    now = () => Date.now(),
  } = options

  /** @type {Map<string, any>} */
  const cameras = new Map()
  /** @type {Map<string, {cameraId: string, expires: number}>} */
  const tickets = new Map()
  const hasFfmpeg = createFfmpegProbe(ffmpegBin, spawnImpl)

  const camClass = () => {
    if (Cam) return Cam
    const require = createRequire(import.meta.url)
    return require('onvif/promises').Cam
  }

  const getEntry = (id) => {
    const entry = cameras.get(id)
    if (!entry) {
      const err = new Error(`ONVIF-Kamera nicht verbunden: ${id}`)
      err.status = 404
      throw err
    }
    return entry
  }

  /**
   * The browser-facing shape of a camera. Explicitly enumerated — a spread of
   * `entry.config` would carry the password out of the process.
   */
  const cameraView = (entry) => {
    const cam = entry.cam
    return {
      id: entry.config.id,
      name: entry.config.name ?? entry.config.id,
      host: entry.config.host,
      connected: true,
      manufacturer: cam.manufacturer,
      model: cam.model,
      firmware: cam.firmware,
      serialNumber: cam.serialNumber,
      /**
       * `ptz` stays the simple boolean the connector already reads, but it is
       * no longer the capability flag: it is "PTZ is not known to be absent".
       * `ptzSupport` carries the nuance.
       */
      ptz: entry.ptzSupport !== 'unavailable',
      ptzSupport: entry.ptzSupport,
      ptzMessage: entry.ptzMessage,
      snapshot: Boolean(entry.snapshotUri),
      stream: Boolean(entry.streamUri),
      profiles: (cam.profiles ?? []).map((p) => ({
        token: p.token,
        name: p.name,
        width: p.videoEncoderConfiguration?.resolution?.width,
        height: p.videoEncoderConfiguration?.resolution?.height,
        fps: p.videoEncoderConfiguration?.rateControl?.frameRateLimit,
      })),
      streamUri: sanitizeUri(entry.streamUri),
    }
  }

  /**
   * Ask ContinuousMove itself whether PTZ works.
   *
   * A zero velocity vector moves nothing, so this is safe to run on connect,
   * and it is the only answer that matters: node-onvif reports
   * `capabilities.PTZ === false` for the Arenti and `GetStatus` faults with
   * "Action Not Implemented", yet ContinuousMove may still be served.
   */
  const probePtz = async (entry) => {
    try {
      await entry.cam.continuousMove({ x: 0, y: 0, zoom: 0, timeout: 1 })
      try { await entry.cam.stop({ panTilt: true, zoom: true }) } catch { /* optional */ }
      entry.ptzSupport = 'available'
      entry.ptzMessage = undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isUnsupportedOperation(error)) {
        entry.ptzSupport = 'unavailable'
        entry.ptzMessage = message
      } else {
        // Something else went wrong (timeout, transient fault). Not proof of
        // absence — leave the door open and let a real move decide.
        entry.ptzSupport = 'unknown'
        entry.ptzMessage = message
      }
    }
  }

  const connectCamera = async (config) => {
    if (!config?.id || !config?.host || !config?.username) {
      const err = new Error('id, host und username sind erforderlich')
      err.status = 400
      throw err
    }

    const old = cameras.get(config.id)
    if (old) {
      try { old.cam.removeAllListeners?.() } catch { /* ignore */ }
      stopMjpeg(old)
      cameras.delete(config.id)
    }

    const CamImpl = camClass()
    const cam = new CamImpl({
      hostname: config.host,
      port: Number(config.port ?? 8000),
      username: config.username,
      password: config.password ?? '',
    })

    await cam.connect()
    const entry = { config: { ...config }, cam, ptzSupport: 'unknown' }
    cameras.set(config.id, entry)

    /*
     * Resolve the actual RTSP URI once after connection. It may differ from a
     * guessed vendor URL, so Omega always trusts ONVIF's response — the URI is
     * never assembled from the host and a known path.
     */
    try {
      const stream = await cam.getStreamUri({ protocol: 'RTSP', stream: 'RTP-Unicast' })
      entry.streamUri = stream?.uri
    } catch {
      entry.streamUri = undefined
    }

    try {
      const snap = await cam.getSnapshotUri()
      entry.snapshotUri = snap?.uri
    } catch {
      entry.snapshotUri = undefined
    }

    if (ptzProbe) await probePtz(entry)

    return cameraView(entry)
  }

  // ── MJPEG ──────────────────────────────────────────────────────────────

  const stopMjpeg = (entry) => {
    if (entry?.mjpeg) {
      try { entry.mjpeg.kill('SIGKILL') } catch { /* ignore */ }
      entry.mjpeg = undefined
    }
  }

  /**
   * ffmpeg's `mpjpeg` muxer already emits `multipart/x-mixed-replace`, which
   * is exactly what an <img> consumes — so no frame re-framing happens here.
   */
  const spawnMjpeg = (entry) => {
    const rtsp = withRtspCredentials(entry.streamUri, entry.config.username, entry.config.password)
    return spawnImpl(ffmpegBin, [
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', rtsp,
      '-an',
      '-r', String(mjpegFps),
      '-q:v', String(mjpegQuality),
      '-f', 'mpjpeg',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
  }

  // ── Stream tickets ─────────────────────────────────────────────────────

  /**
   * An <img> or a <video> cannot carry an `Authorization` header, so the MJPEG
   * URL needs its own credential. A short-lived random ticket keeps the bridge
   * token out of URLs (and out of browser history) while still letting the tag
   * fetch the stream.
   */
  const issueTicket = (cameraId) => {
    const ticket = crypto.randomBytes(24).toString('base64url')
    tickets.set(ticket, { cameraId, expires: now() + STREAM_TICKET_TTL_MS })
    for (const [key, value] of tickets) if (value.expires < now()) tickets.delete(key)
    return { ticket, expiresInMs: STREAM_TICKET_TTL_MS }
  }

  const ticketValid = (ticket, cameraId) => {
    const entry = ticket ? tickets.get(ticket) : undefined
    if (!entry) return false
    if (entry.expires < now()) { tickets.delete(ticket); return false }
    return entry.cameraId === cameraId
  }

  // ── Routing ────────────────────────────────────────────────────────────

  const authorized = (headers) => {
    if (!token) return true
    return headers?.authorization === `Bearer ${token}`
  }

  const streamDescriptor = async (entry) => {
    const whepUrl = whepUrlFor(whepTemplate, entry.config.id)
    const pick = pickStreamMode({
      whepUrl,
      ffmpeg: await hasFfmpeg(),
      streamUri: entry.streamUri,
      snapshot: entry.snapshotUri,
    })
    return {
      ...pick,
      cameraId: entry.config.id,
      /** Informational only. The browser must never feed this to <video>. */
      rtspUri: sanitizeUri(entry.streamUri),
      snapshot: Boolean(entry.snapshotUri),
      mjpegPath: pick.mode === 'mjpeg'
        ? `/cameras/${encodeURIComponent(entry.config.id)}/stream.mjpeg`
        : undefined,
      snapshotPath: entry.snapshotUri
        ? `/cameras/${encodeURIComponent(entry.config.id)}/snapshot`
        : undefined,
    }
  }

  /**
   * The whole API as one pure-ish function: in a request description, out a
   * response description. The node adapter below is the only part that knows
   * about sockets, which is what lets the tests drive every route directly.
   */
  async function dispatch({ method, pathname, query = {}, headers = {}, body = {} }) {
    if (method === 'OPTIONS') return { status: 204, json: {} }

    const parts = pathname.split('/').filter(Boolean)
    const isMjpeg = parts[0] === 'cameras' && parts[2] === 'stream.mjpeg'

    // Everything needs the bearer token; the MJPEG URL uses a ticket instead,
    // because a media tag cannot send headers.
    if (!isMjpeg && !authorized(headers)) {
      return { status: 401, json: { error: 'Bridge-Authentifizierung abgelehnt' } }
    }

    try {
      if (method === 'GET' && pathname === '/health') {
        return {
          status: 200,
          json: {
            ok: true,
            version: BRIDGE_VERSION,
            cameras: cameras.size,
            ffmpeg: await hasFfmpeg(),
            webrtc: Boolean(whepTemplate),
            auth: Boolean(token),
            /*
             * What this build can actually do.
             *
             * The bridge is a long-lived process started by hand, so a running
             * one is routinely older than the app talking to it. Without this,
             * the app's only signal was a bare 404 carrying the bridge's own
             * "ONVIF-Route nicht gefunden" — which it printed over the video
             * area, where it tells the user nothing about the fact that their
             * bridge simply predates the streaming routes and needs restarting.
             */
            features: {
              stream: true,
              snapshot: true,
              mjpeg: true,
              ptz: true,
              ticket: true,
            },
          },
        }
      }

      if (method === 'GET' && pathname === '/cameras') {
        return { status: 200, json: { cameras: [...cameras.values()].map(cameraView) } }
      }

      if (method === 'POST' && pathname === '/cameras/connect') {
        return { status: 200, json: await connectCamera(body) }
      }

      if (parts[0] !== 'cameras' || !parts[1]) {
        return { status: 404, json: { error: 'Nicht gefunden' } }
      }

      const id = decodeURIComponent(parts[1])

      // The MJPEG route authenticates by ticket, so it resolves its camera
      // before the generic lookup and answers 401 rather than 404 on a bad one.
      if (method === 'GET' && parts[2] === 'stream.mjpeg') {
        if (!ticketValid(query.ticket, id)) {
          return { status: 401, json: { error: 'Stream-Ticket ungültig oder abgelaufen' } }
        }
        const entry = getEntry(id)
        if (!entry.streamUri) {
          return { status: 409, json: { error: 'Kamera liefert keine RTSP-Adresse' } }
        }
        if (!(await hasFfmpeg())) {
          return { status: 503, json: { error: 'ffmpeg nicht gefunden — Live-Stream nicht verfügbar' } }
        }
        return {
          status: 200,
          headers: {
            'Content-Type': 'multipart/x-mixed-replace;boundary=ffmpeg',
            'Cache-Control': 'no-store',
            Connection: 'close',
          },
          pipe: (res) => {
            const child = spawnMjpeg(entry)
            entry.mjpeg = child
            child.stdout.pipe(res)
            child.stderr?.resume()
            const cleanup = () => { if (entry.mjpeg === child) entry.mjpeg = undefined; try { child.kill('SIGKILL') } catch { /* ignore */ } }
            child.once('error', cleanup)
            child.once('exit', () => { if (entry.mjpeg === child) entry.mjpeg = undefined; res.end() })
            res.once('close', cleanup)
          },
        }
      }

      const entry = getEntry(id)
      const cam = entry.cam

      if (method === 'GET' && parts.length === 2) {
        return { status: 200, json: cameraView(entry) }
      }

      if (method === 'POST' && parts[2] === 'disconnect') {
        stopMjpeg(entry)
        cameras.delete(id)
        return { status: 200, json: { ok: true } }
      }

      if (method === 'GET' && parts[2] === 'stream') {
        return { status: 200, json: await streamDescriptor(entry) }
      }

      if (method === 'POST' && parts[2] === 'stream' && parts[3] === 'ticket') {
        return { status: 200, json: issueTicket(id) }
      }

      if (method === 'GET' && parts[2] === 'snapshot') {
        if (!entry.snapshotUri) {
          return { status: 409, json: { error: 'Kamera liefert keinen ONVIF-Snapshot' } }
        }
        const res = await fetchSnapshot(entry.snapshotUri, {
          username: entry.config.username,
          password: entry.config.password,
          fetchImpl,
        })
        if (!res.ok) {
          return { status: 502, json: { error: `Snapshot fehlgeschlagen (HTTP ${res.status})` } }
        }
        return {
          status: 200,
          headers: {
            'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
            'Cache-Control': 'no-store',
          },
          buffer: Buffer.from(await res.arrayBuffer()),
        }
      }

      if (parts[2] === 'ptz') return ptzRoute({ method, parts, entry, cam, body })

      return { status: 404, json: { error: 'ONVIF-Route nicht gefunden' } }
    } catch (error) {
      return {
        status: error?.status ?? 502,
        json: { error: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  /**
   * PTZ.
   *
   * The old gate — `if (!cam.capabilities?.PTZ) throw` — refused to even try on
   * a camera that reports no PTZ service, which is precisely the Arenti's
   * situation, and it was wrong: capability discovery and `GetStatus` are
   * separate operations from `ContinuousMove`, and a camera may implement the
   * last without the first two. Movement is therefore attempted directly, and
   * only `ContinuousMove` itself may declare PTZ unavailable.
   */
  async function ptzRoute({ method, parts, entry, cam, body }) {
    const op = parts[3]

    if (method === 'POST' && op === 'move') {
      try {
        await cam.continuousMove({
          x: clamp(body.x, -1, 1),
          y: clamp(body.y, -1, 1),
          zoom: clamp(body.zoom, -1, 1),
          timeout: body.timeoutMs == null ? undefined : Math.max(50, Number(body.timeoutMs)),
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isUnsupportedOperation(error)) {
          entry.ptzSupport = 'unavailable'
          entry.ptzMessage = message
          return { status: 501, json: { error: message, ptzSupport: 'unavailable' } }
        }
        return { status: 502, json: { error: message, ptzSupport: entry.ptzSupport } }
      }
      entry.ptzSupport = 'available'
      entry.ptzMessage = undefined
      return { status: 200, json: { ok: true, ptzSupport: 'available' } }
    }

    if (method === 'POST' && op === 'stop') {
      try {
        await cam.stop({ panTilt: true, zoom: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Stop is its own operation. A camera that moves but does not
        // implement Stop still has usable PTZ, so this never demotes support.
        if (isUnsupportedOperation(error)) {
          return { status: 501, json: { error: message, ptzSupport: entry.ptzSupport } }
        }
        return { status: 502, json: { error: message } }
      }
      return { status: 200, json: { ok: true } }
    }

    if (method === 'GET' && op === 'status') {
      /*
       * GetStatus is explicitly NOT a precondition for steering. The Arenti
       * faults here with "Action Not Implemented"; answering 502 made the UI
       * treat the whole camera as broken. A 200 that says "no status" lets the
       * UI hide one readout and keep the controls.
       */
      try {
        const result = await cam.getStatus()
        return {
          status: 200,
          json: {
            supported: true,
            position: result?.position,
            moveStatus: result?.moveStatus,
            utcTime: result?.utcTime,
          },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isUnsupportedOperation(error)) {
          return { status: 200, json: { supported: false, reason: message } }
        }
        return { status: 200, json: { supported: false, reason: message } }
      }
    }

    if (method === 'GET' && op === 'presets') {
      try {
        const raw = await cam.getPresets()
        const presets = Array.isArray(raw)
          ? raw.map((value, index) => ({
              token: value?.token ?? value?.PresetToken ?? String(index),
              name: value?.name ?? value?.Name,
            }))
          : Object.entries(raw ?? {}).map(([token, value]) => ({
              token,
              name: typeof value === 'string' ? value : (value?.name ?? value?.Name),
            }))
        return { status: 200, json: { supported: true, presets } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { status: 200, json: { supported: false, presets: [], reason: message } }
      }
    }

    if (method === 'POST' && op === 'preset') {
      if (!body.token) return { status: 400, json: { error: 'Preset token fehlt' } }
      try {
        await cam.gotoPreset({ preset: body.token })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { status: isUnsupportedOperation(error) ? 501 : 502, json: { error: message } }
      }
      return { status: 200, json: { ok: true } }
    }

    if (method === 'POST' && op === 'home') {
      try {
        await cam.gotoHomePosition({})
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { status: isUnsupportedOperation(error) ? 501 : 502, json: { error: message } }
      }
      return { status: 200, json: { ok: true } }
    }

    return { status: 404, json: { error: 'ONVIF-Route nicht gefunden' } }
  }

  // ── node:http adapter ──────────────────────────────────────────────────

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }

  const readBody = async (req) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text) return {}
    try { return JSON.parse(text) } catch { throw new Error('Ungültiges JSON') }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    let body = {}
    if (req.method === 'POST') {
      try {
        body = await readBody(req)
      } catch (error) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: error.message }))
        return
      }
    }

    const result = await dispatch({
      method: req.method ?? 'GET',
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
    })

    if (result.pipe) {
      res.writeHead(result.status, { ...corsHeaders, ...result.headers })
      result.pipe(res)
      return
    }
    if (result.buffer) {
      res.writeHead(result.status, { ...corsHeaders, ...result.headers })
      res.end(result.buffer)
      return
    }
    res.writeHead(result.status, {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...result.headers,
    })
    res.end(JSON.stringify(result.json ?? {}))
  }

  return { dispatch, handle, cameras, issueTicket, ticketValid }
}

// ─────────────────────────────────────────────────────────────────────────
//  CLI entry point
// ─────────────────────────────────────────────────────────────────────────

export function startBridge(env = process.env) {
  const host = env.OMEGA_ONVIF_BRIDGE_HOST ?? '127.0.0.1'
  const port = Number(env.OMEGA_ONVIF_BRIDGE_PORT ?? 8787)
  const token = env.OMEGA_ONVIF_BRIDGE_TOKEN ?? ''

  const bridge = createBridge({
    token,
    origin: env.OMEGA_ONVIF_BRIDGE_ORIGIN ?? '*',
    ffmpegBin: env.OMEGA_ONVIF_FFMPEG ?? 'ffmpeg',
    whepTemplate: env.OMEGA_ONVIF_WEBRTC_WHEP ?? '',
    ptzProbe: env.OMEGA_ONVIF_PTZ_PROBE !== '0',
    mjpegFps: Number(env.OMEGA_ONVIF_MJPEG_FPS ?? 12),
    mjpegQuality: Number(env.OMEGA_ONVIF_MJPEG_QUALITY ?? 6),
  })

  const server = http.createServer((req, res) => {
    void bridge.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Interner Bridge-Fehler' }))
    })
  })

  server.listen(port, host, () => {
    console.log(`OMEGA ONVIF bridge listening on http://${host}:${port}`)
    console.log(token ? 'Bridge token authentication: enabled' : 'WARNING: bridge token authentication is DISABLED')
    if (env.OMEGA_ONVIF_WEBRTC_WHEP) console.log(`WebRTC (WHEP): ${env.OMEGA_ONVIF_WEBRTC_WHEP}`)
    else console.log('WebRTC: not configured — MJPEG (ffmpeg) will be used when available')
  })

  return server
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) startBridge()
