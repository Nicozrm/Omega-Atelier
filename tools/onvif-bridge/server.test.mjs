/**
 * Bridge route tests.
 *
 * The point of these is the half that cannot be checked from the browser: that
 * the RTSP URI comes from ONVIF and is never assembled, that credentials never
 * travel back out, and that PTZ survives a camera which implements
 * ContinuousMove but neither capability discovery nor GetStatus — the Arenti's
 * exact behaviour.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createBridge, sanitizeUri, withRtspCredentials, isUnsupportedOperation,
  pickStreamMode, whepUrlFor, digestAuthHeader, fetchSnapshot,
} from './server.mjs'

const PASSWORD = 'sup3r-s3cret-onvif'

const CONFIG = {
  id: 'arenti-aussenkamera',
  name: 'Arenti Außenkamera',
  host: '192.168.0.107',
  port: 8000,
  username: 'admin',
  password: PASSWORD,
}

/** A stand-in for node-onvif's Cam, shaped like the Arenti actually answers. */
function makeCam(overrides = {}) {
  const calls = []
  const cam = {
    manufacturer: 'Arenti',
    model: 'GO2',
    firmware: '1.0.0',
    serialNumber: 'SN-1',
    // The Arenti reports NO PTZ service here — the old gate refused on this.
    capabilities: { PTZ: false },
    profiles: [
      { token: 'PROFILE_000', name: 'Main', videoEncoderConfiguration: { resolution: { width: 2560, height: 1440 }, rateControl: { frameRateLimit: 15 } } },
      { token: 'PROFILE_001', name: 'Sub', videoEncoderConfiguration: { resolution: { width: 640, height: 360 }, rateControl: { frameRateLimit: 15 } } },
    ],
    calls,
    connect: async () => { calls.push(['connect']) },
    getStreamUri: async (args) => { calls.push(['getStreamUri', args]); return { uri: 'rtsp://192.168.0.107:8554/Streaming/Channels/101' } },
    getSnapshotUri: async () => ({ uri: 'http://192.168.0.107/onvif/snapshot' }),
    continuousMove: async (args) => { calls.push(['continuousMove', args]) },
    stop: async (args) => { calls.push(['stop', args]) },
    getStatus: async () => { throw new Error('ONVIF SOAP Fault: Action Not Implemented') },
    getPresets: async () => ({ 'preset-1': 'Eingang' }),
    gotoPreset: async (args) => { calls.push(['gotoPreset', args]) },
    gotoHomePosition: async () => { calls.push(['home']) },
    ...overrides,
  }
  return cam
}

function makeBridge({ cam = makeCam(), ...opts } = {}) {
  class Cam {
    constructor(config) {
      Object.assign(cam, { __config: config })
      return cam
    }
  }
  return { bridge: createBridge({ Cam, ...opts }), cam }
}

const connect = (bridge, headers = {}) =>
  bridge.dispatch({ method: 'POST', pathname: '/cameras/connect', headers, body: CONFIG })

describe('bridge — pure helpers', () => {
  it('strips embedded credentials from a URI', () => {
    expect(sanitizeUri('rtsp://admin:secret@192.168.0.107:8554/live')).toBe('rtsp://192.168.0.107:8554/live')
    expect(sanitizeUri('rtsp://192.168.0.107:8554/live')).toBe('rtsp://192.168.0.107:8554/live')
    expect(sanitizeUri(undefined)).toBeUndefined()
  })

  it('re-injects credentials only on the bridge side', () => {
    expect(withRtspCredentials('rtsp://192.168.0.107:8554/live', 'admin', 'p@ss/w'))
      .toBe('rtsp://admin:p%40ss%2Fw@192.168.0.107:8554/live')
  })

  it('classifies "Action Not Implemented" as an unsupported operation', () => {
    expect(isUnsupportedOperation(new Error('ONVIF SOAP Fault: Action Not Implemented'))).toBe(true)
    expect(isUnsupportedOperation(new Error('ter:ActionNotSupported'))).toBe(true)
    expect(isUnsupportedOperation(new Error('socket hang up'))).toBe(false)
  })

  it('prefers WebRTC, then MJPEG, then snapshot — and always states a reason', () => {
    expect(pickStreamMode({ whepUrl: 'http://127.0.0.1:1984/api/webrtc', ffmpeg: true, streamUri: 'rtsp://x', snapshot: true }).mode).toBe('webrtc')
    expect(pickStreamMode({ ffmpeg: true, streamUri: 'rtsp://x', snapshot: true }).mode).toBe('mjpeg')
    const fallback = pickStreamMode({ ffmpeg: false, streamUri: 'rtsp://x', snapshot: true })
    expect(fallback.mode).toBe('snapshot')
    expect(fallback.reason).toMatch(/ffmpeg/i)
    const none = pickStreamMode({ ffmpeg: false, streamUri: undefined, snapshot: false })
    expect(none.mode).toBe('none')
    expect(none.reason).toBeTruthy()
  })

  it('substitutes the camera id into a WHEP template', () => {
    expect(whepUrlFor('http://127.0.0.1:1984/api/webrtc?src={id}', 'cam a')).toBe('http://127.0.0.1:1984/api/webrtc?src=cam%20a')
    expect(whepUrlFor('', 'x')).toBeUndefined()
  })

  it('builds an RFC 2617 digest response', () => {
    const header = digestAuthHeader({
      challenge: 'Digest realm="IPCAM", nonce="abc", qop="auth"',
      username: 'admin', password: 'pw', method: 'GET', uri: '/snap', cnonce: 'deadbeef',
    })
    expect(header).toMatch(/^Digest /)
    expect(header).toContain('username="admin"')
    expect(header).toContain('qop=auth')
    expect(header).not.toContain('pw')
  })
})

