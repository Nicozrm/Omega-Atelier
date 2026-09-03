/**
 * CameraLiveView — the camera device card, turned into an actual viewer.
 *
 * Until now a connected ONVIF camera showed a "Live" chip and nothing else,
 * because the only address anyone had was RTSP and no browser plays RTSP. The
 * picture therefore comes from the local bridge, in this order:
 *
 *   WebRTC (WHEP)  lowest latency, when a local media server is configured
 *   MJPEG          ffmpeg remux — an <img> plays it, no extra infrastructure
 *   Snapshot       ONVIF still image, polled; always the last resort
 *
 * and if none of them can start, the card says so in words and offers a
 * snapshot, rather than showing a black rectangle.
 *
 * PTZ sits underneath, and only when the camera has not *proven* it cannot
 * pan/tilt/zoom — a camera that reports no PTZ service and faults on GetStatus
 * may still serve ContinuousMove, so those two are no longer allowed to hide
 * the controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Square, Home, Camera, AlertCircle, Loader2, RefreshCw, Video,
} from 'lucide-react'
import type { Device } from '@/domain'
import { getOnvifTransport, type OnvifPreset, type OnvifStreamInfo } from '@/connectors/onvif'
import type { OnvifBridgeHealth } from '@/connectors/onvif/transport'
import {
  bridgeCanSnapshot, degradeLiveView, diagnoseStreamFailure, liveViewMessage, type LiveViewState,
} from '@/connectors/onvif/liveView'
import { startWhep, type WhepSession } from '@/connectors/onvif/whep'

/** How often the snapshot fallback refreshes. Slow on purpose — it is a fallback. */
const SNAPSHOT_INTERVAL_MS = 2000
/** Velocity used by the arrow pad. */
const PAN_SPEED = 0.5
const ZOOM_SPEED = 0.5

export interface CameraLiveViewProps {
  device: Device
  /** Routed through the twin so the command gets the usual confirmation mask. */
  onPtz: (device: Device, x: number, y: number, zoom?: number) => void
}

type Phase = 'idle' | 'loading' | 'live' | 'failed'

