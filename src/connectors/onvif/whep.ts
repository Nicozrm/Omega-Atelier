/**
 * whep.ts — WHEP (WebRTC-HTTP Egress Protocol) playback.
 *
 * The lowest-latency way to get a camera picture into a browser, and the reason
 * it is first in line: the alternative that actually ships everywhere (MJPEG)
 * costs a full JPEG per frame and lands around a second behind.
 *
 * The endpoint is a local media server (go2rtc, MediaMTX) that the bridge
 * points at — never a cloud service, and never something that sees the ONVIF
 * password. WHEP itself is one HTTP round trip: POST an SDP offer, receive an
 * SDP answer.
 *
 * Everything external is injected so this can be exercised without a browser
 * WebRTC stack.
 */

export interface WhepSession {
  stream: MediaStream
  close(): void
}

export interface WhepOptions {
  /** Defaults to the browser's own RTCPeerConnection. */
  createPeerConnection?: () => RTCPeerConnection
  /** Defaults to the browser's own MediaStream (absent under jsdom). */
  createMediaStream?: () => MediaStream
  fetchImpl?: typeof fetch
  /** How long to wait for ICE gathering before posting the offer. */
  iceTimeoutMs?: number
  signal?: AbortSignal
}

/**
 * Wait for ICE gathering, but never forever.
 *
 * Non-trickle WHEP wants a complete offer; some stacks simply never reach
 * `complete` when a STUN server is unreachable, so a timeout falls back to
 * whatever candidates are already there. On a LAN those are the host
 * candidates, which is exactly what is needed.
 */
async function gatherIce(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => { if (pc.iceGatheringState === 'complete') done() }
    const timer = setTimeout(done, timeoutMs)
    pc.addEventListener('icegatheringstatechange', onChange)
  })
}

export async function startWhep(url: string, options: WhepOptions = {}): Promise<WhepSession> {
  const {
    createPeerConnection = () => new RTCPeerConnection({ iceServers: [] }),
    createMediaStream = () => new MediaStream(),
    fetchImpl = fetch.bind(globalThis),
    iceTimeoutMs = 1500,
    signal,
  } = options

  const pc = createPeerConnection()
  const remote = createMediaStream()

  pc.addEventListener('track', (event) => {
    const ev = event as RTCTrackEvent
    for (const track of ev.streams[0]?.getTracks() ?? [ev.track]) remote.addTrack(track)
  })

  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })

  const close = () => {
    try { pc.close() } catch { /* already gone */ }
  }

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await gatherIce(pc, iceTimeoutMs)

    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription?.sdp ?? offer.sdp ?? '',
      signal,
    })
    if (!response.ok) throw new Error(`WHEP-Endpunkt antwortete mit HTTP ${response.status}`)

    const answer = await response.text()
    if (!answer.trim()) throw new Error('WHEP-Endpunkt lieferte kein SDP')
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
  } catch (error) {
    close()
    throw error instanceof Error ? error : new Error('WebRTC-Verbindung fehlgeschlagen')
  }

  return { stream: remote, close }
}
