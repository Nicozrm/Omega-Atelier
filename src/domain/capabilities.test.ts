import { describe, it, expect } from 'vitest'
import {
  CAPABILITY_KINDS, findCapability, hasCapability, isWritable,
  type Capability,
} from './capabilities'

const caps: Capability[] = [
  { kind: 'OnOff', access: 'readWrite', on: true },
  { kind: 'Brightness', access: 'readWrite', percent: 70 },
  { kind: 'Temperature', access: 'read', celsius: 21 },
]

describe('capability helpers', () => {
  it('finds a capability with its concrete type', () => {
    const b = findCapability(caps, 'Brightness')
    expect(b?.percent).toBe(70)
    expect(findCapability(caps, 'Lock')).toBeUndefined()
  })

  it('reports presence', () => {
    expect(hasCapability(caps, 'OnOff')).toBe(true)
    expect(hasCapability(caps, 'Color')).toBe(false)
  })

  it('separates writable from read-only', () => {
    expect(isWritable(caps[0])).toBe(true) // OnOff
    expect(isWritable(caps[2])).toBe(false) // Temperature
  })

  it('lists every capability kind exactly once', () => {
    expect(new Set(CAPABILITY_KINDS).size).toBe(CAPABILITY_KINDS.length)
    expect(CAPABILITY_KINDS).toContain('Vacuum')
    expect(CAPABILITY_KINDS.length).toBe(12)
  })
})