export function CameraLiveView({ device, onPtz }: CameraLiveViewProps) {
  const transport = getOnvifTransport(device.connectorId)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [info, setInfo] = useState<OnvifStreamInfo | null>(null)
  const [view, setView] = useState<LiveViewState>({ mode: 'none' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [mjpegSrc, setMjpegSrc] = useState<string | null>(null)
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [presets, setPresets] = useState<OnvifPreset[]>([])
  const [statusText, setStatusText] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  /** Null until asked; `false` once the bridge proved it has no snapshot route. */
  const [health, setHealth] = useState<OnvifBridgeHealth | null | undefined>(undefined)

  const ptzSupport = device.metadata?.ptzSupport ?? (device.metadata?.ptz === 'true' ? 'unknown' : 'unavailable')
  const showPtz = ptzSupport !== 'unavailable'
  const resolution = device.metadata?.resolution
  const online = device.health.reachability === 'online'

  // ── Which mode does the bridge offer? ───────────────────────────────────
  useEffect(() => {
    if (!transport) {
      setView({ mode: 'none', reason: 'ONVIF-Bridge für dieses Gerät nicht mehr verbunden' })
      setPhase('failed')
      return
    }
    let cancelled = false
    setPhase('loading')
    setError(undefined)
    transport.stream(device.id)
      .then((next) => {
        if (cancelled) return
        setInfo(next)
        setView({ mode: next.mode, reason: next.reason })
      })
      .catch(async (e: unknown) => {
        if (cancelled) return
        /*
         * Ask the bridge what it is before blaming it. The common failure here
         * is a bridge process left running from an older checkout: it serves
         * `/cameras` fine — the camera connects, resolution and PTZ appear —
         * and 404s on `/stream` with its own German error text, which said
         * nothing about the actual fix being to restart it.
         */
        const status = (e as { status?: number })?.status
        const message = e instanceof Error ? e.message : 'Bridge nicht erreichbar'
        const reported = (await transport.health?.()) ?? null
        if (cancelled) return
        setHealth(reported)
        setView({ mode: 'none', reason: diagnoseStreamFailure({ message, status }, reported) })
        setPhase('failed')
      })
    return () => { cancelled = true }
  }, [transport, device.id, attempt])

  /** Drop one rung, keeping the reason the failing rung gave. */
  const degrade = useCallback((from: LiveViewState['mode'], reason: string) => {
    setView((current) => {
      if (current.mode !== from || !info) return current
      return degradeLiveView(from, info, reason)
    })
  }, [info])

  // ── WebRTC ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (view.mode !== 'webrtc' || !info?.whepUrl) return
    if (typeof RTCPeerConnection === 'undefined') {
      degrade('webrtc', 'Dieser Browser unterstützt kein WebRTC')
      return
    }
    let session: WhepSession | undefined
    let cancelled = false
    // Captured for the cleanup: by then the ref may already point elsewhere.
    const element = videoRef.current
    setPhase('loading')
    startWhep(info.whepUrl)
      .then((next) => {
        if (cancelled) { next.close(); return }
        session = next
        if (videoRef.current) videoRef.current.srcObject = next.stream
        setPhase('live')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        degrade('webrtc', e instanceof Error ? e.message : 'WebRTC fehlgeschlagen')
      })
    return () => {
      cancelled = true
      session?.close()
      if (element) element.srcObject = null
    }
  }, [view.mode, info?.whepUrl, degrade, info])

  // ── MJPEG ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (view.mode !== 'mjpeg' || !transport) return
    let cancelled = false
    setPhase('loading')
    transport.streamTicket(device.id)
      .then(({ ticket }) => {
        if (cancelled) return
        // A media tag cannot send the bridge token, hence the short-lived
        // ticket in the URL instead.
        setMjpegSrc(transport.mjpegUrl(device.id, ticket))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        degrade('mjpeg', e instanceof Error ? e.message : 'Stream-Ticket abgelehnt')
      })
    return () => { cancelled = true; setMjpegSrc(null) }
  }, [view.mode, transport, device.id, degrade])

  // ── Snapshot (fallback, and the manual button) ──────────────────────────
  const loadSnapshot = useCallback(async (): Promise<boolean> => {
    if (!transport) return false
    try {
      const blob = await transport.snapshot(device.id)
      const url = URL.createObjectURL(blob)
      setSnapshotUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return url
      })
      setError(undefined)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Snapshot fehlgeschlagen')
      return false
    }
  }, [transport, device.id])

  useEffect(() => {
    if (view.mode !== 'snapshot') return
    let cancelled = false
    setPhase('loading')
    const tick = async () => {
      const ok = await loadSnapshot()
      if (cancelled) return
      setPhase(ok ? 'live' : 'failed')
    }
    void tick()
    const timer = setInterval(() => { void tick() }, SNAPSHOT_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [view.mode, loadSnapshot])

  useEffect(() => () => { if (snapshotUrl) URL.revokeObjectURL(snapshotUrl) }, [snapshotUrl])

  useEffect(() => {
    if (view.mode === 'none') setPhase('failed')
  }, [view.mode])

  // ── PTZ extras: presets and the (optional) status readout ───────────────
  useEffect(() => {
    if (!transport || !showPtz) return
    let cancelled = false
    transport.presets(device.id)
      .then((list) => { if (!cancelled) setPresets(list) })
      .catch(() => { if (!cancelled) setPresets([]) })
    transport.status(device.id)
      .then((status) => {
        if (cancelled) return
        /*
         * A camera that does not implement GetStatus is not a broken camera.
         * The readout says so and the controls stay exactly as they were.
         */
        setStatusText(
          status.supported && status.position
            ? `Pan ${status.position.x?.toFixed(2) ?? '–'} · Tilt ${status.position.y?.toFixed(2) ?? '–'} · Zoom ${status.position.zoom?.toFixed(2) ?? '–'}`
            : 'Position: nicht verfügbar',
        )
      })
      .catch(() => { if (!cancelled) setStatusText('Position: nicht verfügbar') })
    return () => { cancelled = true }
  }, [transport, device.id, showPtz])

  // ── Rendering ───────────────────────────────────────────────────────────

  const hold = (x: number, y: number, zoom = 0) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      onPtz(device, x, y, zoom)
    },
    onPointerUp: () => onPtz(device, 0, 0, 0),
    onPointerCancel: () => onPtz(device, 0, 0, 0),
  })

  const arrowClass = 'btn btn-sm btn-ghost btn-icon'

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <div
        className="relative overflow-hidden rounded-md border border-[color:var(--border)] bg-black"
        style={{ aspectRatio: '16 / 9' }}
      >
        {view.mode === 'webrtc' && (
          <video
            ref={videoRef}
            autoPlay muted playsInline
            className="h-full w-full object-contain"
            aria-label={`Livebild ${device.name}`}
          />
        )}

        {view.mode === 'mjpeg' && mjpegSrc && (
          <img
            src={mjpegSrc}
            alt={`Livebild ${device.name}`}
            className="h-full w-full object-contain"
            onLoad={() => setPhase('live')}
            onError={() => degrade('mjpeg', 'MJPEG-Stream abgebrochen')}
          />
        )}

        {view.mode === 'snapshot' && snapshotUrl && (
          <img src={snapshotUrl} alt={`Standbild ${device.name}`} className="h-full w-full object-contain" />
        )}

        {phase === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11px] text-white/70">
            <Loader2 size={14} className="animate-spin" /> Verbinde …
          </div>
        )}

        {(view.mode === 'none' || phase === 'failed') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <AlertCircle size={20} className="text-[#d8635f]" />
            <div className="text-[12px] font-medium text-white/90">Live-Stream nicht verfügbar</div>
            {(view.reason ?? error) && (
              <div className="text-[10px] leading-snug text-white/55">{view.reason ?? error}</div>
            )}
            <div className="mt-1 flex items-center gap-1.5">
              {/* Only when the bridge can actually serve a still. Offering it on
                  a build without the route is a second dead end from the same
                  cause — and the reason above already names that cause. */}
              {(health === undefined ? (info?.snapshot ?? true) : bridgeCanSnapshot(health)) && (
                <button
                  onClick={() => { void loadSnapshot().then((ok) => setPhase(ok ? 'live' : 'failed')) }}
                  className="btn btn-sm btn-outline inline-flex items-center gap-1.5"
                >
                  <Camera size={12} /> Snapshot laden
                </button>
              )}
              <button
                onClick={() => setAttempt((a) => a + 1)}
                className="btn btn-sm btn-ghost inline-flex items-center gap-1.5 text-white/70"
              >
                <RefreshCw size={12} /> Erneut versuchen
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] text-[color:var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <Video size={11} />
          {resolution ?? 'Auflösung unbekannt'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: online ? '#3fb27f' : '#d8635f' }}
          />
          {online ? 'Verbunden' : 'Getrennt'}
        </span>
      </div>

      <div className="text-[10px] leading-snug text-[color:var(--muted)]">{liveViewMessage(view)}</div>

      {showPtz && (
        <div className="flex flex-col items-center gap-1.5 border-t border-[color:var(--border)] pt-2">
          <button className={arrowClass} aria-label="Kamera hoch" {...hold(0, PAN_SPEED)}><ChevronUp size={14} /></button>
          <div className="flex items-center gap-1.5">
            <button className={arrowClass} aria-label="Kamera links" {...hold(-PAN_SPEED, 0)}><ChevronLeft size={14} /></button>
            <button
              onClick={() => onPtz(device, 0, 0, 0)}
              className="btn btn-sm btn-ghost btn-icon"
              aria-label="Kamera stoppen"
            ><Square size={12} /></button>
            <button className={arrowClass} aria-label="Kamera rechts" {...hold(PAN_SPEED, 0)}><ChevronRight size={14} /></button>
          </div>
          <button className={arrowClass} aria-label="Kamera runter" {...hold(0, -PAN_SPEED)}><ChevronDown size={14} /></button>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
            <button className={arrowClass} aria-label="Zoom heraus" {...hold(0, 0, -ZOOM_SPEED)}><ZoomOut size={14} /></button>
            <button className={arrowClass} aria-label="Zoom hinein" {...hold(0, 0, ZOOM_SPEED)}><ZoomIn size={14} /></button>
            <button
              onClick={() => onPtz(device, 0, 0, 0)}
              className="btn btn-sm btn-outline text-[10px]"
              aria-label="PTZ Stop"
            >STOP</button>
            <button
              onClick={() => { transport?.home(device.id).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Home fehlgeschlagen')) }}
              className="btn btn-sm btn-ghost inline-flex items-center gap-1 text-[10px]"
              aria-label="Kamera Grundstellung"
            ><Home size={11} /> Home</button>
          </div>

          {presets.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.token}
                  onClick={() => { transport?.gotoPreset(device.id, p.token).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Preset fehlgeschlagen')) }}
                  className="btn btn-sm btn-ghost text-[10px]"
                >{p.name || p.token}</button>
              ))}
            </div>
          )}

          <div className="text-[10px] text-[color:var(--muted)]">
            {statusText ?? 'Position: nicht verfügbar'}
            {ptzSupport === 'unknown' && ' · PTZ noch nicht bestätigt'}
          </div>
        </div>
      )}
    </div>
  )
}