describe('bridge — authentication', () => {
  it('rejects every route without the bearer token', async () => {
    const { bridge } = makeBridge({ token: 'topsecret' })
    const res = await bridge.dispatch({ method: 'GET', pathname: '/health', headers: {} })
    expect(res.status).toBe(401)
  })

  it('accepts the configured bearer token', async () => {
    const { bridge } = makeBridge({ token: 'topsecret' })
    const res = await bridge.dispatch({ method: 'GET', pathname: '/health', headers: { authorization: 'Bearer topsecret' } })
    expect(res.status).toBe(200)
    expect(res.json.ok).toBe(true)
  })

  it('runs open when no token is configured', async () => {
    const { bridge } = makeBridge()
    expect((await bridge.dispatch({ method: 'GET', pathname: '/health' })).status).toBe(200)
  })
})

describe('bridge — connect and stream URI', () => {
  it('takes the RTSP URI from ONVIF getStreamUri instead of guessing one', async () => {
    const { bridge, cam } = makeBridge()
    const res = await connect(bridge)
    expect(res.status).toBe(200)
    expect(res.json.streamUri).toBe('rtsp://192.168.0.107:8554/Streaming/Channels/101')
    expect(cam.calls.some(([name]) => name === 'getStreamUri')).toBe(true)
  })

  it('reports no stream when the camera does not answer getStreamUri — never a guessed path', async () => {
    const cam = makeCam({ getStreamUri: async () => { throw new Error('no stream') } })
    const { bridge } = makeBridge({ cam })
    const res = await connect(bridge)
    expect(res.json.stream).toBe(false)
    expect(res.json.streamUri).toBeUndefined()
  })

  it('never returns the ONVIF password, in any camera response', async () => {
    const { bridge } = makeBridge()
    const connected = await connect(bridge)
    const list = await bridge.dispatch({ method: 'GET', pathname: '/cameras' })
    const one = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}` })
    const stream = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream` })
    for (const res of [connected, list, one, stream]) {
      expect(JSON.stringify(res.json)).not.toContain(PASSWORD)
    }
  })

  it('strips credentials the camera embedded in its own stream URI', async () => {
    const cam = makeCam({ getStreamUri: async () => ({ uri: `rtsp://admin:${PASSWORD}@192.168.0.107:8554/live` }) })
    const { bridge } = makeBridge({ cam })
    const res = await connect(bridge)
    expect(res.json.streamUri).toBe('rtsp://192.168.0.107:8554/live')
    expect(JSON.stringify(res.json)).not.toContain(PASSWORD)
  })

  it('exposes the discovered profiles', async () => {
    const { bridge } = makeBridge()
    const res = await connect(bridge)
    expect(res.json.profiles).toHaveLength(2)
    expect(res.json.profiles[0]).toMatchObject({ token: 'PROFILE_000', width: 2560, height: 1440, fps: 15 })
  })
})

