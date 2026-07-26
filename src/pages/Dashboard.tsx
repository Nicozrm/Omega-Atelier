import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Home, LayoutPanelLeft, Box, Cpu, Clapperboard, Workflow, Zap,
  Settings, Sun, Moon, Bell, Copy, ChevronDown, ChevronRight, Thermometer,
  Droplets, Leaf, Plug, Lightbulb, PanelTop, MousePointer2, Hand, Orbit,
  Ruler, Grid3X3, RefreshCw, Maximize2, Eye, Move, MoreHorizontal,
  Sunrise, Coffee, LogOut, PartyPopper, AlertTriangle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { createDemoPlan } from '@/data/demoPlan'
import { useUIStore } from '@/store/useUIStore'
import { OMEGA_MODES } from '@/lib/constants'
import { DEVICES } from '@/data/devices'
import type { ModeKey } from '@/types'

const ThreeDView = lazy(() =>
  import('@/components/3d/ThreeDView').then((m) => ({ default: m.ThreeDView })),
)

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

const MODE_ICONS: Record<string, LucideIcon> = {
  'auto': Zap, 'morning': Sunrise, 'day-office': Sun, 'film': Clapperboard,
  'night': Moon, 'relax': Coffee, 'away': LogOut, 'party': PartyPopper,
  'alarm': AlertTriangle,
}

/** Small pill switch (the mockup's blue iOS-style toggle). */
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--surface-3)]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/** Tiny inline sparkline / bar chart, no chart lib. */
function Sparkline({ color = '#3ecf8e' }: { color?: string }) {
  return (
    <svg viewBox="0 0 64 20" className="h-5 w-16">
      <polyline
        points="0,14 8,12 16,15 24,9 32,12 40,6 48,10 56,4 64,8"
        fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  )
}
function Bars({ color = '#3ecf8e' }: { color?: string }) {
  const h = [6, 9, 5, 11, 8, 13, 10, 16, 12, 18, 14, 20]
  return (
    <svg viewBox="0 0 76 22" className="h-6 w-20">
      {h.map((v, i) => (
        <rect key={i} x={i * 6.4} y={22 - v} width="4.2" height={v} rx="1" fill={color} opacity={0.5 + (i / h.length) * 0.5} />
      ))}
    </svg>
  )
}

const NAV: Array<{ icon: LucideIcon; label: string; to?: string; view?: '2d' | '3d' }> = [
  { icon: Home, label: 'Übersicht' },
  { icon: LayoutPanelLeft, label: 'Grundrisse', to: '/plans' },
  { icon: Box, label: '3D Ansicht', to: '/plan/local', view: '3d' },
  { icon: Cpu, label: 'Geräte', to: '/plan/local' },
  { icon: Clapperboard, label: 'Szenen', to: '/plan/local' },
  { icon: Workflow, label: 'Automationen', to: '/plan/local' },
  { icon: Zap, label: 'Energie', to: '/plan/local' },
  { icon: Settings, label: 'Einstellungen', to: '/settings' },
]

const PROJECTS = ['Mein Smart Home', 'Studio Apartment', 'Penthouse', 'Gartenhaus']

