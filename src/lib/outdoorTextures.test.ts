import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GENERATOR_SETS, OUTDOOR_SETS, hasOutdoorMap, outdoorConstant, outdoorSetNames,
  outdoorTextureUrl, shouldUseBakedOutdoor, type OutdoorMap, type OutdoorSetKey,
} from './outdoorTextures'

/**
 * The baked outdoor library has three neighbours it can silently disagree with:
 * the files in `public/textures/outdoor`, the bake's manifest, and the canvas
 * generators it substitutes for. Each disagreement fails quietly — a 404 that
 * leaves the canvas drawing in place forever, a map claimed but never written,
 * a set nothing ever asks for.
 */

const ROOT = resolve(__dirname, '..', '..')
const OUT = resolve(ROOT, 'public', 'textures', 'outdoor')
const mapPath = (name: string, kind: string) => resolve(OUT, `${name}_${kind}.jpg`)
const KINDS: OutdoorMap[] = ['diff', 'nor', 'rough', 'bump']

interface BakeRecord {
  size: number
  maps: OutdoorMap[]
  bytes: Record<string, number>
  constants: Record<string, number>
  seam: Record<string, number>
  total: number
}
const manifest: Record<string, BakeRecord> = JSON.parse(
  readFileSync(resolve(ROOT, 'tools', 'blender', 'textures.json'), 'utf8'),
).surfaces

/** The baker's own limit; a wrap step worse than this is a visible seam. */
const SEAM_LIMIT = 1.5

describe('every declared map exists, and every written map is declared', () => {
  const names = outdoorSetNames()

  it.each(names)('%s declares exactly what was baked', (name) => {
    expect([...OUTDOOR_SETS[name].maps].sort()).toEqual([...manifest[name].maps].sort())
  })

  it.each(names)('%s resolves to real files', (name) => {
    for (const kind of KINDS) {
      expect(existsSync(mapPath(name, kind)), `${name}_${kind}`).toBe(hasOutdoorMap(name, kind))
    }
  })

  it('leaves no baked file unreferenced', () => {
    const referenced = new Set<string>()
    for (const name of names) {
      for (const kind of OUTDOOR_SETS[name].maps) referenced.add(`${name}_${kind}.jpg`)
    }
    expect(readdirSync(OUT).sort()).toEqual([...referenced].sort())
  })

  it('records the constant for every map it chose not to write', () => {
    for (const name of names) {
      for (const kind of KINDS) {
        if (hasOutdoorMap(name, kind)) continue
        // A map that is neither written nor constant would be a silent hole.
        expect(outdoorConstant(name, kind), `${name}_${kind}`).toBeTypeOf('number')
      }
    }
  })
})

describe('the bake is verified, not merely produced', () => {
  it('every surface tiles', () => {
    for (const [name, record] of Object.entries(manifest)) {
      for (const [kind, ratio] of Object.entries(record.seam)) {
        // Running bond needs an even row count or the stagger breaks where the
        // texture wraps; that defect scored 5.03 here before it was fixed.
        expect(ratio, `${name}_${kind} seam`).toBeLessThanOrEqual(SEAM_LIMIT)
      }
    }
  })

  it('keeps every surface inside the web budget', () => {
    for (const [name, record] of Object.entries(manifest)) {
      expect(record.size).toBeLessThanOrEqual(1024)
      expect(record.total, `${name} is oversized`).toBeLessThan(260 * 1024)
      for (const [kind, bytes] of Object.entries(record.bytes)) {
        expect(statSync(mapPath(name, kind)).size).toBe(bytes)
      }
    }
  })

  it('ships no constant map as an image', () => {
    // A 512² JPEG of one number costs bandwidth and a texture unit to say what
    // a scalar already says.
    for (const [name, record] of Object.entries(manifest)) {
      for (const kind of Object.keys(record.constants)) {
        expect(existsSync(mapPath(name, kind)), `${name}_${kind}`).toBe(false)
      }
    }
  })
})

describe('the substitution table', () => {
  it('points every canvas generator at a real baked set', () => {
    for (const [generator, set] of Object.entries(GENERATOR_SETS)) {
      expect(OUTDOOR_SETS[set], `${generator} → ${set}`).toBeDefined()
    }
  })

  it('covers the surfaces that fill the frame outdoors', () => {
    for (const generator of ['brickTextures', 'roofTextures', 'grassTexture', 'asphaltSurface']) {
      expect(GENERATOR_SETS[generator], generator).toBeDefined()
    }
  })

  it('builds base-aware URLs', () => {
    expect(outdoorTextureUrl('klinker' as OutdoorSetKey, 'diff'))
      .toContain('textures/outdoor/klinker_diff.jpg')
  })
})

describe('shouldUseBakedOutdoor — weak devices keep the canvas library', () => {
  it('follows the same profile flag as the other detail maps', () => {
    expect(shouldUseBakedOutdoor({ detailMaps: true })).toBe(true)
    expect(shouldUseBakedOutdoor({ detailMaps: false })).toBe(false)
  })
})
