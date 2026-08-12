import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Server, Radio, Power, Lock, Thermometer, Droplets, Activity, Zap, Video,
  Blinds, Sun, Palette, Loader2, CheckCircle2, AlertCircle, Plug, Unplug, Home,
  Sunrise, Clapperboard, Moon, Coffee, LogOut, PartyPopper, AlertTriangle, Gauge,
  Lightbulb, Speaker, Bot, ArrowRight, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ZoomIn, ZoomOut, Check, Sparkles, Cloud,
} from 'lucide-react'
import { kelvinToHex } from '@/lib/lighting'
import { findCapability, type Capability, type Device, type DeviceCommand } from '@/domain'
import { usePlanStore } from '@/store/usePlanStore'
import { twinManager, commandKey, type TwinSession, type ConnectorDescriptor, type CommandPhase } from '@/twin/twinManager'
import { useFailureHaptics } from '@/hooks/useFailureHaptics'
import { VoiceControl } from './VoiceControl'
import { useTier } from '@/hooks/useTier'
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
import { createTuyaConnector, HttpTuyaTransport, type TuyaRegion } from '@/connectors/tuya'
import { createOnvifConnector, HttpOnvifTransport, type OnvifCameraConfig } from '@/connectors/onvif'
import { createBrandConnector, createGoveeClient, createSwitchBotClient } from '@/connectors/brands'
import { ECOSYSTEM_SPECS, createEcosystemConnector, type EcosystemIcon } from '@/connectors/ecosystem'

/** Id of the real (live) Home Assistant connector — distinct from the demo. */
const LIVE_HA_ID = 'home-assistant-live'
const HA_CONFIG_KEY = 'omega:ha-live-config'
/** Id of the real (live) Tuya Cloud connector. */
const LIVE_TUYA_ID = 'tuya-cloud-live'
const LIVE_ONVIF_ID = 'onvif-live'
const TUYA_CONFIG_KEY = 'omega:tuya-live-config'
const ONVIF_CONFIG_KEY = 'omega:onvif-live-config'

interface HaLiveConfig { url: string; token: string }
function loadHaConfig(): HaLiveConfig {
  try {
    const raw = localStorage.getItem(HA_CONFIG_KEY)
    if (raw) { const p = JSON.parse(raw) as Partial<HaLiveConfig>; return { url: p.url ?? '', token: p.token ?? '' } }
  } catch { /* ignore */ }
  return { url: '', token: '' }
}
function saveHaConfig(c: HaLiveConfig) { try { localStorage.setItem(HA_CONFIG_KEY, JSON.stringify(c)) } catch { /* ignore */ } }

interface TuyaLiveConfig { region: TuyaRegion; clientId: string; secret: string; uid: string }
function loadTuyaConfig(): TuyaLiveConfig {
  try {
    const raw = localStorage.getItem(TUYA_CONFIG_KEY)
    if (raw) { const p = JSON.parse(raw) as Partial<TuyaLiveConfig>; return { region: p.region ?? 'eu', clientId: p.clientId ?? '', secret: p.secret ?? '', uid: p.uid ?? '' } }
  } catch { /* ignore */ }
  return { region: 'eu', clientId: '', secret: '', uid: '' }
}
function saveTuyaConfig(c: TuyaLiveConfig) { try { localStorage.setItem(TUYA_CONFIG_KEY, JSON.stringify(c)) } catch { /* ignore */ } }

interface OnvifLiveConfig {
  bridgeUrl: string
  bridgeToken: string
  cameraId: string
  cameraName: string
  host: string
  port: number
  username: string
  password: string
}
function loadOnvifConfig(): OnvifLiveConfig {
  try {
    const raw = localStorage.getItem(ONVIF_CONFIG_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<OnvifLiveConfig>
      return {
        bridgeUrl: p.bridgeUrl ?? 'http://127.0.0.1:8787',
        bridgeToken: p.bridgeToken ?? '',
        cameraId: p.cameraId ?? 'arenti-outdoor',
        cameraName: p.cameraName ?? 'Arenti Außenkamera',
        host: p.host ?? '192.168.0.107',
        port: Number(p.port ?? 8000),
        username: p.username ?? 'admin',
        password: '',
      }
    }
  } catch { /* ignore */ }
  return {
    bridgeUrl: 'http://127.0.0.1:8787',
    bridgeToken: '',
    cameraId: 'arenti-outdoor',
    cameraName: 'Arenti Außenkamera',
    host: '192.168.0.107',
    port: 8000,
    username: 'admin',
    password: '',
  }
}
function saveOnvifConfig(c: OnvifLiveConfig) {
  try {
    // Never persist the ONVIF camera password in localStorage.
    const { password: _password, ...safe } = c
    localStorage.setItem(ONVIF_CONFIG_KEY, JSON.stringify(safe))
  } catch { /* ignore */ }
}

/** Live brand-cloud connectors (Govee + SwitchBot) — main's real cloud clients,
 *  surfaced here so they run alongside the 30 ecosystems. Vendor clouds send no
 *  CORS headers, so a relay URL forwards the calls (see docs/CONNECTOR_SETUP.md). */
const LIVE_GOVEE_ID = 'govee-live'
const LIVE_SB_ID = 'switchbot-live'
const CLOUD_CONFIG_KEY = 'omega:brand-cloud-config'
const relayBase = (relay: string, vendor: 'govee' | 'switchbot'): string | undefined =>
  relay ? `${relay.replace(/\/+$/, '')}/${vendor}` : undefined
interface BrandCloudConfig { goveeKey: string; sbToken: string; sbSecret: string; relay: string }
function loadCloudConfig(): BrandCloudConfig {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY)
    if (raw) { const p = JSON.parse(raw) as Partial<BrandCloudConfig>; return { goveeKey: p.goveeKey ?? '', sbToken: p.sbToken ?? '', sbSecret: p.sbSecret ?? '', relay: p.relay ?? '' } }
  } catch { /* ignore */ }
  return { goveeKey: '', sbToken: '', sbSecret: '', relay: '' }
}
function saveCloudConfig(c: BrandCloudConfig) { try { localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(c)) } catch { /* ignore */ } }

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

/** Icon per ecosystem archetype — brands stay data, icons stay UI. */
const ECO_ICON: Record<EcosystemIcon, typeof Server> = {
  bulb: Lightbulb, lock: Lock, speaker: Speaker, camera: Video, hub: Server,
  thermo: Thermometer, plug: Plug, sensor: Activity, blind: Blinds, vacuum: Bot,
}

