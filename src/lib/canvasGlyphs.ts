/**
 * canvasGlyphs.ts — v14 visual upgrade.
 *
 * Drawing primitives for the 2D top-down plan canvas. The goal is to give
 * every placed object (device / furniture / wall / room label) a clean,
 * recognizable, depth-aware look without resorting to SVG sprites.
 *
 * All functions take a 2D context that is already transformed to the
 * object's local space (origin = object center, no rotation applied yet).
 * Caller is responsible for `ctx.save()/translate/rotate/restore`.
 *
 * Coordinates passed are in SCREEN pixels (already zoom-scaled by caller).
 *
 * Style tokens are read once from CSS variables; callers may pass
 * overrides for selection highlight, hover, etc.
 */

import type { Material } from '@/data/materials'
import type { RoomLighting } from '@/lib/lighting'

export interface Theme {
  paper: string
  paperEdge: string
  paperShadow: string
  gridMinor: string
  gridMajor: string
  roomFill: string
  roomStroke: string
  wallFill: string
  wallEdge: string
  wallShadow: string
  furnFill: string
  furnStroke: string
  furnDetail: string
  shadow: string
  fg: string
  muted: string
  accent: string
  surface: string
  /** Selection / handle language */
  select: string
  selectSoft: string
  selectFaint: string
  handleFill: string
  handleOn: string
  measure: string
  zoneFill: string
  zoneStroke: string
  zoneLabel: string
}

/** Read CSS variables once; pass into draw functions for consistency. */
export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback
  return {
    paper:        v('--canvas-paper',        '#ffffff'),
    paperEdge:    v('--canvas-paper-edge',   'rgba(200, 182, 142,0.40)'),
    paperShadow:  v('--canvas-paper-shadow', 'rgba(20,16,8,0.10)'),
    gridMinor:    v('--canvas-grid-minor',   'rgba(200, 182, 142,0.05)'),
    gridMajor:    v('--canvas-grid-major',   'rgba(200, 182, 142,0.11)'),
    roomFill:     v('--canvas-room-fill',    'rgba(232,228,218,0.55)'),
    roomStroke:   v('--canvas-room-stroke',  'rgba(199, 162, 78,0.16)'),
    wallFill:     v('--canvas-wall-fill',    '#2a2a30'),
    wallEdge:     v('--canvas-wall-edge',    '#C7A24E'),
    wallShadow:   v('--canvas-wall-shadow',  'rgba(20,16,8,0.18)'),
    furnFill:     v('--canvas-furn-fill',    '#f5efe0'),
    furnStroke:   v('--canvas-furn-stroke',  'rgba(200, 182, 142,0.40)'),
    furnDetail:   v('--canvas-furn-detail',  'rgba(200, 182, 142,0.25)'),
    shadow:       v('--canvas-shadow',       'rgba(0,0,0,0.55)'),
    fg:           v('--fg',                  '#F1ECE1'),
    muted:        v('--muted',               '#8B8478'),
    accent:       v('--accent',              '#C7A24E'),
    surface:      v('--surface',             '#17161A'),
    select:       v('--canvas-select',       '#C7A24E'),
    selectSoft:   v('--canvas-select-soft',  'rgba(199, 162, 78,0.55)'),
    selectFaint:  v('--canvas-select-faint', 'rgba(199, 162, 78,0.16)'),
    handleFill:   v('--canvas-handle-fill',  '#121113'),
    handleOn:     v('--canvas-handle-on',    '#FFFFFF'),
    measure:      v('--canvas-measure',      '#E8C879'),
    zoneFill:     v('--canvas-zone-fill',    'rgba(46,229,157,0.12)'),
    zoneStroke:   v('--canvas-zone-stroke',  'rgba(46,229,157,0.80)'),
    zoneLabel:    v('--canvas-zone-label',   '#2EE59D'),
  }
}

// ─────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────

