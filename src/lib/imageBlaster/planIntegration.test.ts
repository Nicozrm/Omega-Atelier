import { describe, it, expect } from 'vitest'
import {
  normalizeSettings,
  polygonCentroid,
  largestRoom,
  wallArtPlacement,
  floorObjectPlacement,
  nextWallPlacement,
  DEFAULT_SETTINGS,
} from './index'
import { coercePlan } from '@/lib/planSchema'
import { createDemoPlan } from '@/data/demoPlan'
import type { Room } from '@/types'

const room = (id: string, poly: Array<[number, number]>): Room => ({
  id,
  name: id,
  polygon: poly.map(([x, y]) => ({ x, y })),
})

describe('normalizeSettings', () => {
  it('returns full defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('kaputt')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ mesh: { mode: 'hologramm', resolution: 'viel' } }).mesh.mode).toBe('relief')
  })

  it('keeps valid values and clamps out-of-range numbers', () => {
    const s = normalizeSettings({
      mesh: { mode: 'points', resolution: 9999, pointSize: 0.004 },
      depth: { gamma: -5, invert: true },
    })
    expect(s.mesh.mode).toBe('points')
    expect(s.mesh.resolution).toBe(256)
    expect(s.mesh.pointSize).toBe(0.004)
    expect(s.depth.gamma).toBe(0.25)
    expect(s.depth.invert).toBe(true)
    expect(s.material).toEqual(DEFAULT_SETTINGS.material)
  })
})

describe('placement', () => {
  const square = room('wohnen', [[0, 0], [400, 0], [400, 300], [0, 300]])

  it('computes the centroid of a rectangle', () => {
    const c = polygonCentroid(square.polygon)
    expect(c.x).toBeCloseTo(200, 5)
    expect(c.y).toBeCloseTo(150, 5)
  })

  it('picks the largest room', () => {
    const small = room('bad', [[0, 0], [100, 0], [100, 100], [0, 100]])
    expect(largestRoom([small, square])?.id).toBe('wohnen')
    expect(largestRoom([])).toBeNull()
  })

  it('hangs wall art on the longest edge, facing inward', () => {
    const p = wallArtPlacement(square)
    // Longest edges are the 400cm horizontals; the first one wins (y=0).
    expect(p.position.x).toBeCloseTo(200, 5)
    expect(p.position.y).toBeGreaterThan(0) // nudged into the room
    expect(p.position.y).toBeLessThan(20)
    // Normal points toward centroid (+y) → rotation 0°.
    expect(Math.abs(p.rotation)).toBeLessThan(1e-6)
  })

  it('centers floor objects in the room', () => {
    const p = floorObjectPlacement(square)
    expect(p.position).toEqual({ x: 200, y: 150 })
  })

  it('cycles wall art to the next room wall', () => {
    const start = wallArtPlacement(square) // top edge (y≈0)
    const next = nextWallPlacement(square, start.position)
    // Next polygon edge is the right wall (x=400) → placed just inside it.
    expect(next.position.x).toBeCloseTo(394, 5)
    expect(next.position.y).toBeCloseTo(150, 5)
    expect(next.rotation).toBeCloseTo(-90, 5)
    // Cycling all four edges returns to the start.
    let p = start
    for (let i = 0; i < 4; i++) p = nextWallPlacement(square, p.position)
    expect(p.position.x).toBeCloseTo(start.position.x, 5)
    expect(p.position.y).toBeCloseTo(start.position.y, 5)
  })
})

describe('planSchema — blasterAssets', () => {
  const base = () => JSON.parse(JSON.stringify(createDemoPlan()))

  it('normalizes a missing field to []', () => {
    const doc = coercePlan(base())
    expect(doc?.floors[0].blasterAssets).toEqual([])
  })

  it('keeps valid assets and repairs missing optionals', () => {
    const raw = base()
    raw.floors[0].blasterAssets = [{
      image: 'data:image/png;base64,AAAA',
      settings: { mesh: { mode: 'relief' } },
      position: { x: 100, y: 50 },
    }]
    const doc = coercePlan(raw)
    const a = doc?.floors[0].blasterAssets?.[0]
    expect(a).toBeDefined()
    expect(a?.mount).toBe('wall')
    expect(a?.width).toBe(100)
    expect(a?.elevation).toBe(140)
    expect(a?.rotation).toBe(0)
    expect(typeof a?.id).toBe('string')
  })

  it('drops structurally-invalid assets', () => {
    const raw = base()
    raw.floors[0].blasterAssets = [
      { image: 'https://evil.example/x.png', settings: {}, position: { x: 0, y: 0 } }, // not a data-URL
      { image: 'data:image/png;base64,AAAA', settings: 'kaputt', position: { x: 0, y: 0 } },
      { image: 'data:image/png;base64,AAAA', settings: {}, position: { x: 'a' } },
      'müll',
    ]
    const doc = coercePlan(raw)
    expect(doc?.floors[0].blasterAssets).toEqual([])
  })
})
