import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isCinematicEnabled, setCinematicEnabled,
  onCinematicPulse, emitCinematicPulse, cinematicReact,
} from './cinematic'

// sound.play is a no-op without an AudioContext, but stub it so the reaction
// test asserts intent rather than audio internals.
vi.mock('./sound', () => ({ play: vi.fn() }))
import { play } from './sound'

describe('cinematic — preference', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('defaults on and round-trips through storage', () => {
    expect(isCinematicEnabled()).toBe(true)
    setCinematicEnabled(false)
    expect(isCinematicEnabled()).toBe(false)
    setCinematicEnabled(true)
    expect(isCinematicEnabled()).toBe(true)
  })
})

describe('cinematic — pulse bus', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('delivers pulses to subscribers with monotonic ids and the click point', () => {
    const seen: number[] = []
    const off = onCinematicPulse((p) => { seen.push(p.id); expect(p.x).toBe(12); expect(p.y).toBe(34); expect(p.kind).toBe('place') })
    const a = emitCinematicPulse(12, 34, 'place')
    const b = emitCinematicPulse(12, 34, 'place')
    expect(a && b && b.id).toBeGreaterThan(a!.id)
    off()
    emitCinematicPulse(12, 34, 'place')
    expect(seen).toHaveLength(2) // no delivery after unsubscribe
  })

  it('is a silent no-op when the mode is off', () => {
    setCinematicEnabled(false)
    const cb = vi.fn()
    onCinematicPulse(cb)
    expect(emitCinematicPulse(0, 0, 'place')).toBeNull()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('cinematic — reaction', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

  it('fires sound and pulse together when on, nothing when off', () => {
    const cb = vi.fn()
    onCinematicPulse(cb)
    cinematicReact(5, 6, 'place')
    expect(play).toHaveBeenCalledWith('thud')
    expect(cb).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    setCinematicEnabled(false)
    cinematicReact(5, 6, 'place')
    expect(play).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()
  })
})
