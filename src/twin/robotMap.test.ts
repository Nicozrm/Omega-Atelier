import { describe, it, expect } from 'vitest'
import {
  decodeTuyaMap, encodeTuyaMap, cellAt, pixelToCm, cleanedAreaM2, rasterise, mapBoundsCm,
  CELL_UNKNOWN, CELL_WALL, CELL_FLOOR, type RobotMap,
} from './robotMap'

/** A small hand-built map: 4×3, a wall border with floor inside. */
function sampleMap(): RobotMap {
  const w = 4, h = 3
  const cells = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      cells[y * w + x] = edge ? CELL_WALL : CELL_FLOOR
    }
  }
  return {
    width: w, height: h, resolutionCm: 5,
    origin: { x: -100, y: -50 },
    charger: { x: -90, y: -40 },
    cells,
    path: [{ x: -90, y: -40 }, { x: -80, y: -40 }, { x: -80, y: -30 }],
  }
}

describe('Tuya map codec', () => {
  it('round-trips a map through encode → decode losslessly', () => {
    const m = sampleMap()
    const back = decodeTuyaMap(encodeTuyaMap(m))
    expect(back.width).toBe(m.width)
    expect(back.height).toBe(m.height)
    expect(back.resolutionCm).toBe(m.resolutionCm)
    expect(back.origin).toEqual(m.origin)
    expect(back.charger).toEqual(m.charger)
    expect(Array.from(back.cells)).toEqual(Array.from(m.cells))
    expect(back.path).toEqual(m.path)
  })

  it('RLE compresses runs of identical cells', () => {
    // A 100×100 all-floor map has one long run → tiny blob despite 10k cells.
    const big: RobotMap = {
      width: 100, height: 100, resolutionCm: 5,
      origin: { x: 0, y: 0 }, charger: { x: 0, y: 0 },
      cells: new Uint8Array(10_000).fill(CELL_FLOOR), path: [],
    }
    const blob = encodeTuyaMap(big)
    expect(blob.length).toBeLessThan(60) // header + a couple RLE runs, base64'd
    expect(decodeTuyaMap(blob).cells.every((c) => c === CELL_FLOOR)).toBe(true)
  })

  it('rejects a blob without the TM magic', () => {
    expect(() => decodeTuyaMap(btoa('not a map at all'))).toThrow(/Tuya-Kartenformat/)
  })

  it('rejects a truncated RLE stream', () => {
    const good = encodeTuyaMap(sampleMap())
    const bytes = atob(good)
    const truncated = btoa(bytes.slice(0, 22)) // header + a partial run
    expect(() => decodeTuyaMap(truncated)).toThrow()
  })
})

describe('map helpers', () => {
  it('reads cells and clamps out-of-bounds to unknown', () => {
    const m = sampleMap()
    expect(cellAt(m, 0, 0)).toBe(CELL_WALL)
    expect(cellAt(m, 1, 1)).toBe(CELL_FLOOR)
    expect(cellAt(m, -1, 0)).toBe(CELL_UNKNOWN)
    expect(cellAt(m, 99, 99)).toBe(CELL_UNKNOWN)
  })

  it('maps pixels to world centimetres via origin + resolution', () => {
    const m = sampleMap()
    expect(pixelToCm(m, 0, 0)).toEqual({ x: -100, y: -50 })
    expect(pixelToCm(m, 2, 1)).toEqual({ x: -90, y: -45 })
  })

  it('computes the world bounding box', () => {
    expect(mapBoundsCm(sampleMap())).toEqual({ x: -100, y: -50, w: 20, h: 15 })
  })

  it('estimates cleaned area from floor cells (0.1 m² steps)', () => {
    // 8×10 all-floor, 5cm px → 80 × 25 cm² = 2000 cm² = 0.2 m².
    const m: RobotMap = {
      width: 8, height: 10, resolutionCm: 5,
      origin: { x: 0, y: 0 }, charger: { x: 0, y: 0 },
      cells: new Uint8Array(80).fill(CELL_FLOOR), path: [],
    }
    expect(cleanedAreaM2(m)).toBeCloseTo(0.2, 5)
    // A tiny floor area rounds down to 0.0 — the display never shows noise.
    expect(cleanedAreaM2(sampleMap())).toBe(0)
  })

  it('rasterises to RGBA with the given palette', () => {
    const m = sampleMap()
    const palette = {
      unknown: [0, 0, 0, 0] as [number, number, number, number],
      wall: [255, 0, 0, 255] as [number, number, number, number],
      floor: [0, 255, 0, 255] as [number, number, number, number],
    }
    const r = rasterise(m, palette)
    expect(r.width).toBe(4)
    expect(r.height).toBe(3)
    expect(r.rgba.length).toBe(4 * 3 * 4)
    // pixel (0,0) is wall → red
    expect(Array.from(r.rgba.slice(0, 4))).toEqual([255, 0, 0, 255])
    // pixel (1,1) is floor → green, at offset (1*4 + 1)*4 = 20
    expect(Array.from(r.rgba.slice(20, 24))).toEqual([0, 255, 0, 255])
  })
})
