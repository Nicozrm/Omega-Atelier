import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  uuid,
  clamp,
  snap,
  dist,
  pointInPolygon,
  timeAgo,
  stableHue,
  debounce,
  formatLength,
} from '@/lib/utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toContain('a')
    expect(cn('a', 'b')).toContain('b')
  })
  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })
})

describe('uuid', () => {
  it('produces unique, non-empty ids', () => {
    const a = uuid()
    const b = uuid()
    expect(a).toBeTruthy()
    expect(typeof a).toBe('string')
    expect(a).not.toBe(b)
  })
})

describe('clamp', () => {
  it('keeps values within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })
  it('clamps below min and above max', () => {
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })
  it('handles equal bounds', () => {
    expect(clamp(7, 4, 4)).toBe(4)
  })
})

describe('snap', () => {
  it('rounds to the nearest step', () => {
    expect(snap(23, 10)).toBe(20)
    expect(snap(26, 10)).toBe(30)
    expect(snap(25, 10)).toBe(30) // Math.round rounds .5 up
  })
  it('returns the value unchanged for non-positive steps', () => {
    expect(snap(23, 0)).toBe(23)
    expect(snap(23, -5)).toBe(23)
  })
  it('is exact on multiples', () => {
    expect(snap(40, 8)).toBe(40)
  })
})

describe('dist', () => {
  it('computes a 3-4-5 triangle', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
  it('is zero for identical points', () => {
    expect(dist({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  it('detects an interior point', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })
  it('rejects an exterior point', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInPolygon({ x: -1, y: -1 }, square)).toBe(false)
  })
  it('handles a concave polygon (L-shape)', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 2, y: 2 }, lShape)).toBe(true) // in the foot
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false) // in the notch
  })
})

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('says "gerade eben" within a minute', () => {
    expect(timeAgo(new Date('2026-06-01T11:59:30Z'))).toBe('gerade eben')
  })
  it('reports minutes', () => {
    expect(timeAgo(new Date('2026-06-01T11:45:00Z'))).toBe('vor 15 Min.')
  })
  it('reports hours', () => {
    expect(timeAgo(new Date('2026-06-01T09:00:00Z'))).toBe('vor 3 Std.')
  })
  it('reports days', () => {
    expect(timeAgo(new Date('2026-05-29T12:00:00Z'))).toBe('vor 3 Tg.')
  })
  it('accepts ISO strings', () => {
    expect(timeAgo('2026-06-01T11:59:30Z')).toBe('gerade eben')
  })
})

describe('stableHue', () => {
  it('is deterministic for the same input', () => {
    expect(stableHue('alice')).toBe(stableHue('alice'))
  })
  it('stays within 0..359', () => {
    for (const s of ['a', 'bob', 'a-very-long-identifier-123', '']) {
      const h = stableHue(s)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })
  it('differs for different inputs (usually)', () => {
    expect(stableHue('alice')).not.toBe(stableHue('zoe'))
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('invokes once after the wait, with the latest args', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1 as never)
    d(2 as never)
    d(3 as never)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
  })
})

describe('formatLength', () => {
  it('formats centimetres (rounded)', () => {
    expect(formatLength(123.6)).toBe('124 cm')
    expect(formatLength(50)).toBe('50 cm')
  })
  it('formats metres with two decimals', () => {
    expect(formatLength(250, 'm')).toBe('2.50 m')
    expect(formatLength(123, 'm')).toBe('1.23 m')
  })
})
