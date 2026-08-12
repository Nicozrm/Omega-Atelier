import { describe, it, expect } from 'vitest'
import { degradeLiveView, liveViewMessage } from './liveView'
import type { OnvifStreamInfo } from './transport'

const info = (over: Partial<OnvifStreamInfo> = {}): OnvifStreamInfo => ({
  mode: 'webrtc', cameraId: 'cam', snapshot: true,
  mjpegPath: '/cameras/cam/stream.mjpeg',
  snapshotPath: '/cameras/cam/snapshot',
  ...over,
})

describe('live-view fallback ladder', () => {
  it('drops WebRTC to MJPEG, then to snapshot', () => {
    expect(degradeLiveView('webrtc', info(), 'kein WebRTC')).toEqual({ mode: 'mjpeg', reason: 'kein WebRTC' })
    expect(degradeLiveView('mjpeg', info(), 'Stream weg')).toEqual({ mode: 'snapshot', reason: 'Stream weg' })
  })

  it('skips a rung the bridge does not offer', () => {
    expect(degradeLiveView('webrtc', info({ mjpegPath: undefined }), 'x').mode).toBe('snapshot')
    expect(degradeLiveView('webrtc', info({ mjpegPath: undefined, snapshotPath: undefined, snapshot: false }), 'x').mode).toBe('none')
  })

  it('ends at "none" and never loops', () => {
    expect(degradeLiveView('snapshot', info(), 'Snapshot kaputt').mode).toBe('none')
    expect(degradeLiveView('none', info(), 'x').mode).toBe('none')
  })

  it('always carries a reason downward', () => {
    expect(degradeLiveView('mjpeg', info(), 'ffmpeg beendet').reason).toBe('ffmpeg beendet')
  })

  it('says "Live-Stream nicht verfügbar" instead of showing nothing', () => {
    expect(liveViewMessage({ mode: 'none' })).toBe('Live-Stream nicht verfügbar')
    expect(liveViewMessage({ mode: 'none', reason: 'ffmpeg fehlt' })).toContain('ffmpeg fehlt')
    expect(liveViewMessage({ mode: 'snapshot' })).toMatch(/Live-Stream nicht verfügbar/)
    expect(liveViewMessage({ mode: 'webrtc' })).toMatch(/WebRTC/)
    expect(liveViewMessage({ mode: 'mjpeg' })).toMatch(/MJPEG/)
  })
})