describe('bridge — PTZ without capability discovery', () => {
  it('moves even though the camera reports capabilities.PTZ === false', async () => {
    const { bridge, cam } = makeBridge()
    await connect(bridge)
    const res = await bridge.dispatch({
      method: 'POST',
      pathname: `/cameras/${CONFIG.id}/ptz/move`,
      body: { x: 0.2, y: 0, zoom: 0, timeoutMs: 300 },
    })
    expect(res.status).toBe(200)
    expect(res.json.ptzSupport).toBe('available')
    const move = cam.calls.filter(([name]) => name === 'continuousMove').at(-1)
    expect(move[1]).toMatchObject({ x: 0.2, y: 0, zoom: 0, timeout: 300 })
  })

  it('stops', async () => {
    const { bridge, cam } = makeBridge()
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/stop` })
    expect(res.status).toBe(200)
    expect(cam.calls.some(([name, args]) => name === 'stop' && args.panTilt && args.zoom)).toBe(true)
  })

  it('clamps the velocity vector', async () => {
    const { bridge, cam } = makeBridge()
    await connect(bridge)
    await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/move`, body: { x: 12, y: -9, zoom: 4 } })
    const move = cam.calls.filter(([name]) => name === 'continuousMove').at(-1)
    expect(move[1]).toMatchObject({ x: 1, y: -1, zoom: 1 })
  })

  it('keeps PTZ usable when GetStatus answers "Action Not Implemented"', async () => {
    const { bridge } = makeBridge()
    await connect(bridge)
    const status = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/ptz/status` })
    // Not an error: the camera simply will not say where it is pointing.
    expect(status.status).toBe(200)
    expect(status.json.supported).toBe(false)
    expect(status.json.reason).toMatch(/not implemented/i)

    const view = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}` })
    expect(view.json.ptz).toBe(true)
    expect(view.json.ptzSupport).toBe('available')

    const move = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/move`, body: { x: 0.2 } })
    expect(move.status).toBe(200)
  })

  it('marks PTZ unavailable only when ContinuousMove itself is not implemented', async () => {
    const cam = makeCam({
      continuousMove: async () => { throw new Error('ONVIF SOAP Fault: Action Not Implemented') },
    })
    const { bridge } = makeBridge({ cam })
    await connect(bridge)

    const res = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/move`, body: { x: 0.2 } })
    expect(res.status).toBe(501)
    expect(res.json.ptzSupport).toBe('unavailable')

    const view = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}` })
    expect(view.json.ptz).toBe(false)
    expect(view.json.ptzSupport).toBe('unavailable')
  })

  it('leaves support "unknown" when the probe fails for an unrelated reason', async () => {
    const cam = makeCam({ continuousMove: async () => { throw new Error('socket hang up') } })
    const { bridge } = makeBridge({ cam })
    const res = await connect(bridge)
    expect(res.json.ptzSupport).toBe('unknown')
    // Unknown is not "no": the controls stay reachable.
    expect(res.json.ptz).toBe(true)
  })

  it('does not demote PTZ when only Stop is unimplemented', async () => {
    const cam = makeCam({ stop: async () => { throw new Error('Action Not Implemented') } })
    const { bridge } = makeBridge({ cam })
    await connect(bridge)
    await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/move`, body: { x: 0.2 } })
    const stop = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/ptz/stop` })
    expect(stop.status).toBe(501)
    const view = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}` })
    expect(view.json.ptzSupport).toBe('available')
  })

  it('answers presets as unsupported instead of failing the camera', async () => {
    const cam = makeCam({ getPresets: async () => { throw new Error('Action Not Implemented') } })
    const { bridge } = makeBridge({ cam })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/ptz/presets` })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ supported: false, presets: [] })
  })
})

describe('bridge — live view', () => {
  const spawnOk = () => {
    const child = { stdout: { pipe: vi.fn() }, stderr: { resume: vi.fn() }, once: vi.fn(), kill: vi.fn() }
    return vi.fn(() => {
      // `-version` probe and the real stream share one fake.
      queueMicrotask(() => {
        const exit = child.once.mock.calls.find(([e]) => e === 'exit')
        exit?.[1](0)
      })
      return child
    })
  }

  it('offers WebRTC when a local WHEP endpoint is configured', async () => {
    const { bridge } = makeBridge({ whepTemplate: 'http://127.0.0.1:1984/api/webrtc?src={id}' })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream` })
    expect(res.json.mode).toBe('webrtc')
    expect(res.json.whepUrl).toContain('src=arenti-aussenkamera')
  })

  it('falls back to the snapshot when neither WebRTC nor ffmpeg is there', async () => {
    const spawnImpl = vi.fn(() => { throw new Error('ENOENT') })
    const { bridge } = makeBridge({ spawnImpl })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream` })
    expect(res.json.mode).toBe('snapshot')
    expect(res.json.snapshotPath).toBe(`/cameras/${CONFIG.id}/snapshot`)
    expect(res.json.reason).toMatch(/ffmpeg/i)
  })

  it('reports "none" with a reason when the camera offers no picture at all', async () => {
    const cam = makeCam({
      getStreamUri: async () => { throw new Error('nope') },
      getSnapshotUri: async () => { throw new Error('nope') },
    })
    const spawnImpl = vi.fn(() => { throw new Error('ENOENT') })
    const { bridge } = makeBridge({ cam, spawnImpl })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream` })
    expect(res.json.mode).toBe('none')
    expect(res.json.reason).toBeTruthy()
  })

  it('serves MJPEG only against a valid, camera-scoped ticket', async () => {
    const { bridge } = makeBridge({ spawnImpl: spawnOk(), token: 'tok' })
    const headers = { authorization: 'Bearer tok' }
    await connect(bridge, headers)

    const denied = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream.mjpeg`, query: {} })
    expect(denied.status).toBe(401)

    const issued = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/stream/ticket`, headers })
    expect(issued.json.ticket).toBeTruthy()

    const wrongCamera = await bridge.dispatch({ method: 'GET', pathname: '/cameras/other/stream.mjpeg', query: { ticket: issued.json.ticket } })
    expect(wrongCamera.status).toBe(401)

    const ok = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream.mjpeg`, query: { ticket: issued.json.ticket } })
    expect(ok.status).toBe(200)
    expect(ok.headers['Content-Type']).toMatch(/multipart\/x-mixed-replace/)
  })

  it('expires a stream ticket', async () => {
    let clock = 1_000
    const { bridge } = makeBridge({ spawnImpl: spawnOk(), now: () => clock })
    await connect(bridge)
    const issued = await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/stream/ticket` })
    clock += 10 * 60_000
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/stream.mjpeg`, query: { ticket: issued.json.ticket } })
    expect(res.status).toBe(401)
  })

  it('relays the ONVIF snapshot as bytes, authenticating on the bridge side', async () => {
    const seen = []
    const fetchImpl = vi.fn(async (url, init) => {
      seen.push({ url, init })
      if (seen.length === 1) {
        return {
          status: 401, ok: false,
          headers: new Headers({ 'www-authenticate': 'Digest realm="IPCAM", nonce="n1", qop="auth"' }),
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      return {
        status: 200, ok: true,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
      }
    })
    const { bridge } = makeBridge({ fetchImpl })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/snapshot` })
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('image/jpeg')
    expect([...res.buffer]).toEqual([0xff, 0xd8, 0xff, 0xd9])
    // The digest answer went out, and the password itself never did.
    expect(seen[1].init.headers.Authorization).toMatch(/^Digest /)
    expect(seen[1].init.headers.Authorization).not.toContain(PASSWORD)
  })

  it('answers 409 for a snapshot the camera does not offer', async () => {
    const cam = makeCam({ getSnapshotUri: async () => { throw new Error('nope') } })
    const { bridge } = makeBridge({ cam })
    await connect(bridge)
    const res = await bridge.dispatch({ method: 'GET', pathname: `/cameras/${CONFIG.id}/snapshot` })
    expect(res.status).toBe(409)
  })
})

