import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Lock } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useTier } from '@/hooks/useTier'
import { DEVICES } from '@/data/devices'
import { buildMesh, arcPoint, PROTOCOL_COLORS, type RadioLink } from '@/lib/radioMesh'
import type { Floor } from '@/types'

/**
 * RadioMesh — the home's invisible nervous system, rendered.
 *
 * Toggling «Funknetz» overlays the plan with its radio topology: every device
 * is linked to its hub by a faint arc in its protocol's colour (zigbee gold,
 * thread green, matter violet, wifi sky, backbone slate) and animated packets
 * ride those arcs as glowing points of light, pulsing on arrival — the actual
 * unseen traffic of a smart home, visible for the first time. Rendered on its
 * own transparent canvas with a continuous rAF loop (the plan canvas below
 * stays dirty-gated and untouched); pointer events pass straight through.
 */

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

interface Packet {
  link: RadioLink
  /** 0…1 along the arc. */
  t: number
  /** t-units per second (constant screen-ish speed per link length). */
  speed: number
}

interface Pulse {
  x: number
  y: number
  color: string
  /** 0…1 lifetime. */
  age: number
}

export function RadioMesh() {
  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo<Floor | undefined>(
    () => doc?.floors.find((f) => f.id === doc.activeFloorId),
    [doc],
  )
  const [active, setActive] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const { can } = useTier()
  const navigate = useNavigate()
  const pushToast = useUIStore((s) => s.pushToast)
  const locked = !can('radio-mesh')
  const goUpgrade = useCallback(() => {
    pushToast({ kind: 'info', title: 'Pro-Funktion', description: 'Der Funknetz-Röntgenblick ist Teil des Pro-Plans.' })
    navigate('/#preise')
  }, [pushToast, navigate])

  const links = useMemo(
    () => (floor ? buildMesh(floor.devices, (id) => {
      const e = DEVICE_MAP[id]
      return e ? { category: e.category, protocols: e.protocol } : undefined
    }) : []),
    [floor],
  )

  useEffect(() => {
    if (!active || !canvasRef.current || links.length === 0) return
    const cvs = canvasRef.current
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const packets: Packet[] = []
    const pulses: Pulse[] = []
    const spawnAt = new Map<RadioLink, number>()
    for (const l of links) spawnAt.set(l, performance.now() + Math.random() * 2600)

    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const wrap = wrapRef.current
      if (!wrap) return
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (cvs.width !== Math.round(w * dpr) || cvs.height !== Math.round(h * dpr)) {
        cvs.width = Math.round(w * dpr)
        cvs.height = Math.round(h * dpr)
        cvs.style.width = `${w}px`
        cvs.style.height = `${h}px`
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // X-ray veil: dim the plan below so the network reads like a scan of
      // the house's nervous system — the arcs glow against near-dark.
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = 'rgba(5, 7, 12, 0.72)'
      ctx.fillRect(0, 0, w, h)

      const vp = usePlanStore.getState().viewport
      const toScreen = (p: { x: number; y: number }) => ({ x: p.x * vp.zoom + vp.offsetX, y: p.y * vp.zoom + vp.offsetY })

      // Additive blending — light accumulates where arcs and packets overlap,
      // which is what makes the layer read as energy instead of ink.
      ctx.globalCompositeOperation = 'lighter'

      // ── Arcs — the standing topology ──────────────────────────────────
      for (const l of links) {
        const a = toScreen(l.from)
        const b = toScreen(l.to)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        const cx = mx - (b.y - a.y) * 0.12
        const cy = my + (b.x - a.x) * 0.12
        ctx.strokeStyle = PROTOCOL_COLORS[l.protocol]
        ctx.globalAlpha = l.backbone ? 0.30 : 0.22
        ctx.lineWidth = l.backbone ? 1.6 : 1.1
        ctx.setLineDash(l.backbone ? [5, 5] : [])
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(cx, cy, b.x, b.y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // ── Device nodes — the constellation the arcs hang from ───────────
      for (const l of links) {
        const s = toScreen(l.from)
        const color = PROTOCOL_COLORS[l.protocol]
        ctx.globalAlpha = 0.28
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Hubs breathe — the heart of the network ───────────────────────
      const breathe = 0.5 + 0.5 * Math.sin(now / 640)
      for (const l of links) {
        if (!l.backbone) continue
        for (const end of [l.from, l.to]) {
          const s = toScreen(end)
          ctx.globalAlpha = 0.20 + 0.18 * breathe
          ctx.strokeStyle = '#E6CC86'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(s.x, s.y, 13 + breathe * 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // ── Spawn + advance packets ───────────────────────────────────────
      for (const l of links) {
        if (now >= (spawnAt.get(l) ?? 0) && packets.length < 90) {
          const lenCm = Math.hypot(l.to.x - l.from.x, l.to.y - l.from.y) || 1
          packets.push({ link: l, t: 0, speed: 480 / lenCm }) // ≈ 4.8 m/s world speed
          spawnAt.set(l, now + 900 + Math.random() * 2600)
        }
      }
      for (let i = packets.length - 1; i >= 0; i--) {
        const p = packets[i]
        p.t += p.speed * dt
        if (p.t >= 1) {
          const end = toScreen(p.link.to)
          pulses.push({ x: end.x, y: end.y, color: PROTOCOL_COLORS[p.link.protocol], age: 0 })
          packets.splice(i, 1)
          continue
        }
        const world = arcPoint(p.link.from, p.link.to, p.t)
        const s = toScreen(world)
        const color = PROTOCOL_COLORS[p.link.protocol]
        // Comet: a short fading tail behind the packet, then halo + hot core.
        for (let k = 1; k <= 4; k++) {
          const tb = Math.max(0, p.t - k * 0.02)
          const wb = arcPoint(p.link.from, p.link.to, tb)
          const sb = toScreen(wb)
          ctx.globalAlpha = 0.30 * (1 - k / 5)
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(sb.x, sb.y, 2.4 - k * 0.4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 0.30
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(s.x, s.y, 6, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 0.85
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(s.x, s.y, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── Arrival pulses ────────────────────────────────────────────────
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pu = pulses[i]
        pu.age += dt * 2.2
        if (pu.age >= 1) { pulses.splice(i, 1); continue }
        ctx.globalAlpha = 0.5 * (1 - pu.age)
        ctx.strokeStyle = pu.color
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(pu.x, pu.y, 4 + pu.age * 16, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, links])

  if (!floor) return null

  return (
    <>
      {active && (
        <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-10">
          <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
      )}
      <button
        onClick={locked ? goUpgrade : () => setActive((v) => !v)}
        className={`glass spring-press absolute bottom-[148px] left-3 z-20 inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium md:bottom-[104px] ${
          active ? 'text-[color:var(--accent-bright)]' : 'text-[color:var(--fg)]'
        }`}
        style={active ? { boxShadow: 'var(--glow-accent-soft)' } : undefined}
        title={locked ? 'Funknetz — im Pro-Plan enthalten' : 'Funknetz — die Funk-Topologie deines Zuhauses, live'}
      >
        <Radio size={14} className={active ? 'text-[color:var(--accent-bright)]' : 'text-[color:var(--accent)]'} />
        <span className="hidden sm:inline">Funknetz</span>
        {locked && <Lock size={11} className="text-[color:var(--muted)]" />}
      </button>
    </>
  )
}
