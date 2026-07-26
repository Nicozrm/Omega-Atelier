/**
 * Omega Floor — the canvas editor (PERFORMANCE OPTIMIZED).
 *
 * Pure HTML5 Canvas with hand-rolled render loop via requestAnimationFrame.
 * All world coordinates are in centimeters; the viewport stores zoom (px per cm) and offset (px).
 *
 * PERFORMANCE FIX:
 * - Canvas renders via requestAnimationFrame, independent of React render cycle
 * - Mouse position stored in ref (not state) to avoid re-renders on every move
 * - Only triggers React state when actual changes happen (selection, tool change, etc.)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import type { Floor, Point, RemoteCursor, Tool, WallSubtype } from '@/types'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { snap, clamp, dist, pointInPolygon } from '@/lib/utils'
import { resolveFloorMaterial } from '@/lib/materials'
import { deriveRoomLighting } from '@/lib/lighting'
import {
  readTheme,
  drawWall,
  drawRoomFill,
  drawRoomFloor,
  drawRoomLabel,
  drawFurnitureGlyph,
  drawDevicePin,
  drawAlignmentLine,
  roundRect,
} from '@/lib/canvasGlyphs'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))
const FURN_MAP = Object.fromEntries(FURNITURE.map((f) => [f.id, f] as const))

export interface OmegaFloorCanvasProps {
  /** Live cursors from other users (Supabase realtime broadcast). */
  cursors?: Record<string, RemoteCursor>
  /** Throttled publisher; called on every pointermove. */
  publishCursor?: (worldX: number, worldY: number, floorId: string, tool: Tool) => void
}

