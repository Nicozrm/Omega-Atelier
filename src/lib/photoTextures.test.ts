import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PHOTO_SETS, PHOTO_UPGRADES, hasMap, photoTextureUrl, requiredSets, shouldUpgrade,
  type MapKind, type PhotoSetKey,
  GENERATED_MATERIAL_UPGRADES, requiredGeneratedSets,
} from './photoTextures'

/**
 * `public/textures/` shipped 32 CC0 PBR maps that nothing in the app ever
 * loaded — 7.8 MB copied into every build and sampled by no material. These
 * tests hold the table against the files on disk, so the connection cannot rot
 * back into that state without failing loudly.
 */

const ROOT = resolve(__dirname, '..', '..')
const texturePath = (dir: string, file: string) => resolve(ROOT, 'public', 'textures', dir, file)
const KINDS: MapKind[] = ['diff', 'nor', 'rough']

describe('every declared map exists on disk', () => {
  const declared = Object.entries(PHOTO_SETS) as [PhotoSetKey, typeof PHOTO_SETS[PhotoSetKey]][]

  it.each(declared)('%s', (_key, set) => {
    for (const kind of set.maps) {
      expect(existsSync(texturePath(set.dir, `${set.base}_${kind}.jpg`))).toBe(true)
    }
  })

  it('does not claim a map a set has not got', () => {
    // Poly Haven's linen ships no roughness; claiming one would 404 on every
    // load and silently leave the canvas texture in place forever.
    expect(hasMap(PHOTO_SETS.linen, 'rough')).toBe(false)
    for (const set of Object.values(PHOTO_SETS)) {
      for (const kind of KINDS) {
        if (!hasMap(set, kind)) {
          expect(existsSync(texturePath(set.dir, `${set.base}_${kind}.jpg`))).toBe(false)
        }
      }
    }
  })

  it('leaves no shipped texture unconnected', () => {
    // The original defect, inverted: a file in the repo that no set references
    // is dead weight in the bundle.
    const referenced = new Set<string>()
    for (const set of Object.values(PHOTO_SETS)) {
      for (const kind of set.maps) referenced.add(`${set.dir}/${set.base}_${kind}.jpg`)
    }
    const onDisk: string[] = []
    for (const dir of readdirSync(resolve(ROOT, 'public', 'textures'), { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      // `outdoor/` is the Blender-baked library, which owns this same check in
      // `outdoorTextures.test.ts`. Each table is responsible for its own
      // directory; sweeping both from here would make either one's additions
      // fail the other's test.
      if (dir.name === 'outdoor') continue
      for (const file of readdirSync(resolve(ROOT, 'public', 'textures', dir.name))) {
        onDisk.push(`${dir.name}/${file}`)
      }
    }
    expect([...onDisk].sort()).toEqual([...referenced].sort())
  })
})

describe('the upgrade table', () => {
  it('points every entry at a real set', () => {
    for (const [key, upgrade] of Object.entries(PHOTO_UPGRADES)) {
      expect(PHOTO_SETS[upgrade.set], `${key} → ${upgrade.set}`).toBeDefined()
    }
  })

  it('covers the surfaces that dominate a view', () => {
    for (const key of ['floorParquet', 'floorWalnut', 'floorSlate', 'wallPlaster', 'wallConcrete']) {
      expect(PHOTO_UPGRADES[key], `${key} should be upgraded`).toBeDefined()
    }
  })

  it('gives every entry a usable fallback tiling', () => {
    for (const [key, upgrade] of Object.entries(PHOTO_UPGRADES)) {
      const [x, y] = upgrade.fallbackRepeat
      expect(x, key).toBeGreaterThan(0)
      expect(y, key).toBeGreaterThan(0)
    }
  })

  it('keeps normal strength in a sane range', () => {
    for (const [key, upgrade] of Object.entries(PHOTO_UPGRADES)) {
      if (upgrade.normalScale === undefined) continue
      // A scanned normal at full strength reads as embossed plastic.
      expect(upgrade.normalScale, key).toBeGreaterThan(0)
      expect(upgrade.normalScale, key).toBeLessThanOrEqual(1)
    }
  })
})

describe('requiredSets — one decode per set, not one per material', () => {
  it('deduplicates the three upholstery materials onto one linen scan', () => {
    expect(requiredSets(['fabric', 'fabricGray', 'fabricBlue'])).toEqual(['linen'])
  })

  it('ignores materials with no upgrade', () => {
    expect(requiredSets(['glass', 'brass', 'chrome'])).toEqual([])
  })

  it('collects the distinct sets for a mixed list', () => {
    expect(requiredSets(['floorParquet', 'wallPlaster', 'fabric', 'bedding']).sort())
      .toEqual(['linen', 'parquet', 'plaster'])
  })

  it('needs far fewer decodes than there are materials', () => {
    const keys = Object.keys(PHOTO_UPGRADES)
    expect(requiredSets(keys).length).toBeLessThan(keys.length)
  })
})

describe('shouldUpgrade — weak devices skip the whole pass', () => {
  it('follows the profile flag that already gates detail maps', () => {
    expect(shouldUpgrade({ detailMaps: true })).toBe(true)
    expect(shouldUpgrade({ detailMaps: false })).toBe(false)
  })
})

describe('photoTextureUrl', () => {
  it('builds a base-aware path', () => {
    const url = photoTextureUrl(PHOTO_SETS.parquet, 'diff')
    expect(url).toContain('textures/floor/parquet_diff.jpg')
  })
})

describe('GENERATED_MATERIAL_UPGRADES — textures for the Blender-built furniture', () => {
  it('names only sets that actually ship', () => {
    for (const [role, upgrade] of Object.entries(GENERATED_MATERIAL_UPGRADES)) {
      expect(PHOTO_SETS[upgrade.set], `${role} points at a set that does not exist`).toBeDefined()
    }
  })

  it('keeps every tile a plausible physical size', () => {
    for (const [role, upgrade] of Object.entries(GENERATED_MATERIAL_UPGRADES)) {
      // Under 10 cm would alias into noise on a wardrobe door; over 3 m would
      // show barely one repeat across the whole piece.
      expect(upgrade.metresPerTile, `${role}`).toBeGreaterThan(0.1)
      expect(upgrade.metresPerTile, `${role}`).toBeLessThan(3)
    }
  })

  it('leaves grainless roles alone rather than inventing texture for them', () => {
    // These are the palette's painted, plated and glazed finishes. Giving a
    // soft-touch black console a wood grain would be worse than flat colour.
    for (const role of ['steel', 'soft_black', 'warm_white', 'ceramic', 'glass_dark']) {
      expect(GENERATED_MATERIAL_UPGRADES[role]).toBeUndefined()
    }
  })

  it('shares one weave across the upholstery colourways', () => {
    // The materials keep their own base colour and gain only the weave, so
    // three colourways must not cost three decodes.
    const sets = requiredGeneratedSets(['fabric_beige', 'fabric_gray', 'fabric_blue'])
    expect(sets).toEqual(['linen'])
  })

  it('deduplicates the sets a whole model list needs', () => {
    const sets = requiredGeneratedSets(['oak', 'oak', 'walnut', 'steel', 'fabric_beige'])
    expect(sets).toEqual(['linen', 'oak', 'walnut'])
  })

  it('asks for nothing when no role has a set', () => {
    expect(requiredGeneratedSets(['steel', 'soft_black'])).toEqual([])
    expect(requiredGeneratedSets([])).toEqual([])
  })
})
