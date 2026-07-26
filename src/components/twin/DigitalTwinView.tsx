import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Cpu, Lightbulb, Thermometer, Zap, Radar, Lock, LockOpen, Droplets, Wifi,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { planDevicesToTwin } from '@/lib/deviceTwin'
import { deriveRoomLiveState } from '@/twin/binding'
import { findCapability, type Device, type Capability } from '@/domain'
import { LiveFloorplan } from '@/components/connectors/LiveFloorplan'

/**
 * DigitalTwinView — the live Digital Twin: the plan's devices are projected into
 * the neutral domain twin, driven by a small in-browser simulation (no real
 * hardware) and painted onto the real floorplan geometry (reusing LiveFloorplan)
 * plus per-room sensor cards and a live power sparkline. Lights, locks and
 * switches are tappable; sensors drift over time so the twin feels alive.
 */

const hashNum = (id: string): number => {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 997
}
const frac = (n: number): number => { const x = Math.sin(n) * 43758.5453; return x - Math.floor(x) }

/** Drift read-only telemetry by tick and apply the user's on/lock overrides. */
function simulate(d: Device, tick: number, onOv: Record<string, boolean>, lockOv: Record<string, boolean>): Device {
  const seed = hashNum(d.id)
  const caps: Capability[] = d.capabilities.map((c): Capability => {
    switch (c.kind) {
      case 'OnOff': return onOv[d.id] === undefined ? c : { ...c, on: onOv[d.id] }
      case 'Lock': return lockOv[d.id] === undefined ? c : { ...c, locked: lockOv[d.id] }
      case 'Temperature': return { ...c, celsius: Math.round((c.celsius + Math.sin((tick + seed) * 0.35) * 0.5) * 10) / 10 }
      case 'Humidity': return { ...c, percent: Math.max(30, Math.min(70, c.percent + Math.round(Math.sin((tick + seed) * 0.22) * 2))) }
      case 'Motion': return { ...c, detected: frac(seed + tick * 1.7) > 0.72 }
      case 'Energy': return { ...c, watts: Math.max(0, Math.round(c.watts * (1 + Math.sin((tick + seed) * 0.5) * 0.22))) }
      default: return c
    }
  })
  return { ...d, capabilities: caps }
}

function powerOf(devices: Device[]): number {
  let w = 0
  for (const d of devices) {
    const e = findCapability(d.capabilities, 'Energy')
    if (e) { w += e.watts; continue }
    const on = findCapability(d.capabilities, 'OnOff')
    if (d.category === 'light' && on?.on) {
      const rated = Number(d.metadata?.ratedWatts) || 9
      const br = findCapability(d.capabilities, 'Brightness')
      w += rated * ((br?.percent ?? 100) / 100)
    }
  }
  return Math.round(w)
}

function Sparkline({ data, color = '#C7A24E' }: { data: number[]; color?: string }) {
  if (data.length < 2) return <div style={{ height: 34 }} />
  const max = Math.max(...data, 1), min = Math.min(...data, 0)
  const rng = max - min || 1
  const w = 120, h = 34
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * (h - 4) - 2}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`${pts} ${w},${h} 0,${h}`} fill={color} opacity={0.1} stroke="none" />
    </svg>
  )
}

function Kpi({ icon, label, value, sub, spark }: { icon: React.ReactNode; label: string; value: string; sub?: string; spark?: React.ReactNode }) {
  return (
    <div className="surface rounded-xl p-3 flex-1 min-w-[140px]">
      <div className="flex items-center gap-2 text-[color:var(--muted)] text-xs mb-1">{icon}<span>{label}</span></div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="font-display text-2xl font-semibold text-[color:var(--fg)] tabular-nums leading-none">{value}</div>
          {sub && <div className="text-[11px] text-[color:var(--muted)] mt-1">{sub}</div>}
        </div>
        {spark}
      </div>
    </div>
  )
}

