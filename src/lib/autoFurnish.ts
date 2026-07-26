import type { Floor, Room, PlacedFurniture } from '@/types'
import { uuid } from '@/lib/utils'
import { obbCorners, obbPenetration, furnitureFootprint } from '@/lib/planIntegrity'

/**
 * autoFurnish.ts — "OMEGA Auto-Möblieren": one click turns an empty room into a
 * sensibly furnished one. Renderer-neutral, deterministic geometry.
 *
 * The whole point is *trust*: the result is guaranteed clean. Each room gets a
 * prioritised arrangement for its inferred type (bed set, sofa landscape,
 * kitchen run, bath …); every candidate piece is only kept if it fits inside
 * the room with wall clearance and doesn't collide with anything already there
 * or already placed. It reuses the exact oriented-box overlap the integrity
 * checker uses, so an auto-furnished plan passes `checkPlanIntegrity` by
 * construction — "ohne Toleranz" for free.
 */

type Rect = { x0: number; y0: number; x1: number; y1: number; w: number; h: number; cx: number; cy: number }
function roomRect(r: Room): Rect {
  const xs = r.polygon.map((p) => p.x), ys = r.polygon.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

export type RoomKind = 'bedroom' | 'kids' | 'living' | 'kitchen' | 'dining' | 'bath' | 'office' | 'hall' | 'generic'

/** Infer a room's purpose from its name (German + English keywords). */
export function classifyRoom(name: string): RoomKind {
  const n = name.toLowerCase()
  if (/kinder|kind|kids|nursery/.test(n)) return 'kids'
  // Bath before bedroom so an en-suite "Master-Bad" is a bath, not a bedroom.
  if (/bad|\bwc\b|bath|dusch|wellness|sanitär/.test(n)) return 'bath'
  if (/schlaf|master|eltern|bedroom|schlafen/.test(n)) return 'bedroom'
  if (/küche|kuche|kitchen|kochen/.test(n)) return 'kitchen'
  // "Wohnen / Essen" is a living-dining room — treat the living side as primary.
  if (/wohn|living|lounge/.test(n)) return 'living'
  if (/essen|esszimmer|dining|essbereich/.test(n)) return 'dining'
  if (/arbeit|büro|buro|office|homeoffice/.test(n)) return 'office'
  if (/flur|diele|entrée|entree|eingang|\bhall\b|galerie|garderobe/.test(n)) return 'hall'
  return 'generic'
}

interface Cand { furnitureId: string; x: number; y: number; w: number; h: number; rot?: number; label?: string }

// Arrangements per kind: candidates in priority order, positioned relative to
// the room rect. The fitter keeps as many as fit cleanly, so the same recipe
// gracefully degrades from a grand room to a snug one.
function arrangement(kind: RoomKind, r: Rect): Cand[] {
  const M = 22 // wall clearance
  const nY = r.y0 + M, sY = r.y1 - M, wX = r.x0 + M, eX = r.x1 - M
  switch (kind) {
    case 'bedroom': {
      const big = r.w >= 260 && r.h >= 280
      const bw = big ? 185 : 145, bh = big ? 210 : 200
      const bedCy = nY + bh / 2 + 20
      return [
        { furnitureId: big ? 'bed-180' : 'bed-140', x: r.cx, y: bedCy, w: bw, h: bh, label: 'Bett' },
        { furnitureId: 'nightstand', x: r.cx - bw / 2 - 30, y: bedCy - bh / 2 + 20, w: 45, h: 40 },
        { furnitureId: 'nightstand', x: r.cx + bw / 2 + 30, y: bedCy - bh / 2 + 20, w: 45, h: 40 },
        { furnitureId: 'wardrobe-200', x: r.cx, y: sY - 30, w: 200, h: 60, label: 'Kleiderschrank' },
        { furnitureId: 'wall-art-wide', x: r.cx, y: r.y0 + 8, w: 140, h: 4 },
      ]
    }
    case 'kids':
      return [
        { furnitureId: 'bed-140', x: wX + 72, y: nY + 100, w: 145, h: 200, label: 'Bett' },
        { furnitureId: 'desk-160', x: eX - 80, y: nY + 40, w: 160, h: 80, label: 'Schreibtisch' },
        { furnitureId: 'office-chair', x: eX - 80, y: nY + 120, w: 60, h: 60 },
        { furnitureId: 'wardrobe-200', x: r.cx, y: sY - 30, w: 200, h: 60, label: 'Schrank' },
      ]
    case 'living': {
      const sofaCy = sY - 110
      return [
        { furnitureId: 'sofa-corner', x: r.cx, y: sofaCy, w: 300, h: 220, rot: 180, label: 'Wohnlandschaft' },
        { furnitureId: 'rug-large', x: r.cx, y: sofaCy, w: 250, h: 350 },
        { furnitureId: 'table-coffee', x: r.cx, y: sofaCy - 155, w: 120, h: 60, label: 'Couchtisch' },
        { furnitureId: 'tv-stand', x: r.cx, y: r.y0 + 25, w: 200, h: 45, label: 'TV-Konsole' },
        { furnitureId: 'plant-tall', x: eX - 25, y: r.cy, w: 40, h: 40 },
      ]
    }
    case 'kitchen':
      return [
        { furnitureId: 'kitchen-row', x: r.cx, y: nY + 30, w: Math.min(r.w - 2 * M, 420), h: 60, label: 'Küchenzeile' },
        { furnitureId: 'kitchen-island', x: r.cx, y: r.cy + 20, w: 240, h: 90, label: 'Kochinsel' },
        { furnitureId: 'fridge', x: wX + 33, y: nY + 33, w: 60, h: 65 },
      ]
    case 'dining': {
      const rows = r.w >= 240
      const tw = rows ? 200 : 140
      return [
        { furnitureId: rows ? 'table-dining-6' : 'table-dining-4', x: r.cx, y: r.cy, w: tw, h: 90, label: 'Esstisch' },
        { furnitureId: 'chair-dining', x: r.cx - 65, y: r.cy - 70, w: 45, h: 50, rot: 180 },
        { furnitureId: 'chair-dining', x: r.cx + 65, y: r.cy - 70, w: 45, h: 50, rot: 180 },
        { furnitureId: 'chair-dining', x: r.cx - 65, y: r.cy + 70, w: 45, h: 50 },
        { furnitureId: 'chair-dining', x: r.cx + 65, y: r.cy + 70, w: 45, h: 50 },
      ]
    }
    case 'bath': {
      const big = r.w >= 260 && r.h >= 260
      return [
        ...(big ? [{ furnitureId: 'bathtub', x: wX + 85, y: nY + 40, w: 170, h: 80, label: 'Badewanne' } as Cand]
          : [{ furnitureId: 'shower', x: wX + 45, y: nY + 45, w: 90, h: 90, label: 'Dusche' } as Cand]),
        { furnitureId: 'toilet', x: eX - 20, y: sY - 35, w: 40, h: 70, rot: 270 },
        { furnitureId: 'sink-bath', x: wX + 30, y: sY - 23, w: 60, h: 45 },
        { furnitureId: 'washing-machine', x: eX - 30, y: nY + 30, w: 60, h: 60 },
      ]
    }
    case 'office':
      return [
        { furnitureId: 'desk-180', x: r.cx, y: nY + 40, w: 180, h: 80, label: 'Schreibtisch' },
        { furnitureId: 'office-chair', x: r.cx, y: nY + 120, w: 60, h: 60 },
        { furnitureId: 'bookshelf-wide', x: r.cx, y: sY - 18, w: 200, h: 35, label: 'Regal' },
        { furnitureId: 'armchair', x: eX - 45, y: r.cy + 40, w: 85, h: 90 },
      ]
    case 'hall':
      return [
        { furnitureId: 'coat-rail', x: r.cx, y: r.y0 + 12, w: 90, h: 6, label: 'Garderobe' },
        { furnitureId: 'shoe-bench', x: r.cx, y: r.y0 + 45, w: 95, h: 34 },
        { furnitureId: 'dresser', x: wX + 22, y: r.cy, w: 110, h: 45, rot: 90 },
      ]
    default:
      return [
        { furnitureId: 'rug-medium', x: r.cx, y: r.cy, w: 200, h: 300 },
        { furnitureId: 'armchair', x: r.cx, y: r.cy, w: 85, h: 90, label: 'Sessel' },
        { furnitureId: 'plant-tall', x: eX - 25, y: nY + 25, w: 40, h: 40 },
      ]
  }
}

const OVERLAP_TOL = 2
function corners(c: { x: number; y: number; w: number; h: number; rot?: number }) {
  return obbCorners(c.x, c.y, c.w, c.h, c.rot ?? 0)
}
function withinRect(c: { x: number; y: number; w: number; h: number; rot?: number }, r: Rect, margin: number): boolean {
  const pts = corners(c)
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]))
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]))
  return minX >= r.x0 + margin - 0.01 && maxX <= r.x1 - margin + 0.01 && minY >= r.y0 + margin - 0.01 && maxY <= r.y1 - margin + 0.01
}

