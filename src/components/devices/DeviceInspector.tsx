import { useMemo, useState } from 'react'
import {
  X, Lightbulb, Lock, LockOpen, Camera, Speaker, Plug, Blinds, Thermometer,
  Bot, Router, Cpu, Activity, Droplets, Zap, Video, Sun, Palette, Power,
  Wifi, BatteryMedium, Gauge,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { kelvinToHex } from '@/lib/lighting'
import { planDevicesToTwin } from '@/lib/deviceTwin'
import {
  DigitalTwinRuntime, mergeCapabilities, deviceCapability,
  type Capability, type CapabilityKind, type Device,
} from '@/domain'

/** Category → icon (capability-aware where it matters). Pure presentation. */
function deviceIcon(d: Device) {
  if (deviceCapability(d, 'Vacuum')) return Bot
  switch (d.category) {
    case 'light': return Lightbulb
    case 'lock': return Lock
    case 'camera': return Camera
    case 'speaker': return Speaker
    case 'energy': return Plug
    case 'cover': return Blinds
    case 'climate': return Thermometer
    case 'hub': return Router
    case 'sensor': return deviceCapability(d, 'Temperature') ? Thermometer : Activity
    default: return Cpu
  }
}

const CAP_LABEL: Record<CapabilityKind, string> = {
  OnOff: 'Schalten', Brightness: 'Helligkeit', ColorTemperature: 'Farbtemperatur',
  Color: 'Farbe', Lock: 'Schloss', Position: 'Position', Temperature: 'Temperatur',
  Humidity: 'Luftfeuchte', Motion: 'Bewegung', Energy: 'Energie', Camera: 'Kamera',
  Vacuum: 'Saugroboter',
}

function Pill({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{
        background: on ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--bg)',
        color: on ? 'var(--accent)' : 'var(--muted)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </span>
  )
}

/** One capability rendered dynamically from its kind — no device-type special cases. */
function CapabilityRow({ cap, onChange }: { cap: Capability; onChange: (c: Capability) => void }) {
  const label = <span className="text-[11px] text-[color:var(--muted)] w-28 shrink-0">{CAP_LABEL[cap.kind]}</span>
  switch (cap.kind) {
    case 'OnOff':
      return (
        <div className="flex items-center gap-3">
          {label}
          <button
            onClick={() => onChange({ ...cap, on: !cap.on })}
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: cap.on ? 'var(--accent)' : 'var(--muted)' }}
          >
            <Power size={13} /> {cap.on ? 'An' : 'Aus'}
          </button>
        </div>
      )
    case 'Brightness':
      return (
        <div className="flex items-center gap-3">
          {label}
          <Sun size={13} className="text-[color:var(--muted)]" />
          <input
            type="range" min={0} max={100} value={cap.percent}
            onChange={(e) => onChange({ ...cap, percent: parseInt(e.target.value, 10) })}
            className="w-32 accent-[color:var(--accent)] cursor-pointer"
          />
          <span className="text-[11px] tabular-nums w-10 text-right">{cap.percent}%</span>
        </div>
      )
    case 'ColorTemperature':
      return (
        <div className="flex items-center gap-3">
          {label}
          <span className="w-3.5 h-3.5 rounded-full border border-[color:var(--border)]" style={{ background: kelvinToHex(cap.kelvin) }} />
          <input
            type="range" min={cap.minKelvin} max={cap.maxKelvin} step={50} value={cap.kelvin}
            onChange={(e) => onChange({ ...cap, kelvin: parseInt(e.target.value, 10) })}
            className="w-32 accent-[color:var(--accent)] cursor-pointer"
          />
          <span className="text-[11px] tabular-nums w-12 text-right">{cap.kelvin}K</span>
        </div>
      )
    case 'Color':
      return (
        <div className="flex items-center gap-3">
          {label}
          <Palette size={13} className="text-[color:var(--muted)]" />
          <span className="w-5 h-5 rounded border border-[color:var(--border)]" style={{ background: cap.hex }} />
          <span className="text-[11px] tabular-nums text-[color:var(--muted)]">{cap.hex}</span>
        </div>
      )
    case 'Lock':
      return (
        <div className="flex items-center gap-3">
          {label}
          <button
            onClick={() => onChange({ ...cap, locked: !cap.locked })}
            className="flex items-center gap-1.5 text-[12px]"
            style={{ color: cap.locked ? 'var(--accent)' : '#e0a23c' }}
          >
            {cap.locked ? <Lock size={13} /> : <LockOpen size={13} />} {cap.locked ? 'Verriegelt' : 'Offen'}
          </button>
        </div>
      )
    case 'Position':
      return (
        <div className="flex items-center gap-3">
          {label}
          <Blinds size={13} className="text-[color:var(--muted)]" />
          <input
            type="range" min={0} max={100} value={cap.percent}
            onChange={(e) => onChange({ ...cap, percent: parseInt(e.target.value, 10) })}
            className="w-32 accent-[color:var(--accent)] cursor-pointer"
          />
          <span className="text-[11px] tabular-nums w-10 text-right">{cap.percent}%</span>
        </div>
      )
    case 'Temperature':
      return <div className="flex items-center gap-3">{label}<Thermometer size={13} className="text-[color:var(--muted)]" /><span className="text-[12px] tabular-nums">{cap.celsius} °C</span></div>
    case 'Humidity':
      return <div className="flex items-center gap-3">{label}<Droplets size={13} className="text-[color:var(--muted)]" /><span className="text-[12px] tabular-nums">{cap.percent} %</span></div>
    case 'Motion':
      return <div className="flex items-center gap-3">{label}<Activity size={13} className="text-[color:var(--muted)]" /><Pill on={cap.detected}>{cap.detected ? 'Bewegung' : 'Ruhe'}</Pill></div>
    case 'Energy':
      return <div className="flex items-center gap-3">{label}<Zap size={13} className="text-[color:var(--muted)]" /><span className="text-[12px] tabular-nums">{cap.watts} W</span></div>
    case 'Camera':
      return <div className="flex items-center gap-3">{label}<Video size={13} className="text-[color:var(--muted)]" /><Pill on={cap.streaming}>{cap.streaming ? 'Live' : 'Aus'}</Pill></div>
    case 'Vacuum':
      return <div className="flex items-center gap-3">{label}<Bot size={13} className="text-[color:var(--muted)]" /><Pill on={cap.activity === 'cleaning'}>{cap.activity}</Pill></div>
  }
}

