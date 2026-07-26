import { describe, it, expect } from 'vitest'
import { segmentsIntersect, barriersBetween, acousticPath } from './acoustics'
import type { Wall } from '@/types'

const wall = (ax: number, ay: number, bx: number, by: number, subtype?: Wall['subtype']): Wall => ({
  id: `${ax},${ay}-${bx},${by}`, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 12,
  ...(subtype ? { subtype } : {}),
})

describe('segmentsIntersect', () => {
  it('detects a crossing', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true)
  })
  it('rejects parallel and distant segments', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false)
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 5 })).toBe(false)
  })
})

describe('barriersBetween', () => {
  const walls = [wall(200, 0, 200, 400), wall(400, 0, 400, 400, 'door')]
  it('counts solid walls and openings separately', () => {
    const b = barriersBetween({ x: 0, y: 200 }, { x: 500, y: 200 }, walls)
    expect(b.solid).toBe(1)
    expect(b.openings).toBe(1)
  })
  it('sees no barriers on a clear line', () => {
    const b = barriersBetween({ x: 0, y: 200 }, { x: 100, y: 200 }, walls)
    expect(b).toEqual({ solid: 0, openings: 0 })
  })
})

describe('acousticPath', () => {
  it('is loud and bright up close, quiet and dull far away', () => {
    const near = acousticPath({ x: 0, y: 0 }, { x: 50, y: 0 }, [])
    const far = acousticPath({ x: 0, y: 0 }, { x: 2000, y: 0 }, [])
    expect(near.gain).toBeGreaterThan(0.95)
    expect(far.gain).toBeLessThan(0.15)
    expect(near.lowpassHz).toBeGreaterThan(far.lowpassHz)
  })

  it('a wall muffles: lower gain and much lower cutoff than open air', () => {
    const open = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [])
    const blocked = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [wall(300, 0, 300, 200)])
    expect(blocked.walls).toBe(1)
    expect(blocked.gain).toBeLessThan(open.gain * 0.6)
    expect(blocked.lowpassHz).toBeLessThan(open.lowpassHz * 0.5)
  })

  it('two walls muffle more than one', () => {
    const one = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [wall(300, 0, 300, 200)])
    const two = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [wall(200, 0, 200, 200), wall(400, 0, 400, 200)])
    expect(two.gain).toBeLessThan(one.gain)
    expect(two.lowpassHz).toBeLessThan(one.lowpassHz)
  })

  it('a door attenuates less than a solid wall', () => {
    const solid = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [wall(300, 0, 300, 200)])
    const door = acousticPath({ x: 0, y: 100 }, { x: 600, y: 100 }, [wall(300, 0, 300, 200, 'door')])
    expect(door.gain).toBeGreaterThan(solid.gain)
    expect(door.lowpassHz).toBeGreaterThan(solid.lowpassHz)
  })

  it('pans right for a source to the right, centred for straight ahead', () => {
    expect(acousticPath({ x: 0, y: 0 }, { x: 300, y: 0 }, []).pan).toBeGreaterThan(0.5)
    expect(acousticPath({ x: 0, y: 0 }, { x: -300, y: 0 }, []).pan).toBeLessThan(-0.5)
    expect(Math.abs(acousticPath({ x: 0, y: 0 }, { x: 0, y: 300 }, []).pan)).toBeLessThan(0.01)
  })

  it('never exceeds 0..1 gain and stays above the cutoff floor', () => {
    const p = acousticPath({ x: 0, y: 0 }, { x: 4000, y: 0 }, [wall(100, -50, 100, 50), wall(200, -50, 200, 50), wall(300, -50, 300, 50)])
    expect(p.gain).toBeGreaterThanOrEqual(0)
    expect(p.gain).toBeLessThanOrEqual(1)
    expect(p.lowpassHz).toBeGreaterThanOrEqual(180)
  })
})