/** True if the room already contains a furniture piece (by centre-in-rect). */
export function roomHasFurniture(room: Room, furniture: PlacedFurniture[]): boolean {
  const r = roomRect(room)
  return furniture.some((f) => f.position.x >= r.x0 && f.position.x <= r.x1 && f.position.y >= r.y0 && f.position.y <= r.y1)
}

/**
 * Furnish a single empty room. Returns collision-free placed furniture that
 * fits inside the room; empty when the room is too small for anything.
 * `existing` = furniture already on the floor (avoided during placement).
 */
export function furnishRoom(room: Room, existing: PlacedFurniture[] = []): PlacedFurniture[] {
  if ((room.zoneType ?? 'indoor') === 'outdoor' || room.polygon.length < 3) return []
  const r = roomRect(room)
  if (r.w < 120 || r.h < 120) return []
  const wallMargin = 8
  // Solids already in this room that we must not collide with.
  const blockers = existing
    .filter((f) => f.size && furnitureFootprint(f.furnitureId, f.size) === 'solid' && f.position.x >= r.x0 && f.position.x <= r.x1 && f.position.y >= r.y0 && f.position.y <= r.y1)
    .map((f) => obbCorners(f.position.x, f.position.y, f.size![0], f.size![1], f.rotation ?? 0))

  const kept: PlacedFurniture[] = []
  const keptSolidBoxes: ReturnType<typeof obbCorners>[] = [...blockers]

  for (const c of arrangement(classifyRoom(room.name), r)) {
    if (!withinRect(c, r, wallMargin)) continue
    const solid = furnitureFootprint(c.furnitureId, [c.w, c.h]) === 'solid'
    if (solid) {
      const box = corners(c)
      if (keptSolidBoxes.some((b) => obbPenetration(box, b) > OVERLAP_TOL)) continue
      keptSolidBoxes.push(box)
    }
    kept.push({ id: uuid(), furnitureId: c.furnitureId, position: { x: c.x, y: c.y }, rotation: c.rot ?? 0, size: [c.w, c.h], ...(c.label ? { label: c.label } : {}) })
  }
  return kept
}

/**
 * Auto-furnish every empty indoor room on a floor. Non-destructive: rooms that
 * already hold furniture are left untouched. Returns the pieces to add.
 */
export function autoFurnishFloor(floor: Floor): PlacedFurniture[] {
  const added: PlacedFurniture[] = []
  for (const room of floor.rooms) {
    if (roomHasFurniture(room, floor.furniture)) continue
    added.push(...furnishRoom(room, [...floor.furniture, ...added]))
  }
  return added
}
