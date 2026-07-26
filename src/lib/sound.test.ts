import { describe, it, expect, beforeEach } from 'vitest'
import { play, installSound, isSoundEnabled, setSoundEnabled } from './sound'

describe('sound engine', () => {
  beforeEach(() => localStorage.clear())

  it('is enabled by default and persists the preference', () => {
    expect(isSoundEnabled()).toBe(true)
    setSoundEnabled(false)
    expect(isSoundEnabled()).toBe(false)
    expect(localStorage.getItem('omega.sound')).toBe('0')
    setSoundEnabled(true)
    expect(isSoundEnabled()).toBe(true)
  })

  it('every entry point is a safe no-op without AudioContext (jsdom)', () => {
    expect(() => installSound()).not.toThrow()
    expect(() => play('thud')).not.toThrow()
    expect(() => play('click')).not.toThrow()
    expect(() => play('swell')).not.toThrow()
    setSoundEnabled(false)
    expect(() => play('click')).not.toThrow()
  })
})
