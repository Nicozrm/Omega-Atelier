/**
 * CameraPanel — the camera entry point that did not exist.
 *
 * A connected Arenti/ONVIF camera used to be reachable only by switching the
 * Digital Twin to the "Geräte" tab and finding its card among everything else —
 * and in the default "Grundriss" view it was a dot on the floorplan and nothing
 * more. The connection worked; the camera function was, in practice, missing.
 *
 * This panel is that function: every device in the twin that *really* exposes a
 * `Camera` capability, in one place, with the live viewer attached. It is
 * derived from the twin, so it can never list a camera that is not there — and
 * the shortcut that opens it is rendered only when this list is non-empty.
 *
 * Cameras whose connector cannot deliver a picture (a simulated ecosystem, a
 * cloud without a stream path) are listed and labelled as such rather than
 * given a viewer that would show a black rectangle.
 */

import { useState } from 'react'
import { Video, X, AlertTriangle } from 'lucide-react'
import { hasCapability, type Device } from '@/domain'
import { CameraLiveView } from './CameraLiveView'

/** Devices with a real Camera capability. The only source of truth for cameras. */
export function cameraDevices(devices: Device[]): Device[] {
  return devices.filter((d) => hasCapability(d.capabilities, 'Camera'))
}

/** Can this camera actually produce a picture? Only the ONVIF path can today. */
export function hasLiveView(device: Device): boolean {
  return device.metadata?.onvif === 'true'
}

export function CameraPanel({ devices, initialDeviceId, onPtz, onClose }: {
  devices: Device[]
  initialDeviceId?: string
  onPtz: (device: Device, x: number, y: number, zoom?: number) => void
  onClose: () => void
}) {
  const cameras = cameraDevices(devices)
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialDeviceId ?? cameras[0]?.id,
  )
  const selected = cameras.find((c) => c.id === selectedId) ?? cameras[0]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center scrim p-4 animate-fade-in">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <Video size={17} className="text-[color:var(--accent)]" />
            <div>
              <div className="font-display text-[15px] font-semibold">Kameras</div>
              <div className="text-[11px] text-[color:var(--muted)]">
                {cameras.length} {cameras.length === 1 ? 'erkannte Kamera' : 'erkannte Kameras'} im Twin
              </div>
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Schließen"><X size={16} /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto omega-scroll px-5 py-4">
          {cameras.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[color:var(--border)] p-8 text-center text-[12px] text-[color:var(--muted)]">
              Keine Kamera erkannt. Verbinde eine ONVIF-Kamera unter „Echte Verbindung".
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cameras.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {cameras.map((camera) => (
                    <button
                      key={camera.id}
                      onClick={() => setSelectedId(camera.id)}
                      className={`spring-press rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                        selected?.id === camera.id
                          ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                          : 'border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >{camera.name}</button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-[13px] font-medium">{selected.name}</div>
                    <span className="text-[10px] text-[color:var(--muted)]">
                      {selected.metadata?.manufacturer ?? selected.metadata?.model ?? selected.connectorId}
                    </span>
                  </div>

                  {hasLiveView(selected) ? (
                    <CameraLiveView device={selected} onPtz={onPtz} />
                  ) : (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-[color:var(--border)] p-3 text-[11px] leading-snug text-[color:var(--muted)]">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#e0a23c]" />
                      <span>
                        Diese Kamera meldet zwar eine Kamera-Fähigkeit, ihre Quelle liefert aber keinen
                        Bildpfad. Ein Livebild gibt es nur über den ONVIF-Connector mit laufender Bridge.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