/** Rounded-rectangle path, stroke or fill yourself afterward. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/** Apply a soft drop-shadow to the next draw op. Cheap. */
export function withShadow(
  ctx: CanvasRenderingContext2D,
  color: string, blur: number, offsetY: number, fn: () => void,
) {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  ctx.shadowOffsetY = offsetY
  fn()
  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────
// Walls — solid base with light top-edge highlight + soft shadow
// ─────────────────────────────────────────────────────────────────────

/**
 * Draw a wall as a stroked thick line with a subtle outer shadow and
 * a thin gold accent on top so it reads as "edge of room", not a
 * generic line. Caller passes screen-space endpoints.
 */
export function drawWall(
  ctx: CanvasRenderingContext2D,
  ax: number, ay: number, bx: number, by: number,
  thicknessPx: number,
  selected: boolean,
  theme: Theme,
  subtype: 'wall' | 'door' | 'window' = 'wall',
  /** Opening width as fraction of wall length (0..1) — defaults derived from subtype */
  openingFrac = 0,
) {
  const t = Math.max(2, thicknessPx)
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len

  // For openings, draw the wall in two segments and the opening glyph in the middle
  if (subtype === 'door' || subtype === 'window') {
    const op = Math.max(0.10, Math.min(0.7, openingFrac || (subtype === 'door' ? 0.30 : 0.35)))
    const segLen = (1 - op) / 2 * len
    const x1a = ax,                  y1a = ay
    const x1b = ax + ux * segLen,    y1b = ay + uy * segLen
    const x2a = bx - ux * segLen,    y2a = by - uy * segLen
    const x2b = bx,                  y2b = by
    // Two side segments (regular wall draw)
    for (const [sa, sb] of [[[x1a, y1a], [x1b, y1b]], [[x2a, y2a], [x2b, y2b]]] as const) {
      ctx.save()
      ctx.shadowColor = theme.wallShadow
      ctx.shadowBlur = Math.min(8, t)
      ctx.shadowOffsetY = 1.5
      ctx.lineCap = 'round'
      ctx.strokeStyle = selected ? theme.accent : theme.wallFill
      ctx.lineWidth = t
      ctx.beginPath()
      ctx.moveTo(sa[0], sa[1])
      ctx.lineTo(sb[0], sb[1])
      ctx.stroke()
      ctx.restore()
    }
    // Door arc: short threshold + 90° swing arc
    if (subtype === 'door') {
      ctx.save()
      ctx.strokeStyle = selected ? theme.accent : 'rgba(200, 182, 142,0.5)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x1b, y1b)
      ctx.lineTo(x2a, y2a)
      ctx.stroke()
      // Arc — quarter circle from x1b sweeping to perpendicular
      const radius = op * len
      const ang = Math.atan2(uy, ux)
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.arc(x1b, y1b, radius, ang, ang - Math.PI / 2, true)
      ctx.stroke()
      ctx.setLineDash([])
      // Door panel line (90° open)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x1b, y1b)
      ctx.lineTo(x1b + Math.cos(ang - Math.PI / 2) * radius, y1b + Math.sin(ang - Math.PI / 2) * radius)
      ctx.stroke()
      ctx.restore()
    } else {
      // Window: parallel double line with glass tint
      ctx.save()
      const nx = -uy, ny = ux
      const off = t * 0.35
      // Background fill (glass tint)
      ctx.fillStyle = 'rgba(140, 180, 220, 0.30)'
      ctx.beginPath()
      ctx.moveTo(x1b + nx * off, y1b + ny * off)
      ctx.lineTo(x2a + nx * off, y2a + ny * off)
      ctx.lineTo(x2a - nx * off, y2a - ny * off)
      ctx.lineTo(x1b - nx * off, y1b - ny * off)
      ctx.closePath()
      ctx.fill()
      // Two parallel rails
      ctx.strokeStyle = selected ? theme.accent : theme.wallFill
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x1b + nx * off, y1b + ny * off)
      ctx.lineTo(x2a + nx * off, y2a + ny * off)
      ctx.moveTo(x1b - nx * off, y1b - ny * off)
      ctx.lineTo(x2a - nx * off, y2a - ny * off)
      ctx.stroke()
      // Center mullion
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x1b, y1b)
      ctx.lineTo(x2a, y2a)
      ctx.stroke()
      ctx.restore()
    }
    if (selected) {
      ctx.strokeStyle = 'rgba(200, 182, 142,0.22)'
      ctx.lineWidth = t + 8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
      ctx.stroke()
    }
    return
  }

  // Solid wall — original code path
  ctx.save()
  ctx.shadowColor = theme.wallShadow
  ctx.shadowBlur = Math.min(8, t)
  ctx.shadowOffsetY = 1.5
  ctx.lineCap = 'round'
  ctx.strokeStyle = selected ? theme.accent : theme.wallFill
  ctx.lineWidth = t
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.restore()

  if (t >= 6) {
    ctx.lineCap = 'round'
    ctx.strokeStyle = selected ? theme.accent : 'rgba(200, 182, 142,0.35)'
    ctx.lineWidth = Math.max(1, t * 0.18)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
  if (selected) {
    ctx.strokeStyle = 'rgba(200, 182, 142,0.22)'
    ctx.lineWidth = t + 8
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.stroke()
  }
}

// ─────────────────────────────────────────────────────────────────────
// Rooms — fill polygons under walls + label plates
// ─────────────────────────────────────────────────────────────────────

/** Fill a room polygon (in screen-space points) with a tinted background. */
export function drawRoomFill(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  theme: Theme,
  zoneType: 'indoor' | 'outdoor' = 'indoor',
) {
  if (pts.length < 3) return
  ctx.save()

  if (zoneType === 'outdoor') {
    // Terrace: warm wood-deck tint + decking plank lines + dashed green border
    const minX = Math.min(...pts.map((p) => p.x))
    const maxX = Math.max(...pts.map((p) => p.x))
    const minY = Math.min(...pts.map((p) => p.y))
    const maxY = Math.max(...pts.map((p) => p.y))

    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    // Greenish-warm outdoor tint
    ctx.fillStyle = 'rgba(150, 175, 130, 0.16)'
    ctx.fill()

    // Clip to polygon and draw decking planks
    ctx.save()
    ctx.clip()
    ctx.strokeStyle = 'rgba(120, 145, 100, 0.30)'
    ctx.lineWidth = 1
    const plankGap = 18
    for (let y = minY; y <= maxY; y += plankGap) {
      ctx.beginPath()
      ctx.moveTo(minX, y)
      ctx.lineTo(maxX, y)
      ctx.stroke()
    }
    ctx.restore()

    // Dashed green border to signal "outdoor / free zone"
    ctx.strokeStyle = 'rgba(110, 160, 95, 0.65)'
    ctx.lineWidth = 1.5
    ctx.setLineDash([7, 4])
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
    return
  }

  ctx.fillStyle = theme.roomFill
  ctx.strokeStyle = theme.roomStroke
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/* ───────── material floor rendering ───────── */

/** #rrggbb + alpha → rgba() */
function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Darken a hex colour toward black (amount 0..1). */
function shadeHex(hex: string, amount: number): string {
  const h = hex.replace('#', '')
  const r = Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount))
  const g = Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount))
  const b = Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount))
  return `rgb(${r},${g},${b})`
}

/**
 * Render an indoor room's floor from its resolved catalog material, plus an
 * optional ambient-light glow derived from the room's luminaires. Kept subtle
 * so the blueprint stays legible while the space gains material identity — the
 * "this feels like my home" layer. (Outdoor zones keep `drawRoomFill`.)
 */
