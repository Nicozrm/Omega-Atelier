import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Bot, Play, Pause, Home, Trash2, BatteryCharging,
  Battery, Timer, Ruler, Fan, LayoutGrid, Radar,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { createDemoPlan } from '@/data/demoPlan'
import { twinManager, commandKey, type TwinSession, type CommandPhase } from '@/twin/twinManager'
import { useFailureHaptics } from '@/hooks/useFailureHaptics'
import { findCapability, type Device } from '@/domain'
import { ECOSYSTEM_SPECS, createEcosystemConnector } from '@/connectors/ecosystem'
import {
  createVacuumRun, planRooms, planCoveragePath, polygonAreaCm2, polygonCenter,
  type VacPoint, type VacuumActivity, type VacuumRun, type VacuumRunState,
} from '@/twin/vacuum'
import { decodeTuyaMap, rasterise, mapBoundsCm, type RobotMap } from '@/twin/robotMap'
import type { Room } from '@/types'

/**
 * RobotPage — the robot-vacuum control centre ("Saug- & Wischroboter").
 *
 * The LiDAR-style map is the plan's real floor plan: rooms become cleaning
 * zones, the serpentine coverage path is planned per room, and a live run
 * paints the cleaned stroke while the robot drives. Control flows through the
 * Digital Twin: every button publishes a real `Vacuum` connector command
 * (Tuya), the twin's device update drives the run — so a live Tuya/Matter
 * bridge slots in without touching this page.
 */

const LANE_CM = 26
const MARGIN_CM = 16
const TRAIL = '#35c2a2'
const TUYA = ECOSYSTEM_SPECS.find((s) => s.id === 'eco-tuya')!

/** Suction levels: pace + drain, applied live to the run. */
const SUCTION = [
  { key: 'quiet', label: 'Leise', speedCmS: 24, drainPerS: 0.016 },
  { key: 'standard', label: 'Standard', speedCmS: 30, drainPerS: 0.026 },
  { key: 'turbo', label: 'Turbo', speedCmS: 36, drainPerS: 0.045 },
  { key: 'max', label: 'Max', speedCmS: 42, drainPerS: 0.07 },
] as const
type SuctionKey = (typeof SUCTION)[number]['key']

const ROOM_FILLS = ['#67b8ab', '#7d9fd6', '#d6ae67', '#a58bdd', '#7fbf88', '#d68f85', '#8fb3c9']

/** Human source label + accent for a vacuum, by owning connector id. */
function vacuumSource(connectorId: string): { label: string; color: string } {
  if (connectorId === 'home-assistant-live') return { label: 'Home Assistant', color: '#41bd84' }
  if (connectorId === 'home-assistant') return { label: 'Home Assistant', color: '#C7A24E' }
  if (connectorId === 'tuya-cloud-live') return { label: 'Tuya Cloud', color: '#ff5b00' }
  if (connectorId === 'mqtt') return { label: 'MQTT', color: '#16a766' }
  const spec = ECOSYSTEM_SPECS.find((s) => s.id === connectorId)
  if (spec) return { label: spec.label, color: spec.color }
  return { label: connectorId, color: '#8B8478' }
}

type Tab = 'all' | 'room' | 'zone'
interface ZoneRect { x: number; y: number; w: number; h: number }

const de1 = (n: number): string => n.toFixed(1).replace('.', ',')

/** Dock position: just inside the largest room, off its first corner. */
function dockFor(rooms: Room[]): VacPoint {
  if (rooms.length === 0) return { x: 0, y: 0 }
  const largest = rooms.reduce((a, b) => (polygonAreaCm2(b.polygon) > polygonAreaCm2(a.polygon) ? b : a))
  const v0 = largest.polygon[0]
  const c = polygonCenter(largest.polygon)
  const len = Math.hypot(c.x - v0.x, c.y - v0.y) || 1
  return { x: v0.x + ((c.x - v0.x) / len) * 55, y: v0.y + ((c.y - v0.y) / len) * 55 }
}

const zonePolygon = (z: ZoneRect): VacPoint[] => [
  { x: z.x, y: z.y }, { x: z.x + z.w, y: z.y },
  { x: z.x + z.w, y: z.y + z.h }, { x: z.x, y: z.y + z.h },
]

