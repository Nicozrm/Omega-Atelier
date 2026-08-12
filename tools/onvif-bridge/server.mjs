#!/usr/bin/env node
/**
 * OMEGA Atelier — local ONVIF bridge.
 *
 * Why this exists:
 * The deployed Vite app runs in a browser. Browsers cannot reliably perform
 * WS-Discovery UDP multicast or authenticated ONVIF SOAP against arbitrary
 * 192.168.x.x cameras. This tiny local service does that job and exposes a
 * deliberately small HTTP API to the browser-side ONVIF connector.
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
 * returns them through its API.
 */

import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Cam } = require('onvif/promises')

const HOST = process.env.OMEGA_ONVIF_BRIDGE_HOST ?? '127.0.0.1'
const PORT = Number(process.env.OMEGA_ONVIF_BRIDGE_PORT ?? 8787)
const TOKEN = process.env.OMEGA_ONVIF_BRIDGE_TOKEN ?? ''
const ORIGIN = process.env.OMEGA_ONVIF_BRIDGE_ORIGIN ?? '*'

/** @type {Map<string, {config: object, cam: any}>} */
const cameras = new Map()

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try { return JSON.parse(text) } catch { throw new Error('Ungültiges JSON') }
}

const auth = (req) => {
  if (!TOKEN) return true
  return req.headers.authorization === `Bearer ${TOKEN}`
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : 0))

const cameraView = (entry) => {
  const cam = entry.cam
  const profile = cam.defaultProfile
  return {
    id: entry.config.id,
    name: entry.config.name ?? entry.config.id,
    host: entry.config.host,
    connected: true,
    manufacturer: cam.manufacturer,
    model: cam.model,
    firmware: cam.firmware,
    serialNumber: cam.serialNumber,
    ptz: Boolean(cam.capabilities?.PTZ && cam.activeSource?.ptz),
    snapshot: typeof cam.getSnapshotUri === 'function',
    stream: Boolean(profile),
    profiles: (cam.profiles ?? []).map((p) => ({
      token: p.token,
      name: p.name,
      width: p.videoEncoderConfiguration?.resolution?.width,
      height: p.videoEncoderConfiguration?.resolution?.height,
      fps: p.videoEncoderConfiguration?.rateControl?.frameRateLimit,
    })),
    streamUri: undefined,
  }
}

const getEntry = (id) => {
  const entry = cameras.get(id)
  if (!entry) throw new Error(`ONVIF-Kamera nicht verbunden: ${id}`)
  return entry
}

const connectCamera = async (config) => {
  if (!config?.id || !config?.host || !config?.username) {
    throw new Error('id, host und username sind erforderlich')
  }

  const old = cameras.get(config.id)
  if (old) {
    try { old.cam.removeAllListeners?.() } catch {}
    cameras.delete(config.id)
  }

  const cam = new Cam({
    hostname: config.host,
    port: Number(config.port ?? 8000),
    username: config.username,
    password: config.password ?? '',
  })

  await cam.connect()
  const entry = { config: { ...config }, cam }
  cameras.set(config.id, entry)

  // Resolve the actual RTSP URI once after connection. It may differ from a
  // guessed vendor URL, so Omega always trusts ONVIF's response.
  try {
    const stream = await cam.getStreamUri({ protocol: 'RTSP', stream: 'RTP-Unicast' })
    entry.streamUri = stream?.uri
  } catch {
    entry.streamUri = undefined
  }

  return {
    ...cameraView(entry),
    streamUri: entry.streamUri,
  }
}

const route = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (!auth(req)) return json(res, 401, { error: 'Bridge-Authentifizierung abgelehnt' })

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const parts = url.pathname.split('/').filter(Boolean)

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, cameras: cameras.size })
    }

    if (req.method === 'GET' && url.pathname === '/cameras') {
      const result = []
      for (const entry of cameras.values()) {
        const view = cameraView(entry)
        view.streamUri = entry.streamUri
        result.push(view)
      }
      return json(res, 200, { cameras: result })
    }

    if (req.method === 'POST' && url.pathname === '/cameras/connect') {
      const config = await readBody(req)
      return json(res, 200, await connectCamera(config))
    }

    if (parts[0] !== 'cameras' || !parts[1]) {
      return json(res, 404, { error: 'Nicht gefunden' })
    }

    const id = decodeURIComponent(parts[1])
    const entry = getEntry(id)
    const cam = entry.cam

    if (req.method === 'GET' && parts.length === 2) {
      const view = cameraView(entry)
      view.streamUri = entry.streamUri
      return json(res, 200, view)
    }

    if (req.method === 'POST' && parts[2] === 'disconnect') {
      cameras.delete(id)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && parts[2] === 'ptz' && parts[3] === 'move') {
      const body = await readBody(req)
      if (!entry.cam.capabilities?.PTZ) throw new Error('Kamera meldet keinen ONVIF-PTZ-Service')

      await cam.continuousMove({
        x: clamp(body.x, -1, 1),
        y: clamp(body.y, -1, 1),
        zoom: clamp(body.zoom, -1, 1),
        timeout: body.timeoutMs == null ? undefined : Math.max(50, Number(body.timeoutMs)),
      })
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && parts[2] === 'ptz' && parts[3] === 'stop') {
      await cam.stop({ panTilt: true, zoom: true })
      return json(res, 200, { ok: true })
    }

    if (req.method === 'GET' && parts[2] === 'ptz' && parts[3] === 'status') {
      const result = await cam.getStatus()
      return json(res, 200, {
        position: result?.position,
        moveStatus: result?.moveStatus,
        utcTime: result?.utcTime,
      })
    }

    if (req.method === 'GET' && parts[2] === 'ptz' && parts[3] === 'presets') {
      const raw = await cam.getPresets()
      const presets = Array.isArray(raw)
        ? raw.map((value, index) => ({
            token: value?.token ?? value?.PresetToken ?? String(index),
            name: value?.name ?? value?.Name,
          }))
        : Object.entries(raw ?? {}).map(([token, value]) => ({
            token,
            name: value?.name ?? value?.Name,
          }))
      return json(res, 200, { presets })
    }

    if (req.method === 'POST' && parts[2] === 'ptz' && parts[3] === 'preset') {
      const body = await readBody(req)
      if (!body.token) throw new Error('Preset token fehlt')
      await cam.gotoPreset({ preset: body.token })
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && parts[2] === 'ptz' && parts[3] === 'home') {
      await cam.gotoHomePosition({})
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: 'ONVIF-Route nicht gefunden' })
  } catch (error) {
    return json(res, 502, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const server = http.createServer((req, res) => {
  void route(req, res)
})

server.listen(PORT, HOST, () => {
  console.log(`OMEGA ONVIF bridge listening on http://${HOST}:${PORT}`)
  console.log(TOKEN ? 'Bridge token authentication: enabled' : 'WARNING: bridge token authentication is DISABLED')
})