function DeviceCard({ device, onCapability }: { device: Device; onCapability: (c: Capability) => void }) {
  const Icon = deviceIcon(device)
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-3.5">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
            <Icon size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">{device.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{device.category}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: device.health.reachability === 'online' ? '#3fb27f' : 'var(--muted)' }} title={device.health.reachability} />
          {typeof device.health.signal === 'number' && (
            <span className="flex items-center gap-0.5 text-[10px] text-[color:var(--muted)]"><Wifi size={11} />{Math.round(device.health.signal * 100)}</span>
          )}
          {device.battery && (
            <span className="flex items-center gap-0.5 text-[10px] text-[color:var(--muted)]"><BatteryMedium size={12} />{device.battery.percent}%</span>
          )}
        </div>
      </div>
      {device.capabilities.length === 0 ? (
        <div className="text-[11px] text-[color:var(--muted)] italic">Infrastruktur · keine Fähigkeiten</div>
      ) : (
        <div className="flex flex-col gap-2">
          {device.capabilities.map((cap) => (
            <CapabilityRow key={cap.kind} cap={cap} onChange={onCapability} />
          ))}
        </div>
      )}
      <div className="mt-2.5 pt-2 border-t border-[color:var(--border)] text-[10px] text-[color:var(--muted)]">
        Connector · {device.connectorId}
      </div>
    </div>
  )
}

export function DeviceInspector({ onClose }: { onClose: () => void }) {
  const doc = usePlanStore((s) => s.doc)
  const floor = doc?.floors.find((f) => f.id === doc.activeFloorId)
  const mode = doc?.activeModeKey ?? 'auto'

  const initial = useMemo(
    () => (floor ? planDevicesToTwin(floor.devices, mode) : []),
    [floor, mode],
  )
  const [devices, setDevices] = useState<Device[]>(initial)

  // Single access layer: the runtime. All groupings/queries go through it.
  const runtime = useMemo(() => {
    const rt = new DigitalTwinRuntime()
    rt.setDevices(devices)
    return rt
  }, [devices])

  const rooms = floor?.rooms ?? []
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name ?? 'Ohne Raum'

  const all = runtime.listDevices()
  const distinctCaps = new Set<CapabilityKind>()
  let totalWatts = 0
  for (const d of all) for (const c of d.capabilities) {
    distinctCaps.add(c.kind)
    if (c.kind === 'Energy') totalWatts += c.watts
  }
  const online = all.filter((d) => d.health.reachability === 'online').length

  const grouped = useMemo(() => {
    const map = new Map<string, Device[]>()
    for (const d of all) {
      const key = d.roomId ?? '∅'
      const arr = map.get(key) ?? []
      arr.push(d)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [all])

  const onCapability = (deviceId: string) => (cap: Capability) =>
    setDevices((ds) => ds.map((d) => (d.id === deviceId ? { ...d, capabilities: mergeCapabilities(d.capabilities, [cap]) } : d)))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[color:var(--bg)]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-elevated)]">
        <div className="flex items-center gap-3">
          <Cpu size={18} className="text-[color:var(--accent)]" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">Geräte-Inspektor</div>
            <div className="text-[11px] text-[color:var(--muted)]">Aus der Geräte-Domäne erzeugt · herstellerneutral · Capability-getrieben</div>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-icon" title="Schließen (Esc)"><X size={16} /></button>
      </div>

      {/* Summary */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5 border-b border-[color:var(--border)] text-[12px]">
        <span className="flex items-center gap-1.5"><Cpu size={13} className="text-[color:var(--muted)]" /><b className="tabular-nums">{all.length}</b> Geräte</span>
        <span className="flex items-center gap-1.5"><Gauge size={13} className="text-[color:var(--muted)]" /><b className="tabular-nums">{distinctCaps.size}</b> Fähigkeitstypen</span>
        <span className="flex items-center gap-1.5"><Wifi size={13} className="text-[color:var(--muted)]" /><b className="tabular-nums">{online}</b> online</span>
        {totalWatts > 0 && <span className="flex items-center gap-1.5"><Zap size={13} className="text-[color:var(--muted)]" /><b className="tabular-nums">{totalWatts}</b> W</span>}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {all.length === 0 ? (
          <div className="text-[13px] text-[color:var(--muted)] py-12 text-center">Keine Geräte auf dieser Etage platziert.</div>
        ) : (
          <div className="flex flex-col gap-6 max-w-6xl mx-auto">
            {grouped.map(([roomId, list]) => (
              <section key={roomId}>
                <h3 className="text-[12px] uppercase tracking-wider text-[color:var(--muted)] mb-2.5">
                  {roomName(roomId === '∅' ? undefined : roomId)} · {list.length}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((d) => (
                    <DeviceCard key={d.id} device={d} onCapability={onCapability(d.id)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
