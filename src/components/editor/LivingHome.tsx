import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Pause, Sunrise, X, Lock } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useTier } from '@/hooks/useTier'
import { modeForHour, formatClock, phaseLabel } from '@/lib/dayCycle'

/** Real-seconds for one full simulated day when playing. */
const DAY_SECONDS = 30
const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 }

/**
 * LivingHome — the day-cycle player. A single control drives a shared
 * `timeOfDay`; the 2D plan washes with daylight and the active OMEGA mode is
 * auto-selected by the hour, so pressing play sweeps the whole home through a
 * day (morning → day → evening → night) as a living time-lapse. Entering
 * remembers the user's current mode and restores it on exit — non-destructive.
 */
export function LivingHome() {
  const timeOfDay = useUIStore((s) => s.timeOfDay)
  const setTimeOfDay = useUIStore((s) => s.setTimeOfDay)
  const setActiveMode = usePlanStore((s) => s.setActiveMode)
  const { can } = useTier()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)
  const locked = !can('living-home')
  const goUpgrade = useCallback(() => {
    pushToast({ kind: 'info', title: 'Pro-Funktion', description: 'Der Tagesverlauf ist Teil des Pro-Plans.' })
    navigate('/#preise')
  }, [pushToast, navigate])

  const [playing, setPlaying] = useState(false)
  const raf = useRef<number | null>(null)
  const lastTs = useRef(0)
  const lastMode = useRef<string | null>(null)
  const entryMode = useRef<string | null>(null)
  const lastWrite = useRef(0)

  const active = timeOfDay !== null

  // Keep the auto-mode in step with a given hour (during play or a manual scrub).
  const applyTimeMode = useCallback((h: number) => {
    const m = modeForHour(h)
    if (m !== lastMode.current) { lastMode.current = m; setActiveMode(m) }
  }, [setActiveMode])

  const activate = useCallback(() => {
    entryMode.current = usePlanStore.getState().doc?.activeModeKey ?? null
    lastMode.current = null
    const h = nowHour()
    setTimeOfDay(h)
    applyTimeMode(h)
  }, [setTimeOfDay, applyTimeMode])

  const deactivate = useCallback(() => {
    setPlaying(false)
    setTimeOfDay(null)
    if (entryMode.current) setActiveMode(entryMode.current as never)
  }, [setTimeOfDay, setActiveMode])

  // Play loop — advance the clock, throttling store writes to keep it smooth
  // without flooding React with 60 updates/s.
  useEffect(() => {
    if (!playing) return
    lastTs.current = 0
    const step = (ts: number) => {
      if (!lastTs.current) lastTs.current = ts
      const dt = (ts - lastTs.current) / 1000
      lastTs.current = ts
      const cur = useUIStore.getState().timeOfDay ?? nowHour()
      const next = (cur + dt * (24 / DAY_SECONDS)) % 24
      if (ts - lastWrite.current > 40) {
        lastWrite.current = ts
        setTimeOfDay(next)
        applyTimeMode(next)
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [playing, setTimeOfDay, applyTimeMode])

  // Clean up if the component unmounts while active.
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  if (!active) {
    return (
      <button
        onClick={locked ? goUpgrade : activate}
        className="glass spring-press absolute bottom-16 left-3 z-20 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-[color:var(--fg)] md:bottom-4"
        title={locked ? 'Tagesverlauf — im Pro-Plan enthalten' : 'Tagesverlauf abspielen — das Zuhause durch einen Tag'}
      >
        <Sunrise size={14} className="text-[color:var(--accent-bright)]" />
        <span className="hidden sm:inline">Tagesverlauf</span>
        {locked && <Lock size={11} className="text-[color:var(--muted)]" />}
      </button>
    )
  }

  const t = timeOfDay as number
  return (
    <div className="glass absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full px-2.5 py-2 md:bottom-4">
      <button onClick={() => setPlaying((p) => !p)} className="spring-press flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--accent-contrast)]" title={playing ? 'Pause' : 'Abspielen'}>
        {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-[1px]" />}
      </button>
      <div className="min-w-[104px] leading-tight">
        <div className="font-mono text-sm tabular-nums text-[color:var(--fg)]">{formatClock(t)}</div>
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{phaseLabel(t)}</div>
      </div>
      <input
        type="range" min={0} max={24} step={0.1} value={t}
        onChange={(e) => { const v = parseFloat(e.target.value); setTimeOfDay(v); applyTimeMode(v) }}
        className="blaster-range w-40 md:w-56"
        aria-label="Uhrzeit"
      />
      <button onClick={deactivate} className="spring-press flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--muted)] hover:text-[color:var(--fg)]" title="Tagesverlauf beenden">
        <X size={15} />
      </button>
    </div>
  )
}