/**
 * DashboardPage — the reference "Deine Grundrisse" home screen, rebuilt 1:1:
 * sidebar navigation + projects, OMEGA mode chips, a LIVE embedded 3D preview
 * (not a static image), and the environment / devices / energy column.
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const doc = usePlanStore((s) => s.doc)
  const setActiveMode = usePlanStore((s) => s.setActiveMode)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const activeMode = doc?.activeModeKey ?? 'auto'

  // The dashboard previews the digital twin, so it bootstraps the same demo
  // plan the editor would — without it the store is empty on a fresh visit.
  useEffect(() => {
    if (!doc) loadDocument(createDemoPlan(), false)
  }, [doc, loadDocument])
  const [project] = useState(PROJECTS[0])

  const floor = doc?.floors.find((f) => f.id === doc.activeFloorId)

  const stats = useMemo(() => {
    if (!doc) return { devices: 0, lights: 0, watts: 0, kwh: '0,0' }
    let devices = 0, lights = 0, watts = 0
    for (const f of doc.floors) {
      devices += f.devices.length
      for (const d of f.devices) {
        const e = DEVICE_MAP[d.deviceId]
        if (e?.category === 'light') lights++
        if (e?.power) watts += e.power
      }
    }
    return { devices, lights, watts, kwh: ((watts * 15) / 1000).toFixed(1).replace('.', ',') }
  }, [doc])

  // Device quick-toggles — the first four devices with a known catalog entry.
  // Toggling patches the device's modeState for the ACTIVE mode: the dashboard
  // writes into the same digital twin the 3D scene reads from.
  const quickDevices = useMemo(() => {
    if (!floor) return []
    return floor.devices
      .filter((d) => DEVICE_MAP[d.deviceId])
      .slice(0, 4)
      .map((d) => {
        const e = DEVICE_MAP[d.deviceId]!
        const on = d.modeState?.[activeMode]?.on !== false
        return { id: d.id, name: d.note ?? e.name, sub: e.power ? `${e.power} W` : e.brand, category: e.category, on }
      })
  }, [floor, activeMode])

  const toggleDevice = (id: string, on: boolean) => {
    updateDoc((dr) => {
      const fl = dr.floors.find((f) => f.id === dr.activeFloorId)
      const dev = fl?.devices.find((x) => x.id === id)
      if (!dev) return
      dev.modeState = dev.modeState ?? {}
      dev.modeState[activeMode] = { ...(dev.modeState[activeMode] ?? {}), on }
    })
  }

  const DEV_ICONS: Partial<Record<string, LucideIcon>> = {
    light: Lightbulb, outlet: Plug, blind: PanelTop,
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[color:var(--bg)] text-[color:var(--fg)]">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--bg-elevated)] md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--surface-2)] font-display text-lg text-[color:var(--accent)]">Ω</div>
          <div className="font-display text-base font-semibold tracking-wide">OMEGA <span className="text-[color:var(--accent)]">Atelier</span></div>
        </div>
        <div className="px-4 pb-4">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
            <input className="input pl-8 !py-1.5 text-sm" placeholder="Suchen…" />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[color:var(--muted)]">⌘K</span>
          </div>
        </div>
        <div className="px-5 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">Hauptmenü</div>
        <nav className="space-y-0.5 px-3">
          {NAV.map(({ icon: Icon, label, to, view }, i) => (
            <button
              key={label}
              onClick={() => { if (view) setViewMode(view); if (to) navigate(to) }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                i === 0 ? 'bg-[color:var(--surface-2)] text-[color:var(--fg)]' : 'text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--fg)]'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-6 px-5 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">Projekte</div>
        <div className="space-y-0.5 px-3">
          {PROJECTS.map((p) => (
            <button
              key={p}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                p === project ? 'bg-[rgba(199, 162, 78,0.12)] text-[color:var(--fg)]' : 'text-[color:var(--muted)] hover:bg-[color:var(--surface)]'
              }`}
            >
              <LayoutPanelLeft size={14} />
              <span className="flex-1 truncate text-left">{p}</span>
              {p === project && <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />}
            </button>
          ))}
        </div>
        <div className="mt-auto p-3">
          <div className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--surface-3)] text-sm font-semibold">NZ</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Nico Zimmermann</div>
              <div className="text-xs text-[color:var(--muted)]">Pro Plan</div>
            </div>
            <MoreHorizontal size={16} className="text-[color:var(--muted)]" />
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto omega-scroll">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-[color:var(--border)] px-6 py-3">
          <button className="flex items-center gap-1.5 text-sm font-medium">
            {doc?.title ?? 'Mein Smart Home'} <ChevronDown size={14} className="text-[color:var(--muted)]" />
          </button>
          <div className="flex items-center gap-1">
            {[Sun, Bell, Copy].map((I, i) => (
              <button key={i} className="btn btn-ghost btn-icon"><I size={15} /></button>
            ))}
            <div className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--surface-3)] text-xs font-semibold">NZ</div>
          </div>
        </div>

        <div className="flex flex-1 gap-6 p-6">
          {/* Center column */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-semibold">Deine Grundrisse</h1>
                <p className="mt-1 text-sm text-[color:var(--muted)]">Steuere dein Zuhause mit OMEGA-Modi</p>
              </div>
              <div className="flex gap-2">
                <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <Moon size={15} className="text-[color:var(--accent)]" />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Sonnenstand</div>
                    <div className="text-sm font-medium">Abend</div>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">⚡ Live-Verbrauch</div>
                    <div className="text-sm font-medium">{stats.watts} W</div>
                  </div>
                  <Sparkline />
                </div>
              </div>
            </div>

            {/* Mode chips */}
            <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 omega-scroll">
              {OMEGA_MODES.map((m) => {
                const Icon = MODE_ICONS[m.key] ?? Zap
                const active = m.key === activeMode
                return (
                  <button
                    key={m.key}
                    onClick={() => setActiveMode(m.key as ModeKey)}
                    className={`flex min-w-[92px] shrink-0 flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all ${
                      active
                        ? 'border-[color:var(--accent)] bg-[rgba(199, 162, 78,0.10)] shadow-[0_0_16px_rgba(199, 162, 78,0.25)]'
                        : 'border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]'
                    }`}
                  >
                    <Icon size={16} className={active ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted)]'} />
                    <span className="text-xs font-medium">{m.name}</span>
                    <span className={`text-[10px] ${active ? 'text-[color:var(--accent)]' : 'text-transparent'}`}>Aktiv</span>
                  </button>
                )
              })}
              <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--muted)]">
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Live 3D preview card */}
            <div className="relative mt-4 h-[440px] overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] xl:h-[520px]">
              <Suspense fallback={
                <div className="flex h-full items-center justify-center">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)]" />
                </div>
              }>
                {doc && <ThreeDView embedded preview />}
              </Suspense>
              <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]/85 px-3 py-1.5 backdrop-blur">
                <Box size={13} className="text-[color:var(--accent)]" />
                <div className="text-xs font-medium leading-tight">3D Ansicht<br /><span className="font-normal text-[color:var(--muted)]">Perspektive</span></div>
              </div>
              <div className="absolute right-3 top-3 z-10 flex gap-1">
                {[Move, Eye].map((I, i) => (
                  <button key={i} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]/85 text-[color:var(--muted)] backdrop-blur"><I size={14} /></button>
                ))}
                <button
                  onClick={() => { setViewMode('3d'); navigate('/plan/local') }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]/85 text-[color:var(--muted)] backdrop-blur hover:text-[color:var(--fg)]"
                  title="Im Editor öffnen"
                ><Maximize2 size={14} /></button>
              </div>
              <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 p-1 backdrop-blur">
                {[MousePointer2, Hand, Orbit, Box, Ruler, Grid3X3].map((I, i) => (
                  <span key={i} className={`flex h-7 w-7 items-center justify-center rounded-lg ${i === 0 ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}><I size={13} /></span>
                ))}
              </div>
            </div>

            {/* Bottom status row */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3 text-sm">
              <div className="flex flex-wrap items-center gap-6">
                <div><div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Verbundene Geräte</div><div className="font-medium">{stats.devices}</div></div>
                <div><div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Aktive Szene</div><div className="font-medium">{OMEGA_MODES.find((m) => m.key === activeMode)?.name}</div></div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">Verbunden mit</div>
                  <div className="mt-0.5 flex gap-1.5">
                    {['H', 'A', 'S', 'M'].map((c) => (
                      <span key={c} className="flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--surface-3)] text-[9px] font-semibold text-[color:var(--muted)]">{c}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-[color:var(--muted)]">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e]" /> Live</span>
                <span>Letzte Aktualisierung: Jetzt</span>
                <RefreshCw size={12} />
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="hidden w-72 shrink-0 space-y-4 xl:block">
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="mb-3 text-sm font-semibold">Umgebung</div>
              {[
                { icon: Thermometer, label: 'Temperatur', value: '21,5 °C' },
                { icon: Droplets, label: 'Luftfeuchtigkeit', value: '45 %' },
                { icon: Leaf, label: 'Luftqualität', value: 'Sehr gut', good: true },
              ].map(({ icon: I, label, value, good }) => (
                <div key={label} className="flex items-center justify-between border-b border-[color:var(--border)] py-2.5 text-sm last:border-0">
                  <span className="flex items-center gap-2.5 text-[color:var(--muted)]"><I size={14} /> {label}</span>
                  <span className={`font-medium ${good ? 'text-[#3ecf8e]' : ''}`}>{value}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Geräte</div>
                <button onClick={() => navigate('/plan/local')} className="text-xs text-[color:var(--accent)] hover:underline">Alle anzeigen</button>
              </div>
              {quickDevices.map((d) => {
                const I = DEV_ICONS[d.category] ?? Cpu
                return (
                  <div key={d.id} className="flex items-center gap-3 border-b border-[color:var(--border)] py-2.5 last:border-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--surface-2)] text-[color:var(--muted)]"><I size={14} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{d.name}</div>
                      <div className="text-xs text-[color:var(--muted)]">{d.sub}</div>
                    </div>
                    <Switch on={d.on} onChange={(v) => toggleDevice(d.id, v)} />
                  </div>
                )
              })}
            </div>

            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
              <div className="mb-3 text-sm font-semibold">Energie heute</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="font-display text-2xl font-semibold">{stats.watts} W</div>
                  <div className="text-xs text-[color:var(--muted)]">Aktueller Verbrauch</div>
                </div>
                <Sparkline />
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <div className="font-display text-2xl font-semibold">{stats.kwh} kWh</div>
                  <div className="text-xs text-[color:var(--muted)]">Gesamtverbrauch</div>
                </div>
                <Bars />
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
