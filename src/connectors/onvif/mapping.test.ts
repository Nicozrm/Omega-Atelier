import { describe, it, expect } from 'vitest'
import { findCapability } from '@/domain'
import { mapOnvifCamera } from './mapping'
import type { OnvifCameraInfo } from './transport'

const info: OnvifCameraInfo = {
  id: 'cam-1',
  name: 'Außenkamera',
  host: '192.168.0.107',
  connected: true,
  manufacturer: 'Arenti',
  model: 'PTZ',
  firmware: '5.6',
  ptz: true,
  snapshot: true,
  stream: true,
  profiles: [{ token: 'p1', name: 'Main', width: 2560, height: 1440, fps: 15 }],
  streamUri: 'rtsp://192.168.0.107:8554/stream',
}

describe('ONVIF mapping', () => {
  it('maps a PTZ camera to the neutral camera domain', () => {
    const d = mapOnvifCamera(info, 'onvif')
    expect(d.category).toBe('camera')
    expect(d.connectorId).toBe('onvif')
    expect(findCapability(d.capabilities, 'Camera')).toMatchObject({ streaming: true })
    expect(d.metadata).toMatchObject({ manufacturer: 'Arenti', model: 'PTZ', ptz: 'true' })
  })
})
