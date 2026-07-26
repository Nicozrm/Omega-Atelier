import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ear, X, Lock } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useTier } from '@/hooks/useTier'
import { DEVICES } from '@/data/devices'
import { acousticPath } from '@/lib/acoustics'
import type { Floor, Point } from '@/types'

/**
 * SoundScape — hear the floor plan.
 *
 * Activating it drops an ear (the listener) into the apartment and starts a
 * procedurally generated multiroom track on every speaker in the plan (plus a
 * soft motor hum on appliances). What reaches the ear obeys the REAL geometry:
 * distance rolls the level off, every wall on the straight path muffles level
 * and treble (acousticPath), and the direction pans the stereo field. Drag the
 * ear from the living room into the bathroom and the music dulls behind the
 * walls exactly like it would at home. Modes matter too — speakers only play
 * in modes their modeTags cover, so «Nacht» silences the house.
 *
 * All synthesis is procedural Web Audio (no assets): a shared music bus (pad +
 * pentatonic plucks) fans out into one filter→gain→panner chain per speaker,
 * so the whole flat plays the same track in sync, like a real multiroom setup.
 */

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

interface SourceChain {
  filter: BiquadFilterNode
  gain: GainNode
  pan: StereoPannerNode
  position: Point
}

interface Engine {
  ctx: AudioContext
  master: GainNode
  musicBus: GainNode
  humBus: GainNode
  chains: Map<string, SourceChain>
  timers: number[]
  dispose: () => void
}

/** A looping noise buffer (for the appliance hum). */
function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    // Brown-ish noise: integrate white noise, keep it bounded.
    last = Math.max(-1, Math.min(1, last + (Math.random() * 2 - 1) * 0.04))
    data[i] = last
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  return src
}

/** Pentatonic A-minor pluck frequencies for the generative track. */
const SCALE = [440, 523.25, 587.33, 659.25, 783.99, 880]

function buildEngine(): Engine {
  const ctx = new AudioContext()
  const comp = ctx.createDynamicsCompressor()
  const master = ctx.createGain()
  master.gain.value = 0.3
  master.connect(comp)
  comp.connect(ctx.destination)

  // ── Shared multiroom music bus: soft pad + generative plucks ─────────
  const musicBus = ctx.createGain()
  musicBus.gain.value = 0.5

  const padGain = ctx.createGain()
  padGain.gain.value = 0.05
  for (const [freq, type] of [[220, 'triangle'], [221.2, 'triangle'], [110, 'sine']] as const) {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.connect(padGain)
    o.start()
  }
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.09
  const lfoDepth = ctx.createGain()
  lfoDepth.gain.value = 0.02
  lfo.connect(lfoDepth)
  lfoDepth.connect(padGain.gain)
  lfo.start()
  padGain.connect(musicBus)

  let step = Math.floor(Math.random() * SCALE.length)
  const pluck = () => {
    if (Math.random() < 0.3) return // rests keep it musical
    step = Math.max(0, Math.min(SCALE.length - 1, step + (Math.random() < 0.5 ? -1 : 1)))
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = SCALE[step]
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    o.connect(g)
    g.connect(musicBus)
    o.start(t)
    o.stop(t + 0.6)
  }
  const pluckTimer = window.setInterval(pluck, 340)

  // ── Shared appliance hum bus ──────────────────────────────────────────
  const humBus = ctx.createGain()
  humBus.gain.value = 0.7
  const noise = noiseSource(ctx)
  const humBp = ctx.createBiquadFilter()
  humBp.type = 'bandpass'
  humBp.frequency.value = 110
  humBp.Q.value = 1.2
  noise.connect(humBp)
  humBp.connect(humBus)
  noise.start()

  const chains = new Map<string, SourceChain>()
  return {
    ctx, master, musicBus, humBus, chains,
    timers: [pluckTimer],
    dispose: () => {
      window.clearInterval(pluckTimer)
      void ctx.close()
    },
  }
}

/** Attach one positioned output chain (filter → gain → pan → master). */
function addChain(engine: Engine, id: string, bus: GainNode, position: Point): void {
  const { ctx, master } = engine
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 18000
  const gain = ctx.createGain()
  gain.gain.value = 0
  const pan = ctx.createStereoPanner()
  bus.connect(filter)
  filter.connect(gain)
  gain.connect(pan)
  pan.connect(master)
  engine.chains.set(id, { filter, gain, pan, position })
}

