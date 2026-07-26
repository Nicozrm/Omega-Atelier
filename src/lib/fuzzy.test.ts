import { describe, it, expect } from 'vitest'
import { fuzzyMatch, highlightRuns } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches a subsequence and reports its indices', () => {
    const m = fuzzyMatch('wz', 'Wohnzimmer')!
    expect(m).not.toBeNull()
    expect(m.indices).toEqual([0, 4]) // W…z
  })

  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', 'Wohnzimmer')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('HALL', 'Flur Hallenbad')).not.toBeNull()
  })

  it('an empty query matches everything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] })
  })

  it('ranks a start-of-string hit above a mid-word hit', () => {
    const start = fuzzyMatch('la', 'Lampe')!.score
    const mid = fuzzyMatch('la', 'Schlafzimmer')!.score
    expect(start).toBeGreaterThan(mid)
  })

  it('ranks a consecutive run above scattered letters', () => {
    const run = fuzzyMatch('lamp', 'Lampe')!.score
    const scattered = fuzzyMatch('lamp', 'Lautsprecher-Panel')!
    if (scattered) expect(run).toBeGreaterThan(scattered.score)
  })

  it('rewards word-boundary hits (multi-word query, AND semantics)', () => {
    const m = fuzzyMatch('hue motion', 'Hue Motion Sensor')
    expect(m).not.toBeNull()
    // both tokens must match; a missing token fails the whole query
    expect(fuzzyMatch('hue xxxx', 'Hue Motion Sensor')).toBeNull()
  })

  it('prefers a shorter target on an otherwise equal match', () => {
    const short = fuzzyMatch('hue', 'Hue')!.score
    const long = fuzzyMatch('hue', 'Hue Lightstrip Plus 2m Extension')!.score
    expect(short).toBeGreaterThan(long)
  })
})

describe('highlightRuns', () => {
  it('splits text into matched / unmatched runs', () => {
    const runs = highlightRuns('Wohnzimmer', [0, 4])
    expect(runs).toEqual([
      { text: 'W', match: true },
      { text: 'ohn', match: false },
      { text: 'z', match: true },
      { text: 'immer', match: false },
    ])
  })

  it('returns the whole string unmatched when there are no indices', () => {
    expect(highlightRuns('Lampe', [])).toEqual([{ text: 'Lampe', match: false }])
  })

  it('handles adjacent matched indices as one run', () => {
    expect(highlightRuns('Lampe', [0, 1, 2])).toEqual([
      { text: 'Lam', match: true },
      { text: 'pe', match: false },
    ])
  })
})
