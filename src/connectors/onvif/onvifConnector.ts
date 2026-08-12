/**
 * onvifConnector.ts — generic ONVIF camera connector.
 *
 * It implements the existing neutral Connector contract. PTZ is exposed as a
 * Camera command payload so the domain does not need an ONVIF-specific type:
 *
 * { capability: 'Camera', payload: { action: 'ptz', x, y, zoom, timeoutMs } }
 * { capability: 'Camera', payload: { action: 'stop' } }
 * { capability: 'Camera', payload: { action: 'gotoPreset', token } }
 * { capability: 'Camera', payload: { action: 'home' } }
 */

import type {
  Connector, ConnectorHealth, ConnectorStatus, Device,
  DeviceCommand, DeviceUpdate, Unsubscribe,
} from '@/domain'
import type { OnvifCameraConfig, OnvifTransport } from './transport'
import { mapOnvifCamera } from './mapping'
import { registerOnvifTransport, unregisterOnvifTransport } from './registry'

export interface OnvifConnectorOptions {
  id?: string
  label?: string
  transport: OnvifTransport
  cameras?: OnvifCameraConfig[]
  /** Poll interval for health/status refresh. Default 5000 ms. */
  pollMs?: number
}

type CameraAction = 'ptz' | 'stop' | 'gotoPreset' | 'home'

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

const clampVelocity = (v: number): number => Math.max(-1, Math.min(1, v))

export function createOnvifConnector(opts: OnvifConnectorOptions): Connector {
  const id = opts.id ?? 'onvif'
  const label = opts.label ?? 'ONVIF Cameras'
  const pollMs = opts.pollMs ?? 5000
  const transport = opts.transport
  const configured = new Map((opts.cameras ?? []).map((c) => [c.id, c]))

  // The live viewer needs *this* bridge (and its token) to fetch snapshot
  // bytes and MJPEG tickets. The Device stays neutral; the widget looks the
  // transport up by connector id instead.
  registerOnvifTransport(id, transport)

  let status: ConnectorStatus = 'disconnected'
  let message: string | undefined
  let lastSync: string | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let onUpdate: ((u: DeviceUpdate) => void) | undefined
  let statusListener: ((h: ConnectorHealth) => void) | undefined
  const signatures = new Map<string, string>()

  const health = (): ConnectorHealth => ({ status, message, lastSync })
  const setStatus = (next: ConnectorStatus, msg?: string): void => {
    status = next
    message = msg
    statusListener?.(health())
  }

  const snapshot = async (): Promise<Device[]> => {
    const infos = await transport.list()
    const devices = infos.map((info) => mapOnvifCamera(info, id))
    lastSync = new Date().toISOString()

    for (const d of devices) {
      const sig = JSON.stringify([d.capabilities, d.health, d.metadata])
      if (signatures.get(d.id) !== sig) {
        signatures.set(d.id, sig)
        onUpdate?.({
          deviceId: d.id,
          capabilities: d.capabilities,
          health: d.health,
          // Carries the PTZ verdict, which the bridge revises as it learns.
          metadata: d.metadata,
        })
      }
    }

    return devices
  }

  const poll = async (): Promise<void> => {
    try {
      await snapshot()
      if (status !== 'connected') setStatus('connected')
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : 'ONVIF-Abfrage fehlgeschlagen')
    }
  }

  return {
    info: { id, label },

    async connect(): Promise<void> {
      setStatus('connecting')
      try {
        for (const config of configured.values()) await transport.connect(config)
        await snapshot()
        setStatus('connected')
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : 'ONVIF-Verbindung fehlgeschlagen')
        throw error
      }
    },

    async disconnect(): Promise<void> {
      if (timer) { clearInterval(timer); timer = undefined }
      onUpdate = undefined
      for (const config of configured.values()) {
        try { await transport.disconnect(config.id) } catch { /* best effort */ }
      }
      signatures.clear()
      unregisterOnvifTransport(id)
      setStatus('disconnected')
    },

    async discover(): Promise<Device[]> {
      return snapshot()
    },

    async synchronize(): Promise<Device[]> {
      return snapshot()
    },

    subscribe(handler: (u: DeviceUpdate) => void): Unsubscribe {
      onUpdate = handler
      if (!timer) timer = setInterval(() => void poll(), pollMs)
      return () => {
        onUpdate = undefined
        if (timer) { clearInterval(timer); timer = undefined }
      }
    },

    async publish(command: DeviceCommand): Promise<void> {
      if (command.capability !== 'Camera') return

      const action = String(command.payload.action ?? '') as CameraAction
      try {
        switch (action) {
          case 'ptz': {
            await transport.move(command.deviceId, {
              x: clampVelocity(num(command.payload.x)),
              y: clampVelocity(num(command.payload.y)),
              zoom: clampVelocity(num(command.payload.zoom)),
              timeoutMs: Math.max(0, num(command.payload.timeoutMs, 500)),
            })
            break
          }
          case 'stop':
            await transport.stop(command.deviceId)
            break
          case 'gotoPreset': {
            const token = String(command.payload.token ?? '')
            if (!token) throw new Error('ONVIF preset token fehlt')
            await transport.gotoPreset(command.deviceId, token)
            break
          }
          case 'home':
            await transport.home(command.deviceId)
            break
          default:
            throw new Error(`Unbekannter ONVIF-Kamerabefehl: ${action || '(leer)'}`)
        }
      } catch (error) {
        /*
         * A rejected move is also an answer: the bridge has just learned that
         * ContinuousMove is not implemented, and the device metadata now says
         * so. Re-reading it here means the controls disappear on the failed
         * attempt rather than one poll interval later.
         */
        try {
          const info = await transport.get(command.deviceId)
          const device = mapOnvifCamera(info, id)
          onUpdate?.({
            deviceId: command.deviceId,
            capabilities: device.capabilities,
            health: device.health,
            metadata: device.metadata,
          })
        } catch { /* the original failure is the one worth reporting */ }
        throw error
      }

      // PTZ movement does not necessarily change the neutral Camera capability.
      // Emit a fresh capability object so the existing TwinManager command
      // confirmation mechanism can acknowledge the physical command without
      // adding ONVIF-specific state to the domain.
      const info = await transport.get(command.deviceId)
      const device = mapOnvifCamera(info, id)
      onUpdate?.({
        deviceId: command.deviceId,
        capabilities: device.capabilities,
        health: device.health,
        metadata: device.metadata,
      })
    },

    health,

    onStatus(listener: (h: ConnectorHealth) => void): Unsubscribe {
      statusListener = listener
      return () => { if (statusListener === listener) statusListener = undefined }
    },
  }
}
