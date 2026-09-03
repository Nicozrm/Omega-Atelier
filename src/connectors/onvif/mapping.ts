/**
 * mapping.ts — ONVIF -> Omega neutral domain translation.
 *
 * No ONVIF types escape this module into the Digital Twin. What crosses is a
 * `Device` with capabilities plus a few metadata strings — including the PTZ
 * verdict, so the UI can decide whether to offer controls without ever asking
 * the camera itself.
 */

import type { Capability, CameraCapability, Device } from '@/domain'
import type { OnvifCameraInfo, OnvifPtzSupport } from './transport'

const cameraCapability = (info: OnvifCameraInfo): CameraCapability => ({
  kind: 'Camera',
  access: 'read',
  streaming: info.connected && info.stream,
})

/** Bridges older than the PTZ probe only sent the boolean; keep them working. */
export function ptzSupportOf(info: OnvifCameraInfo): OnvifPtzSupport {
  if (info.ptzSupport) return info.ptzSupport
  return info.ptz ? 'unknown' : 'unavailable'
}

/** The best resolution the camera advertises, as a display string. */
export function bestProfileLabel(info: OnvifCameraInfo): string | undefined {
  const sized = info.profiles.filter((p) => p.width && p.height)
  if (sized.length === 0) return undefined
  const best = sized.reduce((a, b) => (a.width! * a.height! >= b.width! * b.height! ? a : b))
  const fps = best.fps ? ` · ${best.fps} FPS` : ''
  return `${best.width} × ${best.height}${fps}`
}

export function mapOnvifCamera(info: OnvifCameraInfo, connectorId: string): Device {
  const caps: Capability[] = [
    cameraCapability(info),
  ]
  const support = ptzSupportOf(info)
  const resolution = bestProfileLabel(info)

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
      ...(resolution ? { resolution } : {}),
      ...(info.ptzMessage ? { ptzMessage: info.ptzMessage } : {}),
      onvif: 'true',
      /*
       * `ptz` stays a string boolean for existing readers, but it now means
       * "not known to be absent". `ptzSupport` carries the three-valued truth:
       * a camera whose PTZ service is undiscoverable is 'unknown', not 'false',
       * and only a ContinuousMove that answers "Action Not Implemented" makes
       * it 'unavailable'.
       */
      ptz: String(support !== 'unavailable'),
      ptzSupport: support,
      snapshot: String(info.snapshot),
      // Informational. The browser never plays this; the bridge consumes it.
      stream: info.streamUri ?? '',
    },
    health: {
      reachability: info.connected ? 'online' : 'offline',
      lastSeen: info.connected ? new Date().toISOString() : undefined,
    },
  }
}
