import { describe, it, expect } from 'vitest'
import { SeededRng, rngFromSeed, hashString, hashInts, hashGeo } from './rng'

describe('hashing', () => {
  it('hashString is stable and returns a uint32', () => {
    const a = hashString('Musterstraße 1')
    const b = hashString('Musterstraße 1')
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(a)).toBe(true)
  })

  it('hashString differs for different input', () => {
    expect(hashString('a')).not.toBe(hashString('b'))
  })

  it('hashInts is order-sensitive and stable', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3))
    expect(hashInts(1, 2)).not.toBe(hashInts(2, 1))
  })

  it('hashGeo returns the same seed for coordinates within the precision cell', () => {
    const a = hashGeo(52.52, 13.405)
    const b = hashGeo(52.520001, 13.405001) // < 1.1m away
    expect(a).toBe(b)
  })

  it('hashGeo returns a different seed for a clearly different place', () => {
    expect(hashGeo(52.52, 13.405)).not.toBe(hashGeo(48.135, 11.582))
  })
})

describe('SeededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = new SeededRng(42)
    const b = new SeededRng(42)
    const seqA = Array.from({ length: 5 }, () => a.next())
    const seqB = Array.from({ length: 5 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces values in [0, 1)', () => {
    const r = new SeededRng(7)
    for (let i = 0; i < 200; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('range stays within [min, max)', () => {
    const r = new SeededRng(9)
    for (let i = 0; i < 200; i++) {
      const v = r.range(10, 20)
      expect(v).toBeGreaterThanOrEqual(10)
      expect(v).toBeLessThan(20)
    }
  })

  it('int is inclusive on both ends and integral', () => {
    const r = new SeededRng(11)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) {
      const v = r.int(1, 3)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
      seen.add(v)
    }
    expect(seen).toEqual(new Set([1, 2, 3]))
  })

  it('pick throws on an empty list', () => {
    const r = new SeededRng(1)
    expect(() => r.pick([])).toThrow()
  })

  it('gaussian is roughly centred on the mean', () => {
    const r = new SeededRng(123)
    let sum = 0
    const n = 2000
    for (let i = 0; i < n; i++) sum += r.gaussian(5, 2)
    expect(sum / n).toBeCloseTo(5, 0)
  })

  it('fork produces an independent but deterministic stream', () => {
    const parent = new SeededRng(100)
    const c1 = parent.fork(1)
    const c2 = new SeededRng(100).fork(1)
    expect(c1.next()).toBe(c2.next())
    const other = new SeededRng(100).fork(2)
    expect(new SeededRng(100).fork(1).next()).not.toBe(other.next())
  })

  it('rngFromSeed matches the constructor', () => {
    expect(rngFromSeed(55).next()).toBe(new SeededRng(55).next())
  })
})
