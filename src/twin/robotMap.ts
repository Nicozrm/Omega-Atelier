/**
 * robotMap.ts — decoding a real robot-vacuum LiDAR map into a neutral form.
 *
 * Tuya (and Roborock-class) robots expose their laser map as a compact binary
 * blob: a header (dimensions, resolution, origin, charger) + a run-length-
 * encoded occupancy grid (unknown / wall / floor) + the actually-driven path.
 * This module decodes that Tuya-style layout into a renderer-neutral `RobotMap`
 * and offers pure helpers to rasterise it — no canvas, no THREE, no network,
 * fully testable. `encodeTuyaMap` is the inverse, used by tests and the
 * simulator so the whole pipeline round-trips real bytes.
 *
 * Binary layout (little-endian):
 *   0  u8×2  magic 'T''M'
 *   2  u8    version
 *   3  u8    flags (reserved)
 *   4  u16   width  (pixels)
 *   6  u16   height (pixels)
 *   8  i16   originX (cm — world coord of pixel 0,0)
 *  10  i16   originY (cm)
 *  12  u16   resolution (mm per pixel)
 *  14  i16   chargerX offset (cm from origin)
 *  16  i16   chargerY offset (cm from origin)
 *  18  u16   pathCount
 *  20  …     RLE occupancy: repeated [value:u8, count:u16] until w*h filled
 *   …        path: pathCount × [x:i16, y:i16] (cm, world)
 */

export type MapCell = 0 | 1 | 2 // 0 unknown · 1 wall/obstacle · 2 floor
export const CELL_UNKNOWN = 0
export const CELL_WALL = 1
export const CELL_FLOOR = 2

export interface RobotMapPoint { x: number; y: number }

export interface RobotMap {
  /** Grid size in pixels. */
  width: number
  height: number
  /** Centimetres per pixel. */
  resolutionCm: number
  /** World coordinate (cm) of pixel (0,0). */
  origin: RobotMapPoint
  /** Charger/dock position (cm, world). */
  charger: RobotMapPoint
  /** Occupancy grid, row-major, length width*height. */
  cells: Uint8Array
  /** The actually-driven cleaning path (cm, world). */
  path: RobotMapPoint[]
}

const MAGIC_T = 0x54
const MAGIC_M = 0x4d

function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  return Buffer.from(bytes).toString('base64')
}

/** Decode a Tuya-style laser-map blob (base64) into a neutral RobotMap. */
export function decodeTuyaMap(base64: string): RobotMap {
  const b = b64ToBytes(base64)
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length < 20 || b[0] !== MAGIC_T || b[1] !== MAGIC_M) {
    throw new Error('Kein gültiges Tuya-Kartenformat')
  }
  const width = dv.getUint16(4, true)
  const height = dv.getUint16(6, true)
  const originX = dv.getInt16(8, true)
  const originY = dv.getInt16(10, true)
  const resMm = dv.getUint16(12, true)
  const chargerX = dv.getInt16(14, true)
  const chargerY = dv.getInt16(16, true)
  const pathCount = dv.getUint16(18, true)
  const total = width * height
  if (total <= 0 || total > 4_000_000) throw new Error('Kartengröße unplausibel')

  const cells = new Uint8Array(total)
  let p = 20
  let filled = 0
  while (filled < total) {
    if (p + 3 > b.length) throw new Error('Karte abgeschnitten (RLE)')
    const value = b[p]
    const count = dv.getUint16(p + 1, true)
    p += 3
    const end = Math.min(total, filled + count)
    cells.fill(value, filled, end)
    filled = end
  }

  const path: RobotMapPoint[] = []
  for (let i = 0; i < pathCount; i++) {
    if (p + 4 > b.length) break
    path.push({ x: dv.getInt16(p, true), y: dv.getInt16(p + 2, true) })
    p += 4
  }

  const resolutionCm = resMm / 10
  return {
    width, height, resolutionCm,
    origin: { x: originX, y: originY },
    charger: { x: originX + chargerX, y: originY + chargerY },
    cells, path,
  }
}

/** Encode a RobotMap back to the Tuya-style blob (base64). Inverse of decode. */
export function encodeTuyaMap(map: RobotMap): string {
  // RLE the occupancy grid.
  const rle: number[] = []
  let i = 0
  while (i < map.cells.length) {
    const v = map.cells[i]
    let n = 1
    while (i + n < map.cells.length && map.cells[i + n] === v && n < 0xffff) n++
    rle.push(v, n & 0xff, (n >> 8) & 0xff)
    i += n
  }
  const size = 20 + rle.length + map.path.length * 4
  const b = new Uint8Array(size)
  const dv = new DataView(b.buffer)
  b[0] = MAGIC_T; b[1] = MAGIC_M; b[2] = 1; b[3] = 0
  dv.setUint16(4, map.width, true)
  dv.setUint16(6, map.height, true)
  dv.setInt16(8, map.origin.x, true)
  dv.setInt16(10, map.origin.y, true)
  dv.setUint16(12, Math.round(map.resolutionCm * 10), true)
  dv.setInt16(14, Math.round(map.charger.x - map.origin.x), true)
  dv.setInt16(16, Math.round(map.charger.y - map.origin.y), true)
  dv.setUint16(18, map.path.length, true)
  let p = 20
  for (const byte of rle) b[p++] = byte
  for (const pt of map.path) {
    dv.setInt16(p, Math.round(pt.x), true)
    dv.setInt16(p + 2, Math.round(pt.y), true)
    p += 4
  }
  return bytesToB64(b)
}

/** Cell value at a pixel (out-of-bounds ⇒ unknown). */
export function cellAt(map: RobotMap, px: number, py: number): MapCell {
  if (px < 0 || py < 0 || px >= map.width || py >= map.height) return CELL_UNKNOWN
  return map.cells[py * map.width + px] as MapCell
}

/** Pixel centre → world centimetres. */
export function pixelToCm(map: RobotMap, px: number, py: number): RobotMapPoint {
  return { x: map.origin.x + px * map.resolutionCm, y: map.origin.y + py * map.resolutionCm }
}

/** Cleaned area estimate (m²): floor cells × pixel area. */
export function cleanedAreaM2(map: RobotMap): number {
  let floor = 0
  for (let i = 0; i < map.cells.length; i++) if (map.cells[i] === CELL_FLOOR) floor++
  const pxAreaCm2 = map.resolutionCm * map.resolutionCm
  return Math.round((floor * pxAreaCm2) / 10_000 * 10) / 10
}

/** World bounding box of the map, in cm. */
export function mapBoundsCm(map: RobotMap): { x: number; y: number; w: number; h: number } {
  return {
    x: map.origin.x,
    y: map.origin.y,
    w: map.width * map.resolutionCm,
    h: map.height * map.resolutionCm,
  }
}

export interface MapRaster {
  width: number
  height: number
  /** RGBA bytes, length width*height*4 — ready for canvas putImageData. */
  rgba: Uint8ClampedArray
}

export interface MapPalette {
  unknown: [number, number, number, number]
  wall: [number, number, number, number]
  floor: [number, number, number, number]
}

/** Rasterise the occupancy grid to RGBA (pure — the caller owns the canvas). */
export function rasterise(map: RobotMap, palette: MapPalette): MapRaster {
  const rgba = new Uint8ClampedArray(map.width * map.height * 4)
  for (let i = 0; i < map.cells.length; i++) {
    const c = map.cells[i]
    const col = c === CELL_FLOOR ? palette.floor : c === CELL_WALL ? palette.wall : palette.unknown
    const o = i * 4
    rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = col[3]
  }
  return { width: map.width, height: map.height, rgba }
}