describe('fetchSnapshot', () => {
  it('sends Basic when the camera asks for Basic', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push(init)
      if (calls.length === 1) {
        return { status: 401, headers: new Headers({ 'www-authenticate': 'Basic realm="cam"' }), arrayBuffer: async () => new ArrayBuffer(0) }
      }
      return { status: 200, ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }
    })
    await fetchSnapshot('http://cam/snap', { username: 'admin', password: 'pw', fetchImpl })
    expect(calls[1].headers.Authorization).toBe(`Basic ${Buffer.from('admin:pw').toString('base64')}`)
  })

  it('passes an unauthenticated snapshot straight through', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, ok: true, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }))
    const res = await fetchSnapshot('http://cam/snap', { username: 'admin', password: 'pw', fetchImpl })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('bridge — unknown camera', () => {
  it('answers 404 for a camera that was never connected', async () => {
    const { bridge } = makeBridge()
    const res = await bridge.dispatch({ method: 'GET', pathname: '/cameras/ghost' })
    expect(res.status).toBe(404)
  })

  it('forgets a camera on disconnect', async () => {
    const { bridge } = makeBridge()
    await connect(bridge)
    expect((await bridge.dispatch({ method: 'GET', pathname: '/cameras' })).json.cameras).toHaveLength(1)
    await bridge.dispatch({ method: 'POST', pathname: `/cameras/${CONFIG.id}/disconnect` })
    expect((await bridge.dispatch({ method: 'GET', pathname: '/cameras' })).json.cameras).toHaveLength(0)
  })
})
