import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpOnvifTransport } from './transport'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('HttpOnvifTransport — bridge URL handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ cameras: [] }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('normalises a pasted API URL into the base URL', async () => {
    const t = new HttpOnvifTransport('http://127.0.0.1:8787/cameras/connect')
    expect(t.baseUrl).toBe('http://127.0.0.1:8787')
    await t.list()
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/cameras')
  })

  it('builds every route on the base URL', async () => {
    const t = new HttpOnvifTransport('http://127.0.0.1:8787/')
    await t.move('arenti aussen', { x: 0.2, timeoutMs: 300 })
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/cameras/arenti%20aussen/ptz/move')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ x: 0.2, timeoutMs: 300 })
  })

  it('falls back to the default bridge when the field is empty', () => {
    expect(new HttpOnvifTransport('').baseUrl).toBe('http://127.0.0.1:8787')
  })

  it('sends the bridge token as a bearer header', async () => {
    const t = new HttpOnvifTransport('http://127.0.0.1:8787', 'tok')
    await t.list()
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })

  it('omits the Authorization header when no token is configured', async () => {
    const t = new HttpOnvifTransport('http://127.0.0.1:8787')
    await t.list()
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBeNull()
  })

  it('surfaces the bridge error message rather than the status code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Kamera meldet ONVIF SOAP Fault' }, 502))
    const t = new HttpOnvifTransport('http://127.0.0.1:8787')
    await expect(t.get('cam')).rejects.toThrow('Kamera meldet ONVIF SOAP Fault')
  })
})

describe('HttpOnvifTransport — live view', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the stream descriptor from the bridge', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      mode: 'mjpeg', cameraId: 'cam', snapshot: true,
      mjpegPath: '/cameras/cam/stream.mjpeg', rtspUri: 'rtsp://192.168.0.107:8554/Streaming/Channels/101',
    }))
    vi.stubGlobal('fetch', fetchMock)
    const info = await new HttpOnvifTransport('http://127.0.0.1:8787').stream('cam')
    expect(info.mode).toBe('mjpeg')
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8787/cameras/cam/stream')
  })

  it('carries the ticket, not the token, in the MJPEG URL', () => {
    const t = new HttpOnvifTransport('http://127.0.0.1:8787', 'super-secret-token')
    const url = t.mjpegUrl('cam', 'tick et')
    expect(url).toBe('http://127.0.0.1:8787/cameras/cam/stream.mjpeg?ticket=tick%20et')
    expect(url).not.toContain('super-secret-token')
  })

  it('fetches snapshot bytes with the bearer header', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8]), {
      status: 200, headers: { 'Content-Type': 'image/jpeg' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = await new HttpOnvifTransport('http://127.0.0.1:8787', 'tok').snapshot('cam')
    expect(blob.type).toBe('image/jpeg')
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Bearer tok')
  })

  it('reports why a snapshot failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Kamera liefert keinen ONVIF-Snapshot' }, 409)))
    await expect(new HttpOnvifTransport('http://127.0.0.1:8787').snapshot('cam'))
      .rejects.toThrow('Kamera liefert keinen ONVIF-Snapshot')
  })
})
