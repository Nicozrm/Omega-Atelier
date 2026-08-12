/**
 * mapping.ts — ONVIF -> Omega neutral domain translation.
 *
 * No ONVIF types escape this module into the Digital Twin.
 */

import type { Capability, CameraCapability, Device } from '@/domain'
import type { OnvifCameraInfo } from './transport'

const cameraCapability = (info: OnvifCameraInfo): CameraCapability => ({
  kind: 'Camera',
  access: 'read',
  streaming: info.connected && info.stream,
})

export function mapOnvifCamera(info: OnvifCameraInfo, connectorId: string): Device {
  const caps: Capability[] = [
    cameraCapability(info),
  ]

  return {
    id: info.id,
    connectorId,
    category: 'camera',
    name: info.name || info.model || info.id,
    capabilities: caps,
    metadata: {
      ...(info.manufacturer ? { manufacturer: info.manufacturer } : {}),
      ...(info.model ? { model: info.model } : {}),
      ...(info.firmware ? { firmware: info.firmware } : {}),
      ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
      onvif: 'true',
      ptz: String(info.ptz),
      stream: info.streamUri ?? '',
    },
    health: {
      reachability: info.connected ? 'online' : 'offline',
      lastSeen: info.connected ? new Date().toISOString() : undefined,
    },
  }
}