/** Every ecosystem from the device library as a connectable twin source. */
const ECO_ENTRIES: CatalogEntry[] = ECOSYSTEM_SPECS.map((spec) => ({
  id: spec.id,
  kind: spec.id,
  label: spec.label,
  badge: 'Simuliert',
  icon: ECO_ICON[spec.icon],
  make: () => createEcosystemConnector(spec),
}))

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

/** Build a live Tuya Cloud connector descriptor from user credentials. */
function makeLiveTuyaDescriptor(cfg: TuyaLiveConfig): ConnectorDescriptor {
  return {
    label: 'Tuya Cloud',
    kind: 'tuya',
    make: () => createTuyaConnector({
      id: LIVE_TUYA_ID,
      label: 'Tuya Cloud',
      transport: new HttpTuyaTransport(cfg.region),
      clientId: cfg.clientId,
      secret: cfg.secret,
      uid: cfg.uid || undefined,
    }),
  }
}


/** Build the browser-side ONVIF connector. The bridge performs the actual LAN/SOAP work. */
function makeLiveOnvifDescriptor(cfg: OnvifLiveConfig): ConnectorDescriptor {
  const camera: OnvifCameraConfig = {
    id: cfg.cameraId.trim() || 'onvif-camera',
    name: cfg.cameraName.trim() || 'ONVIF Kamera',
    host: cfg.host.trim(),
    port: cfg.port,
    username: cfg.username.trim(),
    password: cfg.password,
  }
  return {
    label: cfg.cameraName.trim() || 'ONVIF Kamera',
    kind: 'onvif',
    make: () => createOnvifConnector({
      id: LIVE_ONVIF_ID,
      label: cfg.cameraName.trim() || 'ONVIF Kamera',
      transport: new HttpOnvifTransport(cfg.bridgeUrl.trim(), cfg.bridgeToken.trim() || undefined),
      cameras: [camera],
      pollMs: 5000,
    }),
  }
}

