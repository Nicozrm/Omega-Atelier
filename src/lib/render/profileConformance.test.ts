import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Architecture conformance: `quality.ts` is the only place a render budget is
 * decided (ARCHITECTURE §7, rule 4).
 *
 * Every drift found so far followed the same shape — a number that *looks*
 * self-evidently right at the call site, written straight into the renderer,
 * quietly overriding a profile field that already had an answer. The shadow map
 * was 4096-or-2048, the light pool was 8/4/2, and anisotropy was a flat 16 on
 * the exterior world. None of them were wrong on the machine they were written
 * on; all of them were wrong on the other three profiles.
 *
 * The pattern is hard to catch in review precisely because each instance reads
 * as a sensible constant. So it is caught here instead: a literal sampling
 * budget anywhere under `src/` fails this test, and the fix is to read the
 * field from `activeProfile()`.
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
 * Deliberate exceptions, each with the reason it is not the same bug.
 *
 * Keep this list short and argued. "It was already like that" is not a reason.
 */
const ALLOWED = new Map<string, string>([
  [
    'features/imageBlaster/BlasterPreview.tsx',
    // A single generated asset on its own preview canvas, framed head-on. The
    // profile governs the plan scene, where anisotropy pays for large surfaces
    // seen at grazing angles; neither condition holds here.
    'standalone asset preview, not a grazing-angle surface in the plan scene',
  ],
])

describe('render budgets come from the profile', () => {
  it('has no hard-coded texture anisotropy outside quality.ts', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/')
      if (rel === 'lib/render/quality.ts' || ALLOWED.has(rel)) continue
      const src = readFileSync(file, 'utf8')
      // `x.anisotropy = 8` — a numeric literal, not a profile read.
      for (const m of src.matchAll(/\.anisotropy\s*=\s*(\d+(?:\.\d+)?)/g)) {
        // 0 is the material-lobe reset in `leanizeForPerf`, not a sampling
        // budget: it switches the anisotropic BRDF lobe off entirely.
        if (m[1] === '0') continue
        offenders.push(`${rel}: ${m[0]}`)
      }
    }
    expect(
      offenders,
      'Sampling budgets belong in RENDER_PROFILES. Read activeProfile().anisotropy instead.',
    ).toEqual([])
  })

  it('has no hard-coded shadow-map size outside quality.ts', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, '/')
      if (rel === 'lib/render/quality.ts') continue
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/shadow-mapSize-(?:width|height)=\{(\d+)\}/g)) {
        offenders.push(`${rel}: ${m[0]}`)
      }
    }
    expect(
      offenders,
      'Shadow-map size belongs in RENDER_PROFILES. Read activeProfile().shadowMapSize instead.',
    ).toEqual([])
  })

  it('keeps the allow-list honest', () => {
    // An exception that no longer exists is an exception nobody re-argued.
    for (const rel of ALLOWED.keys()) {
      const src = readFileSync(join(SRC, rel), 'utf8')
      expect(/\.anisotropy\s*=\s*\d/.test(src), `${rel} no longer needs its exemption`).toBe(true)
    }
  })
})
