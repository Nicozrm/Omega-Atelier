import { useEffect, useRef, useState } from 'react'
import { usePlanStore } from '@/store/usePlanStore'
import type { Point } from '@/types'

/**
 * MobilePlacement — touch-only placement engine.
 *
 * On non-touch / desktop this renders `null` and attaches no listeners, so the
 * desktop editor is completely unchanged. It owns no store state of its own and
 * places objects exclusively through the existing `addDevice` / `addFurniture`
 * actions (+ `setSelection`/`rotateSelection` for wall auto-rotation).
 *
 * Gestures (all transform-driven, zero React re-render during a drag → 60 fps):
 *  - Long-press a library item → "lift" → a ghost chip follows the finger.
 *  - Live snapping: room corners → walls (with auto-rotation) → grid.
 *  - Collision vs existing furniture → invalid (red) ghost + landing ring; blocks drop.
 *  - Release → places; haptics via navigator.vibrate when available.
 *  - Two-finger pan/zoom of the canvas (only ≥2 touches → never conflicts with
 *    single-finger select/drag handled by the canvas itself).
 */

const LIFT_MS = 170
const MOVE_CANCEL = 12 // px finger travel that cancels the long-press (= scroll intent)
const WALL_SNAP = 30 // cm
const CORNER_SNAP = 26 // cm
const DEVICE_FP = 24 // cm footprint (collision)
const FURN_FP = 60
const FURN_SNAP = 28 // cm: Achsen-Alignment an Möbelzentren

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window
}

const buzz = (p: number | number[]) => {
  try { navigator.vibrate?.(p) } catch { /* unsupported */ }
}

type Kind = 'device' | 'furniture'
interface Session { kind: Kind; catalogId: string; label: string; rot: number; valid: boolean; pos: Point }