const SOURCE: Record<string, { short: string; color: string }> = {
  'home-assistant': { short: 'HA', color: '#C7A24E' },
  [LIVE_HA_ID]: { short: 'HA Live', color: '#41bd84' },
  [LIVE_TUYA_ID]: { short: 'Tuya Live', color: '#ff5b00' },
  [LIVE_ONVIF_ID]: { short: 'ONVIF Live', color: '#8f7cff' },
  [LIVE_GOVEE_ID]: { short: 'Govee Live', color: '#4a9dff' },
  [LIVE_SB_ID]: { short: 'SwitchBot Live', color: '#e05a4e' },
  mqtt: { short: 'MQTT', color: '#16a766' },
  ...Object.fromEntries(ECOSYSTEM_SPECS.map((s) => [s.id, { short: s.short, color: s.color }])),
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

/**
 * Die stufenlosen Fähigkeiten eines Live-Geräts: Helligkeit, Farbe,
 * Farbtemperatur.
 *
 * Bis hierher konnte die App an einem echten Gerät **nur schalten**. Die
 * Marken-Clients konnten längst mehr — Govee bildet `brightness`, `colorRgb`
 * und `colorTemperatureK` ab, die Domäne kennt die Capabilities, die Chips
 * unter dem Gerätenamen zeigten sie sogar an — aber der einzige Kommandopfad
 * war `onToggle`, und der kennt `OnOff` und `Lock`. Eine Lampe liess sich also
 * ein- und ausschalten, und das war alles, was je bei ihr ankam.
 *
 * Gerendert wird strikt nach `access`: was der Connector als `read` meldet,
 * wird angezeigt, aber nicht bedienbar gemacht.
 */
function LiveCapabilityControls({ device, onCommand }: {
  device: Device
  onCommand: (cmd: DeviceCommand) => void
}) {
  const brightness = findCapability(device.capabilities, 'Brightness')
  const colour = findCapability(device.capabilities, 'Color')
  const temp = findCapability(device.capabilities, 'ColorTemperature')

  const writable = (c: { access?: string } | undefined) => c?.access === 'readWrite'
  if (!writable(brightness) && !writable(colour) && !writable(temp)) return null

  return (
    <div className="mt-2.5 flex flex-col gap-2 pt-2 border-t border-[color:var(--border)]">
      {writable(brightness) && brightness && (
        <label className="flex items-center gap-2">
          <Sun size={12} className="text-[color:var(--muted)] shrink-0" />
          <input
            type="range" min={0} max={100} step={1} defaultValue={brightness.percent}
            aria-label={`Helligkeit ${device.name}`}
            /*
             * `onChange` würde beim Ziehen pro Pixel ein Kommando senden und das
             * Tageslimit der Hersteller-Cloud in Sekunden aufbrauchen (Govee:
             * 10 000 Aufrufe/Tag). `onPointerUp`/`onKeyUp` sendet einmal, wenn
             * der Nutzer den Wert festgelegt hat. Deshalb auch `defaultValue`:
             * der Regler gehört während des Ziehens dem Browser, danach dem
             * Gerätezustand.
             */
            onPointerUp={(e) => onCommand({
              deviceId: device.id, capability: 'Brightness',
              payload: { percent: Number((e.target as HTMLInputElement).value) },
            })}
            onKeyUp={(e) => onCommand({
              deviceId: device.id, capability: 'Brightness',
              payload: { percent: Number((e.target as HTMLInputElement).value) },
            })}
            className="flex-1 accent-[color:var(--accent)] cursor-pointer"
          />
          <span className="text-[10px] tabular-nums w-9 text-right text-[color:var(--muted)]">{brightness.percent}%</span>
        </label>
      )}

      {writable(temp) && temp && (
        <label className="flex items-center gap-2">
          <Thermometer size={12} className="text-[color:var(--muted)] shrink-0" />
          <input
            type="range" min={temp.minKelvin} max={temp.maxKelvin} step={50} defaultValue={temp.kelvin}
            aria-label={`Farbtemperatur ${device.name}`}
            onPointerUp={(e) => onCommand({
              deviceId: device.id, capability: 'ColorTemperature',
              payload: { kelvin: Number((e.target as HTMLInputElement).value) },
            })}
            onKeyUp={(e) => onCommand({
              deviceId: device.id, capability: 'ColorTemperature',
              payload: { kelvin: Number((e.target as HTMLInputElement).value) },
            })}
            className="flex-1 accent-[color:var(--accent)] cursor-pointer"
          />
          <span className="text-[10px] tabular-nums w-11 text-right text-[color:var(--muted)]">{temp.kelvin}K</span>
        </label>
      )}

      {writable(colour) && colour && (
        <label className="flex items-center gap-2">
          <Palette size={12} className="text-[color:var(--muted)] shrink-0" />
          <input
            type="color" defaultValue={colour.hex}
            aria-label={`Farbe ${device.name}`}
            // `onBlur` statt `onChange`: der native Farbwähler feuert `change`
            // fortlaufend, solange das Fenster offen ist.
            onBlur={(e) => onCommand({
              deviceId: device.id, capability: 'Color',
              payload: { hex: e.target.value },
            })}
            className="h-6 w-10 cursor-pointer rounded border border-[color:var(--border)] bg-transparent p-0"
          />
          <span className="text-[10px] tabular-nums text-[color:var(--muted)]">{colour.hex}</span>
        </label>
      )}
    </div>
  )
}

function DeviceCard({ device, flash, commandPhase, rooms, currentRoomId, onToggle, onCommand, onPtz, onAssign, onClear }: {
  device: Device; flash: boolean; commandPhase?: CommandPhase
  rooms: { id: string; name: string }[]; currentRoomId?: string
  onToggle: (d: Device) => void
  onCommand: (cmd: DeviceCommand) => void
  onPtz: (d: Device, x: number, y: number, zoom?: number) => void
  onAssign: (roomId: string) => void; onClear: () => void
}) {
  const src = SOURCE[device.connectorId] ?? { short: device.connectorId, color: 'var(--muted)' }
  const onoff = findCapability(device.capabilities, 'OnOff')
  const lock = findCapability(device.capabilities, 'Lock')
  const writableOnOff = onoff?.access === 'readWrite'
  const writableLock = lock?.access === 'readWrite'
  // Predictive state on the control itself: amber pulse while the command is
  // in flight, a calm morph into the error state when it definitively failed.
  const phaseClass = commandPhase === 'pending' ? 'cmd-pending' : commandPhase === 'failed' ? 'cmd-failed' : ''
  return (
    <div className="rounded-[var(--radius-lg)] border bg-[color:var(--surface-2)] p-3 transition-colors lift" style={{ borderColor: flash ? 'var(--accent)' : 'var(--border)' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-[13px] font-medium leading-tight">{device.name}</div>
        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0" style={{ borderColor: src.color, color: src.color }}>{src.short}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">{device.capabilities.map((c, i) => <CapChip key={i} cap={c} />)}</div>
      {device.category === 'camera' && device.metadata?.ptz === 'true' && (
        <div className="mt-2.5 flex items-center gap-1">
          <button onClick={() => onPtz(device, -0.5, 0)} className="btn btn-sm btn-ghost btn-icon" aria-label="Kamera links"><ChevronLeft size={14} /></button>
          <button onClick={() => onPtz(device, 0, 0.5)} className="btn btn-sm btn-ghost btn-icon" aria-label="Kamera hoch"><ChevronUp size={14} /></button>
          <button onClick={() => onPtz(device, 0, -0.5)} className="btn btn-sm btn-ghost btn-icon" aria-label="Kamera runter"><ChevronDown size={14} /></button>
          <button onClick={() => onPtz(device, 0.5, 0)} className="btn btn-sm btn-ghost btn-icon" aria-label="Kamera rechts"><ChevronRight size={14} /></button>
          <button onClick={() => onPtz(device, 0, 0, -0.5)} className="btn btn-sm btn-ghost btn-icon" aria-label="Zoom heraus"><ZoomOut size={14} /></button>
          <button onClick={() => onPtz(device, 0, 0, 0.5)} className="btn btn-sm btn-ghost btn-icon" aria-label="Zoom hinein"><ZoomIn size={14} /></button>
          <button onClick={() => onPtz(device, 0, 0, 0)} className="btn btn-sm btn-ghost text-[10px]" aria-label="Kamera stoppen">Stop</button>
        </div>
      )}
      <LiveCapabilityControls device={device} onCommand={onCommand} />
      <div className="mt-2.5 flex items-center justify-between gap-2">
        {(writableOnOff || writableLock) ? (
          <button onClick={() => onToggle(device)} className={`spring-press text-[11px] px-2.5 py-1 rounded-md border border-[color:var(--border)] hover:border-[color:var(--accent)] transition-colors ${phaseClass}`}>
            {commandPhase === 'failed'
              ? 'Keine Antwort'
              : writableLock ? (lock?.locked ? 'Entriegeln' : 'Verriegeln') : onoff?.on ? 'Ausschalten' : 'Einschalten'}
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

const TUYA_REGIONS: { id: TuyaRegion; label: string }[] = [
  { id: 'eu', label: 'Europa' }, { id: 'us', label: 'Amerika' },
  { id: 'cn', label: 'China' }, { id: 'in', label: 'Indien' },
]

/**
 * Live Tuya Cloud connection — the real, signed OpenAPI path. The user pastes
 * their Tuya IoT project's Access ID / Secret and links user id; every command
 * is HMAC-SHA256-signed and hits the chosen data centre. Credentials are stored
 * locally (this browser only) and travel only toward Tuya.
 */
function RealTuyaCard({ session, busy, onConnect, onDisconnect }: {
  session?: TwinSession
  busy: boolean
  onConnect: (cfg: TuyaLiveConfig) => void
  onDisconnect: () => void
}) {
  const saved = useMemo(() => loadTuyaConfig(), [])
  const [region, setRegion] = useState<TuyaRegion>(saved.region)
  const [clientId, setClientId] = useState(saved.clientId)
  const [secret, setSecret] = useState(saved.secret)
  const [uid, setUid] = useState(saved.uid)
  const connected = session?.health.status === 'connected'
  const active = !!session && session.health.status !== 'disconnected'
  const canConnect = clientId.trim().length > 8 && secret.trim().length > 8

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3.5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #ff5b00 16%, transparent)', color: '#ff5b00' }}><Plug size={16} /></span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">Tuya Cloud <span className="text-[10px] uppercase tracking-wide ml-1" style={{ color: '#ff5b00' }}>Live</span></div>
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
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Rechenzentrum</span>
            <div className="mt-1 flex gap-1">
              {TUYA_REGIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  className={`spring-press flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${region === r.id ? 'bg-[color:var(--accent)] text-black' : 'bg-[color:var(--surface-2)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
                >{r.label}</button>
              ))}
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Access ID / Client ID</span>
            <input
              value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Tuya IoT Platform → Cloud → Projekt"
              className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]"
              autoComplete="off" spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Access Secret</span>
            <input
              value={secret} onChange={(e) => setSecret(e.target.value)} type="password" placeholder="Access Secret des Projekts"
              className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]"
              autoComplete="off" spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Nutzer-ID <span className="normal-case opacity-70">(optional — „Verknüpfte Geräte")</span></span>
            <input
              value={uid} onChange={(e) => setUid(e.target.value)} placeholder="Tuya App-Account UID"
              className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]"
              autoComplete="off" spellCheck={false}
            />
          </label>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-[color:var(--muted)] leading-tight">Wird nur lokal gespeichert. Jede Anfrage wird HMAC-SHA256-signiert.</span>
            <button
              onClick={() => onConnect({ region, clientId: clientId.trim(), secret: secret.trim(), uid: uid.trim() })}
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

/**
 * Live Hersteller-Clouds — Govee (API-Key) + SwitchBot (Token + Secret).
 *
 * The two vendors differ in one way that decides whether they work at all, and
 * the UI has to say so rather than offer one shared "optional" relay field:
 *
 *   Govee      OPTIONS → 200, `access-control-allow-origin` for the app origin.
 *              Reachable straight from the browser; the relay is optional.
 *   SwitchBot  OPTIONS → 404 "no Route matched", no CORS header on any response.
 *              Unreachable from a browser. The relay is *required*.
 *
 * Every SwitchBot request carries `Authorization`, which is not a safelisted
 * header, so a preflight always happens and always fails — dropping the
 * signature for a plain API key changes nothing.
 *
 * Credentials stay in this browser. Sits beside HA-Live and Tuya-Live.
 */
type CloudVendor = 'govee' | 'switchbot'
function CloudBrandsCard({ sessions, busy, onConnect, onDisconnect }: {
  sessions: { govee?: TwinSession; switchbot?: TwinSession }
  busy: string | null
  onConnect: (vendor: CloudVendor, cfg: BrandCloudConfig) => void
  onDisconnect: (vendor: CloudVendor) => void
}) {
  const saved = useMemo(() => loadCloudConfig(), [])
  const [goveeKey, setGoveeKey] = useState(saved.goveeKey)
  const [sbToken, setSbToken] = useState(saved.sbToken)
  const [sbSecret, setSbSecret] = useState(saved.sbSecret)
  const [relay, setRelay] = useState(saved.relay)
  const cfg = (): BrandCloudConfig => ({ goveeKey: goveeKey.trim(), sbToken: sbToken.trim(), sbSecret: sbSecret.trim(), relay: relay.trim() })

  const vendorRow = (vendor: CloudVendor, label: string, canConnect: boolean, session?: TwinSession) => {
    const active = !!session && session.health.status !== 'disconnected'
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0"><span className="text-[12px] font-medium">{label}</span><StatusDot session={session} /></div>
        {active ? (
          <button onClick={() => onDisconnect(vendor)} disabled={busy === vendor} className="btn btn-sm btn-ghost inline-flex items-center gap-1.5 shrink-0">
            {busy === vendor ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />} Trennen
          </button>
        ) : (
          <button onClick={() => onConnect(vendor, cfg())} disabled={!canConnect || busy === vendor} className="btn btn-sm btn-primary inline-flex items-center gap-1.5 shrink-0">
            {busy === vendor ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Live verbinden
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3.5 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #4a9dff 16%, transparent)', color: '#4a9dff' }}><Cloud size={16} /></span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Hersteller-Clouds <span className="text-[10px] uppercase tracking-wide ml-1" style={{ color: '#41bd84' }}>Live</span></div>
          <div className="text-[10px] text-[color:var(--muted)]">Govee &amp; SwitchBot direkt — schaltet physisch über die offizielle API.</div>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Govee API-Key</span>
          <input value={goveeKey} onChange={(e) => setGoveeKey(e.target.value)} type="password" placeholder="Govee Home App → Über uns → API-Key"
            className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">
            Relay-URL <span style={{ color: '#d8635f' }}>· für SwitchBot nötig</span>
          </span>
          <input value={relay} onChange={(e) => setRelay(e.target.value)} placeholder="https://<ref>.supabase.co/functions/v1/vendor-relay"
            className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">SwitchBot Token</span>
          <input value={sbToken} onChange={(e) => setSbToken(e.target.value)} type="password" placeholder="SwitchBot App → Profil → Einstellungen → Entwickler"
            className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">SwitchBot Secret</span>
          <input value={sbSecret} onChange={(e) => setSbSecret(e.target.value)} type="password" placeholder="Client Secret (v1.1)"
            className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <div className="space-y-2 pt-1 border-t border-[color:var(--border)]">
        {vendorRow('govee', 'Govee Cloud', goveeKey.trim().length > 10, sessions.govee)}
        {vendorRow(
          'switchbot', 'SwitchBot Cloud',
          // The relay is part of what makes a SwitchBot connection possible, so
          // it belongs in the precondition — offering the button without it only
          // produces a "Load failed" the user cannot act on.
          sbToken.trim().length > 10 && sbSecret.trim().length > 10 && relay.trim().length > 0,
          sessions.switchbot,
        )}
      </div>
      <div className="text-[10px] text-[color:var(--muted)] leading-snug">
        Zugangsdaten bleiben nur in diesem Browser. Govee antwortet mit CORS-Headern und geht ohne Relay;
        SwitchBot beantwortet den Preflight nicht und ist aus dem Browser <em>nur</em> über das Relay erreichbar —
        auch mit reinem API-Key, denn blockiert wird der <code>Authorization</code>-Header, nicht die Signatur.
        Relay-Funktion liegt im Repo, Anleitung: docs/CONNECTOR_SETUP.md.
      </div>
      {(sessions.govee?.health.status === 'error' || sessions.switchbot?.health.status === 'error') && (
        <div className="flex items-start gap-1.5 text-[11px] text-[#d8635f]"><AlertCircle size={12} className="mt-0.5 shrink-0" />{sessions.govee?.health.message ?? sessions.switchbot?.health.message ?? 'Verbindung fehlgeschlagen'}</div>
      )}
    </div>
  )
}

/**
 * Live ONVIF connection. Credentials are sent only to the configured local
 * bridge; the camera password is intentionally not persisted by the UI.
 */
function RealOnvifCard({ session, busy, onConnect, onDisconnect }: {
  session?: TwinSession
  busy: boolean
  onConnect: (cfg: OnvifLiveConfig) => void
  onDisconnect: () => void
}) {
  const saved = useMemo(() => loadOnvifConfig(), [])
  const [bridgeUrl, setBridgeUrl] = useState(saved.bridgeUrl)
  const [bridgeToken, setBridgeToken] = useState(saved.bridgeToken)
  const [cameraId, setCameraId] = useState(saved.cameraId)
  const [cameraName, setCameraName] = useState(saved.cameraName)
  const [host, setHost] = useState(saved.host)
  const [port, setPort] = useState(String(saved.port))
  const [username, setUsername] = useState(saved.username)
  const [password, setPassword] = useState(saved.password)
  const connected = session?.health.status === 'connected'
  const active = !!session && session.health.status !== 'disconnected'
  const canConnect = bridgeUrl.trim().length > 8 && host.trim().length > 6 && username.trim().length > 0 && password.length > 0

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-3.5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: 'color-mix(in srgb, #8f7cff 16%, transparent)', color: '#8f7cff' }}><Video size={16} /></span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate">ONVIF Kamera <span className="text-[10px] uppercase tracking-wide ml-1" style={{ color: '#8f7cff' }}>Live</span></div>
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
          <div className="grid grid-cols-2 gap-2">
            <label className="block col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Bridge-URL</span>
              <input value={bridgeUrl} onChange={(e) => setBridgeUrl(e.target.value)} placeholder="http://127.0.0.1:8787" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Kamera-IP</span>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.0.107" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">ONVIF-Port</span>
              <input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="8000" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Benutzer</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="username" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">ONVIF-Passwort</span>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="Passwort" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block col-span-2">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Bridge-Token (optional, empfohlen)</span>
              <input value={bridgeToken} onChange={(e) => setBridgeToken(e.target.value)} type="password" placeholder="OMEGA_ONVIF_BRIDGE_TOKEN" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="text-[10px] text-[color:var(--muted)] leading-tight">Kamera-Passwort wird nicht im Browser gespeichert. Die Bridge spricht ONVIF im LAN.</span>
            <button
              onClick={() => onConnect({
                bridgeUrl: bridgeUrl.trim(), bridgeToken: bridgeToken.trim(),
                cameraId: cameraId.trim() || 'onvif-camera', cameraName: cameraName.trim() || 'ONVIF Kamera',
                host: host.trim(), port: Number(port) || 8000, username: username.trim(), password,
              })}
              disabled={!canConnect || busy}
              className="btn btn-sm btn-primary inline-flex items-center gap-1.5 shrink-0"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />} Verbinden
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Kamera-ID</span>
              <input value={cameraId} onChange={(e) => setCameraId(e.target.value)} placeholder="arenti-outdoor" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Name</span>
              <input value={cameraName} onChange={(e) => setCameraName(e.target.value)} placeholder="Arenti Außenkamera" className="mt-1 w-full text-[12px] px-2.5 py-1.5 rounded-md bg-[color:var(--surface-2)] border border-[color:var(--border)] outline-none focus:border-[color:var(--accent)]" />
            </label>
          </div>
          {session?.health.status === 'error' && (
            <div className="flex items-start gap-1.5 text-[11px] text-[#d8635f]"><AlertCircle size={12} className="mt-0.5 shrink-0" />{session.health.message ?? 'ONVIF-Verbindung fehlgeschlagen'}</div>
          )}
        </div>
      )}

      {connected && (
        <div className="flex items-center gap-1.5 text-[11px] text-[#3fb27f]"><CheckCircle2 size={12} /> ONVIF live verbunden — PTZ-Befehle gehen direkt an die Kamera.</div>
      )}
    </div>
  )
}

type WizardSource = 'ha-live' | 'tuya-live' | 'onvif-live' | 'sim'

/**
 * ConnectDeviceWizard — the unified "Gerät verbinden" flow.
 *
 * One guided path replaces the scattered connection cards: pick a source →
 * enter credentials (live sources only) → connect & discover → assign the
 * found devices to plan rooms. Every source ends as the same neutral
 * `Connector`, adopted into the shared twin; the wizard only orchestrates.
 */
function ConnectDeviceWizard({ roomOptions, onClose }: {
  roomOptions: { id: string; name: string }[]
  onClose: () => void
}) {
  const manager = twinManager()
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0)
  const [source, setSource] = useState<WizardSource>('ha-live')
  const [simId, setSimId] = useState<string>(ECOSYSTEM_SPECS[0]?.id ?? '')
  const [ha, setHa] = useState<HaLiveConfig>(loadHaConfig)
  const [tuya, setTuya] = useState<TuyaLiveConfig>(loadTuyaConfig)
  const [onvif, setOnvif] = useState<OnvifLiveConfig>(loadOnvifConfig)
  const [connectorId, setConnectorId] = useState<string | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | undefined>()

  // Watch the twin for this wizard's connector coming online + its devices.
  useEffect(() => {
    if (!connectorId) return
    return manager.subscribe((v) => {
      setDevices(v.devices.filter((d) => d.connectorId === connectorId))
      setBindings(v.bindings)
      const sess = v.sessions.find((s) => s.id === connectorId)
      if (sess?.health.status === 'error') setError(sess.health.message ?? 'Verbindung fehlgeschlagen')
      else if (sess?.health.status === 'connected' && step === 2) setStep(3)
    })
  }, [connectorId, manager, step])

  const build = (): { descriptor: ConnectorDescriptor; id: string } | null => {
    if (source === 'ha-live') { saveHaConfig(ha); return { descriptor: makeLiveHaDescriptor(ha), id: LIVE_HA_ID } }
    if (source === 'tuya-live') { saveTuyaConfig(tuya); return { descriptor: makeLiveTuyaDescriptor(tuya), id: LIVE_TUYA_ID } }
    if (source === 'onvif-live') { saveOnvifConfig(onvif); return { descriptor: makeLiveOnvifDescriptor(onvif), id: LIVE_ONVIF_ID } }
    const spec = ECOSYSTEM_SPECS.find((s) => s.id === simId)
    if (!spec) return null
    return { descriptor: { label: spec.label, kind: spec.id, make: () => createEcosystemConnector(spec) }, id: spec.id }
  }

  async function connect() {
    const built = build()
    if (!built) return
    setError(undefined)
    setConnectorId(built.id)
    setStep(2)
    if (!manager.isActive(built.id)) await manager.addConnector(built.descriptor)
  }

  const canCredentials = source === 'ha-live'
    ? ha.url.trim().length > 3 && ha.token.trim().length > 20
    : source === 'tuya-live'
      ? tuya.clientId.trim().length > 8 && tuya.secret.trim().length > 8
      : source === 'onvif-live'
        ? onvif.bridgeUrl.trim().length > 8 && onvif.host.trim().length > 6 && onvif.username.trim().length > 0 && onvif.password.length > 0
        : !!simId

  const STEP_LABELS = ['Quelle', 'Zugang', 'Verbinden', 'Räume']

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center scrim p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--border)]">
          <div className="flex items-center gap-2.5">
            <Sparkles size={17} className="text-[color:var(--accent)]" />
            <div className="font-display text-[15px] font-semibold">Gerät verbinden</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Schließen"><X size={16} /></button>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1.5 px-5 pt-4">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-1.5">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${i <= step ? 'bg-[color:var(--accent)] text-black' : 'bg-[color:var(--surface-3)] text-[color:var(--muted)]'}`}>
                {i < step ? <Check size={11} /> : i + 1}
              </span>
              <span className={`text-[11px] ${i === step ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted)]'}`}>{label}</span>
              {i < STEP_LABELS.length - 1 && <span className={`h-px flex-1 ${i < step ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--border)]'}`} />}
            </div>
          ))}
        </div>

        <div className="px-5 py-5 min-h-[240px]">
          {/* Step 0 — source */}
          {step === 0 && (
            <div className="space-y-2">
              {([
                { k: 'ha-live', label: 'Home Assistant', sub: 'Echte Verbindung · WebSocket + Token', color: '#41bd84', icon: Server },
                { k: 'tuya-live', label: 'Tuya Cloud', sub: 'Echte Verbindung · signierte OpenAPI', color: '#ff5b00', icon: Plug },
                { k: 'onvif-live', label: 'ONVIF Kamera', sub: 'Echte Verbindung · LAN + PTZ', color: '#8f7cff', icon: Video },
                { k: 'sim', label: 'Simuliertes Ökosystem', sub: '30 Marken · sofort, ohne Zugangsdaten', color: 'var(--accent)', icon: Sparkles },
              ] as const).map((o) => (
                <button
                  key={o.k}
                  onClick={() => setSource(o.k)}
                  className={`spring-press flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${source === o.k ? 'border-[color:var(--accent)] bg-[rgba(199,162,78,0.08)]' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${o.color} 16%, transparent)`, color: o.color }}><o.icon size={17} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{o.label}</span>
                    <span className="block text-[11px] text-[color:var(--muted)]">{o.sub}</span>
                  </span>
                  {source === o.k && <CheckCircle2 size={16} className="shrink-0 text-[color:var(--accent)]" />}
                </button>
              ))}
            </div>
          )}

          {/* Step 1 — credentials */}
          {step === 1 && source === 'ha-live' && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Home-Assistant-Adresse</span>
                <input value={ha.url} onChange={(e) => setHa({ ...ha, url: e.target.value })} placeholder="https://dein-ha.ui.nabu.casa" className="input mt-1 !py-1.5 text-[12px]" autoComplete="off" spellCheck={false} />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Long-Lived Access Token</span>
                <input value={ha.token} onChange={(e) => setHa({ ...ha, token: e.target.value })} type="password" placeholder="Profil → Sicherheit → Token" className="input mt-1 !py-1.5 text-[12px]" autoComplete="off" spellCheck={false} />
              </label>
              <p className="text-[11px] text-[color:var(--muted)]">Wird nur lokal gespeichert. HA muss per HTTPS erreichbar sein.</p>
            </div>
          )}
          {step === 1 && source === 'tuya-live' && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Rechenzentrum</span>
                <div className="mt-1 flex gap-1">
                  {TUYA_REGIONS.map((r) => (
                    <button key={r.id} onClick={() => setTuya({ ...tuya, region: r.id })} className={`spring-press flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${tuya.region === r.id ? 'bg-[color:var(--accent)] text-black' : 'bg-[color:var(--surface-2)] text-[color:var(--muted)]'}`}>{r.label}</button>
                  ))}
                </div>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Access ID / Client ID</span>
                <input value={tuya.clientId} onChange={(e) => setTuya({ ...tuya, clientId: e.target.value })} placeholder="Tuya IoT → Cloud → Projekt" className="input mt-1 !py-1.5 text-[12px]" autoComplete="off" spellCheck={false} />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Access Secret</span>
                <input value={tuya.secret} onChange={(e) => setTuya({ ...tuya, secret: e.target.value })} type="password" placeholder="Access Secret" className="input mt-1 !py-1.5 text-[12px]" autoComplete="off" spellCheck={false} />
              </label>
              <p className="text-[11px] text-[color:var(--muted)]">Jede Anfrage wird HMAC-SHA256-signiert. Nur lokal gespeichert.</p>
            </div>
          )}
          {step === 1 && source === 'onvif-live' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">ONVIF-Bridge</span>
                  <input value={onvif.bridgeUrl} onChange={(e) => setOnvif({ ...onvif, bridgeUrl: e.target.value })} placeholder="http://127.0.0.1:8787" className="input mt-1 !py-1.5 text-[12px]" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Kamera-IP</span>
                  <input value={onvif.host} onChange={(e) => setOnvif({ ...onvif, host: e.target.value })} placeholder="192.168.0.107" className="input mt-1 !py-1.5 text-[12px]" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">ONVIF-Port</span>
                  <input value={String(onvif.port)} onChange={(e) => setOnvif({ ...onvif, port: Number(e.target.value) || 8000 })} inputMode="numeric" placeholder="8000" className="input mt-1 !py-1.5 text-[12px]" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Benutzer</span>
                  <input value={onvif.username} onChange={(e) => setOnvif({ ...onvif, username: e.target.value })} placeholder="admin" className="input mt-1 !py-1.5 text-[12px]" autoComplete="username" />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Passwort</span>
                  <input value={onvif.password} onChange={(e) => setOnvif({ ...onvif, password: e.target.value })} type="password" placeholder="ONVIF-Passwort" className="input mt-1 !py-1.5 text-[12px]" autoComplete="current-password" />
                </label>
                <label className="block col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Bridge-Token (optional)</span>
                  <input value={onvif.bridgeToken} onChange={(e) => setOnvif({ ...onvif, bridgeToken: e.target.value })} type="password" placeholder="OMEGA_ONVIF_BRIDGE_TOKEN" className="input mt-1 !py-1.5 text-[12px]" />
                </label>
              </div>
              <p className="text-[11px] text-[color:var(--muted)]">Die Bridge spricht ONVIF direkt im LAN. Das Kamera-Passwort wird nicht in localStorage geschrieben. PTZ wird über den neutralen Camera-Command an den bestehenden Twin geroutet.</p>
            </div>
          )}

          {step === 1 && source === 'sim' && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Ökosystem</span>
                <select value={simId} onChange={(e) => setSimId(e.target.value)} className="input mt-1 !py-1.5 text-[12px]">
                  {ECOSYSTEM_SPECS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <p className="text-[11px] text-[color:var(--muted)]">Keine Zugangsdaten nötig — eine markentypische Geräteflotte wird simuliert.</p>
            </div>
          )}

          {/* Step 2 — connecting */}
          {step === 2 && (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              {error ? (
                <>
                  <AlertCircle size={26} className="text-[#d8635f]" />
                  <div className="text-[13px] text-[#d8635f]">{error}</div>
                  <button onClick={() => setStep(1)} className="btn btn-sm btn-outline">Zugangsdaten prüfen</button>
                </>
              ) : (
                <>
                  <Loader2 size={26} className="animate-spin text-[color:var(--accent)]" />
                  <div className="text-[13px] text-[color:var(--muted)]">Verbinde und suche Geräte …</div>
                </>
              )}
            </div>
          )}

          {/* Step 3 — room assignment */}
          {step === 3 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[12px] text-[#3fb27f]"><CheckCircle2 size={14} /> {devices.length} {devices.length === 1 ? 'Gerät' : 'Geräte'} gefunden — Räume zuordnen:</div>
              <div className="max-h-[280px] space-y-1.5 overflow-y-auto omega-scroll pr-1">
                {devices.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)] p-2">
                    <span className="min-w-0 flex-1 truncate text-[12px]">{d.name}</span>
                    <select
                      value={bindings[d.id] ?? ''}
                      onChange={(e) => (e.target.value ? manager.setBinding(d.id, e.target.value) : manager.clearBinding(d.id))}
                      className="shrink-0 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] px-1.5 py-1 text-[11px] text-[color:var(--muted)] outline-none"
                    >
                      <option value="">Auto</option>
                      {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                ))}
                {devices.length === 0 && <div className="text-[12px] text-[color:var(--muted)]">Keine steuerbaren Geräte gefunden.</div>}
              </div>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--border)] px-5 py-3">
          <button
            onClick={() => (step === 0 ? onClose() : setStep((s) => Math.max(0, s - 1) as 0 | 1 | 2 | 3))}
            className="btn btn-sm btn-ghost inline-flex items-center gap-1.5"
            disabled={step === 2 && !error}
          >
            {step === 0 ? 'Abbrechen' : <><ChevronLeft size={14} /> Zurück</>}
          </button>
          {step === 0 && <button onClick={() => setStep(1)} className="btn btn-sm btn-primary inline-flex items-center gap-1.5">Weiter <ArrowRight size={14} /></button>}
          {step === 1 && <button onClick={() => void connect()} disabled={!canCredentials} className="btn btn-sm btn-primary inline-flex items-center gap-1.5"><Plug size={14} /> Verbinden</button>}
          {step === 3 && <button onClick={onClose} className="btn btn-sm btn-primary inline-flex items-center gap-1.5"><Check size={14} /> Fertig</button>}
        </div>
      </div>
    </div>
  )
}