export function DigitalTwinView() {
  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo(() => doc?.floors.find((f) => f.id === doc?.activeFloorId), [doc])
  const mode = doc?.activeModeKey ?? 'auto'

  const [tick, setTick] = useState(0)
  const [onOv, setOnOv] = useState<Record<string, boolean>>({})
  const [lockOv, setLockOv] = useState<Record<string, boolean>>({})
  const [hist, setHist] = useState<number[]>([])
  const histRef = useRef<number[]>([])

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 2000)
    return () => clearInterval(t)
  }, [])

  const base = useMemo(() => (floor ? planDevicesToTwin(floor.devices, mode) : []), [floor, mode])
  const devices = useMemo(() => base.map((d) => simulate(d, tick, onOv, lockOv)), [base, tick, onOv, lockOv])

  const byRoom = useMemo(() => {
    const m = new Map<string, Device[]>()
    for (const d of devices) { if (!d.roomId) continue; const l = m.get(d.roomId) ?? []; l.push(d); m.set(d.roomId, l) }
    return m
  }, [devices])

  const power = powerOf(devices)
  useEffect(() => {
    histRef.current = [...histRef.current.slice(-47), power]
    setHist(histRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const lights = devices.filter((d) => d.category === 'light')
  const lightsOn = lights.filter((d) => findCapability(d.capabilities, 'OnOff')?.on).length
  const online = devices.filter((d) => d.health?.reachability === 'online').length
  const temps = devices.map((d) => findCapability(d.capabilities, 'Temperature')?.celsius).filter((t): t is number => t !== undefined)
  const avgTemp = temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : undefined
  const anyMotion = devices.some((d) => findCapability(d.capabilities, 'Motion')?.detected)

  const command = (d: Device) => {
    const on = findCapability(d.capabilities, 'OnOff')
    if (on && on.access === 'readWrite') { setOnOv((s) => ({ ...s, [d.id]: !on.on })); return }
    const lk = findCapability(d.capabilities, 'Lock')
    if (lk && lk.access === 'readWrite') setLockOv((s) => ({ ...s, [d.id]: !lk.locked }))
  }

  if (!floor) return null
  const rooms = floor.rooms.filter((r) => r.polygon.length >= 3)

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[color:var(--bg)]">
      <div className="mx-auto max-w-[1400px] p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--accent)] opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[color:var(--accent)]" />
          </span>
          <h2 className="font-display text-lg font-semibold text-[color:var(--fg)]">Digital Twin</h2>
          <span className="text-xs text-[color:var(--muted)]">Live · simuliert · Modus {mode}</span>
        </div>

        {/* KPI row */}
        <div className="flex flex-wrap gap-3 mb-4">
          <Kpi icon={<Cpu size={13} />} label="Geräte online" value={`${online}`} sub={`von ${devices.length}`} />
          <Kpi icon={<Lightbulb size={13} />} label="Lichter an" value={`${lightsOn}`} sub={`von ${lights.length}`} />
          <Kpi icon={<Thermometer size={13} />} label="Ø Temperatur" value={avgTemp !== undefined ? `${avgTemp}°` : '—'} sub="Innenräume" />
          <Kpi icon={<Zap size={13} />} label="Leistung" value={`${power} W`} sub={anyMotion ? 'Bewegung erkannt' : 'ruhig'} spark={<Sparkline data={hist} />} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
          {/* Live floorplan */}
          <div className="surface rounded-2xl p-3">
            <LiveFloorplan rooms={floor.rooms} walls={floor.walls} extent={floor.extent} byRoom={byRoom} onCommand={command} />
            <p className="text-[11px] text-[color:var(--muted)] mt-2 px-1">Tippe eine Leuchte / ein Schloss an, um es zu schalten — die Karten und der Grundriss aktualisieren sich live.</p>
          </div>

          {/* Room cards */}
          <div className="flex flex-col gap-3">
            {rooms.map((room) => {
              const rd = byRoom.get(room.id) ?? []
              const live = deriveRoomLiveState(rd)
              const writable = rd.filter((d) => findCapability(d.capabilities, 'OnOff')?.access === 'readWrite' || findCapability(d.capabilities, 'Lock')?.access === 'readWrite')
              return (
                <div key={room.id} className="surface rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-[color:var(--fg)]">{room.name}</div>
                    {live.motion && <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--accent)]"><Radar size={12} /> Bewegung</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Tile icon={<Lightbulb size={12} />} v={`${live.lightsOn}/${live.lightTotal}`} l="Licht" active={live.lightsOn > 0} />
                    <Tile icon={<Thermometer size={12} />} v={live.temperature !== undefined ? `${live.temperature}°` : '—'} l="Temp" />
                    <Tile icon={<Droplets size={12} />} v={live.humidity !== undefined ? `${live.humidity}%` : '—'} l="Feuchte" />
                    <Tile icon={<Zap size={12} />} v={live.energyW !== undefined ? `${live.energyW}W` : '—'} l="Energie" />
                  </div>
                  {writable.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {writable.map((d) => {
                        const on = findCapability(d.capabilities, 'OnOff')
                        const lk = findCapability(d.capabilities, 'Lock')
                        const active = on ? on.on : lk ? !lk.locked : false
                        return (
                          <button
                            key={d.id}
                            onClick={() => command(d)}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] border transition-colors ${active ? 'border-[color:var(--accent)] text-[color:var(--accent-bright)] bg-[rgba(199,162,78,0.12)]' : 'border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
                            title={d.name}
                          >
                            {lk ? (lk.locked ? <Lock size={11} /> : <LockOpen size={11} />) : <Lightbulb size={11} />}
                            <span className="max-w-[92px] truncate">{d.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {rd.length === 0 && <div className="text-[11px] text-[color:var(--muted)] flex items-center gap-1"><Wifi size={11} /> keine Geräte</div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function Tile({ icon, v, l, active }: { icon: React.ReactNode; v: string; l: string; active?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 border ${active ? 'border-[color:var(--accent)]' : 'border-[color:var(--border)]'} bg-[color:var(--surface-2)]`}>
      <div className="flex items-center gap-1 text-[10px] text-[color:var(--muted)]">{icon}{l}</div>
      <div className="font-display text-sm font-semibold text-[color:var(--fg)] tabular-nums">{v}</div>
    </div>
  )
}