export function MobilePlacement() {
  const [active] = useState(isTouchDevice)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const sessRef = useRef<Session | null>(null)

  useEffect(() => {
    if (!active) return
    const overlay = overlayRef.current
    const ghost = ghostRef.current
    const ring = ringRef.current
    const labelEl = labelRef.current
    if (!overlay || !ghost || !ring) return
    const overlayEl: HTMLDivElement = overlay

    const getCanvas = () => document.querySelector('[data-editor-canvas]') as HTMLCanvasElement | null
    const toWorld = (cx: number, cy: number): Point | null => {
      const c = getCanvas(); if (!c) return null
      const r = c.getBoundingClientRect(); const { viewport } = usePlanStore.getState()
      return { x: (cx - r.left - viewport.offsetX) / viewport.zoom, y: (cy - r.top - viewport.offsetY) / viewport.zoom }
    }
    const toScreen = (p: Point): { x: number; y: number } | null => {
      const c = getCanvas(); if (!c) return null
      const r = c.getBoundingClientRect(); const { viewport } = usePlanStore.getState()
      return { x: r.left + p.x * viewport.zoom + viewport.offsetX, y: r.top + p.y * viewport.zoom + viewport.offsetY }
    }
    const activeFloor = () => {
      const { doc } = usePlanStore.getState(); if (!doc) return null
      return doc.floors.find((f) => f.id === doc.activeFloorId) ?? doc.floors[0] ?? null
    }
    const d2 = (a: Point, b: Point) => { const dx = a.x - b.x; const dy = a.y - b.y; return dx * dx + dy * dy }

    const computeSnap = (p: Point): { pos: Point; rot: number; snapped: boolean } => {
      const f = activeFloor(); const { doc } = usePlanStore.getState()
      let best = p; let rot = sessRef.current?.rot ?? 0; let snapped = false
      if (f) {
        let cornerD = CORNER_SNAP * CORNER_SNAP
        for (const room of f.rooms) {
          for (const v of room.polygon) {
            const dd = d2(p, v)
            if (dd < cornerD) { cornerD = dd; best = { x: v.x, y: v.y }; snapped = true }
          }
        }
        if (!snapped) {
          let wallD = WALL_SNAP * WALL_SNAP
          for (const w of f.walls) {
            const vx = w.b.x - w.a.x; const vy = w.b.y - w.a.y
            const len2 = vx * vx + vy * vy || 1
            let t = ((p.x - w.a.x) * vx + (p.y - w.a.y) * vy) / len2
            t = Math.max(0, Math.min(1, t))
            const cp = { x: w.a.x + t * vx, y: w.a.y + t * vy }
            const dd = d2(p, cp)
            if (dd < wallD) { wallD = dd; best = cp; rot = (Math.atan2(vy, vx) * 180) / Math.PI; snapped = true }
          }
        }
      }
      if (!snapped && f) {
        for (const fu of f.furniture) {
          let nx = best.x; let ny = best.y; let hit = false
          if (Math.abs(p.x - fu.position.x) < FURN_SNAP) { nx = fu.position.x; hit = true }
          if (Math.abs(p.y - fu.position.y) < FURN_SNAP) { ny = fu.position.y; hit = true }
          if (hit) { best = { x: nx, y: ny }; rot = fu.rotation ?? rot; snapped = true; break }
        }
      }
      if (!snapped && doc?.settings.snap) {
        const s = doc.settings.snapStep
        best = { x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s }
      }
      return { pos: best, rot, snapped }
    }
    const collides = (p: Point, kind: Kind): boolean => {
      const f = activeFloor(); if (!f) return false
      const half = (kind === 'furniture' ? FURN_FP : DEVICE_FP) / 2
      for (const fu of f.furniture) {
        const sz = fu.size ?? [FURN_FP, FURN_FP]
        if (Math.abs(p.x - fu.position.x) < sz[0] / 2 + half && Math.abs(p.y - fu.position.y) < sz[1] / 2 + half) return true
      }
      return false
    }
    const paint = (cx: number, cy: number) => {
      const s = sessRef.current; if (!s) return
      ghost.style.transform = `translate3d(${cx}px, ${cy - 46}px, 0) translate(-50%, -50%)`
      const scr = toScreen(s.pos)
      if (scr) ring.style.transform = `translate3d(${scr.x}px, ${scr.y}px, 0) translate(-50%, -50%) rotate(${s.rot}deg)`
      ghost.classList.toggle('is-invalid', !s.valid)
      ring.classList.toggle('is-invalid', !s.valid)
    }

    let liftTimer = 0
    let startX = 0
    let startY = 0
    let prevSnapped = false
    let lifting: { kind: Kind; catalogId: string; label: string } | null = null
    let manualActive = false // user hat per Geste rotiert → Auto-Rotation ausgesetzt
    let twisting = false
    let twistStart = 0
    let twistBase = 0

    function onDragMove(e: TouchEvent) {
      const s = sessRef.current; if (!s) return
      e.preventDefault()
      const t = e.touches[0]; if (!t) return
      let px = t.clientX; let py = t.clientY
      if (e.touches.length >= 2) {
        const t2 = e.touches[1]
        px = (t.clientX + t2.clientX) / 2; py = (t.clientY + t2.clientY) / 2
        const ang = (Math.atan2(t2.clientY - t.clientY, t2.clientX - t.clientX) * 180) / Math.PI
        if (!twisting) { twisting = true; twistStart = ang; twistBase = s.rot }
        else { s.rot = twistBase + (ang - twistStart); manualActive = true }
      } else {
        twisting = false
      }
      const w = toWorld(px, py)
      if (w) {
        const snap = computeSnap(w)
        s.pos = snap.pos
        if (!manualActive) s.rot = snap.rot
        const nextValid = !collides(snap.pos, s.kind)
        if (nextValid !== s.valid) buzz(nextValid ? 6 : [4, 24])
        s.valid = nextValid
        if (snap.snapped && !prevSnapped) buzz(5)
        prevSnapped = snap.snapped
      }
      paint(px, py)
    }
    function endDrag(e: TouchEvent) {
      const s = sessRef.current
      window.removeEventListener('touchmove', onDragMove)
      window.removeEventListener('touchend', endDrag)
      window.removeEventListener('touchcancel', endDrag)
      sessRef.current = null
      overlayEl.classList.remove('is-active')
      if (!s) return
      e.preventDefault()
      if (s.valid) {
        const { addDevice, addFurniture, setSelection, rotateSelection } = usePlanStore.getState()
        const id = s.kind === 'device' ? addDevice(s.catalogId, s.pos) : addFurniture(s.catalogId, s.pos)
        if (s.rot) { setSelection({ type: s.kind, ids: [id] }); rotateSelection(s.rot) }
        buzz(18)
      } else {
        buzz([6, 30, 6])
      }
    }
    function beginGhost(cx: number, cy: number) {
      if (!lifting) return
      sessRef.current = { kind: lifting.kind, catalogId: lifting.catalogId, label: lifting.label, rot: 0, valid: true, pos: { x: 0, y: 0 } }
      if (labelEl) labelEl.textContent = lifting.label
      overlayEl.classList.add('is-active')
      prevSnapped = false
      manualActive = false
      twisting = false
      buzz(12)
      const w = toWorld(cx, cy)
      if (w) {
        const snap = computeSnap(w)
        sessRef.current.pos = snap.pos; sessRef.current.rot = snap.rot
        sessRef.current.valid = !collides(snap.pos, sessRef.current.kind)
      }
      paint(cx, cy)
      window.addEventListener('touchmove', onDragMove, { passive: false })
      window.addEventListener('touchend', endDrag, { passive: false })
      window.addEventListener('touchcancel', endDrag, { passive: false })
    }
    function preMove(e: TouchEvent) {
      const t = e.touches[0]; if (!t) return
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > MOVE_CANCEL) preCancel()
    }
    function preCancel() {
      window.clearTimeout(liftTimer); lifting = null
      window.removeEventListener('touchmove', preMove)
      window.removeEventListener('touchend', preCancel)
    }
    function onStart(e: TouchEvent) {
      if (sessRef.current) return
      const item = (e.target as HTMLElement | null)?.closest('[data-lib-id]') as HTMLElement | null
      if (!item) return
      const t = e.touches[0]; if (!t) return
      startX = t.clientX; startY = t.clientY
      lifting = { kind: (item.dataset.libKind as Kind) ?? 'device', catalogId: item.dataset.libId ?? '', label: item.dataset.libLabel ?? '' }
      window.addEventListener('touchmove', preMove, { passive: true })
      window.addEventListener('touchend', preCancel, { passive: true })
      window.clearTimeout(liftTimer)
      liftTimer = window.setTimeout(() => {
        window.removeEventListener('touchmove', preMove)
        window.removeEventListener('touchend', preCancel)
        beginGhost(t.clientX, t.clientY)
      }, LIFT_MS)
    }
    document.addEventListener('touchstart', onStart, { passive: true })

    // ── two-finger pan/zoom (≥2 touches only) ───────────────────────────
    let pinchDist = 0
    let pinchZoom = 1
    let pinchOX = 0
    let pinchOY = 0
    let pinchMidX = 0
    let pinchMidY = 0
    function canvasTouchStart(e: TouchEvent) {
      if (e.touches.length < 2 || sessRef.current) return
      const a = e.touches[0]; const b = e.touches[1]
      pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
      const { viewport } = usePlanStore.getState()
      pinchZoom = viewport.zoom; pinchOX = viewport.offsetX; pinchOY = viewport.offsetY
      const r = getCanvas()?.getBoundingClientRect()
      pinchMidX = (a.clientX + b.clientX) / 2 - (r?.left ?? 0)
      pinchMidY = (a.clientY + b.clientY) / 2 - (r?.top ?? 0)
    }
    function canvasTouchMove(e: TouchEvent) {
      if (e.touches.length < 2 || sessRef.current) return
      e.preventDefault()
      const a = e.touches[0]; const b = e.touches[1]
      const r = getCanvas()?.getBoundingClientRect()
      const midX = (a.clientX + b.clientX) / 2 - (r?.left ?? 0)
      const midY = (a.clientY + b.clientY) / 2 - (r?.top ?? 0)
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
      const zoom = Math.max(0.1, Math.min(4, pinchZoom * (dist / pinchDist)))
      const wx = (pinchMidX - pinchOX) / pinchZoom
      const wy = (pinchMidY - pinchOY) / pinchZoom
      usePlanStore.getState().setViewport({ zoom, offsetX: midX - wx * zoom, offsetY: midY - wy * zoom })
    }
    const canvasEl = getCanvas()
    canvasEl?.addEventListener('touchstart', canvasTouchStart, { passive: true })
    canvasEl?.addEventListener('touchmove', canvasTouchMove, { passive: false })

    return () => {
      window.clearTimeout(liftTimer)
      document.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onDragMove)
      window.removeEventListener('touchend', endDrag)
      window.removeEventListener('touchcancel', endDrag)
      window.removeEventListener('touchmove', preMove)
      window.removeEventListener('touchend', preCancel)
      canvasEl?.removeEventListener('touchstart', canvasTouchStart)
      canvasEl?.removeEventListener('touchmove', canvasTouchMove)
    }
  }, [active])

  if (!active) return null
  return (
    <div ref={overlayRef} className="mpe-overlay" aria-hidden="true">
      <div ref={ringRef} className="mpe-ring"><span className="mpe-tick" /></div>
      <div ref={ghostRef} className="mpe-ghost"><span ref={labelRef} className="mpe-ghost-label" /></div>
    </div>
  )
}
