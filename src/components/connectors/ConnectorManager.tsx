import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Server, Radio, Power, Lock, Thermometer, Droplets, Activity, Zap, Video,
  Blinds, Sun, Palette, Loader2, CheckCircle2, AlertCircle, Plug, Unplug, Home,
  Sunrise, Clapperboard, Moon, Coffee, LogOut, PartyPopper, AlertTriangle, Gauge,
} from 'lucide-react'
import { kelvinToHex } from '@/lib/lighting'
import { findCapability, type Capability, type Device } from '@/domain'
import { usePlanStore } from '@/store/usePlanStore'
import { twinManager, type TwinSession, type ConnectorDescriptor } from '@/twin/twinManager'
import { resolveRoomBinding } from '@/twin/binding'
import { LiveFloorplan } from './LiveFloorplan'
import { OMEGA_MODES } from '@/lib/constants'
import { deriveEnvironment } from '@/lib/environment'
import { sceneCommands, totalEnergyW } from '@/twin/scenes'
import type { ModeKey } from '@/types'
import { SegmentedControl } from '@/ui'
import { useAnimatedNumber } from '@/lib/useAnimatedNumber'
import { createHomeAssistantConnector, SimulatedHaTransport, WebSocketHaTransport, haWebsocketUrl } from '@/connectors/homeAssistant'
import { createMqttConnector, SimulatedMqttBroker } from '@/connectors/mqtt'

/** Id of the real (live) Home Assistant connector — distinct from the demo. */
const LIVE_HA_ID = 'home-assistant-live'
const HA_CONFIG_KEY = 'omega:ha-live-config'

interface HaLiveConfig { url: string; token: string }
function loadHaConfig(): HaLiveConfig {
  try {
    const raw = localStorage.getItem(HA_CONFIG_KEY)
    if (raw) { const p = JSON.parse(raw) as Partial<HaLiveConfig>; return { url: p.url ?? '', token: p.token ?? '' } }
  } catch { /* ignore */ }
  return { url: '', token: '' }
}
function saveHaConfig(c: HaLiveConfig) { try { localStorage.setItem(HA_CONFIG_KEY, JSON.stringify(c)) } catch { /* ignore */ } }

/**
 * The Digital Twin: one shared runtime fed by multiple connectors, bound to the
 * plan's real rooms and painted onto the floorplan. Connector-agnostic — each
 * device carries a source badge; the floorplan reflects live state per room.
 */

interface CatalogEntry extends ConnectorDescriptor {
  id: string
  badge: string
  icon: typeof Server
}

const CATALOG: CatalogEntry[] = [
  {
    id: 'home-assistant', kind: 'home-assistant', label: 'Home Assistant · Demo', badge: 'Simuliert', icon: Server,
    make: () => createHomeAssistantConnector({ id: 'home-assistant', transport: new SimulatedHaTransport({ liveMs: 2500 }) }),
  },
  {
    id: 'mqtt', kind: 'mqtt', label: 'MQTT · Homie · Demo', badge: 'Simuliert', icon: Radio,
    make: () => createMqttConnector({ id: 'mqtt', transport: new SimulatedMqttBroker({ liveMs: 2500 }) }),
  },
]

/** Build a live Home Assistant connector descriptor from user credentials. */
function makeLiveHaDescriptor(cfg: HaLiveConfig): ConnectorDescriptor {
  return {
    label: 'Home Assistant',
    kind: 'home-assistant',
    make: () => createHomeAssistantConnector({
      id: LIVE_HA_ID,
      label: 'Home Assistant',
      transport: new WebSocketHaTransport(haWebsocketUrl(cfg.url)),
      token: cfg.token,
    }),
  }
}

const SOURCE: Record<string, { short: string; color: string }> = {
  'home-assistant': { short: 'HA', color: '#C7A24E' },
  [LIVE_HA_ID]: { short: 'HA Live', color: '#41bd84' },
  mqtt: { short: 'MQTT', color: '#16a766' },
}

const MODE_ICON: Record<string, typeof Server> = {
  Zap, Sunrise, Sun, Clapperboard, Moon, Coffee, LogOut, PartyPopper, AlertTriangle,
}
const VIEW_OPTS: { value: 'grundriss' | 'geraete'; label: string }[] = [
  { value: 'grundriss', label: 'Grundriss' },
  { value: 'geraete', label: 'Geräte' },
]
const PHASE_LABEL: Record<string, string> = {
  night: 'Nacht', dawn: 'Morgendämmerung', goldenHour: 'Goldene Stunde', day: 'Tag', dusk: 'Abenddämmerung',
}