export function ConnectorManager({ onClose }: { onClose: () => void }) {
  const { can } = useTier()
  const manager = twinManager()
  const doc = usePlanStore((s) => s.doc)
  const floor = doc ? (doc.floors.find((f) => f.id === doc.activeFloorId) ?? doc.floors[0]) : undefined
  const rooms = useMemo(() => floor?.rooms ?? [], [floor])

  const [devices, setDevices] = useState<Device[]>(manager.view().devices)
  const [sessions, setSessions] = useState<TwinSession[]>(manager.view().sessions)
  const [bindings, setBindings] = useState<Record<string, string>>(manager.view().bindings)
  const [activeScene, setActiveScene] = useState<string | undefined>(manager.view().activeScene)
  const [commands, setCommands] = useState<Record<string, CommandPhase>>(manager.view().commands)
  const [busy, setBusy] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [view, setView] = useState<'grundriss' | 'geraete'>('grundriss')
  const [wizardOpen, setWizardOpen] = useState(false)
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
      setCommands(v.commands)
      if (changed) setFlashId(changed)
    })
    return () => unsub()
  }, [manager])

  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 600)
    return () => clearTimeout(t)
  }, [flashId])

  // A definitive command failure answers with a short haptic double tap.
  useFailureHaptics(commands)
  // The control a DeviceCard renders commands Lock first, then OnOff.
  const phaseFor = (d: Device): CommandPhase | undefined =>
    commands[commandKey(d.id, 'Lock')] ?? commands[commandKey(d.id, 'OnOff')]

  const binding = useMemo(() => resolveRoomBinding(devices, rooms, bindings), [devices, rooms, bindings])
  const roomOptions = rooms.map((r) => ({ id: r.id, name: r.name }))
  const sessionFor = (id: string) => sessions.find((s) => s.id === id)
  const activeSources = new Set(devices.map((d) => d.connectorId)).size
  // "Alle verbinden" spans the demos AND every ecosystem — the whole catalog.
  const allTotal = CATALOG.length + ECO_ENTRIES.length
  const allActive = [...CATALOG, ...ECO_ENTRIES].filter((e) => manager.isActive(e.id)).length

  async function toggleConnector(entry: CatalogEntry) {
    setBusy(entry.id)
    try {
      if (manager.isActive(entry.id)) await manager.removeConnector(entry.id)
      else await manager.addConnector(entry)
    } finally { setBusy(null) }
  }

  const [allBusy, setAllBusy] = useState(false)
  /** Bring every simulated source online (demos + all ecosystems) at once. */
  async function connectAll() {
    setAllBusy(true)
    try {
      const pending = [...CATALOG, ...ECO_ENTRIES].filter((e) => !manager.isActive(e.id))
      // Sequential keeps the connect handshakes calm and the UI counter ticking.
      for (const e of pending) await manager.addConnector(e)
    } finally { setAllBusy(false) }
  }
  async function disconnectAll() {
    setAllBusy(true)
    try {
      const active = [...CATALOG, ...ECO_ENTRIES].filter((e) => manager.isActive(e.id))
      for (const e of active) await manager.removeConnector(e.id)
    } finally { setAllBusy(false) }
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

  async function connectLiveTuya(cfg: TuyaLiveConfig) {
    saveTuyaConfig(cfg)
    setBusy(LIVE_TUYA_ID)
    try { await manager.addConnector(makeLiveTuyaDescriptor(cfg)) } finally { setBusy(null) }
  }
  async function disconnectLiveTuya() {
    setBusy(LIVE_TUYA_ID)
    try { await manager.removeConnector(LIVE_TUYA_ID) } finally { setBusy(null) }
  }

  async function connectLiveOnvif(cfg: OnvifLiveConfig) {
    saveOnvifConfig(cfg)
    setBusy(LIVE_ONVIF_ID)
    try { await manager.addConnector(makeLiveOnvifDescriptor(cfg)) } finally { setBusy(null) }
  }
  async function disconnectLiveOnvif() {
    setBusy(LIVE_ONVIF_ID)
    try { await manager.removeConnector(LIVE_ONVIF_ID) } finally { setBusy(null) }
  }

  async function connectCloud(vendor: CloudVendor, cfg: BrandCloudConfig) {
    saveCloudConfig(cfg)
    setBusy(vendor)
    try {
      const id = vendor === 'govee' ? LIVE_GOVEE_ID : LIVE_SB_ID
      const label = vendor === 'govee' ? 'Govee Cloud' : 'SwitchBot Cloud'
      const client = vendor === 'govee'
        ? createGoveeClient({ apiKey: cfg.goveeKey, baseUrl: relayBase(cfg.relay, 'govee') })
        : createSwitchBotClient({ token: cfg.sbToken, secret: cfg.sbSecret, baseUrl: relayBase(cfg.relay, 'switchbot') })
      await manager.addConnector({ label, kind: vendor, make: () => createBrandConnector({ id, label, client }) })
    } finally { setBusy(null) }
  }
  async function disconnectCloud(vendor: CloudVendor) {
    setBusy(vendor)
    try { await manager.removeConnector(vendor === 'govee' ? LIVE_GOVEE_ID : LIVE_SB_ID) } finally { setBusy(null) }
  }

  function onDevicePtz(d: Device, x: number, y: number, zoom = 0) {
    const action = x === 0 && y === 0 && zoom === 0 ? 'stop' : 'ptz'
    void manager.command({
      deviceId: d.id,
      capability: 'Camera',
      payload: action === 'stop'
        ? { action: 'stop' }
        : { action, x, y, zoom, timeoutMs: 500 },
    }, { timeoutMs: 2500 })
  }

  /** Ein stufenloses Kommando (Helligkeit, Farbe, Farbtemperatur) an das Gerät. */
  function onDeviceCommand(cmd: DeviceCommand) {
    void manager.command(cmd)
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
        <div className="flex items-center gap-2">
          {can('voice-control') && (
            <VoiceControl devices={devices} onRun={(cmds) => cmds.forEach((c) => void manager.command(c))} />
          )}
          <button onClick={() => setWizardOpen(true)} className="btn btn-sm btn-primary inline-flex items-center gap-1.5">
            <Sparkles size={14} /> Gerät verbinden
          </button>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Schließen"><X size={18} /></button>
        </div>
      </div>
      {wizardOpen && <ConnectDeviceWizard roomOptions={roomOptions} onClose={() => setWizardOpen(false)} />}

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
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Alle Ökosysteme · Simuliert</div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[color:var(--muted)]">{ECO_ENTRIES.filter((e) => manager.isActive(e.id)).length} / {ECO_ENTRIES.length} verbunden</span>
                  <button
                    onClick={() => (allActive >= allTotal ? void disconnectAll() : void connectAll())}
                    disabled={allBusy}
                    className="btn btn-sm btn-outline inline-flex items-center gap-1.5"
                  >
                    {allBusy ? <Loader2 size={12} className="animate-spin" /> : allActive >= allTotal ? <Unplug size={12} /> : <Plug size={12} />}
                    {allActive >= allTotal ? 'Alle trennen' : 'Alle verbinden'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 stagger">
                {ECO_ENTRIES.map((entry) => {
                  const Icon = entry.icon
                  const spec = ECOSYSTEM_SPECS.find((sp) => sp.id === entry.id)!
                  const active = manager.isActive(entry.id) || !!sessionFor(entry.id)
                  return (
                    <button
                      key={entry.id}
                      onClick={() => toggleConnector(entry)}
                      disabled={busy === entry.id}
                      title={active ? `${entry.label} trennen` : `${entry.label} verbinden (${spec.fleet.length} Geräte)`}
                      className="flex items-center gap-2 rounded-lg border bg-[color:var(--bg)] px-2.5 py-2 text-left transition-colors hover:border-[color:var(--accent)]"
                      style={{ borderColor: active ? spec.color : 'var(--border)' }}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `color-mix(in srgb, ${spec.color} 16%, transparent)`, color: spec.color }}>
                        {busy === entry.id ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium leading-tight">{entry.label}</span>
                        <span className="block text-[10px] text-[color:var(--muted)]">{active ? 'verbunden' : `${spec.fleet.length} Geräte`}</span>
                      </span>
                      {active
                        ? <CheckCircle2 size={13} className="shrink-0" style={{ color: spec.color }} />
                        : <Plug size={13} className="shrink-0 text-[color:var(--muted)]" />}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-[color:var(--border)] space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mb-2">Echte Verbindung · schaltet physisch</div>
              <RealHaCard session={sessionFor(LIVE_HA_ID)} busy={busy === LIVE_HA_ID} onConnect={connectLiveHa} onDisconnect={disconnectLiveHa} />
              <RealTuyaCard session={sessionFor(LIVE_TUYA_ID)} busy={busy === LIVE_TUYA_ID} onConnect={connectLiveTuya} onDisconnect={disconnectLiveTuya} />
              <RealOnvifCard session={sessionFor(LIVE_ONVIF_ID)} busy={busy === LIVE_ONVIF_ID} onConnect={connectLiveOnvif} onDisconnect={disconnectLiveOnvif} />
              <CloudBrandsCard
                sessions={{ govee: sessionFor(LIVE_GOVEE_ID), switchbot: sessionFor(LIVE_SB_ID) }}
                busy={busy}
                onConnect={connectCloud}
                onDisconnect={disconnectCloud}
              />
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
                          {rd.map((d) => <DeviceCard key={d.id} device={d} flash={flashId === d.id} commandPhase={phaseFor(d)} rooms={roomOptions} currentRoomId={binding.roomOf.get(d.id)} onToggle={onDeviceToggle} onCommand={onDeviceCommand} onPtz={onDevicePtz} onAssign={(rid) => manager.setBinding(d.id, rid)} onClear={() => manager.clearBinding(d.id)} />)}
                        </div>
                      </div>
                    )
                  })}
                  {binding.unassigned.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2"><h3 className="text-[13px] font-semibold text-[color:var(--muted)]">Nicht zugeordnet</h3><span className="text-[11px] text-[color:var(--muted)]">{binding.unassigned.length}</span></div>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger">
                        {binding.unassigned.map((d) => <DeviceCard key={d.id} device={d} flash={flashId === d.id} commandPhase={phaseFor(d)} rooms={roomOptions} currentRoomId={undefined} onToggle={onDeviceToggle} onCommand={onDeviceCommand} onPtz={onDevicePtz} onAssign={(rid) => manager.setBinding(d.id, rid)} onClear={() => manager.clearBinding(d.id)} />)}
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
