import { describe, it, expect, beforeEach } from 'vitest'
import { clearTrace, readTrace, redact, subscribeTrace, trace, traceError } from './diagnostics'

/**
 * The trace exists so "verbunden, aber keine Geräte" can be answered. It is
 * therefore something a user may well paste into a support thread — which makes
 * the redaction the part worth testing hardest.
 */

beforeEach(() => clearTrace())

describe('redact — a trace must never carry a credential', () => {
  it('replaces long token-shaped runs with their length', () => {
    const token = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    // Deliberately blunt — it over-redacts the surrounding field name rather
    // than risk leaving a credential behind.
    expect(redact(`sign=${token}`)).not.toContain(token)
    expect(redact(`sign=${token}`)).toMatch(/‹\d+ Zeichen›/)
  })

  it('redacts a bearer credential', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi')
  })

  it('leaves ordinary prose alone', () => {
    const message = 'Tuya verweigert den Zugriff (permission deny)'
    expect(redact(message)).toBe(message)
  })
})

describe('trace entries', () => {
  it('never stores the value of a secret-named field', () => {
    trace('switchbot', 'request', 'Anfrage gesendet', { token: 'super-secret-token', status: 200 })
    const [entry] = readTrace('switchbot')
    expect(JSON.stringify(entry)).not.toContain('super-secret-token')
    expect(entry.detail?.status).toBe(200)
  })

  it('redacts secrets that arrive inside a free-form message', () => {
    traceError('tuya', 'auth', 'abgelehnt für ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
    expect(JSON.stringify(readTrace('tuya'))).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')
  })

  it('keeps the chain in order, per connector', () => {
    trace('sb', 'auth', 'ok')
    trace('sb', 'request', 'ok')
    trace('other', 'auth', 'ok')
    trace('sb', 'normalize', 'ok')
    expect(readTrace('sb').map((e) => e.step)).toEqual(['auth', 'request', 'normalize'])
  })

  it('marks failures at the step that failed', () => {
    traceError('sb', 'parse', 'Envelope abgelehnt')
    expect(readTrace('sb')[0].level).toBe('error')
  })

  it('notifies subscribers and can be cleared per connector', () => {
    const seen: number[] = []
    const unsubscribe = subscribeTrace((entries) => seen.push(entries.length))
    trace('a', 'auth', 'x')
    trace('b', 'auth', 'y')
    clearTrace('a')
    unsubscribe()
    expect(readTrace('a')).toHaveLength(0)
    expect(readTrace('b')).toHaveLength(1)
    expect(seen.length).toBeGreaterThan(1)
  })
})
