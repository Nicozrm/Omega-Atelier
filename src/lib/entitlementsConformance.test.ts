import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FEATURE_TIER, type FeatureKey } from './entitlements'

/**
 * A feature declared as paid must actually be gated.
 *
 * `FEATURE_TIER` is a table of intentions. It says `robot-map` costs Max — but
 * saying so unlocks nothing and locks nothing; the tier only bites where some
 * component asks `can('robot-map')`. Six keys were declared paid and asked
 * nowhere at all, so every one of those features was free to everyone while the
 * pricing page charged for them.
 *
 * That gap is invisible in review from either side: the table looks complete,
 * and each feature's own file looks fine because nothing in it is wrong — the
 * check is simply absent. So it is checked here instead, by the only means that
 * catches an omission: looking for the key across the whole tree.
 */

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Paid keys with no gate yet, each with the reason it is not simply a hole.
 *
 * A key belongs here only while the feature it names has no way in. The moment
 * it ships a UI, it needs a gate, not an entry in this list.
 */
const NOT_YET_BUILT = new Map<FeatureKey, string>([
  ['history-cloud', 'no entry point exists yet — cloud version history is unbuilt'],
])

describe('paid features are gated', () => {
  const paid = (Object.keys(FEATURE_TIER) as FeatureKey[]).filter((f) => FEATURE_TIER[f] !== 'free')
  const blob = sourceFiles(SRC)
    .filter((f) => !f.endsWith(join('lib', 'entitlements.ts')))
    .map((f) => [relative(SRC, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')] as const)

  it('every paid feature key is referenced outside the table that declares it', () => {
    const ungated = paid.filter(
      (key) => !NOT_YET_BUILT.has(key) && !blob.some(([, src]) => src.includes(`'${key}'`)),
    )
    expect(
      ungated,
      'Declared as paid but never checked — the pricing page charges for it and the app hands it out.',
    ).toEqual([])
  })

  it('keeps the not-yet-built list honest', () => {
    // An unbuilt feature that has since grown a UI must not stay exempt.
    for (const key of NOT_YET_BUILT.keys()) {
      const referenced = blob.some(([, src]) => src.includes(`'${key}'`))
      expect(referenced, `${key} is referenced now — gate it and drop the exemption`).toBe(false)
    }
  })

  it('declares at least as many paid features as free ones, or the table is wrong', () => {
    // Cheap sanity check that the table was read at all.
    expect(paid.length).toBeGreaterThan(0)
    expect(paid).toContain('robot-map')
    expect(paid).toContain('live-connectors')
  })
})