export function RobotPage() {
  const doc = usePlanStore((s) => s.doc)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const pushToast = useUIStore((s) => s.pushToast)

  // The map needs a floor plan — bootstrap the same demo plan the editor uses.
  useEffect(() => {
    if (!doc) loadDocument(createDemoPlan(), false)
  }, [doc, loadDocument])

  const rooms = useMemo<Room[]>(() => {
    const floor = doc?.floors.find((f) => f.id === doc.activeFloorId)
    return (floor?.rooms ?? []).filter((r) => r.zoneType !== 'outdoor' && r.polygon.length >= 3)
  }, [doc])
  const dock = useMemo(() => dockFor(rooms), [rooms])

  /* ── Twin wiring: ANY vacuum from ANY connector ─────────────────────────
   * The robot page is vendor-neutral. It picks up every device that exposes a
   * Vacuum capability — a live Home Assistant robot, a Matter sweeper, a real
   * Tuya Cloud robot, the demo — with no per-brand code. The eco-Tuya demo is
   * only bootstrapped when nothing else offers a robot, so HA/Matter/Tuya-live
   * users control THEIR robot without a stray simulator appearing. */
  const twin = useMemo(() => twinManager(), [])
  const [vacuums, setVacuums] = useState<Device[]>([])
  const [sessions, setSessions] = useState<TwinSession[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [commands, setCommands] = useState<Record<string, CommandPhase>>({})
  const deviceRef = useRef<Device | undefined>(undefined)
  const devActivityRef = useRef<VacuumActivity | undefined>(undefined)
  const bootstrapped = useRef(false)

  useEffect(() => {
    return twin.subscribe((view) => {
      const vs = view.devices.filter((d) => findCapability(d.capabilities, 'Vacuum'))
      setVacuums(vs)
      setSessions(view.sessions)
      setCommands(view.commands)
      // Only stand in a demo robot when the twin truly has none.
      if (!bootstrapped.current && vs.length === 0 && !twin.isActive(TUYA.id)) {
        bootstrapped.current = true
        void twin.addConnector({ label: TUYA.label, kind: TUYA.id, make: () => createEcosystemConnector(TUYA) })
      }
    })
  }, [twin])

  // The active robot: the user's pick, else a real source over the demo, else first.
  const device = useMemo<Device | undefined>(() => {
    if (selectedId) { const s = vacuums.find((d) => d.id === selectedId); if (s) return s }
    return vacuums.find((d) => d.connectorId !== TUYA.id) ?? vacuums[0]
  }, [vacuums, selectedId])
  const session = useMemo(() => sessions.find((s) => s.id === device?.connectorId), [sessions, device])

  // Keep the imperative refs the run loop reads in sync with the active device.
  useEffect(() => {
    deviceRef.current = device
    devActivityRef.current = device ? findCapability(device.capabilities, 'Vacuum')?.activity : undefined
  }, [device])

  // Failed robot commands answer with a short haptic double tap (mobile).
  useFailureHaptics(commands)

  const publish = useCallback((activity: VacuumActivity) => {
    const dev = deviceRef.current
    if (dev) void twin.command({ deviceId: dev.id, capability: 'Vacuum', payload: { activity } })
  }, [twin])

  /* ── Cleaning target: Alles / Raum / Zone ────────────────────────────── */
  const [tab, setTab] = useState<Tab>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [zone, setZone] = useState<ZoneRect | null>(null)
  const [zoneDraft, setZoneDraft] = useState<ZoneRect | null>(null)
  const [suction, setSuction] = useState<SuctionKey>('standard')
  const suctionRef = useRef<SuctionKey>('standard')

  const targetRooms = useMemo(() => {
    if (tab === 'room') return rooms.filter((r) => selected.has(r.id))
    if (tab === 'zone') return []
    return rooms
  }, [tab, rooms, selected])

  const path = useMemo<VacPoint[]>(() => {
    if (tab === 'zone') return zone ? planCoveragePath(zonePolygon(zone), LANE_CM, 10) : []
    return planRooms(targetRooms.map((r) => r.polygon), dock, LANE_CM, MARGIN_CM)
  }, [tab, zone, targetRooms, dock])

  const plannedAreaM2 = useMemo(() => {
    if (tab === 'zone') return zone ? (zone.w * zone.h) / 10_000 : 0
    return targetRooms.reduce((sum, r) => sum + polygonAreaCm2(r.polygon), 0) / 10_000
  }, [tab, zone, targetRooms])

  /* ── The run: local motion model, driven BY the twin's device state ──── */
  const runRef = useRef<VacuumRun | null>(null)
  const prevActivityRef = useRef<VacuumActivity>('docked')
  const [runState, setRunState] = useState<VacuumRunState | null>(null)
  const [emptying, setEmptying] = useState(false)
  const emptyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const activeJob = runState?.activity === 'cleaning' || runState?.activity === 'returning'

  // Rebuild the run when the target changes — never while a job is driving.
  useEffect(() => {
    const prev = runRef.current?.state()
    if (prev && (prev.activity === 'cleaning' || prev.activity === 'returning')) return
    const pace = SUCTION.find((s) => s.key === suctionRef.current)!
    const run = createVacuumRun({
      path, dock,
      // A docked robot sits on the dock — only a paused one keeps its spot
      // (the very first run otherwise inherits the pre-plan {0,0} dock).
      startPosition: prev && prev.activity !== 'docked' ? prev.position : dock,
      batteryPercent: prev?.batteryPercent ?? deviceRef.current?.battery?.percent ?? 84,
      speedCmS: pace.speedCmS, drainPerS: pace.drainPerS,
      swathCm: LANE_CM,
    })
    runRef.current = run
    prevActivityRef.current = run.state().activity
    setRunState(run.state())
  }, [path, dock])

  // Suction applies to the running job immediately.
  useEffect(() => {
    suctionRef.current = suction
    const pace = SUCTION.find((s) => s.key === suction)!
    runRef.current?.setPace({ speedCmS: pace.speedCmS, drainPerS: pace.drainPerS })
  }, [suction])

  // The twin is the source of truth: device activity drives the run.
  const devActivity = device ? findCapability(device.capabilities, 'Vacuum')?.activity : undefined
  useEffect(() => {
    const run = runRef.current
    if (!run || !devActivity) return
    const cur = run.state().activity
    if (devActivity === cur) return
    if (devActivity === 'cleaning') {
      run.start()
      // Run refused (empty plan / battery reserve) → correct the twin back.
      if (run.state().activity !== 'cleaning') publish(run.state().activity)
    } else if (devActivity === 'returning') run.returnToDock()
    else if (devActivity === 'idle') run.pause()
    else if (devActivity === 'docked' && cur !== 'docked') run.returnToDock()
  }, [devActivity, publish])

  const triggerEmpty = useCallback(() => {
    setEmptying(true)
    clearTimeout(emptyTimer.current)
    emptyTimer.current = setTimeout(() => {
      setEmptying(false)
      pushToast({ kind: 'success', title: 'Staubbehälter geleert', description: 'Die Station hat den Behälter abgesaugt.' })
    }, 4000)
  }, [pushToast])
  useEffect(() => () => clearTimeout(emptyTimer.current), [])

  // Animation loop: advance the run, propagate run-made transitions to the twin.
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const run = runRef.current
      if (run) {
        const s = run.step(dt)
        setRunState(s)
        const prev = prevActivityRef.current
        if (s.activity !== prev) {
          prevActivityRef.current = s.activity
          if ((s.activity === 'returning' || s.activity === 'docked') && devActivityRef.current !== s.activity) {
            publish(s.activity)
          }
          // Back on the dock after a real job → the station auto-empties.
          if (s.activity === 'docked' && prev === 'returning' && s.progress > 0.03) triggerEmpty()
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [publish, triggerEmpty])

  /* ── Map interaction (room select, zone drawing) ─────────────────────── */
  const svgRef = useRef<SVGSVGElement>(null)
  const dragStart = useRef<VacPoint | null>(null)
  const draftRef = useRef<ZoneRect | null>(null)

  const viewBox = useMemo(() => {
    const pts = rooms.flatMap((r) => r.polygon)
    if (pts.length === 0) return { x: 0, y: 0, w: 100, h: 100 }
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const pad = 36
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y }
  }, [rooms])

  /* ── Real robot map (decoded from device telemetry) ──────────────────── */
  // A live/simulated robot delivers its LiDAR map as a Tuya-format blob in
  // telemetry; decode it into a neutral occupancy grid + driven path.
  const robotMap = useMemo<RobotMap | null>(() => {
    const blob = device?.telemetry?.map
    if (typeof blob !== 'string') return null
    try { return decodeTuyaMap(blob) } catch { return null }
  }, [device])

  const [mapMode, setMapMode] = useState<'plan' | 'robot'>('plan')
  // Prefer the real robot map the first time one appears.
  const sawMap = useRef(false)
  useEffect(() => {
    if (robotMap && !sawMap.current) { sawMap.current = true; setMapMode('robot') }
    if (!robotMap) setMapMode('plan')
  }, [robotMap])

  /** Rasterise the occupancy grid to a pixelated data-URI once per map. */
  const mapImage = useMemo(() => {
    if (!robotMap || typeof document === 'undefined') return null
    const floor = getComputedStyle(document.documentElement).getPropertyValue('--surface-3').trim() || '#28252D'
    const wall = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#F1ECE1'
    const hexRgba = (hex: string, a: number): [number, number, number, number] => {
      const h = hex.replace('#', '')
      const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
      return [parseInt(n.slice(0, 2), 16) || 40, parseInt(n.slice(2, 4), 16) || 40, parseInt(n.slice(4, 6), 16) || 48, a]
    }
    const raster = rasterise(robotMap, {
      unknown: [0, 0, 0, 0],
      floor: hexRgba(floor, 235),
      wall: hexRgba(wall, 205),
    })
    const cv = document.createElement('canvas')
    cv.width = raster.width; cv.height = raster.height
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    const img = ctx.createImageData(raster.width, raster.height)
    img.data.set(raster.rgba)
    ctx.putImageData(img, 0, 0)
    return cv.toDataURL('image/png')
  }, [robotMap])

  const mapBounds = useMemo(() => (robotMap ? mapBoundsCm(robotMap) : null), [robotMap])
  const showRobotMap = mapMode === 'robot' && robotMap && mapImage && mapBounds

  /** Client → map cm, honouring preserveAspectRatio letterboxing. */
  const toMap = useCallback((clientX: number, clientY: number): VacPoint => {
    const svg = svgRef.current!
    const r = svg.getBoundingClientRect()
    const scale = Math.min(r.width / viewBox.w, r.height / viewBox.h)
    const ox = (r.width - viewBox.w * scale) / 2
    const oy = (r.height - viewBox.h * scale) / 2
    return { x: viewBox.x + (clientX - r.left - ox) / scale, y: viewBox.y + (clientY - r.top - oy) / scale }
  }, [viewBox])

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tab !== 'zone' || activeJob) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = toMap(e.clientX, e.clientY)
    draftRef.current = { ...dragStart.current, w: 0, h: 0 }
    setZoneDraft(draftRef.current)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragStart.current) return
    const p = toMap(e.clientX, e.clientY)
    const a = dragStart.current
    draftRef.current = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }
    setZoneDraft(draftRef.current)
  }
  const onPointerUp = () => {
    if (!dragStart.current) return
    dragStart.current = null
    const draft = draftRef.current
    draftRef.current = null
    setZoneDraft(null)
    if (draft && draft.w >= 60 && draft.h >= 60) setZone(draft)
    else pushToast({ kind: 'info', title: 'Zone zu klein', description: 'Ziehe ein Rechteck von mindestens 60 × 60 cm auf.' })
  }
  const toggleRoom = (id: string) => {
    if (tab !== 'room' || activeJob) return
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /* ── Derived presentation ────────────────────────────────────────────── */
  const battery = runState?.batteryPercent ?? device?.battery?.percent ?? 84
  const inTransit = runState?.activity === 'cleaning' && runState.trail.length === 0
  const statusText = emptying
    ? 'Staubbehälter wird entleert …'
    : runState?.activity === 'cleaning'
      ? inTransit ? 'Fährt zum Startpunkt …' : 'Reinigung läuft …'
      : runState?.activity === 'returning'
        ? 'Kehrt zur Station zurück …'
        : runState?.activity === 'idle'
          ? 'Pausiert'
          : runState && runState.progress >= 1
            ? 'Reinigung abgeschlossen'
            : 'Angedockt · Bereit'
  const connected = session?.health.status === 'connected'
  const src = device ? vacuumSource(device.connectorId) : { label: 'Roboter', color: '#8B8478' }
  const canStart = path.length >= 2 && battery > 5 && !emptying && !!device
  const targetLabel =
    tab === 'zone'
      ? zone ? `Zone · ${de1(plannedAreaM2)} m²` : 'Zone auf der Karte aufziehen'
      : tab === 'room'
        ? selected.size === 0 ? 'Räume auf der Karte antippen' : `${selected.size} ${selected.size === 1 ? 'Raum' : 'Räume'} · ${de1(plannedAreaM2)} m²`
        : `${rooms.length} Räume · ${de1(plannedAreaM2)} m²`

  const trailPoints = (runState?.trail ?? []).map((p) => `${p.x},${p.y}`).join(' ')
  const planPoints = path.map((p) => `${p.x},${p.y}`).join(' ')
  const pos = runState?.position ?? dock

  return (
    <div className="min-h-screen omega-noise">
      <header className="flex h-14 items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 safe-top">
        <Link to="/dashboard" className="btn btn-ghost btn-icon"><ArrowLeft size={16} /></Link>
        <Bot size={18} className="text-[color:var(--accent)]" />
        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight">{device?.name ?? 'Saugroboter'}</div>
          {/* Robot picker — appears only when several vacuums are connected. */}
          {vacuums.length > 1 && (
            <select
              value={device?.id ?? ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mt-0.5 max-w-[60vw] truncate rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[color:var(--muted)] outline-none"
              aria-label="Roboter auswählen"
            >
              {vacuums.map((v) => (
                <option key={v.id} value={v.id}>{v.name} · {vacuumSource(v.connectorId).label}</option>
              ))}
            </select>
          )}
        </div>
        <span
          className="ml-auto inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium"
          style={{ borderColor: `${src.color}55`, color: src.color, background: `${src.color}14` }}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? '' : 'animate-pulse'}`} style={{ background: connected ? '#3ecf8e' : src.color }} />
          {src.label} · {connected ? 'Verbunden' : 'Verbinde …'}
        </span>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5 pb-10 space-y-4">
        {/* Status + live stats — the Reinigungsfläche / Akku / Dauer row */}
        <section className="surface p-4">
          <div className="text-sm font-medium">{statusText}</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-semibold">{de1(runState?.cleanedAreaM2 ?? 0)}</span>
                <span className="text-sm text-[color:var(--muted)]">m²</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[color:var(--muted)]"><Ruler size={11} className="icon-optical" /> Reinigungsfläche</div>
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-semibold">{Math.round(battery)}</span>
                <span className="text-sm text-[color:var(--muted)]">%</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[color:var(--muted)]">
                {runState?.activity === 'docked' && battery < 100 ? <BatteryCharging size={11} className="icon-optical" /> : <Battery size={11} className="icon-optical" />} Akkustand
              </div>
            </div>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-3xl font-semibold">{Math.floor((runState?.durationS ?? 0) / 60)}</span>
                <span className="text-sm text-[color:var(--muted)]">min</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-[color:var(--muted)]"><Timer size={11} className="icon-optical" /> Reinigungsdauer</div>
            </div>
          </div>
          {activeJob && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
              <div className="h-full rounded-full transition-[width]" style={{ width: `${(runState?.progress ?? 0) * 100}%`, background: TRAIL }} />
            </div>
          )}
        </section>

        {/* The LiDAR map */}
        <section className="surface relative overflow-hidden p-2">
          {/* Plan ⇄ real-robot-map toggle (only when the robot delivers a map) */}
          {robotMap && (
            <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]/85 p-1 backdrop-blur">
              <button
                onClick={() => setMapMode('plan')}
                className={`spring-press flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${mapMode === 'plan' ? 'bg-[color:var(--accent)] text-black' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
              ><LayoutGrid size={12} /> Plan</button>
              <button
                onClick={() => setMapMode('robot')}
                className={`spring-press flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${mapMode === 'robot' ? 'bg-[color:var(--accent)] text-black' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
              ><Radar size={12} /> Roboterkarte</button>
            </div>
          )}

          {showRobotMap ? (
            <svg
              viewBox={`${mapBounds.x} ${mapBounds.y} ${mapBounds.w} ${mapBounds.h}`}
              className="block h-[46vh] min-h-[300px] w-full"
            >
              <rect x={mapBounds.x} y={mapBounds.y} width={mapBounds.w} height={mapBounds.h} fill="var(--surface-2)" />
              {/* The decoded occupancy grid, rendered pixel-crisp. */}
              <image
                href={mapImage}
                x={mapBounds.x} y={mapBounds.y} width={mapBounds.w} height={mapBounds.h}
                style={{ imageRendering: 'pixelated' }}
              />
              {/* The robot's actually-driven serpentine path. */}
              {robotMap.path.length > 1 && (
                <polyline
                  points={robotMap.path.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={TRAIL} strokeOpacity="0.9" strokeWidth={robotMap.resolutionCm * 1.1}
                  strokeLinecap="round" strokeLinejoin="round"
                />
              )}
              {/* Dock + robot at the head of the path. */}
              <g transform={`translate(${robotMap.charger.x}, ${robotMap.charger.y})`}>
                <rect x="-11" y="-11" width="22" height="22" rx="5" fill="var(--surface)" stroke={TRAIL} strokeWidth="2" />
                <path d="M1,-6 L-4,1 L-1,1 L-1,6 L4,-1 L1,-1 Z" fill={TRAIL} />
              </g>
              {robotMap.path.length > 0 && (() => {
                const head = robotMap.path[robotMap.path.length - 1]
                return (
                  <g transform={`translate(${head.x}, ${head.y})`}>
                    <circle r="16" fill={TRAIL} opacity="0.18" />
                    <circle r="9" fill="#eef7f4" stroke={TRAIL} strokeWidth="2.5" />
                    <circle r="3" fill="#22313f" />
                  </g>
                )
              })()}
            </svg>
          ) : (
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            className={`block h-[46vh] min-h-[300px] w-full ${tab === 'zone' && !activeJob ? 'cursor-crosshair' : ''}`}
            style={{ touchAction: tab === 'zone' ? 'none' : undefined }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <defs>
              <pattern id="vac-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M50 0H0V50" fill="none" stroke="var(--border)" strokeWidth="1" opacity="0.5" />
              </pattern>
              <radialGradient id="vac-scan">
                <stop offset="0%" stopColor={TRAIL} stopOpacity="0.35" />
                <stop offset="100%" stopColor={TRAIL} stopOpacity="0" />
              </radialGradient>
            </defs>

            <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="var(--surface-2)" />
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="url(#vac-grid)" />

            {/* Rooms = cleaning zones */}
            {rooms.map((room, i) => {
              const isTarget = tab === 'all' || (tab === 'room' && selected.has(room.id))
              const c = polygonCenter(room.polygon)
              return (
                <g key={room.id} onClick={() => toggleRoom(room.id)} className={tab === 'room' && !activeJob ? 'cursor-pointer' : undefined}>
                  <polygon
                    points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={ROOM_FILLS[i % ROOM_FILLS.length]}
                    fillOpacity={isTarget ? 0.26 : 0.1}
                    stroke={tab === 'room' && selected.has(room.id) ? 'var(--accent)' : 'var(--border-strong, var(--border))'}
                    strokeWidth={tab === 'room' && selected.has(room.id) ? 5 : 3}
                    strokeLinejoin="round"
                  />
                  <text x={c.x} y={c.y - 6} textAnchor="middle" fontSize="24" fontWeight="600" fill="var(--fg)" opacity="0.8" pointerEvents="none">
                    {room.name}
                  </text>
                  <text x={c.x} y={c.y + 20} textAnchor="middle" fontSize="18" fill="var(--muted)" pointerEvents="none">
                    {de1(polygonAreaCm2(room.polygon) / 10_000)} m²
                  </text>
                </g>
              )
            })}

            {/* Planned serpentine (before the job starts) */}
            {!activeJob && !emptying && path.length > 1 && (runState?.progress ?? 0) === 0 && (
              <polyline points={planPoints} fill="none" stroke={TRAIL} strokeOpacity="0.3" strokeWidth="2.5" strokeDasharray="8 10" />
            )}

            {/* Zone rectangle */}
            {tab === 'zone' && (zoneDraft ?? zone) && (() => {
              const z = zoneDraft ?? zone!
              return (
                <g>
                  <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="var(--accent)" fillOpacity="0.10" stroke="var(--accent)" strokeWidth="3" strokeDasharray="10 8" />
                  {[[z.x, z.y], [z.x + z.w, z.y], [z.x, z.y + z.h], [z.x + z.w, z.y + z.h]].map(([hx, hy], i) => (
                    <rect key={i} x={hx - 7} y={hy - 7} width="14" height="14" rx="3" fill="var(--accent)" />
                  ))}
                </g>
              )
            })()}

            {/* Cleaned stroke — swath-wide carpet + visible serpentine line */}
            {runState && runState.trail.length > 1 && (
              <g>
                <polyline points={trailPoints} fill="none" stroke={TRAIL} strokeOpacity="0.28" strokeWidth={LANE_CM} strokeLinecap="round" strokeLinejoin="round" />
                <polyline points={trailPoints} fill="none" stroke={TRAIL} strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}

            {/* Travel line: transit to start / return to dock */}
            {runState?.activity === 'returning' && (
              <line x1={pos.x} y1={pos.y} x2={dock.x} y2={dock.y} stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 8" opacity="0.7" />
            )}
            {inTransit && runState && (
              <line x1={dock.x} y1={dock.y} x2={pos.x} y2={pos.y} stroke="var(--muted)" strokeWidth="2" strokeDasharray="6 8" opacity="0.7" />
            )}

            {/* Dock */}
            <g transform={`translate(${dock.x}, ${dock.y})`}>
              {emptying && <circle r="34" fill={TRAIL} opacity="0.25"><animate attributeName="r" values="22;40;22" dur="1.6s" repeatCount="indefinite" /></circle>}
              <rect x="-19" y="-19" width="38" height="38" rx="9" fill="var(--surface)" stroke={TRAIL} strokeWidth="3" />
              <path d="M2,-10 L-6,2 L-1,2 L-2,10 L6,-2 L1,-2 Z" fill={TRAIL} />
            </g>

            {/* Robot */}
            {runState && (
              <g transform={`translate(${pos.x}, ${pos.y})`}>
                {runState.activity === 'cleaning' && (
                  <>
                    <circle r="70" fill="url(#vac-scan)">
                      <animate attributeName="opacity" values="0.9;0.4;0.9" dur="2.4s" repeatCount="indefinite" />
                    </circle>
                    <circle r="24" fill="none" stroke={TRAIL} strokeWidth="2" opacity="0.7">
                      <animate attributeName="r" values="20;34" dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                  </>
                )}
                <circle r="17" fill="#eef7f4" stroke={TRAIL} strokeWidth="3.5" />
                <circle r="5.5" fill="#22313f" />
              </g>
            )}
          </svg>
          )}
        </section>

        {/* Target tabs: Alles / Raum / Zone */}
        <section className="space-y-2">
          <div className={`flex gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1 ${activeJob ? 'pointer-events-none opacity-60' : ''}`}>
            {([['all', 'Alles'], ['room', 'Raum'], ['zone', 'Zone']] as Array<[Tab, string]>).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`spring-press flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  tab === key ? 'bg-[color:var(--accent)] text-black shadow-sm' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="px-1 text-xs text-[color:var(--muted)]">{targetLabel}</div>
        </section>

        {/* Suction level */}
        <section className="flex items-center gap-2">
          <Fan size={14} className="shrink-0 text-[color:var(--muted)]" />
          <div className="flex flex-1 gap-1.5">
            {SUCTION.map((s) => (
              <button
                key={s.key}
                onClick={() => setSuction(s.key)}
                className={`spring-press flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                  suction === s.key
                    ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.12)] text-[color:var(--fg)]'
                    : 'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        {/* Actions — Staubbehälter entleeren / Reinigen */}
        <section className="flex items-center gap-2">
          <button
            onClick={triggerEmpty}
            disabled={runState?.activity !== 'docked' || emptying}
            className="btn btn-outline flex-1 gap-2"
            title={runState?.activity !== 'docked' ? 'Nur an der Station möglich' : undefined}
          >
            <Trash2 size={15} /> Staubbehälter entleeren
          </button>
          <button
            onClick={() => publish(runState?.activity === 'cleaning' ? 'idle' : 'cleaning')}
            disabled={runState?.activity === 'cleaning' ? false : !canStart}
            className={`btn btn-primary flex-1 gap-2 ${
              device && commands[commandKey(device.id, 'Vacuum')] === 'pending'
                ? 'cmd-pending'
                : device && commands[commandKey(device.id, 'Vacuum')] === 'failed' ? 'cmd-failed' : ''
            }`}
          >
            {device && commands[commandKey(device.id, 'Vacuum')] === 'failed'
              ? 'Keine Antwort'
              : runState?.activity === 'cleaning' ? <><Pause size={15} /> Pause</> : <><Play size={15} /> Reinigen</>}
          </button>
          <button
            onClick={() => publish('returning')}
            disabled={!runState || runState.activity === 'docked' || runState.activity === 'returning' || emptying}
            className="btn btn-ghost btn-icon shrink-0"
            title="Zur Station zurückkehren"
          >
            <Home size={16} />
          </button>
        </section>
      </main>
    </div>
  )
}