function CapChip({ cap }: { cap: Capability }) {
  const base = 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-[color:var(--border)] bg-[color:var(--bg)]'
  switch (cap.kind) {
    case 'OnOff': return <span className={base} style={{ color: cap.on ? 'var(--accent)' : 'var(--muted)' }}><Power size={11} />{cap.on ? 'An' : 'Aus'}</span>
    case 'Brightness': return <span className={base}><Sun size={11} />{cap.percent}%</span>
    case 'ColorTemperature': return <span className={base}><span className="w-2.5 h-2.5 rounded-full" style={{ background: kelvinToHex(cap.kelvin) }} />{cap.kelvin}K</span>
    case 'Color': return <span className={base}><Palette size={11} /><span className="w-2.5 h-2.5 rounded" style={{ background: cap.hex }} /></span>
    case 'Lock': return <span className={base} style={{ color: cap.locked ? 'var(--accent)' : '#e0a23c' }}><Lock size={11} />{cap.locked ? 'Verriegelt' : 'Offen'}</span>
    case 'Position': return <span className={base}><Blinds size={11} />{cap.percent}%</span>
    case 'Temperature': return <span className={base}><Thermometer size={11} />{cap.celsius} °C</span>
    case 'Humidity': return <span className={base}><Droplets size={11} />{cap.percent} %</span>
    case 'Motion': return <span className={base} style={{ color: cap.detected ? 'var(--accent)' : 'var(--muted)' }}><Activity size={11} />{cap.detected ? 'Bewegung' : 'Ruhe'}</span>
    case 'Energy': return <span className={base}><Zap size={11} />{cap.watts} W</span>
    case 'Camera': return <span className={base}><Video size={11} />{cap.streaming ? 'Live' : 'Aus'}</span>
    case 'Vacuum': return <span className={base}>{cap.activity}</span>
  }
}

function StatusDot({ session }: { session?: TwinSession }) {
  const status = session?.health.status
  if (status === 'connecting') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#e0a23c]"><Loader2 size={12} className="animate-spin" /> verbinde…</span>
  if (status === 'error') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#d8635f]"><AlertCircle size={12} /> Fehler</span>
  if (status === 'connected') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#3fb27f]"><CheckCircle2 size={12} /> verbunden</span>
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--muted)]"><Unplug size={12} /> getrennt</span>
}