export function SoundScape() {
  const doc = usePlanStore((s) => s.doc)
  const viewport = usePlanStore((s) => s.viewport)
  const floor = useMemo<Floor | undefined>(
    () => doc?.floors.find((f) => f.id === doc.activeFloorId),
    [doc],
  )
  const activeMode = doc?.activeModeKey ?? 'auto'

  const { can } = useTier()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)
  const locked = !can('soundscape')
  const goUpgrade = useCallback(() => {
    pushToast({ kind: 'info', title: 'Pro-Funktion', description: 'Der Hörmodus ist Teil des Pro-Plans.' })
    navigate('/#preise')
  }, [pushToast, navigate])

  const [listening, setListening] = useState(false)
  const [listener, setListener] = useState<Point>({ x: 0, y: 0 })
  const listenerRef = useRef(listener)
  listenerRef.current = listener
  const engineRef = useRef<Engine | null>(null)
  const modeRef = useRef(activeMode)
  modeRef.current = activeMode
  const floorRef = useRef(floor)
  floorRef.current = floor
  const [audible, setAudible] = useState(0)

  // The audible sources on this floor (speakers → music, appliances → hum).
  const sources = useMemo(() => {
    if (!floor) return []
    return floor.devices
      .map((d) => ({ placed: d, entry: DEVICE_MAP[d.deviceId] }))
      .filter((s) => s.entry && (s.entry.category === 'speaker' || s.entry.category === 'appliance'))
  }, [floor])

  const stop = useCallback(() => {
    setListening(false)
    engineRef.current?.dispose()
    engineRef.current = null
  }, [])

  const start = useCallback(() => {
    if (!floorRef.current) return
    const f = floorRef.current
    // Drop the ear into the middle of the plan (or beside the first speaker).
    const firstSpeaker = f.devices.find((d) => DEVICE_MAP[d.deviceId]?.category === 'speaker')
    const at = firstSpeaker
      ? { x: firstSpeaker.position.x + 120, y: firstSpeaker.position.y + 120 }
      : { x: f.extent.width / 2, y: f.extent.height / 2 }
    setListener(at)

    const engine = buildEngine()
    for (const s of sources) {
      addChain(engine, s.placed.id, s.entry!.category === 'speaker' ? engine.musicBus : engine.humBus, s.placed.position)
    }
    engineRef.current = engine
    void engine.ctx.resume()
    setListening(true)
  }, [sources])

  useEffect(() => () => { engineRef.current?.dispose() }, [])

  // ── The acoustic tick: physics → audio params, smoothly ramped ────────
  useEffect(() => {
    if (!listening) return
    const tick = () => {
      const engine = engineRef.current
      const f = floorRef.current
      if (!engine || !f) return
      const t = engine.ctx.currentTime
      const L = listenerRef.current
      let audibleCount = 0
      const debug: Array<{ id: string; gain: number; lowpassHz: number; walls: number }> = []
      for (const s of sources) {
        const chain = engine.chains.get(s.placed.id)
        if (!chain) continue
        // A speaker plays only in modes its modeTags cover (Nacht = silence).
        const playing = s.entry!.category === 'appliance'
          ? modeRef.current !== 'away'
          : (s.entry!.modeTags?.includes(modeRef.current) ?? true)
        const p = acousticPath(L, s.placed.position, f.walls)
        const gain = playing ? p.gain : 0
        chain.gain.gain.setTargetAtTime(gain, t, 0.08)
        chain.filter.frequency.setTargetAtTime(p.lowpassHz, t, 0.08)
        chain.pan.pan.setTargetAtTime(p.pan, t, 0.08)
        if (gain > 0.02) audibleCount++
        debug.push({ id: s.placed.id, gain, lowpassHz: p.lowpassHz, walls: p.walls })
      }
      setAudible(audibleCount)
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__omegaSound = { listener: L, sources: debug }
      }
    }
    tick()
    const iv = window.setInterval(tick, 110)
    return () => window.clearInterval(iv)
  }, [listening, sources])

  // ── Drag the ear (world coordinates, pan/zoom-aware) ──────────────────
  const dragRef = useRef<{ px: number; py: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = (e.clientX - dragRef.current.px) / viewport.zoom
    const dy = (e.clientY - dragRef.current.py) / viewport.zoom
    dragRef.current = { px: e.clientX, py: e.clientY }
    setListener((l) => ({ x: l.x + dx, y: l.y + dy }))
  }
  const onPointerUp = () => { dragRef.current = null }

  if (!floor) return null

  if (!listening) {
    return (
      <button
        onClick={locked ? goUpgrade : start}
        className="glass spring-press absolute bottom-[104px] left-3 z-20 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-[color:var(--fg)] md:bottom-[60px]"
        title={locked ? 'Hörmodus — im Pro-Plan enthalten' : 'Hörmodus — zieh das Ohr durch den Plan und höre dein Zuhause'}
      >
        <Ear size={14} className="text-[color:var(--accent-bright)]" />
        <span className="hidden sm:inline">Hören</span>
        {locked && <Lock size={11} className="text-[color:var(--muted)]" />}
      </button>
    )
  }

  const sx = listener.x * viewport.zoom + viewport.offsetX
  const sy = listener.y * viewport.zoom + viewport.offsetY

  return (
    <>
      {/* The ear — the draggable listener */}
      <div
        role="slider"
        aria-label="Hörposition"
        aria-valuetext={`x ${Math.round(listener.x)} cm, y ${Math.round(listener.y)} cm`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded-full active:cursor-grabbing"
        style={{
          left: sx, top: sy,
          background: 'radial-gradient(circle at 35% 30%, rgba(230,204,134,0.95), rgba(199,162,78,0.9))',
          boxShadow: '0 0 0 2px rgba(10,10,11,0.85), 0 0 22px rgba(199,162,78,0.55), 0 4px 14px rgba(0,0,0,0.5)',
        }}
      >
        <span className="pointer-events-none absolute inset-[-9px] animate-ping rounded-full border border-[rgba(199,162,78,0.5)]" style={{ animationDuration: '2.2s' }} />
        <Ear size={19} className="pointer-events-none text-[#0A0A0B]" />
      </div>

      {/* Status pill */}
      <div className="glass absolute bottom-[104px] left-3 z-20 flex items-center gap-2.5 rounded-full px-3 py-2 md:bottom-[60px]">
        <Ear size={14} className="text-[color:var(--accent-bright)]" />
        <span className="text-xs font-medium tabular-nums">
          {audible === 0 ? 'Stille' : `${audible} ${audible === 1 ? 'Quelle' : 'Quellen'} hörbar`}
        </span>
        <button onClick={stop} className="spring-press flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--muted)] hover:text-[color:var(--fg)]" title="Hörmodus beenden">
          <X size={13} />
        </button>
      </div>
    </>
  )
}