export function OmegaFloorCanvas({ cursors, publishCursor }: OmegaFloorCanvasProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo<Floor | undefined>(
    () => doc?.floors.find((f) => f.id === doc.activeFloorId),
    [doc],
  )
  const tool = usePlanStore((s) => s.tool)
  const selection = usePlanStore((s) => s.selection)
  const viewport = usePlanStore((s) => s.viewport)
  const hoverDevice = usePlanStore((s) => s.hoverDeviceCatalogId)
  const hoverFurn = usePlanStore((s) => s.hoverFurnitureCatalogId)

  const setViewport = usePlanStore((s) => s.setViewport)
  const fitToView = usePlanStore((s) => s.fitToView)
  const setSelection = usePlanStore((s) => s.setSelection)
  const addDevice = usePlanStore((s) => s.addDevice)
  const addFurniture = usePlanStore((s) => s.addFurniture)
  const addWall = usePlanStore((s) => s.addWall)
  const addRoom = usePlanStore((s) => s.addRoom)
  const addLabel = usePlanStore((s) => s.addLabel)
  const moveSelection = usePlanStore((s) => s.moveSelection)
  const setTool = usePlanStore((s) => s.setTool)
  const rotateSelection = usePlanStore((s) => s.rotateSelection)
  const deleteSelection = usePlanStore((s) => s.deleteSelection)
  const resizeFurniture = usePlanStore((s) => s.resizeFurniture)

  const pushToast = useUIStore((s) => s.pushToast)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [wallStart, setWallStart] = useState<Point | null>(null)
  // v26 — terrace drag-rectangle: first corner
  const [terraceStart, setTerraceStart] = useState<Point | null>(null)
  const [measureStart, setMeasureStart] = useState<Point | null>(null)
  const [measureEnd, setMeasureEnd] = useState<Point | null>(null)
  const mouseRef = useRef<Point | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const dragLast = useRef<{ x: number; y: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const spaceDown = useRef(false)
  const needsRedraw = useRef(true)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport
  // ───── DRAG OFFSET — purely local during drag ─────
  // Holds the in-progress (un-committed) world-space delta for the dragged
  // item(s). Stored in a ref so we DON'T re-render React on every pointer
  // move; the canvas redraw loop reads it directly. On pointer-up we commit
  // ONE moveSelection() call to the store (= one history entry, one persist).
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // Same idea for live rotation
  const [isRotating, setIsRotating] = useState(false)
  const rotationStartAngleRef = useRef(0)   // angle from item-center to mouse at rotation start
  const rotationOffsetRef = useRef(0)        // current accumulated delta in deg

  // Live-resize state for furniture corners/edges. 8 handles total: nw,n,ne,e,se,s,sw,w.
  // While resizing we track the original size + position and a delta in world coords.
  type ResizeAnchor = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  const [isResizing, setIsResizing] = useState(false)
  // v22 — right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; type: 'device' | 'furniture' | 'wall'; id: string } | null>(null)
  const resizeAnchorRef = useRef<ResizeAnchor | null>(null)
  const resizeOriginalRef = useRef<{ w: number; h: number; cx: number; cy: number; rot: number } | null>(null)
  const resizeStartWorldRef = useRef<Point | null>(null)
  // Live new dimensions (relative to the original frame; renderer reads these refs)
  const resizeLiveRef = useRef<{ w: number; h: number; dx: number; dy: number }>({ w: 0, h: 0, dx: 0, dy: 0 })

  // Mobile gesture refs
  const touchStartDist = useRef(0)
  const touchStartZoom = useRef(0)
  const touchMidpoint = useRef<Point | null>(null)
  const isPinching = useRef(false)

  // ───── Resize observer ─────
  useEffect(() => {
    if (!wrapRef.current) return
    const el = wrapRef.current
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
      needsRedraw.current = true
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ───── Coordinate transforms ─────
  const screenToWorld = useCallback(
    (sx: number, sy: number): Point => ({
      x: (sx - viewportRef.current.offsetX) / viewportRef.current.zoom,
      y: (sy - viewportRef.current.offsetY) / viewportRef.current.zoom,
    }),
    [],
  )
  const worldToScreen = useCallback(
    (p: Point) => ({
      x: p.x * viewportRef.current.zoom + viewportRef.current.offsetX,
      y: p.y * viewportRef.current.zoom + viewportRef.current.offsetY,
    }),
    [],
  )

  const snapWorld = useCallback(
    (p: Point): Point => {
      if (!doc?.settings.snap) return p
      const s = doc.settings.snapStep
      return { x: snap(p.x, s), y: snap(p.y, s) }
    },
    [doc],
  )

  /**
   * v18 — snap a world point to the nearest wall if it's within 30 cm.
   * Projects onto the wall segment and pulls the point flush against the wall.
   * Used during device placement so smart-home gear naturally aligns.
   */
  const SNAP_TO_WALL_CM = 30
  const snapToWall = useCallback(
    (p: Point): Point => {
      if (!floor || doc?.settings.magnet === false) return p
      let best: { dist: number; pt: Point } | null = null
      for (const w of floor.walls) {
        const dx = w.b.x - w.a.x
        const dy = w.b.y - w.a.y
        const len2 = dx * dx + dy * dy
        if (len2 === 0) continue
        const t = Math.max(0, Math.min(1, ((p.x - w.a.x) * dx + (p.y - w.a.y) * dy) / len2))
        const px = w.a.x + t * dx
        const py = w.a.y + t * dy
        const d = Math.hypot(px - p.x, py - p.y)
        if (d < SNAP_TO_WALL_CM && (best === null || d < best.dist)) {
          best = { dist: d, pt: { x: px, y: py } }
        }
      }
      return best ? best.pt : p
    },
    [floor, doc?.settings.magnet],
  )

  // ───── Hit testing ─────
  /** Returns the world-space center of the single selected device/furniture, or null. */
  const selectedSingleCenter = useCallback((): { pos: Point; rot: number } | null => {
    if (!floor) return null
    if (selection.ids.length !== 1) return null
    if (selection.type === 'device') {
      const d = floor.devices.find((x) => x.id === selection.ids[0])
      if (d) return { pos: d.position, rot: d.rotation ?? 0 }
    }
    if (selection.type === 'furniture') {
      const f = floor.furniture.find((x) => x.id === selection.ids[0])
      if (f) {
        return { pos: f.position, rot: f.rotation ?? 0 }
      }
    }
    return null
  }, [floor, selection])

  /** Screen-space position of the rotation handle for the currently selected single item.
   *  The handle sits ~30 px above the item center. */
  const rotationHandleScreen = useCallback((): { x: number; y: number } | null => {
    const sc = selectedSingleCenter()
    if (!sc) return null
    // Apply live drag offset
    const cx = sc.pos.x + (isDragging ? dragOffsetRef.current.x : 0)
    const cy = sc.pos.y + (isDragging ? dragOffsetRef.current.y : 0)
    // Handle direction: world -Y in the item's rotated frame; we just place it above center on screen
    const screenC = (() => {
      const z = viewportRef.current.zoom
      return {
        x: cx * z + viewportRef.current.offsetX,
        y: cy * z + viewportRef.current.offsetY,
      }
    })()
    return { x: screenC.x, y: screenC.y - 36 }
  }, [selectedSingleCenter, isDragging])

  /** Returns screen-space positions of all 8 resize handles for the
   *  currently selected single furniture item, or null. */
  const resizeHandlesScreen = useCallback((): null | Array<{ anchor: 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'; x: number; y: number }> => {
    if (!floor) return null
    if (selection.type !== 'furniture' || selection.ids.length !== 1) return null
    const f = floor.furniture.find((x) => x.id === selection.ids[0])
    if (!f) return null
    const entry = FURN_MAP[f.furnitureId]
    let [w, h] = f.size ?? entry?.size ?? [60, 60]
    // While resizing, draw handles at the LIVE size + offset
    let cx = f.position.x
    let cy = f.position.y
    if (isResizing && resizeLiveRef.current.w) {
      w = resizeLiveRef.current.w
      h = resizeLiveRef.current.h
      cx += resizeLiveRef.current.dx
      cy += resizeLiveRef.current.dy
    }
    if (isDragging) {
      cx += dragOffsetRef.current.x
      cy += dragOffsetRef.current.y
    }
    const rot = ((f.rotation ?? 0) + (isRotating ? rotationOffsetRef.current : 0)) * Math.PI / 180
    const cos = Math.cos(rot), sin = Math.sin(rot)
    const z = viewportRef.current.zoom
    const ox = viewportRef.current.offsetX
    const oy = viewportRef.current.offsetY
    // 8 handle positions in the item's local frame (cm)
    const hx = w / 2, hy = h / 2
    const local: Array<['nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w', number, number]> = [
      ['nw', -hx, -hy], ['n', 0, -hy], ['ne', hx, -hy],
      ['e',  hx,   0],
      ['se', hx,  hy], ['s', 0,  hy], ['sw', -hx, hy],
      ['w', -hx,   0],
    ]
    return local.map(([anchor, lx, ly]) => {
      const wx = cx + lx * cos - ly * sin
      const wy = cy + lx * sin + ly * cos
      return { anchor, x: wx * z + ox, y: wy * z + oy }
    })
  }, [floor, selection, isResizing, isDragging, isRotating])

  const hitTest = useCallback(
    (world: Point): { type: 'device' | 'furniture' | 'label' | 'room'; id: string } | null => {
      if (!floor) return null
      for (let i = floor.devices.length - 1; i >= 0; i--) {
        const d = floor.devices[i]
        if (dist(world, d.position) < 22) return { type: 'device', id: d.id }
      }
      for (let i = floor.furniture.length - 1; i >= 0; i--) {
        const f = floor.furniture[i]
        if (f.hidden) continue
        const entry = FURN_MAP[f.furnitureId]
        const [w, h] = f.size ?? entry?.size ?? [60, 60]
        const dx = world.x - f.position.x
        const dy = world.y - f.position.y
        if (Math.abs(dx) <= w / 2 && Math.abs(dy) <= h / 2) return { type: 'furniture', id: f.id }
      }
      for (let i = floor.labels.length - 1; i >= 0; i--) {
        const l = floor.labels[i]
        if (dist(world, l.position) < 50) return { type: 'label', id: l.id }
      }
      // Rooms — lowest priority (so devices/furniture on top win). Point-in-polygon.
      for (let i = floor.rooms.length - 1; i >= 0; i--) {
        const room = floor.rooms[i]
        if (room.polygon.length >= 3 && pointInPolygon(world, room.polygon)) {
          return { type: 'room', id: room.id }
        }
      }
      return null
    },
    [floor],
  )

  // ───── requestAnimationFrame Render loop ─────
  useEffect(() => {
    if (!canvasRef.current) return
    const cvs = canvasRef.current
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    function frame() {
      if (!needsRedraw.current) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }
      needsRedraw.current = false

      cvs.width = Math.round(size.w * dpr)
      cvs.height = Math.round(size.h * dpr)
      cvs.style.width = `${size.w}px`
      cvs.style.height = `${size.h}px`
      if (!ctx) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (!doc || !floor) {
        rafRef.current = requestAnimationFrame(frame)
        return
      }

      draw(ctx, size.w, size.h)
      rafRef.current = requestAnimationFrame(frame)
    }

    function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
      if (!doc || !floor) return

      // Theme — read CSS vars once per frame (cheap, lets dark mode work)
      const theme = readTheme()

      // Background
      ctx.fillStyle = theme.paper
      // Use --bg from root for the canvas background outside the paper
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0A0A0B'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, w, h)

      // Paper — soft drop-shadow + linen tint
      const paperTL = worldToScreen({ x: 0, y: 0 })
      const paperBR = worldToScreen({ x: floor.extent.width, y: floor.extent.height })
      const pw = paperBR.x - paperTL.x
      const ph = paperBR.y - paperTL.y
      ctx.save()
      ctx.shadowColor = theme.paperShadow
      ctx.shadowBlur = 24
      ctx.shadowOffsetY = 6
      ctx.fillStyle = theme.paper
      ctx.fillRect(paperTL.x, paperTL.y, pw, ph)
      ctx.restore()
      // Vignette tint inside the paper (very subtle)
      const tint = ctx.createLinearGradient(paperTL.x, paperTL.y, paperBR.x, paperBR.y)
      tint.addColorStop(0, 'rgba(199, 162, 78, 0.03)')
      tint.addColorStop(1, 'rgba(199, 162, 78, 0.07)')
      ctx.fillStyle = tint
      ctx.fillRect(paperTL.x, paperTL.y, pw, ph)

      // Grid — major (gridSize) + minor (gridSize / 5), fade out at low zoom
      if (doc.settings.showGrid) {
        const z = viewportRef.current.zoom
        const major = doc.settings.gridSize
        const minor = Math.max(major / 5, 5)

        // Premium dot grid — only when zoomed in enough to read
        // (line grid felt too technical; dots feel like high-end design tools)
        if (z > 0.20) {
          const dotSpacing = z > 0.50 ? minor : major
          const dotSize = z > 0.80 ? 1.4 : 1.0
          ctx.fillStyle = theme.gridMajor
          // Confine dots to the paper rect so we don't paint into the margin
          for (let x = 0; x <= floor.extent.width; x += dotSpacing) {
            for (let y = 0; y <= floor.extent.height; y += dotSpacing) {
              const p = worldToScreen({ x, y })
              ctx.beginPath()
              ctx.arc(p.x, p.y, dotSize, 0, Math.PI * 2)
              ctx.fill()
            }
          }
          // Major-grid emphasis: slightly larger, more opaque dots at major intervals
          if (z > 0.40 && dotSpacing < major) {
            ctx.fillStyle = theme.gridMajor.replace('0.4', '0.7') // approximation
            for (let x = 0; x <= floor.extent.width; x += major) {
              for (let y = 0; y <= floor.extent.height; y += major) {
                const p = worldToScreen({ x, y })
                ctx.beginPath()
                ctx.arc(p.x, p.y, dotSize * 1.5, 0, Math.PI * 2)
                ctx.fill()
              }
            }
          }
        }
      }

      // Paper edge — thin gold rule
      ctx.strokeStyle = theme.paperEdge
      ctx.lineWidth = 1
      ctx.strokeRect(paperTL.x, paperTL.y, pw, ph)

      // Rooms — indoor floors render their catalog material + ambient light;
      // outdoor zones keep the decking treatment.
      const activeMode = doc.activeModeKey
      for (const room of floor.rooms) {
        const screenPts = room.polygon.map((p) => worldToScreen(p))
        if ((room.zoneType ?? 'indoor') === 'outdoor') {
          drawRoomFill(ctx, screenPts, theme, 'outdoor')
        } else {
          const material = resolveFloorMaterial(room)
          const lighting = deriveRoomLighting({
            roomId: room.id,
            devices: floor.devices,
            lookup: (id) => DEVICE_MAP[id]?.category,
            mode: activeMode,
          })
          drawRoomFloor(ctx, screenPts, material, lighting)
        }
      }

      // Walls
      if (floor.layers.walls) {
        for (const wall of floor.walls) {
          const a = worldToScreen(wall.a)
          const b = worldToScreen(wall.b)
          const sel = selection.type === 'wall' && selection.ids.includes(wall.id)
          const t = Math.max(2, wall.thickness * viewportRef.current.zoom * 0.6)
          const wallLen = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1
          const opFrac = wall.openingWidth ? Math.min(0.7, wall.openingWidth / wallLen) : 0
          drawWall(ctx, a.x, a.y, b.x, b.y, t, sel, theme, wall.subtype ?? 'wall', opFrac)
        }
        // Selected wall: dimension callout
        if (selection.type === 'wall' && selection.ids.length === 1) {
          const w0 = floor.walls.find((x) => x.id === selection.ids[0])
          if (w0) {
            const a = worldToScreen(w0.a)
            const b = worldToScreen(w0.b)
            const len = Math.hypot(w0.a.x - w0.b.x, w0.a.y - w0.b.y)
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            const dx = b.x - a.x, dy = b.y - a.y
            const L = Math.hypot(dx, dy) || 1
            const nx = -dy / L, ny = dx / L
            const offX = mx + nx * 18
            const offY = my + ny * 18
            const text = `${Math.round(len)} cm`
            ctx.save()
            ctx.font = '500 11px JetBrains Mono, monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const tw = ctx.measureText(text).width + 14
            ctx.shadowColor = theme.shadow
            ctx.shadowBlur = 6
            ctx.shadowOffsetY = 1
            ctx.fillStyle = theme.surface
            roundRect(ctx, offX - tw / 2, offY - 9, tw, 18, 9)
            ctx.fill()
            ctx.shadowBlur = 0
            ctx.strokeStyle = theme.selectSoft
            ctx.lineWidth = 1
            roundRect(ctx, offX - tw / 2, offY - 9, tw, 18, 9)
            ctx.stroke()
            ctx.fillStyle = theme.fg
            ctx.fillText(text, offX, offY)
            ctx.restore()
          }
        }
      }

      // Furniture
      if (floor.layers.furniture) {
        for (const f of floor.furniture) {
          if (f.hidden) continue
          const entry = FURN_MAP[f.furnitureId]
          let [fw, fh] = f.size ?? entry?.size ?? [60, 60]
          const sel = selection.type === 'furniture' && selection.ids.includes(f.id)
          const hov = hoverFurn === f.id
          // Apply live drag offset only to currently dragged selected items
          let livePos = f.position
          if (sel && isDragging) {
            livePos = { x: f.position.x + dragOffsetRef.current.x, y: f.position.y + dragOffsetRef.current.y }
          }
          // Apply live resize for the currently resizing item
          if (sel && isResizing && resizeLiveRef.current.w > 0) {
            fw = resizeLiveRef.current.w
            fh = resizeLiveRef.current.h
            livePos = { x: livePos.x + resizeLiveRef.current.dx, y: livePos.y + resizeLiveRef.current.dy }
          }
          const c = worldToScreen(livePos)
          const sw = fw * viewportRef.current.zoom
          const sh = fh * viewportRef.current.zoom
          ctx.save()
          ctx.translate(c.x, c.y)
          const liveRot = ((f.rotation ?? 0) + (sel && isRotating ? rotationOffsetRef.current : 0)) * Math.PI / 180
          ctx.rotate(liveRot)
          drawFurnitureGlyph(ctx, f.furnitureId, sw, sh, sel, hov, theme, viewportRef.current.zoom)
          // Label inside furniture if zoomed enough
          if (viewportRef.current.zoom > 0.35 && Math.min(sw, sh) > 32) {
            ctx.fillStyle = theme.muted
            ctx.font = '500 10px Inter, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(f.label || entry?.name || 'Möbel', 0, 0)
          }
          ctx.restore()
        }
      }

      // Devices
      if (floor.layers.devices) {
        const activeMode = doc.activeModeKey
        for (const d of floor.devices) {
          const entry = DEVICE_MAP[d.deviceId]
          const sel = selection.type === 'device' && selection.ids.includes(d.id)
          const hov = hoverDevice === d.id
          const livePos = (sel && isDragging)
            ? { x: d.position.x + dragOffsetRef.current.x, y: d.position.y + dragOffsetRef.current.y }
            : d.position
          const p = worldToScreen(livePos)
          const r = 14
          // Mode preview alpha
          const supportsMode =
            activeMode === 'auto' || (entry?.modeTags?.includes(activeMode) ?? false)
          // Read mode-state
          const ms = d.modeState?.[activeMode] as Record<string, string | number | boolean> | undefined
          const isOn = ms === undefined ? null : ms.on === true ? true : ms.on === false ? false : null
          const brightness = typeof ms?.brightness === 'number' ? ms.brightness : null
          const locked = typeof ms?.locked === 'boolean' ? ms.locked : null
          const armed = typeof ms?.armed === 'boolean' ? ms.armed : null

          drawDevicePin({
            ctx,
            cx: p.x, cy: p.y, r,
            category: entry?.category ?? 'other',
            deviceId: d.deviceId,
            selected: sel,
            hovered: hov,
            on: isOn,
            brightness,
            locked,
            armed,
            active: supportsMode,
            theme,
          })

          if (viewportRef.current.zoom > 0.35 && entry) {
            ctx.save()
            ctx.globalAlpha = supportsMode ? 1 : 0.4
            ctx.fillStyle = theme.fg
            ctx.font = '500 10px Inter, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillText(entry.name, p.x, p.y + r + 6)
            ctx.restore()
          }
        }
      }

      // Labels (room labels) — pretty plate
      if (floor.layers.labels) {
        for (const l of floor.labels) {
          const p = worldToScreen(l.position)
          drawRoomLabel(ctx, p.x, p.y, l.text, l.size ?? 16, theme)
        }
      }

      // Alignment guides — while dragging a single device or furniture
      if (isDragging && (selection.type === 'device' || selection.type === 'furniture') && selection.ids.length === 1) {
        const SNAP_THRESHOLD = 4 // cm (in world space)
        // Compute the dragged item's CURRENT center (committed position + live drag offset)
        let cur: Point | null = null
        if (selection.type === 'device') {
          const it = floor.devices.find((d) => d.id === selection.ids[0])
          if (it) cur = { x: it.position.x + dragOffsetRef.current.x, y: it.position.y + dragOffsetRef.current.y }
        } else {
          const it = floor.furniture.find((f) => f.id === selection.ids[0])
          if (it) cur = { x: it.position.x + dragOffsetRef.current.x, y: it.position.y + dragOffsetRef.current.y }
        }
        if (cur) {
          // Collect candidate positions of OTHER objects (devices + furniture)
          const others: Point[] = []
          for (const d of floor.devices) if (selection.ids[0] !== d.id) others.push(d.position)
          for (const f of floor.furniture) if (selection.ids[0] !== f.id) others.push(f.position)
          // Vertical alignment (matching X)
          for (const o of others) {
            if (Math.abs(o.x - cur.x) <= SNAP_THRESHOLD) {
              const sp = worldToScreen({ x: o.x, y: 0 })
              drawAlignmentLine(ctx, 'v', sp.x, w, h)
              break
            }
          }
          // Horizontal alignment (matching Y)
          for (const o of others) {
            if (Math.abs(o.y - cur.y) <= SNAP_THRESHOLD) {
              const sp = worldToScreen({ x: 0, y: o.y })
              drawAlignmentLine(ctx, 'h', sp.y, w, h)
              break
            }
          }
        }
      }

      // Rotation handle for the single selected device/furniture
      if (tool === 'select' && (selection.type === 'device' || selection.type === 'furniture') && selection.ids.length === 1) {
        const handle = rotationHandleScreen()
        const sc = selectedSingleCenter()
        if (handle && sc) {
          const cx = (sc.pos.x + (isDragging ? dragOffsetRef.current.x : 0)) * viewportRef.current.zoom + viewportRef.current.offsetX
          const cy = (sc.pos.y + (isDragging ? dragOffsetRef.current.y : 0)) * viewportRef.current.zoom + viewportRef.current.offsetY
          // Connector line
          ctx.strokeStyle = isRotating ? theme.select : theme.selectSoft
          ctx.lineWidth = 1.2
          ctx.setLineDash(isRotating ? [] : [3, 3])
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(handle.x, handle.y)
          ctx.stroke()
          ctx.setLineDash([])
          // Handle disc
          ctx.save()
          ctx.shadowColor = theme.shadow
          ctx.shadowBlur = 8
          ctx.shadowOffsetY = 1.5
          ctx.fillStyle = isRotating ? theme.select : theme.surface
          ctx.beginPath()
          ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
          ctx.strokeStyle = theme.select
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2)
          ctx.stroke()
          // Curved arrow inside handle
          ctx.strokeStyle = isRotating ? theme.handleOn : theme.select
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(handle.x, handle.y, 4, Math.PI * 0.2, Math.PI * 1.8)
          ctx.stroke()
          // Tiny arrowhead
          ctx.fillStyle = isRotating ? theme.handleOn : theme.select
          ctx.beginPath()
          ctx.moveTo(handle.x + 4 * Math.cos(Math.PI * 1.8), handle.y + 4 * Math.sin(Math.PI * 1.8))
          ctx.lineTo(handle.x + 6, handle.y - 2)
          ctx.lineTo(handle.x + 2, handle.y - 2)
          ctx.closePath()
          ctx.fill()

          // While rotating, show angle pill
          if (isRotating) {
            const total = ((sc.rot ?? 0) + rotationOffsetRef.current) % 360
            const text = `${Math.round(total)}°`
            ctx.save()
            ctx.font = '500 11px JetBrains Mono, monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const tw = ctx.measureText(text).width + 14
            ctx.shadowColor = theme.shadow
            ctx.shadowBlur = 6
            ctx.fillStyle = theme.surface
            roundRect(ctx, handle.x - tw / 2, handle.y - 28, tw, 18, 9)
            ctx.fill()
            ctx.shadowBlur = 0
            ctx.strokeStyle = theme.selectSoft
            ctx.lineWidth = 1
            roundRect(ctx, handle.x - tw / 2, handle.y - 28, tw, 18, 9)
            ctx.stroke()
            ctx.fillStyle = theme.fg
            ctx.fillText(text, handle.x, handle.y - 19)
            ctx.restore()
          }
        }
      }

      // Resize handles for the selected single FURNITURE item
      if (tool === 'select' && selection.type === 'furniture' && selection.ids.length === 1) {
        const handles = resizeHandlesScreen()
        if (handles) {
          // Bounding box outline (subtle dashed)
          ctx.save()
          ctx.strokeStyle = theme.selectSoft
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          for (let i = 0; i < handles.length; i++) {
            const p = handles[i]
            // Draw the box by connecting the perimeter handles in order:
            // nw → n → ne → e → se → s → sw → w → nw
            if (i === 0) ctx.moveTo(p.x, p.y)
            else ctx.lineTo(p.x, p.y)
          }
          ctx.closePath()
          ctx.stroke()
          ctx.setLineDash([])
          ctx.restore()
          // Each handle as a small white square with brass border
          for (const h of handles) {
            ctx.save()
            ctx.shadowColor = theme.shadow
            ctx.shadowBlur = 4
            ctx.shadowOffsetY = 1
            const isCorner = h.anchor.length === 2
            const r = isCorner ? 5 : 4
            ctx.fillStyle = (isResizing && resizeAnchorRef.current === h.anchor) ? theme.select : theme.handleFill
            ctx.fillRect(h.x - r, h.y - r, r * 2, r * 2)
            ctx.restore()
            ctx.strokeStyle = theme.select
            ctx.lineWidth = 1.5
            ctx.strokeRect(h.x - r, h.y - r, r * 2, r * 2)
          }

          // While resizing show size pill
          if (isResizing && resizeLiveRef.current.w > 0) {
            const text = `${Math.round(resizeLiveRef.current.w)} × ${Math.round(resizeLiveRef.current.h)} cm`
            const pillX = handles[5].x  // 's' handle
            const pillY = handles[5].y + 18
            ctx.save()
            ctx.font = '500 11px JetBrains Mono, monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            const tw = ctx.measureText(text).width + 14
            ctx.shadowColor = theme.shadow
            ctx.shadowBlur = 6
            ctx.fillStyle = theme.surface
            roundRect(ctx, pillX - tw / 2, pillY - 9, tw, 18, 9)
            ctx.fill()
            ctx.shadowBlur = 0
            ctx.strokeStyle = theme.selectSoft
            ctx.lineWidth = 1
            roundRect(ctx, pillX - tw / 2, pillY - 9, tw, 18, 9)
            ctx.stroke()
            ctx.fillStyle = theme.fg
            ctx.fillText(text, pillX, pillY)
            ctx.restore()
          }
        }
      }

      // Wall / Door / Window preview
      if ((tool === 'wall' || tool === 'door' || tool === 'window') && wallStart && mouseRef.current) {
        const a = worldToScreen(wallStart)
        const b = worldToScreen(snapWorld(mouseRef.current))
        const col = tool === 'door' ? 'rgba(46, 229, 157, 0.85)'
                  : tool === 'window' ? 'rgba(232, 200, 121, 0.85)'
                  : theme.selectSoft
        ctx.strokeStyle = col
        ctx.setLineDash(tool === 'window' ? [3, 3] : [6, 6])
        ctx.lineWidth = tool === 'wall' ? 2 : 4
        ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        ctx.setLineDash([])
        const d = Math.hypot(wallStart.x - mouseRef.current.x, wallStart.y - mouseRef.current.y)
        const tlabel = tool === 'door' ? 'Tür' : tool === 'window' ? 'Fenster' : ''
        ctx.fillStyle = col.replace(/0\.[0-9]+\)/, '1)')
        ctx.font = '11px JetBrains Mono, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`${tlabel} ${Math.round(d)} cm`.trim(), (a.x + b.x) / 2, (a.y + b.y) / 2 - 8)
      }

      // Terrace rectangle preview
      if (tool === 'terrace' && terraceStart && mouseRef.current) {
        const a = worldToScreen(terraceStart)
        const b = worldToScreen(snapWorld(mouseRef.current))
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
        ctx.fillStyle = theme.zoneFill
        ctx.fillRect(x, y, w, h)
        ctx.strokeStyle = theme.zoneStroke
        ctx.lineWidth = 2
        ctx.setLineDash([8, 4])
        ctx.strokeRect(x, y, w, h)
        ctx.setLineDash([])
        const dw = Math.abs(terraceStart.x - snapWorld(mouseRef.current).x)
        const dh = Math.abs(terraceStart.y - snapWorld(mouseRef.current).y)
        ctx.fillStyle = theme.zoneLabel
        ctx.font = '11px JetBrains Mono, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`Terrasse ${Math.round(dw)} × ${Math.round(dh)} cm`, x + w / 2, y + h / 2)
      }

      // Measure tool — line + length + per-axis breakdown
      if (tool === 'measure' && measureStart) {
        const live = measureEnd ?? mouseRef.current
        if (live) {
          const a = worldToScreen(measureStart)
          const b = worldToScreen(live)
          // Crisp gold ruler line
          ctx.strokeStyle = theme.select
          ctx.lineWidth = 2
          ctx.setLineDash([8, 4])
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
          ctx.setLineDash([])
          // End caps
          ctx.beginPath(); ctx.arc(a.x, a.y, 4, 0, Math.PI * 2); ctx.fill()
          ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill()
          // Length label with backdrop
          const d = Math.hypot(measureStart.x - live.x, measureStart.y - live.y)
          const dx = Math.abs(measureStart.x - live.x)
          const dy = Math.abs(measureStart.y - live.y)
          const text = `${Math.round(d)} cm  (${Math.round(dx)} × ${Math.round(dy)})`
          ctx.font = '11px JetBrains Mono, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const tx = (a.x + b.x) / 2
          const ty = (a.y + b.y) / 2 - 14
          const tw = ctx.measureText(text).width + 12
          ctx.fillStyle = 'rgba(11, 15, 20, 0.88)'
          ctx.fillRect(tx - tw / 2, ty - 9, tw, 18)
          ctx.fillStyle = theme.measure
          ctx.fillText(text, tx, ty)
        }
      }

      // Device / Furniture placement preview
      const mouse = mouseRef.current
      if (mouse && tool === 'device' && hoverDevice) {
        const p = worldToScreen(snapWorld(mouse))
        ctx.strokeStyle = theme.selectSoft
        ctx.setLineDash([4, 4]); ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
      }
      if (mouse && tool === 'furniture' && hoverFurn) {
        const entry = FURN_MAP[hoverFurn]
        if (entry) {
          const [fw, fh] = entry.size
          const p = worldToScreen(snapWorld(mouse))
          const sw = fw * viewportRef.current.zoom
          const sh = fh * viewportRef.current.zoom
          ctx.strokeStyle = theme.selectSoft
          ctx.setLineDash([4, 4]); ctx.lineWidth = 2
          ctx.strokeRect(p.x - sw / 2, p.y - sh / 2, sw, sh)
          ctx.setLineDash([])
        }
      }

      // HUD
      ctx.fillStyle = 'rgba(174, 185, 201, 0.5)'
      ctx.font = '10px JetBrains Mono, monospace'
      ctx.textAlign = 'left'
      const zoomPct = (viewportRef.current.zoom * 100).toFixed(0)
      const counts = `${floor.devices.length}D · ${floor.furniture.length}F · ${floor.walls.length}W`
      ctx.fillText(`${floor.name} · ${zoomPct}% · ${counts}`, 14, h - 14)
      // Mouse cm position (right-aligned)
      if (mouseRef.current) {
        ctx.textAlign = 'right'
        ctx.fillText(
          `x ${Math.round(mouseRef.current.x)} cm  y ${Math.round(mouseRef.current.y)} cm`,
          w - 14, h - 14,
        )
      }
    }

    needsRedraw.current = true
    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, doc?.activeModeKey, floor?.id, size.w, size.h, tool, wallStart, terraceStart, measureStart, measureEnd, hoverDevice, hoverFurn, isDragging, isRotating, isResizing, selection.ids.join(','), selection.type])

  // Force redraw on state changes
  useEffect(() => {
    needsRedraw.current = true
  }, [doc, floor, size, viewport, selection, tool, wallStart, terraceStart, measureStart, measureEnd, hoverDevice, hoverFurn, isDragging, isRotating, isResizing])

  // ───── Pointer events ─────
  function getLocalXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = getLocalXY(e)
    const world = screenToWorld(x, y)
    dragStart.current = { x, y }
    dragLast.current = { x, y }

    if (spaceDown.current || e.button === 1 || tool === 'pan') {
      setIsPanning(true); return
    }

    if (tool === 'select') {
      // Check rotation handle first (when one item is selected)
      if (selection.ids.length === 1 && (selection.type === 'device' || selection.type === 'furniture')) {
        const handle = rotationHandleScreen()
        if (handle) {
          const dx = x - handle.x
          const dy = y - handle.y
          if (dx * dx + dy * dy <= 12 * 12) {
            // Begin rotation drag
            const sc = selectedSingleCenter()
            if (sc) {
              // angle from item center to mouse, in screen-space (which matches world up to scale)
              const cx = sc.pos.x * viewportRef.current.zoom + viewportRef.current.offsetX
              const cy = sc.pos.y * viewportRef.current.zoom + viewportRef.current.offsetY
              rotationStartAngleRef.current = Math.atan2(y - cy, x - cx)
              rotationOffsetRef.current = 0
              setIsRotating(true)
            }
            return
          }
        }
      }

      // Check resize handles for furniture
      if (selection.type === 'furniture' && selection.ids.length === 1) {
        const handles = resizeHandlesScreen()
        if (handles) {
          for (const h of handles) {
            const dx = x - h.x
            const dy = y - h.y
            const r = h.anchor.length === 2 ? 7 : 6  // hit-radius slightly larger than visible
            if (dx * dx + dy * dy <= r * r) {
              const f = floor!.furniture.find((fi) => fi.id === selection.ids[0])!
              const entry = FURN_MAP[f.furnitureId]
              const [w0, h0] = f.size ?? entry?.size ?? [60, 60]
              resizeAnchorRef.current = h.anchor
              resizeOriginalRef.current = {
                w: w0, h: h0,
                cx: f.position.x, cy: f.position.y,
                rot: f.rotation ?? 0,
              }
              resizeStartWorldRef.current = world
              resizeLiveRef.current = { w: w0, h: h0, dx: 0, dy: 0 }
              setIsResizing(true)
              return
            }
          }
        }
      }

      const hit = hitTest(world)
      if (hit) {
        const additive = e.shiftKey
        const current = selection
        let ids = [hit.id]
        if (additive && current.type === hit.type) {
          ids = current.ids.includes(hit.id)
            ? current.ids.filter((i) => i !== hit.id)
            : [...current.ids, hit.id]
        }
        setSelection({ type: hit.type, ids })
        // Rooms are selected for editing but not dragged (polygon move is not supported here)
        if (hit.type !== 'room') setIsDragging(true)
      } else {
        setSelection({ type: null, ids: [] })
      }
      return
    }

    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      const snapped = snapWorld(world)
      if (!wallStart) setWallStart(snapped)
      else {
        const subtype = tool === 'door' ? 'door' : tool === 'window' ? 'window' : 'wall'
        addWall(wallStart, snapped, 14, subtype as WallSubtype)
        setWallStart(null)
      }
      return
    }

    if (tool === 'terrace') {
      const snapped = snapWorld(world)
      if (!terraceStart) {
        setTerraceStart(snapped)
      } else {
        // Build a rectangle polygon from the two opposite corners
        const x1 = terraceStart.x, y1 = terraceStart.y
        const x2 = snapped.x, y2 = snapped.y
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
        if (maxX - minX > 20 && maxY - minY > 20) {
          addRoom(
            [
              { x: minX, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x: minX, y: maxY },
            ],
            'Terrasse',
            'outdoor',
          )
          pushToast({ kind: 'success', title: 'Terrasse erstellt', description: 'Frei gestaltbar — platziere Outdoor-Möbel & Geräte.' })
        }
        setTerraceStart(null)
      }
      return
    }

    if (tool === 'measure') {
      const snapped = snapWorld(world)
      if (!measureStart) {
        setMeasureStart(snapped)
        setMeasureEnd(null)
      } else if (!measureEnd) {
        setMeasureEnd(snapped)
      } else {
        // Third click → start a fresh measurement
        setMeasureStart(snapped)
        setMeasureEnd(null)
      }
      return
    }

    if (tool === 'device' && hoverDevice) {
      // v18 — try wall-snap first, fallback to grid-snap
      const wallSnapped = snapToWall(world)
      const finalPos = wallSnapped.x !== world.x || wallSnapped.y !== world.y
        ? wallSnapped
        : snapWorld(world)
      addDevice(hoverDevice, finalPos)
      return
    }
    if (tool === 'furniture' && hoverFurn) {
      const entry = FURN_MAP[hoverFurn]
      addFurniture(hoverFurn, snapWorld(world), entry?.size)
      return
    }
    if (tool === 'label') {
      const text = prompt('Beschriftung eingeben')
      if (text) addLabel(snapWorld(world), text)
      setTool('select')
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = getLocalXY(e)
    const world = screenToWorld(x, y)
    mouseRef.current = world
    needsRedraw.current = true

    // Broadcast our cursor to peers (throttled inside the hook).
    if (publishCursor && floor) {
      publishCursor(world.x, world.y, floor.id, tool)
    }

    if (isPanning && dragLast.current) {
      const dx = x - dragLast.current.x
      const dy = y - dragLast.current.y
      setViewport({ offsetX: viewportRef.current.offsetX + dx, offsetY: viewportRef.current.offsetY + dy })
      dragLast.current = { x, y }
      return
    }

    if (isDragging && dragLast.current && selection.type) {
      const prev = screenToWorld(dragLast.current.x, dragLast.current.y)
      const dx = world.x - prev.x
      const dy = world.y - prev.y
      if (dx !== 0 || dy !== 0) {
        dragOffsetRef.current.x += dx
        dragOffsetRef.current.y += dy
        needsRedraw.current = true
      }
      dragLast.current = { x, y }
      return
    }

    if (isRotating) {
      const sc = selectedSingleCenter()
      if (sc) {
        const cx = sc.pos.x * viewportRef.current.zoom + viewportRef.current.offsetX
        const cy = sc.pos.y * viewportRef.current.zoom + viewportRef.current.offsetY
        const angle = Math.atan2(y - cy, x - cx)
        let delta = ((angle - rotationStartAngleRef.current) * 180) / Math.PI
        // Snap to 15° while holding shift
        if (e.shiftKey) delta = Math.round(delta / 15) * 15
        rotationOffsetRef.current = delta
        needsRedraw.current = true
      }
      return
    }

    if (isResizing && resizeOriginalRef.current && resizeStartWorldRef.current && resizeAnchorRef.current) {
      const orig = resizeOriginalRef.current
      const start = resizeStartWorldRef.current
      // Translate world delta into the item's local frame (account for rotation).
      const dwx = world.x - start.x
      const dwy = world.y - start.y
      const cosR = Math.cos(orig.rot * Math.PI / 180)
      const sinR = Math.sin(orig.rot * Math.PI / 180)
      // Rotate world delta by -rot to get local delta
      const dlx = dwx * cosR + dwy * sinR
      const dly = -dwx * sinR + dwy * cosR
      const a = resizeAnchorRef.current
      // Decide which sides this anchor moves.
      // For a north handle, dragging up reduces height + shifts center up.
      let newW = orig.w
      let newH = orig.h
      let cdx = 0  // center delta in local frame
      let cdy = 0
      if (a.includes('e')) { newW = orig.w + dlx; cdx = dlx / 2 }
      if (a.includes('w')) { newW = orig.w - dlx; cdx = dlx / 2 }
      if (a.includes('s')) { newH = orig.h + dly; cdy = dly / 2 }
      if (a.includes('n')) { newH = orig.h - dly; cdy = dly / 2 }
      // Clamp min size; if negative, freeze at min and don't move center past it.
      const minSize = 10
      if (newW < minSize) {
        if (a.includes('w')) cdx -= (minSize - newW) / 2
        else                 cdx += (minSize - newW) / 2
        newW = minSize
      }
      if (newH < minSize) {
        if (a.includes('n')) cdy -= (minSize - newH) / 2
        else                 cdy += (minSize - newH) / 2
        newH = minSize
      }
      // Shift+resize = uniform aspect-ratio scale around opposite corner
      if (e.shiftKey && a.length === 2) {
        // Use the larger ratio of (newW/orig.w, newH/orig.h)
        const rW = newW / orig.w
        const rH = newH / orig.h
        const r = (Math.abs(rW - 1) > Math.abs(rH - 1)) ? rW : rH
        newW = orig.w * r
        newH = orig.h * r
        // Recompute center offset relative to the chosen anchor
        const sx = a.includes('w') ? -1 : 1
        const sy = a.includes('n') ? -1 : 1
        cdx = sx * (newW - orig.w) / 2
        cdy = sy * (newH - orig.h) / 2
      }
      // Convert local center delta back to world delta
      const cdwx = cdx * cosR - cdy * sinR
      const cdwy = cdx * sinR + cdy * cosR
      resizeLiveRef.current = { w: newW, h: newH, dx: cdwx, dy: cdwy }
      needsRedraw.current = true
      return
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    // Commit drag offset
    if (isDragging && (dragOffsetRef.current.x !== 0 || dragOffsetRef.current.y !== 0)) {
      const settings = doc?.settings
      let dx = dragOffsetRef.current.x
      let dy = dragOffsetRef.current.y
      if (settings?.snap) {
        const g = settings.snapStep
        dx = Math.round(dx / g) * g
        dy = Math.round(dy / g) * g
      }
      moveSelection(dx, dy)
    }
    // Commit rotation
    if (isRotating && rotationOffsetRef.current !== 0) {
      rotateSelection(rotationOffsetRef.current)
    }
    // Commit resize
    if (isResizing && resizeLiveRef.current.w > 0 && selection.type === 'furniture' && selection.ids.length === 1) {
      const live = resizeLiveRef.current
      // Only commit if there was a meaningful change
      if (Math.abs(live.dx) > 0.1 || Math.abs(live.dy) > 0.1 ||
          Math.abs(live.w - (resizeOriginalRef.current?.w ?? 0)) > 0.1 ||
          Math.abs(live.h - (resizeOriginalRef.current?.h ?? 0)) > 0.1) {
        resizeFurniture(selection.ids[0], live.w, live.h, live.dx, live.dy)
      }
    }
    dragOffsetRef.current = { x: 0, y: 0 }
    rotationOffsetRef.current = 0
    resizeLiveRef.current = { w: 0, h: 0, dx: 0, dy: 0 }
    resizeAnchorRef.current = null
    resizeOriginalRef.current = null
    resizeStartWorldRef.current = null
    setIsDragging(false)
    setIsRotating(false)
    setIsResizing(false)
    setIsPanning(false)
    dragStart.current = null
    dragLast.current = null
    needsRedraw.current = true
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { x, y } = (() => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    })()
    const world = screenToWorld(x, y)
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    const newZoom = clamp(viewportRef.current.zoom * factor, 0.08, 6)
    setViewport({
      zoom: newZoom,
      offsetX: x - world.x * newZoom,
      offsetY: y - world.y * newZoom,
    })
  }

  // ───── Keyboard ─────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Skip if typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      if (e.code === 'Space') spaceDown.current = true
      if (e.key === 'Escape') {
        setWallStart(null)
        setMeasureStart(null)
        setMeasureEnd(null)
        setTool('select')
      }
      // Rotation: R = +15°, Shift+R = -15°, Cmd/Ctrl+R is browser-reload, leave alone
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (selection.type === 'device' || selection.type === 'furniture') {
          e.preventDefault()
          rotateSelection(e.shiftKey ? -15 : 15)
        }
      }
      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.type) {
        e.preventDefault()
        deleteSelection()
      }
      // Arrow keys: nudge by 1cm (or 10cm with Shift)
      if (selection.type && (selection.type === 'device' || selection.type === 'furniture' || selection.type === 'label')) {
        const step = e.shiftKey ? 10 : 1
        if (e.key === 'ArrowLeft')  { e.preventDefault(); moveSelection(-step, 0) }
        if (e.key === 'ArrowRight') { e.preventDefault(); moveSelection(step, 0) }
        if (e.key === 'ArrowUp')    { e.preventDefault(); moveSelection(0, -step) }
        if (e.key === 'ArrowDown')  { e.preventDefault(); moveSelection(0, step) }
      }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [setTool, selection.type, rotateSelection, deleteSelection, moveSelection])

  // ───── Initial zoom-to-fit ─────
  // Re-fits whenever the active floor or canvas size changes.
  // We track the last-fit signature so we don't fight the user after they zoom.
  const lastFitKey = useRef<string>('')
  useEffect(() => {
    if (!floor || !size.w || !size.h) return
    const key = `${doc?.id}:${floor.id}:${Math.round(size.w)}x${Math.round(size.h)}`
    if (lastFitKey.current === key) return
    lastFitKey.current = key
    fitToView(size.w, size.h, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, floor?.id, size.w, size.h])

  const cursor =
    tool === 'pan' || isPanning ? 'cursor-grab'
    : tool === 'wall' || tool === 'door' || tool === 'window' || tool === 'terrace' ? 'cursor-wall'
    : tool === 'device' || tool === 'furniture' || tool === 'label' ? 'cursor-crosshair-gold'
    : isResizing ? 'cursor-nwse-resize'
    : isRotating ? 'cursor-grabbing'
    : isDragging ? 'cursor-grabbing'
    : 'cursor-default'

  useEffect(() => {
    if (tool === 'device' && !hoverDevice) {
      pushToast({ kind: 'info', title: 'Kein Gerät gewählt', description: 'Wähle in der Bibliothek ein Gerät aus.' })
    }
  }, [tool, hoverDevice, pushToast])

  // ───── Touch events (mobile gestures) ─────
  function getMidpoint(a: React.Touch, b: React.Touch): Point {
    const rect = canvasRef.current!.getBoundingClientRect()
    return {
      x: (a.clientX + b.clientX) / 2 - rect.left,
      y: (a.clientY + b.clientY) / 2 - rect.top,
    }
  }

  function getTouchDist(a: React.Touch, b: React.Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }

  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      isPinching.current = true
      const [t1, t2] = [e.touches[0], e.touches[1]]
      touchStartDist.current = getTouchDist(t1, t2)
      touchStartZoom.current = viewportRef.current.zoom
      touchMidpoint.current = getMidpoint(t1, t2)
    }
  }

  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 2 && isPinching.current) {
      e.preventDefault()
      const [t1, t2] = [e.touches[0], e.touches[1]]
      const dist = getTouchDist(t1, t2)
      const factor = dist / touchStartDist.current
      const newZoom = clamp(touchStartZoom.current * factor, 0.08, 6)
      const mid = getMidpoint(t1, t2)
      const worldMid = screenToWorld(mid.x, mid.y)
      setViewport({
        zoom: newZoom,
        offsetX: mid.x - worldMid.x * newZoom,
        offsetY: mid.y - worldMid.y * newZoom,
      })
    }
  }

  const onTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length < 2) {
      isPinching.current = false
      touchMidpoint.current = null
    }
  }

  // Clear in-progress wall/measure/terrace when the user picks a different tool.
  useEffect(() => {
    if (tool !== 'wall' && tool !== 'door' && tool !== 'window' && wallStart) setWallStart(null)
    if (tool !== 'terrace' && terraceStart) setTerraceStart(null)
    if (tool !== 'measure' && (measureStart || measureEnd)) {
      setMeasureStart(null); setMeasureEnd(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // Filter cursors: same floor only, drop expired ones (>10s without update)
  const liveCursors = useMemo(() => {
    if (!cursors || !floor) return [] as RemoteCursor[]
    const now = Date.now()
    return Object.values(cursors).filter(
      (c) => c.floorId === floor.id && now - c.ts < 10000,
    )
  }, [cursors, floor])

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        data-editor-canvas="true"
        className={`absolute inset-0 ${cursor}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!floor) return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const world = screenToWorld(x, y)
          const hit = hitTest(world)
          if (hit && hit.type !== 'label' && hit.type !== 'room') {
            setSelection({ type: hit.type, ids: [hit.id] })
            setCtxMenu({ x: e.clientX, y: e.clientY, type: hit.type, id: hit.id })
          } else {
            setCtxMenu(null)
          }
        }}
      />
      {/* Right-click context menu */}
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-[55]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null) }}
          />
          <div
            className="fixed z-[56] min-w-[180px] rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] backdrop-blur-md py-1.5 overflow-hidden"
            style={{
              left: ctxMenu.x,
              top: ctxMenu.y,
              boxShadow: '0 1px 0 rgba(255,255,255,0.5) inset, 0 8px 24px rgba(20,16,8,0.18), 0 16px 40px rgba(20,16,8,0.12)',
              animation: 'ctxIn 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {(ctxMenu.type === 'device' || ctxMenu.type === 'furniture') && (
              <>
                <button
                  onClick={() => { rotateSelection(15); setCtxMenu(null) }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-[color:var(--surface-2)] transition-colors text-left"
                >
                  <span>Drehen +15°</span>
                  <kbd className="text-[10px] font-mono text-[color:var(--muted)]">R</kbd>
                </button>
                <button
                  onClick={() => { rotateSelection(-15); setCtxMenu(null) }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-[color:var(--surface-2)] transition-colors text-left"
                >
                  <span>Drehen −15°</span>
                  <kbd className="text-[10px] font-mono text-[color:var(--muted)]">⇧R</kbd>
                </button>
                <button
                  onClick={() => { rotateSelection(90); setCtxMenu(null) }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-[color:var(--surface-2)] transition-colors text-left"
                >
                  <span>Drehen +90°</span>
                </button>
                <div className="my-1 mx-2 h-px bg-[color:var(--border)]" />
              </>
            )}
            <button
              onClick={() => { deleteSelection(); setCtxMenu(null) }}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm hover:bg-[rgba(208,100,100,0.10)] text-[color:var(--color-omega-danger,#d06464)] transition-colors text-left"
            >
              <span>Löschen</span>
              <kbd className="text-[10px] font-mono opacity-60">⌫</kbd>
            </button>
          </div>
          <style>{`@keyframes ctxIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
        </>
      )}
      {/* Live cursors overlay (DOM, so we can label and color them cleanly) */}
      {liveCursors.length > 0 && (
        <div className="pointer-events-none absolute inset-0">
          {liveCursors.map((c) => {
            const sp = worldToScreen({ x: c.x, y: c.y })
            // Cull off-screen
            if (sp.x < -40 || sp.y < -40 || sp.x > size.w + 40 || sp.y > size.h + 40) return null
            return (
              <div
                key={c.userId}
                className="absolute transition-transform duration-75"
                style={{
                  transform: `translate(${sp.x}px, ${sp.y}px)`,
                  willChange: 'transform',
                }}
              >
                {/* Pointer triangle */}
                <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: 'block' }}>
                  <path d="M0 0 L0 11 L3.5 8 L5.5 13 L7.5 12 L5.5 7 L11 7 Z" fill={c.color} stroke="rgba(0,0,0,0.4)" strokeWidth="0.5" />
                </svg>
                {/* Name pill with tool indicator */}
                <div
                  className="ml-3 -mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white whitespace-nowrap shadow"
                  style={{ background: c.color }}
                >
                  {c.name}
                  {c.tool && c.tool !== 'select' && (
                    <span className="opacity-75 italic">· {toolLabel(c.tool)}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Short German label for a Tool, shown in remote-cursor pills. */
function toolLabel(t: Tool): string {
  switch (t) {
    case 'wall':      return 'Wand'
    case 'device':    return 'Gerät'
    case 'furniture': return 'Möbel'
    case 'label':     return 'Text'
    case 'measure':   return 'Messen'
    case 'pan':       return 'Verschieben'
    case 'room':      return 'Raum'
    default:          return t
  }
}