export function drawRoomFloor(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
  material: Material,
  lighting?: RoomLighting,
) {
  if (pts.length < 3) return
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = maxX - minX
  const h = maxY - minY

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()

  // Subtle base tint in the material colour.
  ctx.fillStyle = hexA(material.color, 0.16)
  ctx.fill()

  ctx.save()
  ctx.clip()
  ctx.lineWidth = 1
  ctx.strokeStyle = hexA(shadeHex(material.color, 0.35), 0.22)

  if (material.pattern === 'planks') {
    const plank = 24
    for (let y = minY; y <= maxY; y += plank) {
      ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke()
    }
    let row = 0
    for (let y = minY; y < maxY; y += plank) {
      const off = (row % 2) * 80
      for (let x = minX + off; x <= maxX; x += 160) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + plank); ctx.stroke()
      }
      row++
    }
  } else if (material.pattern === 'tiles') {
    const tile = 30
    for (let x = minX; x <= maxX; x += tile) { ctx.beginPath(); ctx.moveTo(x, minY); ctx.lineTo(x, maxY); ctx.stroke() }
    for (let y = minY; y <= maxY; y += tile) { ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke() }
  } else if (material.pattern === 'weave') {
    ctx.strokeStyle = hexA(shadeHex(material.color, 0.25), 0.10)
    const gap = 6
    for (let x = minX; x <= maxX; x += gap) { ctx.beginPath(); ctx.moveTo(x, minY); ctx.lineTo(x, maxY); ctx.stroke() }
  } else if (material.pattern === 'speckle') {
    ctx.fillStyle = hexA(shadeHex(material.color, 0.30), 0.16)
    for (let x = minX; x <= maxX; x += 14) {
      for (let y = minY; y <= maxY; y += 14) {
        const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0
        if (hsh % 5 === 0) {
          ctx.beginPath()
          ctx.arc(x + (hsh % 7), y + (hsh % 5), 1.1, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }
  // 'smooth' → no structure lines

  // Ambient glow from the room's lights (warm/cool per colour temperature).
  if (lighting?.on && lighting.intensity > 0) {
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const rad = Math.max(w, h) * 0.75 || 1
    const a = 0.05 + Math.min(0.22, lighting.intensity * 0.20)
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    grad.addColorStop(0, hexA(lighting.color, a))
    grad.addColorStop(1, hexA(lighting.color, 0))
    ctx.fillStyle = grad
    ctx.fillRect(minX, minY, w, h)
  }

  ctx.restore() // unclip
  ctx.restore()
}

/** Polygon centroid (for label auto-placement). */
export function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0, cy = 0
  for (const p of pts) { cx += p.x; cy += p.y }
  return { x: cx / pts.length, y: cy / pts.length }
}

/** Pretty room label with a subtle backdrop plate + ornate accent dots. */
export function drawRoomLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, text: string, size: number,
  theme: Theme,
) {
  ctx.save()
  ctx.font = `500 ${size}px "Playfair Display", "Cormorant Garamond", Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const metrics = ctx.measureText(text)
  const padX = Math.max(10, size * 0.6)
  const padY = Math.max(4, size * 0.25)
  const w = metrics.width + padX * 2
  const h = size + padY * 2

  // Plate
  ctx.shadowColor = theme.shadow
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 1
  ctx.fillStyle = theme.surface
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.shadowBlur = 0

  // Edge
  ctx.strokeStyle = 'rgba(200, 182, 142,0.30)'
  ctx.lineWidth = 1
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.stroke()

  // Ornate accent diamonds left/right
  const diamondSize = Math.max(2, size * 0.18)
  ctx.fillStyle = theme.selectSoft
  for (const sign of [-1, 1]) {
    ctx.save()
    ctx.translate(x + sign * (w / 2 - padX * 0.4), y)
    ctx.rotate(Math.PI / 4)
    ctx.fillRect(-diamondSize / 2, -diamondSize / 2, diamondSize, diamondSize)
    ctx.restore()
  }

  // Text
  ctx.fillStyle = theme.fg
  ctx.fillText(text, x, y)
  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────
// Furniture — top-down recognizable shapes per furnitureId
// ─────────────────────────────────────────────────────────────────────

export interface FurnitureDrawArgs {
  ctx: CanvasRenderingContext2D
  /** Local-frame width (px, screen-space). Centered at origin. */
  w: number
  h: number
  selected: boolean
  hovered: boolean
  theme: Theme
  zoom: number
}

/** Default body fill — used by every furniture shape. */
function furnitureBase(args: FurnitureDrawArgs, radius = 4) {
  const { ctx, w, h, selected, hovered, theme } = args
  // Drop shadow
  ctx.save()
  ctx.shadowColor = theme.shadow
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 2
  ctx.fillStyle = theme.furnFill
  roundRect(ctx, -w / 2, -h / 2, w, h, radius)
  ctx.fill()
  ctx.restore()

  // Stroke
  ctx.strokeStyle = selected ? theme.accent
    : hovered ? 'rgba(199, 162, 78,0.6)'
    : theme.furnStroke
  ctx.lineWidth = selected ? 2 : 1
  roundRect(ctx, -w / 2, -h / 2, w, h, radius)
  ctx.stroke()
}

/** Sofa: base + 2-3 cushion bumps along the long side + back rail. */
function drawSofa(args: FurnitureDrawArgs) {
  furnitureBase(args, 8)
  const { ctx, w, h, theme } = args
  // back rail (at top of sofa, the long edge)
  const longSide = w >= h
  ctx.fillStyle = theme.furnDetail
  if (longSide) {
    // Backrest occupies top ~25%
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, Math.max(3, h * 0.22))
    // Cushions: 3 across
    const innerW = (w - 8) / 3
    const yy = -h / 2 + h * 0.32
    for (let i = 0; i < 3; i++) {
      const xx = -w / 2 + 4 + i * innerW
      ctx.strokeStyle = theme.furnDetail
      ctx.lineWidth = 1
      roundRect(ctx, xx + 1, yy, innerW - 2, h * 0.55, 4)
      ctx.stroke()
    }
  } else {
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, Math.max(3, w * 0.22), h - 4)
    const innerH = (h - 8) / 3
    const xx = -w / 2 + w * 0.32
    for (let i = 0; i < 3; i++) {
      const yy = -h / 2 + 4 + i * innerH
      ctx.strokeStyle = theme.furnDetail
      roundRect(ctx, xx, yy + 1, w * 0.55, innerH - 2, 4)
      ctx.stroke()
    }
  }
}

/** Bed: pillow strip on top edge + duvet line. */
function drawBed(args: FurnitureDrawArgs) {
  furnitureBase(args, 4)
  const { ctx, w, h, theme } = args
  // Pillow (top short edge)
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  const pillowH = Math.max(6, h * 0.18)
  roundRect(ctx, -w / 2 + 6, -h / 2 + 4, w - 12, pillowH, 3)
  ctx.fill(); ctx.stroke()
  // Two pillow halves divider
  if (w > 80) {
    ctx.beginPath()
    ctx.moveTo(0, -h / 2 + 4)
    ctx.lineTo(0, -h / 2 + 4 + pillowH)
    ctx.stroke()
  }
  // Duvet edge
  ctx.strokeStyle = theme.furnDetail
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 6, -h / 2 + 4 + pillowH + 4)
  ctx.lineTo(w / 2 - 6, -h / 2 + 4 + pillowH + 4)
  ctx.stroke()
}

/** Table: surface + 4 corner circles for legs hint. */
function drawTable(args: FurnitureDrawArgs) {
  furnitureBase(args, 4)
  const { ctx, w, h, theme } = args
  const r = Math.min(3, Math.min(w, h) * 0.06)
  ctx.fillStyle = theme.furnDetail
  for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]] as const) {
    ctx.beginPath()
    ctx.arc(sx * (w / 2 - r * 2), sy * (h / 2 - r * 2), r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Coffee table: rounded with subtle top-surface line. */
function drawCoffeeTable(args: FurnitureDrawArgs) {
  furnitureBase(args, 12)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  roundRect(ctx, -w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 8)
  ctx.stroke()
}

/** Wardrobe: full body + door divisions. */
function drawWardrobe(args: FurnitureDrawArgs) {
  furnitureBase(args, 2)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  // Estimate doors based on wider dimension
  const longSide = w >= h
  const doors = Math.max(2, Math.floor((longSide ? w : h) / 50))
  if (longSide) {
    const dw = w / doors
    for (let i = 1; i < doors; i++) {
      ctx.beginPath()
      ctx.moveTo(-w / 2 + i * dw, -h / 2 + 2)
      ctx.lineTo(-w / 2 + i * dw,  h / 2 - 2)
      ctx.stroke()
    }
    // Door handles — small dots
    ctx.fillStyle = theme.accent
    for (let i = 0; i < doors; i++) {
      ctx.beginPath()
      ctx.arc(-w / 2 + (i + 0.5) * dw + (i % 2 ? 4 : -4), 0, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    const dh = h / doors
    for (let i = 1; i < doors; i++) {
      ctx.beginPath()
      ctx.moveTo(-w / 2 + 2, -h / 2 + i * dh)
      ctx.lineTo(w / 2 - 2,  -h / 2 + i * dh)
      ctx.stroke()
    }
  }
}

/** Kitchen row: cabinet divisions + sink/cooktop hint. */
function drawKitchenRow(args: FurnitureDrawArgs) {
  furnitureBase(args, 2)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  const longSide = w >= h
  const slots = Math.max(3, Math.floor((longSide ? w : h) / 50))
  if (longSide) {
    const sw = w / slots
    for (let i = 1; i < slots; i++) {
      ctx.beginPath()
      ctx.moveTo(-w / 2 + i * sw, -h / 2 + 2)
      ctx.lineTo(-w / 2 + i * sw,  h / 2 - 2)
      ctx.stroke()
    }
    // Cooktop ring (one slot from left at 1/3) + sink (square at 2/3)
    const ringR = Math.min(h * 0.25, sw * 0.28)
    ctx.strokeStyle = theme.furnDetail
    ctx.beginPath()
    ctx.arc(-w / 2 + sw * Math.floor(slots / 3) + sw / 2, 0, ringR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(-w / 2 + sw * Math.floor(slots / 3) + sw / 2, 0, ringR * 0.55, 0, Math.PI * 2)
    ctx.stroke()
    const sinkX = -w / 2 + sw * Math.floor((2 * slots) / 3) + sw / 2 - sw * 0.32
    ctx.strokeRect(sinkX, -h * 0.3, sw * 0.65, h * 0.6)
  }
}

/** TV-Sideboard: 2-3 cabinet doors. */
function drawSideboard(args: FurnitureDrawArgs) {
  furnitureBase(args, 4)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  const sections = 3
  const sw = w / sections
  for (let i = 1; i < sections; i++) {
    ctx.beginPath()
    ctx.moveTo(-w / 2 + i * sw, -h / 2 + 2)
    ctx.lineTo(-w / 2 + i * sw,  h / 2 - 2)
    ctx.stroke()
  }
}

/** Rug: simple rounded outline, more transparent than other furniture. */
function drawRug(args: FurnitureDrawArgs) {
  const { ctx, w, h, selected, theme } = args
  ctx.save()
  ctx.fillStyle = 'rgba(199, 162, 78,0.08)'
  ctx.strokeStyle = selected ? theme.accent : 'rgba(200, 182, 142,0.40)'
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.5
  roundRect(ctx, -w / 2, -h / 2, w, h, 12)
  ctx.fill()
  ctx.stroke()
  ctx.setLineDash([])
  // Inner border accent
  ctx.strokeStyle = 'rgba(200, 182, 142,0.20)'
  roundRect(ctx, -w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 8)
  ctx.stroke()
  ctx.restore()
}

/** Nightstand: small box with single drawer line. */
function drawNightstand(args: FurnitureDrawArgs) {
  furnitureBase(args, 3)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(-w / 2 + 4, 0)
  ctx.lineTo(w / 2 - 4, 0)
  ctx.stroke()
  // Handle
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.arc(0, -h * 0.12, 1.2, 0, Math.PI * 2)
  ctx.fill()
}

/** Dresser: wide, multiple drawers. */
function drawDresser(args: FurnitureDrawArgs) {
  furnitureBase(args, 3)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  // 2 horizontal divisions = 3 drawer rows
  for (const yFrac of [-0.16, 0.16] as const) {
    ctx.beginPath()
    ctx.moveTo(-w / 2 + 4, h * yFrac)
    ctx.lineTo(w / 2 - 4, h * yFrac)
    ctx.stroke()
  }
}

/** Shoe rack: thin horizontal slots. */
function drawShoeRack(args: FurnitureDrawArgs) {
  furnitureBase(args, 2)
  const { ctx, w, h, theme } = args
  ctx.strokeStyle = theme.furnDetail
  ctx.lineWidth = 1
  for (const yFrac of [-0.25, 0, 0.25] as const) {
    ctx.beginPath()
    ctx.moveTo(-w / 2 + 3, h * yFrac)
    ctx.lineTo(w / 2 - 3, h * yFrac)
    ctx.stroke()
  }
}

/** Generic chair: rounded square + small back-bar indicator. */
function drawChair(args: FurnitureDrawArgs) {
  furnitureBase(args, 6)
  const { ctx, w, h, theme } = args
  ctx.fillStyle = theme.furnDetail
  // Backrest at top
  ctx.fillRect(-w / 2 + 4, -h / 2 + 2, w - 8, Math.max(2, h * 0.15))
}

/** Default fallback — same as table but without legs. */
function drawDefault(args: FurnitureDrawArgs) {
  furnitureBase(args, 4)
}

/** Furniture-id → renderer map. Order matters for prefix matching. */
const FURNITURE_RENDERERS: Array<[RegExp, (a: FurnitureDrawArgs) => void]> = [
  [/^sofa/i,           drawSofa],
  [/^bed/i,            drawBed],
  [/^table-coffee/i,   drawCoffeeTable],
  [/^table/i,          drawTable],
  [/^wardrobe/i,       drawWardrobe],
  [/^kitchen/i,        drawKitchenRow],
  [/^tv-sideboard|^sideboard/i, drawSideboard],
  [/^rug/i,            drawRug],
  [/^nightstand/i,     drawNightstand],
  [/^dresser|^kommode/i, drawDresser],
  [/^shoe/i,           drawShoeRack],
  [/^chair|^stuhl/i,   drawChair],
]

export function drawFurnitureGlyph(
  ctx: CanvasRenderingContext2D,
  furnitureId: string,
  w: number, h: number,
  selected: boolean, hovered: boolean,
  theme: Theme, zoom: number,
) {
  const args: FurnitureDrawArgs = { ctx, w, h, selected, hovered, theme, zoom }
  for (const [re, fn] of FURNITURE_RENDERERS) {
    if (re.test(furnitureId)) {
      fn(args)
      return
    }
  }
  drawDefault(args)
}

// ─────────────────────────────────────────────────────────────────────
// Devices — category-aware glyphs in a circular tile
// ─────────────────────────────────────────────────────────────────────

/** Per-category color for the device pin ring. */
export const DEVICE_COLORS: Record<string, string> = {
  light:      '#FFC44D',
  switch:     '#7E93B5',
  outlet:     '#7E93B5',
  blind:      '#5BB8FF',
  climate:    '#5BD6C0',
  lock:       '#E6CC86',
  speaker:    '#A78BFF',
  camera:     '#FF6B6B',
  alarm:      '#FF6B6B',
  tv:         '#A78BFF',
  appliance:  '#9AA7B8',
  irrigation: '#2EE59D',
  sensor:     '#E8C879',
  hub:        '#C7A24E',
  other:      '#8B8478',
}

/** Per-device glyph dispatcher (v26). Checks for an exact `deviceId`
 *  match first — so a SwitchBot lock looks different from a Nuki lock —
 *  then falls back to the category glyph. Operates in local frame,
 *  centered at (0,0), with radius `r`. */
function drawDeviceGlyph(
  ctx: CanvasRenderingContext2D,
  deviceId: string | undefined,
  category: string,
  r: number,
  on: boolean | null,
) {
  ctx.lineWidth = Math.max(1.2, r * 0.13)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (deviceId) {
    const id = deviceId.toLowerCase()

    // ── Philips Hue bulbs ──────────────────────────────────────────
    if (id.startsWith('hue-e27') || id.startsWith('hue-bulb') || id.startsWith('hue-go')) {
      ctx.beginPath()
      ctx.arc(0, -r * 0.08, r * 0.38, 0, Math.PI * 2)
      if (on) ctx.fill(); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r * 0.15, r * 0.31); ctx.lineTo(r * 0.15, r * 0.31)
      ctx.moveTo(-r * 0.10, r * 0.44); ctx.lineTo(r * 0.10, r * 0.44)
      ctx.stroke()
      return
    }
    // ── Light strips (Hue / Govee / SwitchBot) ─────────────────────
    if (id.includes('lightstrip') || id.includes('strip') || id.includes('led-strip') || id.includes('gradient')) {
      ctx.beginPath()
      ctx.moveTo(-r * 0.55, 0)
      for (let i = 0; i < 5; i++) {
        ctx.lineTo(-r * 0.55 + (i + 0.5) * r * 0.22, i % 2 === 0 ? -r * 0.28 : r * 0.28)
        ctx.lineTo(-r * 0.55 + (i + 1) * r * 0.22, 0)
      }
      ctx.stroke()
      return
    }
    // ── Sonos speakers ─────────────────────────────────────────────
    if (id.startsWith('sonos')) {
      const w = r * 0.62, h = r * 0.95
      ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.stroke()
      for (const rr of [r * 0.14, r * 0.27] as const) {
        ctx.beginPath(); ctx.arc(0, 0, rr, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke()
      }
      return
    }
    // ── Echo / Alexa speakers ──────────────────────────────────────
    if (id.startsWith('echo') || id.includes('alexa')) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2)
      if (on) ctx.fill(); else ctx.stroke()
      return
    }
    // ── HomePod ────────────────────────────────────────────────────
    if (id.includes('homepod')) {
      ctx.beginPath()
      ctx.moveTo(-r * 0.32, -r * 0.42)
      ctx.quadraticCurveTo(-r * 0.42, 0, -r * 0.32, r * 0.42)
      ctx.lineTo(r * 0.32, r * 0.42)
      ctx.quadraticCurveTo(r * 0.42, 0, r * 0.32, -r * 0.42)
      ctx.closePath(); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.14, 0, Math.PI * 2)
      if (on) ctx.fill(); else ctx.stroke()
      return
    }
    // ── Nuki smart lock ────────────────────────────────────────────
    if (id.startsWith('nuki')) {
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6
        i === 0 ? ctx.moveTo(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48)
                : ctx.lineTo(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48)
      }
      ctx.closePath(); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, r * 0.13, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.moveTo(0, r * 0.13); ctx.lineTo(0, r * 0.34); ctx.stroke()
      return
    }
    // ── Lockin G30 — fingerprint pattern ───────────────────────────
    if (id.startsWith('lockin')) {
      for (const fr of [r * 0.15, r * 0.28, r * 0.42] as const) {
        ctx.beginPath(); ctx.arc(0, r * 0.1, fr, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke()
      }
      ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.06, 0, Math.PI * 2); ctx.fill()
      return
    }
    // ── SwitchBot Lock — square + turn arrow ───────────────────────
    if (id.includes('lock') && id.includes('switchbot')) {
      ctx.beginPath(); ctx.rect(-r * 0.40, -r * 0.45, r * 0.80, r * 0.90); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.22, -Math.PI * 0.7, Math.PI * 0.2); ctx.stroke()
      const ax = Math.cos(Math.PI * 0.2) * r * 0.22, ay = Math.sin(Math.PI * 0.2) * r * 0.22
      ctx.beginPath(); ctx.moveTo(ax, ay)
      ctx.lineTo(ax + r * 0.12, ay - r * 0.08); ctx.lineTo(ax + r * 0.05, ay + r * 0.13); ctx.fill()
      return
    }
    // ── Hubs / bridges (SwitchBot, Hue, generic) ───────────────────
    if (id.includes('hub') || id.includes('bridge') || id.includes('dirigera') || id.includes('gateway')) {
      ctx.beginPath(); ctx.rect(-r * 0.45, -r * 0.35, r * 0.90, r * 0.70); ctx.stroke()
      for (const rr of [r * 0.16, r * 0.29, r * 0.42] as const) {
        ctx.beginPath(); ctx.arc(0, r * 0.25, rr, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke()
      }
      return
    }
    // ── SwitchBot Bot — robot pressing button ──────────────────────
    if (id === 'switchbot-bot') {
      ctx.beginPath(); ctx.rect(-r * 0.35, -r * 0.45, r * 0.70, r * 0.55); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, r * 0.1); ctx.lineTo(0, r * 0.4)
      ctx.moveTo(-r * 0.15, r * 0.4); ctx.lineTo(r * 0.15, r * 0.4)
      ctx.stroke()
      return
    }
    // ── Curtain / blind motors ─────────────────────────────────────
    if (id.includes('curtain') || id.includes('roller') || id.includes('blind')) {
      ctx.beginPath()
      ctx.moveTo(-r * 0.55, -r * 0.45); ctx.lineTo(r * 0.55, -r * 0.45); ctx.stroke()
      ctx.beginPath()
      ctx.quadraticCurveTo(-r * 0.45, r * 0.0, -r * 0.30, r * 0.45)
      ctx.moveTo(-r * 0.10, -r * 0.45)
      ctx.quadraticCurveTo(-r * 0.0, r * 0.0, r * 0.10, r * 0.45)
      ctx.moveTo(r * 0.30, -r * 0.45)
      ctx.quadraticCurveTo(r * 0.40, r * 0.0, r * 0.50, r * 0.45)
      ctx.stroke()
      return
    }
    // ── Govee Glide Hexa — hexagon panel ───────────────────────────
    if (id.includes('hexa') || id.includes('hexagon')) {
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        i === 0 ? ctx.moveTo(Math.cos(a) * r * 0.50, Math.sin(a) * r * 0.50)
                : ctx.lineTo(Math.cos(a) * r * 0.50, Math.sin(a) * r * 0.50)
      }
      ctx.closePath()
      if (on) ctx.fill(); ctx.stroke()
      return
    }
    // ── Floor / table lamps ────────────────────────────────────────
    if (id.includes('floor-lamp') || id.includes('table-lamp') || id.includes('lamp')) {
      ctx.beginPath(); ctx.moveTo(0, r * 0.55); ctx.lineTo(0, -r * 0.25); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r * 0.42, -r * 0.25)
      ctx.quadraticCurveTo(-r * 0.28, -r * 0.55, 0, -r * 0.55)
      ctx.quadraticCurveTo(r * 0.28, -r * 0.55, r * 0.42, -r * 0.25)
      ctx.closePath()
      if (on) ctx.fill(); ctx.stroke()
      return
    }
    // ── Outdoor / string lights ────────────────────────────────────
    if (id.includes('outdoor') || id.includes('string') || id.includes('permanent')) {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.arc(i * r * 0.22, i % 2 === 0 ? -r * 0.1 : r * 0.1, r * 0.10, 0, Math.PI * 2)
        if (on) ctx.fill(); else ctx.stroke()
      }
      ctx.beginPath()
      ctx.moveTo(-r * 0.44, -r * 0.1)
      for (let i = -2; i <= 2; i++) ctx.lineTo(i * r * 0.22, i % 2 === 0 ? -r * 0.1 : r * 0.1)
      ctx.stroke()
      return
    }
    // ── Osaio / Arenti / Ring / Blink cameras — bullet cam ─────────
    if (id.startsWith('osaio') || id.startsWith('arenti') || id.startsWith('ring') || id.startsWith('blink') || id.includes('doorbell')) {
      ctx.beginPath()
      ctx.moveTo(-r * 0.50, -r * 0.22); ctx.lineTo(r * 0.25, -r * 0.22)
      ctx.arc(r * 0.25, 0, r * 0.22, -Math.PI / 2, Math.PI / 2)
      ctx.lineTo(-r * 0.50, r * 0.22); ctx.closePath(); ctx.stroke()
      ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.10, 0, Math.PI * 2); ctx.fill()
      return
    }
    // ── Aqara FP2 / mmWave presence — radar fan ────────────────────
    if (id.includes('fp2') || id.includes('mmwave') || id.includes('presence')) {
      for (const a of [Math.PI * 1.1, Math.PI * 1.3, Math.PI * 1.5, Math.PI * 1.7, Math.PI * 1.9] as const) {
        ctx.beginPath()
        ctx.moveTo(0, r * 0.3)
        ctx.lineTo(Math.cos(a) * r * 0.55, r * 0.3 + Math.sin(a) * r * 0.55)
        ctx.stroke()
      }
      ctx.beginPath(); ctx.arc(0, r * 0.3, r * 0.08, 0, Math.PI * 2); ctx.fill()
      return
    }
    // ── Plugs / energy (Eve, Shelly, smart plugs) — bolt in circle ─
    if (id.includes('plug') || id.includes('energy') || id.startsWith('shelly')) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(r * 0.10, -r * 0.38); ctx.lineTo(-r * 0.08, r * 0.04)
      ctx.lineTo(r * 0.08, r * 0.04); ctx.lineTo(-r * 0.10, r * 0.38)
      ctx.stroke()
      return
    }
    // ── Thermostats / radiator valves (Eve Thermo, tado, Nest) ─────
    if (id.includes('thermo') || id.startsWith('tado') || id.includes('nest') || id.includes('radiator')) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.44, 0, Math.PI * 2); ctx.stroke()
      const pct = on === true ? 0.75 : 0.35
      ctx.beginPath(); ctx.arc(0, 0, r * 0.30, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2); ctx.fill()
      return
    }
    // ── Smoke / CO detectors (Bosch TwinGuard) ─────────────────────
    if (id.includes('twinguard') || id.includes('smoke') || id.includes('twinkle')) {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.50, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, -r * 0.10, r * 0.26, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, r * 0.18); ctx.lineTo(0, r * 0.34); ctx.stroke()
      ctx.beginPath(); ctx.arc(0, r * 0.40, r * 0.035, 0, Math.PI * 2); ctx.fill()
      return
    }
    // ── Wall switches (Smart Life / Tuya / generic switch) ─────────
    if (id.includes('switch') && !id.includes('smartthings')) {
      ctx.beginPath(); ctx.rect(-r * 0.45, -r * 0.50, r * 0.90, r * 1.00); ctx.stroke()
      const count = id.includes('2g') || id.includes('double') ? 2 : 1
      for (let i = 0; i < count; i++) {
        const bx = count === 1 ? 0 : (i === 0 ? -r * 0.18 : r * 0.18)
        ctx.beginPath(); ctx.rect(bx - r * 0.14, -r * 0.24, r * 0.28, r * 0.48); ctx.stroke()
      }
      return
    }
    // ── Motion / contact sensors ───────────────────────────────────
    if (id.includes('motion') || id.includes('contact') || id.includes('door-window') || id.includes('pir')) {
      // Walking-figure dot + waves
      ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.2, r * 0.12, 0, Math.PI * 2)
      if (on) ctx.fill(); else ctx.stroke()
      for (const rr of [r * 0.25, r * 0.42] as const) {
        ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.2, rr, -Math.PI * 0.1, Math.PI * 0.5); ctx.stroke()
      }
      return
    }
    // ── Meter / temp+humidity (SwitchBot Meter) ────────────────────
    if (id.includes('meter') || id.includes('thermometer') || id.includes('hygro')) {
      ctx.beginPath(); ctx.rect(-r * 0.40, -r * 0.42, r * 0.80, r * 0.84); ctx.stroke()
      ctx.beginPath(); ctx.rect(-r * 0.26, -r * 0.24, r * 0.52, r * 0.30); ctx.stroke()
      return
    }
  }

  drawCategoryGlyph(ctx, category, r, on)
}

/** Glyph drawing per category — operates in local frame, centered at (0,0),
 *  with radius = `r`. Stroke color is supplied by caller. */
function drawCategoryGlyph(
  ctx: CanvasRenderingContext2D,
  category: string,
  r: number,
  on: boolean | null,
) {
  ctx.lineWidth = Math.max(1.2, r * 0.13)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (category) {
    case 'light': {
      // Lightbulb: rounded top + thin base lines
      ctx.beginPath()
      ctx.arc(0, -r * 0.1, r * 0.45, Math.PI * 1.05, Math.PI * 1.95)
      ctx.lineTo(r * 0.18, r * 0.35)
      ctx.lineTo(-r * 0.18, r * 0.35)
      ctx.closePath()
      if (on) ctx.fill()
      ctx.stroke()
      // Base ridges
      ctx.beginPath()
      ctx.moveTo(-r * 0.18, r * 0.45)
      ctx.lineTo(r * 0.18, r * 0.45)
      ctx.moveTo(-r * 0.13, r * 0.55)
      ctx.lineTo(r * 0.13, r * 0.55)
      ctx.stroke()
      return
    }
    case 'switch': {
      // Toggle switch frame
      const w = r * 0.9, h = r * 0.55
      ctx.beginPath()
      ctx.rect(-w / 2, -h / 2, w, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(on ? w / 2 - h / 2 : -w / 2 + h / 2, 0, h * 0.4, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'outlet': {
      // Two pin holes
      ctx.beginPath()
      ctx.arc(-r * 0.25, 0, r * 0.10, 0, Math.PI * 2)
      ctx.arc( r * 0.25, 0, r * 0.10, 0, Math.PI * 2)
      ctx.fill()
      // Outline
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2)
      ctx.stroke()
      return
    }
    case 'blind': {
      // Horizontal slats
      for (const yy of [-r * 0.4, -r * 0.15, r * 0.1, r * 0.35] as const) {
        ctx.beginPath()
        ctx.moveTo(-r * 0.55, yy)
        ctx.lineTo(r * 0.55, yy)
        ctx.stroke()
      }
      return
    }
    case 'climate': {
      // Thermometer: bulb + stem
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.5)
      ctx.lineTo(0, r * 0.2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, r * 0.32, r * 0.22, 0, Math.PI * 2)
      ctx.fill()
      // Tick lines
      for (const yy of [-r * 0.3, -r * 0.1, r * 0.05] as const) {
        ctx.beginPath()
        ctx.moveTo(r * 0.06, yy); ctx.lineTo(r * 0.18, yy)
        ctx.stroke()
      }
      return
    }
    case 'lock': {
      // Padlock: shackle + body
      ctx.beginPath()
      ctx.arc(0, -r * 0.15, r * 0.30, Math.PI, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.rect(-r * 0.40, -r * 0.05, r * 0.80, r * 0.55)
      if (on) ctx.fill()
      ctx.stroke()
      // Keyhole
      ctx.beginPath()
      ctx.arc(0, r * 0.18, r * 0.06, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'speaker': {
      // Speaker box + cone
      ctx.beginPath()
      ctx.rect(-r * 0.45, -r * 0.55, r * 0.90, r * 1.10)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.25, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'camera': {
      // Camera body + lens
      ctx.beginPath()
      ctx.rect(-r * 0.50, -r * 0.30, r * 1.00, r * 0.60)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(r * 0.18, 0, r * 0.18, 0, Math.PI * 2)
      ctx.fill()
      // Top notch
      ctx.beginPath()
      ctx.rect(-r * 0.40, -r * 0.42, r * 0.30, r * 0.12)
      ctx.fill()
      return
    }
    case 'alarm': {
      // Bell
      ctx.beginPath()
      ctx.moveTo(-r * 0.40, r * 0.20)
      ctx.lineTo(r * 0.40, r * 0.20)
      ctx.lineTo(r * 0.30, r * 0.05)
      ctx.quadraticCurveTo(r * 0.30, -r * 0.45, 0, -r * 0.45)
      ctx.quadraticCurveTo(-r * 0.30, -r * 0.45, -r * 0.30, r * 0.05)
      ctx.closePath()
      ctx.stroke()
      // Clapper
      ctx.beginPath()
      ctx.arc(0, r * 0.34, r * 0.08, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'tv': {
      // Screen
      ctx.beginPath()
      ctx.rect(-r * 0.55, -r * 0.35, r * 1.10, r * 0.70)
      ctx.stroke()
      // Stand
      ctx.beginPath()
      ctx.moveTo(-r * 0.18, r * 0.45); ctx.lineTo(r * 0.18, r * 0.45)
      ctx.stroke()
      return
    }
    case 'appliance': {
      // Generic box with knob
      ctx.beginPath()
      ctx.rect(-r * 0.50, -r * 0.50, r * 1.00, r * 1.00)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(r * 0.20, -r * 0.20, r * 0.08, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.rect(-r * 0.35, r * 0.05, r * 0.40, r * 0.35)
      ctx.stroke()
      return
    }
    case 'irrigation': {
      // Water drop
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.5)
      ctx.bezierCurveTo(r * 0.45, -r * 0.05, r * 0.30, r * 0.45, 0, r * 0.45)
      ctx.bezierCurveTo(-r * 0.30, r * 0.45, -r * 0.45, -r * 0.05, 0, -r * 0.5)
      ctx.closePath()
      ctx.stroke()
      return
    }
    case 'sensor': {
      // Wave/radar arcs
      for (const rr of [r * 0.20, r * 0.36, r * 0.52] as const) {
        ctx.beginPath()
        ctx.arc(0, r * 0.20, rr, Math.PI * 1.15, Math.PI * 1.85)
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(0, r * 0.20, r * 0.06, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    case 'hub': {
      // Three concentric squares
      for (const k of [0.55, 0.35, 0.15] as const) {
        ctx.beginPath()
        ctx.rect(-r * k, -r * k, r * k * 2, r * k * 2)
        ctx.stroke()
      }
      return
    }
    default: {
      // Generic dot in ring
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

export interface DeviceDrawArgs {
  ctx: CanvasRenderingContext2D
  cx: number
  cy: number
  /** Pin radius in screen px. 14 ≈ default. */
  r: number
  category: string
  /** v26 — device catalog ID for per-model glyphs (more recognizable than category alone) */
  deviceId?: string
  selected: boolean
  hovered: boolean
  /** Mode-state: on (true), off (false), or unknown (null). Drives glow. */
  on: boolean | null
  brightness: number | null
  locked: boolean | null
  armed: boolean | null
  /** Whether the active mode highlights this device (alpha modulation). */
  active: boolean
  theme: Theme
}

/**
 * Draw one device pin with category-specific glyph, drop shadow, optional
 * glow halo (when on), brightness arc, and lock/alarm pip.
 */
export function drawDevicePin(args: DeviceDrawArgs) {
  const { ctx, cx, cy, r, category, deviceId, selected, hovered, on, brightness, locked, armed, active, theme } = args
  const color = DEVICE_COLORS[category] ?? DEVICE_COLORS.other
  const alpha = active ? 1 : 0.32
  ctx.save()
  ctx.globalAlpha = alpha

  // Selection ring
  if (selected) {
    ctx.fillStyle = 'rgba(200, 182, 142,0.22)'
    ctx.beginPath()
    ctx.arc(cx, cy, r + 9, 0, Math.PI * 2)
    ctx.fill()
  }

  // Glow when on
  if (on === true) {
    const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r + 14)
    glow.addColorStop(0, color + 'aa')
    glow.addColorStop(0.6, color + '33')
    glow.addColorStop(1, color + '00')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, r + 14, 0, Math.PI * 2)
    ctx.fill()
  }

  // Drop shadow on the body
  ctx.save()
  ctx.shadowColor = theme.shadow
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 1.5
  // Body — solid color when on, neutral surface when off/unknown
  ctx.fillStyle = on === true ? color : theme.surface
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Hover highlight ring
  if (hovered && !selected) {
    ctx.strokeStyle = theme.selectSoft
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Outer ring
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  // Glyph — per-deviceId where available, else category fallback
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = on === true ? '#ffffff' : color
  ctx.strokeStyle = on === true ? '#ffffff' : color
  drawDeviceGlyph(ctx, deviceId, category, r * 0.95, on)
  ctx.restore()

  // Off cross overlay
  if (on === false) {
    ctx.strokeStyle = 'rgba(140, 140, 150, 0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.55, cy - r * 0.55)
    ctx.lineTo(cx + r * 0.55, cy + r * 0.55)
    ctx.moveTo(cx + r * 0.55, cy - r * 0.55)
    ctx.lineTo(cx - r * 0.55, cy + r * 0.55)
    ctx.stroke()
  }

  // Brightness arc (top, 12 o'clock anti-clockwise to value)
  if (brightness !== null && brightness > 0 && brightness < 100) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, r + 4, -Math.PI / 2, -Math.PI / 2 + (brightness / 100) * Math.PI * 2)
    ctx.stroke()
  }

  // Status pip (top-right): lock = green, alarm armed = red
  if (locked === true || armed === true) {
    const px = cx + r * 0.85
    const py = cy - r * 0.85
    ctx.fillStyle = armed ? '#d06464' : '#7cba7a'
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '7px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(armed ? '!' : '✓', px, py + 0.5)
  }

  ctx.restore()
}

// ─────────────────────────────────────────────────────────────────────
// Alignment guides — used while dragging
// ─────────────────────────────────────────────────────────────────────

/** Draw a thin dashed pink line spanning the canvas at the given screen Y or X. */
export function drawAlignmentLine(
  ctx: CanvasRenderingContext2D,
  axis: 'h' | 'v',
  pos: number,
  canvasW: number,
  canvasH: number,
) {
  ctx.save()
  ctx.strokeStyle = '#e57bb1'
  ctx.lineWidth = 1
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  if (axis === 'h') {
    ctx.moveTo(0, pos); ctx.lineTo(canvasW, pos)
  } else {
    ctx.moveTo(pos, 0); ctx.lineTo(pos, canvasH)
  }
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}