function RoomSelect({ device, rooms, currentRoomId, onAssign, onClear }: {
  device: Device; rooms: { id: string; name: string }[]; currentRoomId?: string
  onAssign: (roomId: string) => void; onClear: () => void
}) {
  return (
    <select
      value={currentRoomId ?? ''}
      onChange={(e) => (e.target.value ? onAssign(e.target.value) : onClear())}
      className="text-[11px] px-1.5 py-1 rounded-md bg-[color:var(--bg)] border border-[color:var(--border)] outline-none text-[color:var(--muted)]"
      aria-label={`Raum für ${device.name}`}
    >
      <option value="">Auto</option>
      {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
    </select>
  )
}

function DeviceCard({ device, flash, rooms, currentRoomId, onToggle, onAssign, onClear }: {
  device: Device; flash: boolean; rooms: { id: string; name: string }[]; currentRoomId?: string
  onToggle: (d: Device) => void; onAssign: (roomId: string) => void; onClear: () => void
}) {
  const src = SOURCE[device.connectorId] ?? { short: device.connectorId, color: 'var(--muted)' }
  const onoff = findCapability(device.capabilities, 'OnOff')
  const lock = findCapability(device.capabilities, 'Lock')
  const writableOnOff = onoff?.access === 'readWrite'
  const writableLock = lock?.access === 'readWrite'
  return (
    <div className="rounded-[var(--radius-lg)] border bg-[color:var(--surface-2)] p-3 transition-colors lift" style={{ borderColor: flash ? 'var(--accent)' : 'var(--border)' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[13px] font-medium leading-tight">{device.name}</div>
        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0" style={{ borderColor: src.color, color: src.color }}>{src.short}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{device.capabilities.map((c, i) => <CapChip key={i} cap={c} />)}</div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {(writableOnOff || writableLock) ? (
          <button onClick={() => onToggle(device)} className="text-[11px] px-2.5 py-1 rounded-md border border-[color:var(--border)] hover:border-[color:var(--accent)] transition-colors">
            {writableLock ? (lock?.locked ? 'Entriegeln' : 'Verriegeln') : onoff?.on ? 'Ausschalten' : 'Einschalten'}
          </button>
        ) : <span />}
        <RoomSelect device={device} rooms={rooms} currentRoomId={currentRoomId} onAssign={onAssign} onClear={onClear} />
      </div>
    </div>
  )
}

/**
 * Live Home Assistant connection — the first path where a command from OMEGA
 * physically actuates a real device. The user pastes their HA URL + a
 * long-lived access token; the connector opens a real WebSocket and every
 * toggle / scene routes to `call_service` on their instance. Credentials are
 * stored locally (this browser only) and never leave the device except toward
 * the user's own Home Assistant.
 */
function RealHaCard({ session, busy, onConnect, onDisconnect }: {
  session?: TwinSession
  busy: boolean
  onConnect: (cfg: HaLiveConfig) => void
  onDisconnect: () => void
}) {
  const saved = useMemo(() => loadHaConfig(), [])
  const [url, setUrl] = useState(saved.url)
  const [token, setToken] = useState(saved.token)
  const connected = session?.health.status === 'connected'
  const active = !!session && session.health.status !== 'disconnected'
  const canConnect = url.trim().length > 3 && token.trim().length > 20

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3.5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #41bd84 16%, transparent)', color: '#41bd84' }}><Server size={16} /></span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">Home Assistant <span className="text-[10px] uppercase tracking-wide ml-1" style={{ color: '#41bd84' }}>Live</span></div>
            <StatusDot session={session} />
          </div>
        </div>
        {active && (
          <button onClick={onDisconnect} disabled={busy} className="btn btn-sm btn-ghost inline-flex items-center gap-1.5 shrink-0">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />} Trennen
          </button>
        )}
      </div>

      {!connected && (
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Home-Assistant-Adresse</span>
            <input
              value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://dein-ha.ui.nabu.casa"
              className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]"
              autoComplete="off" spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Long-Lived Access Token</span>
            <input
              value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="Profil → Sicherheit → Token erstellen"
              className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]"
              autoComplete="off" spellCheck={false}
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-[color:var(--muted)] leading-tight">Wird nur lokal gespeichert. HA muss per HTTPS erreichbar sein.</span>
            <button
              onClick={() => onConnect({ url: url.trim(), token: token.trim() })}
              disabled={!canConnect || busy}
              className="btn btn-sm btn-primary inline-flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Verbinden
            </button>
          </div>
          {session?.health.status === 'error' && (
            <div className="flex items-start gap-1.5 text-[11px] text-[#d8635f]"><AlertCircle size={12} className="mt-0.5 shrink-0" />{session.health.message ?? 'Verbindung fehlgeschlagen'}</div>
          )}
        </div>
      )}

      {connected && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#3fb27f]"><CheckCircle2 size={12} /> Live verbunden — Schalten wirkt jetzt physisch.</div>
      )}
    </div>
  )
}

