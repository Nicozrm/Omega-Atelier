import { describe, it, expect, vi } from 'vitest'
import { startWhep } from './whep'

class FakePeerConnection {
  iceGatheringState = 'complete'
  localDescription: { type: string; sdp: string } | null = null
  remote: { type: string; sdp: string } | null = null
  closed = false
  transceivers: string[] = []
  private listeners = new Map<string, Array<(e: unknown) => void>>()

  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  removeEventListener() { /* not needed for these tests */ }
  emit(type: string, event: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(event) }
  addTransceiver(kind: string) { this.transceivers.push(kind) }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\noffer' } }
  async setLocalDescription(d: { type: string; sdp: string }) { this.localDescription = d }
  async setRemoteDescription(d: { type: string; sdp: string }) { this.remote = d }
  close() { this.closed = true }
}

/** jsdom has no MediaStream; the container is injected for exactly that reason. */
const fakeStream = () => ({ tracks: [] as unknown[], addTrack(t: unknown) { this.tracks.push(t) } })

const makePc = () => {
  const pc = new FakePeerConnection()
  const stream = fakeStream()
  return {
    pc,
    stream,
    create: () => pc as unknown as RTCPeerConnection,
    createStream: () => stream as unknown as MediaStream,
  }
}

describe('WHEP playback', () => {
  it('posts the SDP offer and applies the answer', async () => {
    const { pc, stream, create, createStream } = makePc()
    const fetchImpl = vi.fn(async () => new Response('v=0\r\nanswer', { status: 200 }))
    const session = await startWhep('http://127.0.0.1:1984/api/webrtc?src=cam', {
      createPeerConnection: create,
      createMediaStream: createStream,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:1984/api/webrtc?src=cam')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/sdp')
    expect(init.body).toContain('offer')
    expect(pc.remote).toEqual({ type: 'answer', sdp: 'v=0\r\nanswer' })
    expect(pc.transceivers).toEqual(['video', 'audio'])
    expect(session.stream).toBe(stream as unknown as MediaStream)
  })

  it('closes the peer connection when the endpoint refuses', async () => {
    const { pc, create, createStream } = makePc()
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }))
    await expect(startWhep('http://127.0.0.1:1984/api/webrtc', {
      createPeerConnection: create,
      createMediaStream: createStream,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('HTTP 404')
    // A dangling RTCPeerConnection would keep ICE running for nothing.
    expect(pc.closed).toBe(true)
  })

  it('rejects an empty SDP answer instead of waiting for a picture forever', async () => {
    const { pc, create, createStream } = makePc()
    const fetchImpl = vi.fn(async () => new Response('   ', { status: 200 }))
    await expect(startWhep('http://x', {
      createPeerConnection: create,
      createMediaStream: createStream,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow(/kein SDP/)
    expect(pc.closed).toBe(true)
  })
})
