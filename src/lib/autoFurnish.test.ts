import { describe, it, expect } from 'vitest'
import type { Floor, Room, PlacedFurniture } from '@/types'
import { classifyRoom, furnishRoom, roomHasFurniture, autoFurnishFloor } from './autoFurnish'
import { checkFloorIntegrity } from './planIntegrity'
import { FURNITURE } from '@/data/furniture'

const categoryOf = (id: string) => new Map(FURNITURE.map((f) => [f.id, f.category])).get(id)
const FURN_IDS = new Set(FURNITURE.map((f) => f.id))

const rectRoom = (name: string, x0: number, y0: number, x1: number, y1: number, zoneType: Room['zoneType'] = 'indoor'): Room =>
  ({ id: name, name, zoneType, polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] })

const floorOf = (rooms: Room[], furniture: PlacedFurniture[] = []): Floor => ({
  id: 'f', name: 'F', index: 0, rooms, walls: [], devices: [], furniture, labels: [],
  layers: { walls: true, furniture: true, devices: true, labels: true },
  extent: { width: Math.max(...rooms.flatMap((r) => r.polygon.map((p) => p.x))), height: Math.max(...rooms.flatMap((r) => r.polygon.map((p) => p.y))) },
})

describe('classifyRoom', () => {
  it('maps German + English room names to a purpose', () => {
    expect(classifyRoom('Schlafzimmer')).toBe('bedroom')
    expect(classifyRoom('Kinderzimmer 1')).toBe('kids') // kids beats bedroom
    expect(classifyRoom('Wohnen / Essen')).toBe('living')
    expect(classifyRoom('Esszimmer')).toBe('dining')
    expect(classifyRoom('Küche')).toBe('kitchen')
    expect(classifyRoom('Master-Bad')).toBe('bath')
    expect(classifyRoom('Arbeitszimmer')).toBe('office')
    expect(classifyRoom('Flur')).toBe('hall')
    expect(classifyRoom('Abstellraum')).toBe('generic')
  })
})

describe('furnishRoom', () => {
  it('furnishes a bedroom with a bed and keeps everything inside the room', () => {
    const room = rectRoom('Schlafzimmer', 0, 0, 400, 400)
    const pieces = furnishRoom(room)
    expect(pieces.some((p) => p.furnitureId.startsWith('bed'))).toBe(true)
    for (const p of pieces) {
      const [w, h] = p.size!
      expect(p.position.x - w / 2).toBeGreaterThanOrEqual(-0.5)
      expect(p.position.x + w / 2).toBeLessThanOrEqual(400.5)
      expect(p.position.y - h / 2).toBeGreaterThanOrEqual(-0.5)
      expect(p.position.y + h / 2).toBeLessThanOrEqual(400.5)
      expect(FURN_IDS).toContain(p.furnitureId)
    }
  })

  it('produces a collision-free, defect-free result (the whole promise)', () => {
    for (const name of ['Schlafzimmer', 'Wohnzimmer', 'Küche', 'Esszimmer', 'Badezimmer', 'Kinderzimmer', 'Arbeitszimmer', 'Flur']) {
      const room = rectRoom(name, 0, 0, 460, 440)
      const floor = floorOf([room], furnishRoom(room))
      const issues = checkFloorIntegrity(floor, { categoryOf })
      expect(issues, `${name}: ${issues.map((i) => i.message).join('; ')}`).toEqual([])
      expect(floor.furniture.length, `${name} should get furniture`).toBeGreaterThan(0)
    }
  })

  it('returns nothing for a tiny room or an outdoor zone', () => {
    expect(furnishRoom(rectRoom('Nische', 0, 0, 90, 90))).toEqual([])
    expect(furnishRoom(rectRoom('Terrasse', 0, 0, 600, 400, 'outdoor'))).toEqual([])
  })

  it('avoids furniture already present in the room', () => {
    const room = rectRoom('Schlafzimmer', 0, 0, 400, 400)
    const existing: PlacedFurniture = { id: 'x', furnitureId: 'wardrobe-200', position: { x: 200, y: 370 }, rotation: 0, size: [200, 60] }
    const floor = floorOf([room], [existing, ...furnishRoom(room, [existing])])
    expect(checkFloorIntegrity(floor, { categoryOf })).toEqual([])
  })
})

describe('autoFurnishFloor', () => {
  it('furnishes empty rooms but leaves furnished ones untouched, staying defect-free', () => {
    const empty = rectRoom('Schlafzimmer', 0, 0, 400, 400)
    const taken = rectRoom('Wohnzimmer', 400, 0, 900, 500)
    const seed: PlacedFurniture = { id: 's', furnitureId: 'sofa-corner', position: { x: 650, y: 250 }, rotation: 0, size: [300, 220] }
    const floor = floorOf([empty, taken], [seed])

    expect(roomHasFurniture(taken, [seed])).toBe(true)
    const added = autoFurnishFloor(floor)
    expect(added.length).toBeGreaterThan(0)
    // nothing added into the already-furnished living room
    expect(added.every((p) => p.position.x < 400)).toBe(true)

    const result = floorOf([empty, taken], [seed, ...added])
    expect(checkFloorIntegrity(result, { categoryOf })).toEqual([])
  })
})