export function ConnectorManager({ onClose }: { onClose: () => void }) {
  const manager = twinManager()
  const doc = usePlanStore((s) => s.doc)
  const floor = doc ? (doc.floors.find((f) => f.id === doc.activeFloorId) ?? doc.floors[0]) : undefined
  const rooms = useMemo(() => floor?.rooms ?? [], [floor])

  const [devices, setDevices] = useState<Device[]>(manager.view().devices)
  const [sessions, setSessions] = useState<TwinSession[]>(manager.view().sessions)
  const [bindings, setBindings] = useState<Record<string, string>>(manager.view().bindings)
  const [activeScene, setActiveScene] = useState<string | undefined>(manager.view().activeScene)
  const [busy, setBusy] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [view, setView] = useState<'grundriss' | 'geraete'>('grundriss')
  const prevRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const unsub = manager.subscribe((v) => {
      let changed: string | undefined
      for (const d of v.devices) {
        const key = JSON.stringify(d.capabilities)
        if (prevRef.current.has(d.id) && prevRef.current.get(d.id) !== key) changed = d.id
        prevRef.current.set(d.id, key)
      }
      setDevices(v.devices)
      setSessions(v.sessions)
      setBindings(v.bindings)
      setActiveScene(v.activeScene)
      if (changed) setFlashId(changed)
    })
    return () => unsub()
  }, [manager])

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 600)
    return () => clearTimeout(t)
  }, [flashId])

  const binding = useMemo(() => resolveRoomBinding(devices, rooms, bindings), [devices, rooms, bindings])
  const roomOptions = rooms.map((r) => ({ id: r.id, name: r.name }))
  const sessionFor = (id: string) => sessions.find((s) => s.id === id)
  const activeSources = new Set(devices.map((d) => d.connectorId)).size

  async function toggleConnector(entry: CatalogEntry) {
    setBusy(entry.id)
    try {
      if (manager.isActive(entry.id)) await manager.removeConnector(entry.id)
      else await manager.addConnector(entry)
    } finally { setBusy(null) }
  }

  async function connectLiveHa(cfg: HaLiveConfig) {
    saveHaConfig(cfg)
    setBusy(LIVE_HA_ID)
    try { await manager.addConnector(makeLiveHaDescriptor(cfg)) } finally { setBusy(null) }
  }
  async function disconnectLiveHa() {
    setBusy(LIVE_HA_ID)
    try { await manager.removeConnector(LIVE_HA_ID) } finally { setBusy(null) }
  }

  function onDeviceToggle(d: Device) {
    const lock = findCapability(d.capabilities, 'Lock')
    if (lock?.access === 'readWrite') { void manager.command({ deviceId: d.id, capability: 'Lock', payload: { locked: !lock.locked } }); return }
    const onoff = findCapability(d.capabilities, 'OnOff')
    if (onoff?.access === 'readWrite') void manager.command({ deviceId: d.id, capability: 'OnOff', payload: { on: !onoff.on } })
  }

  const env = useMemo(() => deriveEnvironment({ timeOfDay: new Date().getHours() + new Date().getMinutes() / 60 }), [])
  const energyW = totalEnergyW(devices)
  const energyAnim = useAnimatedNumber(energyW)

  function applyScene(mode: ModeKey) {
    void manager.applyScene(mode, sceneCommands(devices, mode, env))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[color:var(--bg)] omega-noise animate-pop-in">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)]">
        <div className="flex items-center gap-2.5">
          <Radio size={18} className="text-[color:var(--accent)]" />
          <div>
            <div className="text-[14px] font-semibold">Digital Twin</div>
            <div className="text-[11px] text-[color:var(--muted)]">Ein Twin · mehrere Connectoren · live im Grundriss</div>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Schließen"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-7">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">

          {/* Connector bar */}
          <section className="surface p-4">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mb-3">Connectoren</div>
            <div className="grid sm:grid-cols-2 gap-3 stagger">
              {CATALOG.map((entry) => {
                const Icon = entry.icon
                const active = manager.isActive(entry.id) || !!sessionFor(entry.id)
                return (
                  <div key={entry.id} className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}><Icon size={16} /></span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate">{entry.label} <span className="text-[10px] uppercase tracking-wide text-[color:var(--muted)] ml-1">{entry.badge}</span></div>
                        <StatusDot session={sessionFor(entry.id)} />
                      </div>
                    </div>
                    <button onClick={() => toggleConnector(entry)} disabled={busy === entry.id} className={`btn btn-sm inline-flex items-center gap-1.5 shrink-0 ${active ? 'btn-ghost' : 'btn-primary'}`}>
                      {busy === entry.id ? <Loader2 size={13} className="animate-spin" /> : active ? <Unplug size={13} /> : <Plug size={13} />}
                      {active ? 'Trennen' : 'Verbinden'}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-[color:var(--border)]">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mb-2">Echte Verbindung · schaltet physisch</div>
              <RealHaCard session={sessionFor(LIVE_HA_ID)} busy={busy === LIVE_HA_ID} onConnect={connectLiveHa} onDisconnect={disconnectLiveHa} />
            </div>
          </section>

          {devices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--border)] p-10 text-center">
              <Home size={28} className="mx-auto mb-3 text-[color:var(--muted)]" />
              <div className="text-[13px] text-[color:var(--muted)]">Noch keine Geräte. Verbinde oben einen oder mehrere Connectoren — sie speisen alle denselben Twin und erscheinen live im Grundriss.</div>
            </div>
          ) : (
            <>
              {/* Scenes — one action across every connector */}
              <section className="surface p-4">
                <div className="flex items-center justify-between mb-3 gap-3">
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Szenen</div>
                  <div className="flex items-center gap-3 text-[11px] text-[color:var(--muted)]">
                    <span className="inline-flex items-center gap-1" title="Sonnenstand — die Automatik folgt ihm"><Sun size={12} /> {PHASE_LABEL[env.phase]}</span>
                    <span className="inline-flex items-center gap-1" title="Live-Gesamtverbrauch"><Gauge size={12} /> <span className="tnum">{Math.round(energyAnim)} W</span></span>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 stagger">
                  {OMEGA_MODES.map((mode) => {
                    const Icon = MODE_ICON[mode.icon] ?? Zap
                    const active = activeScene === mode.key
                    return (
                      <button
                        key={mode.key}
                        onClick={() => applyScene(mode.key)}
                        title={mode.description}
                        className="flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] transition-colors pressable"
                        style={{ borderColor: active ? mode.accent : 'var(--border)', color: active ? mode.accent : 'var(--text)', background: active ? 'color-mix(in srgb, ' + mode.accent + ' 14%, transparent)' : 'transparent' }}
                      >
                        <Icon size={16} />
                        <span className="leading-none">{mode.name}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2.5 text-[11px] text-[color:var(--muted)]">Eine Szene schaltet Geräte über alle Connectoren gleichzeitig. „Automatik" folgt dem Sonnenstand.</div>
              </section>

              {/* View toggle + summary */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[12px] text-[color:var(--muted)]">
                  <Home size={14} />
                  <span><span className="text-[color:var(--text)] font-medium">{devices.length}</span> Geräte · {activeSources} {activeSources === 1 ? 'Quelle' : 'Quellen'} · {binding.byRoom.size} {binding.byRoom.size === 1 ? 'Raum' : 'Räume'}{binding.unassigned.length ? ` · ${binding.unassigned.length} offen` : ''}</span>
                </div>
                <SegmentedControl size="sm" value={view} onChange={setView} options={VIEW_OPTS} />
              </div>

              {view === 'grundriss' ? (
                <div className="flex flex-col gap-4">
                  {floor && <LiveFloorplan rooms={rooms} walls={floor.walls} extent={floor.extent} byRoom={binding.byRoom} onCommand={onDeviceToggle} />}
                  {binding.unassigned.length > 0 && (
                    <div className="surface p-4">
                      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mb-2">Noch nicht zugeordnet · einem Raum zuweisen</div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 stagger">
                        {binding.unassigned.map((d) => (
                          <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-1.5">
                            <span className="text-[12px] truncate">{d.name}</span>
                            <RoomSelect device={d} rooms={roomOptions} currentRoomId={binding.roomOf.get(d.id)} onAssign={(rid) => manager.setBinding(d.id, rid)} onClear={() => manager.clearBinding(d.id)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <section className="flex flex-col gap-4">
                  {rooms.map((room) => {
                    const rd = binding.byRoom.get(room.id) ?? []
                    if (rd.length === 0) return null
                    return (
                      <div key={room.id}>
                        <div className="flex items-center gap-2 mb-2"><h3 className="text-[13px] font-semibold">{room.name}</h3><span className="text-[11px] text-[color:var(--muted)]">{rd.length}</span></div>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
                          {rd.map((d) => <DeviceCard key={d.id} device={d} flash={flashId === d.id} rooms={roomOptions} currentRoomId={binding.roomOf.get(d.id)} onToggle={onDeviceToggle} onAssign={(rid) => manager.setBinding(d.id, rid)} onClear={() => manager.clearBinding(d.id)} />)}
                        </div>
                      </div>
                    )
                  })}
                  {binding.unassigned.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2"><h3 className="text-[13px] font-semibold text-[color:var(--muted)]">Nicht zugeordnet</h3><span className="text-[11px] text-[color:var(--muted)]">{binding.unassigned.length}</span></div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
                        {binding.unassigned.map((d) => <DeviceCard key={d.id} device={d} flash={flashId === d.id} rooms={roomOptions} currentRoomId={undefined} onToggle={onDeviceToggle} onAssign={(rid) => manager.setBinding(d.id, rid)} onClear={() => manager.clearBinding(d.id)} />)}
                      </div>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
