/**
 * photoTextures.ts — the photographic PBR maps, finally connected.
 *
 * ## What was wrong
 *
 * `public/textures/` ships 32 CC0 PBR maps — parquet, laminate, slate, plaster,
 * concrete, oak, walnut, marble, leather, linen, carpet — roughly 7.8 MB, and
 * they are copied into `dist/` on every build. Nothing in the app ever loaded
 * one. Every surface in the house was drawn by the canvas generators in
 * `lib/textures`, which are good at pattern and structurally incapable of
 * grain: they paint rectangles and speckle, so a floor reads as a floor-coloured
 * plane rather than as wood.
 *
 * That is the "wenig Textur" — not missing assets, unconnected ones.
 *
 * ## How it connects
 *
 * As an *upgrade pass*, not a replacement. The canvas materials are built first
 * exactly as before, so the first frame is immediate and works with no files at
 * all; then the photographic maps load in the background and are swapped onto
 * the same material instances. Three consequences, all of them wanted:
 *
 *  - nothing regresses if a file is missing or a decode fails — the canvas
 *    texture simply stays,
 *  - offline-first is intact, because these are local files served from the
 *    same origin, precached with the rest of the app,
 *  - weak devices skip the whole pass, on the same profile flag that already
 *    decides whether roughness detail maps are affordable.
 *
 * Tiling is *inherited* from the canvas map it replaces rather than restated
 * here. Those repeats were tuned against the real mesh UVs; restating them
 * would be a second source of truth, and the first drift would be invisible.
 */

/** The maps a set can provide. Not every set ships all three. */
export type MapKind = 'diff' | 'nor' | 'rough'

export interface PhotoSet {
  /** Folder under `public/textures/`. */
  dir: string
  /** File stem, e.g. `parquet` → `parquet_diff.jpg`. */
  base: string
  /** Which maps actually exist on disk. */
  maps: readonly MapKind[]
}

const FULL = ['diff', 'nor', 'rough'] as const

/** Every PBR set shipped in `public/textures/`. */
export const PHOTO_SETS = {
  parquet: { dir: 'floor', base: 'parquet', maps: FULL },
  laminate: { dir: 'floor', base: 'laminate', maps: FULL },
  slate: { dir: 'floor', base: 'slate', maps: FULL },
  plaster: { dir: 'wall', base: 'plaster', maps: FULL },
  concrete: { dir: 'wall', base: 'concrete', maps: FULL },
  oak: { dir: 'wood', base: 'oak', maps: FULL },
  walnut: { dir: 'wood', base: 'walnut', maps: FULL },
  marble: { dir: 'stone', base: 'marble', maps: FULL },
  leather: { dir: 'leather', base: 'leather', maps: FULL },
  carpet: { dir: 'rug', base: 'carpet', maps: FULL },
  // Poly Haven's linen ships no roughness map; the material keeps its own
  // scalar roughness, which is correct for an even-weave fabric anyway.
  linen: { dir: 'fabric', base: 'linen', maps: ['diff', 'nor'] },
} as const satisfies Record<string, PhotoSet>

export type PhotoSetKey = keyof typeof PHOTO_SETS

export interface PhotoUpgrade {
  set: PhotoSetKey
  /**
   * Tiling to use when the material has no existing map to inherit from.
   * Materials that already carry a canvas map ignore this.
   */
  fallbackRepeat: [number, number]
  /**
   * Normal strength for the photographic map. The canvas normals were derived
   * from a hand-drawn height field and are generally softer than a scanned
   * one, so a few surfaces need dialling back to avoid looking embossed.
   */
  normalScale?: number
}

/**
 * Which material gets which set.
 *
 * Keys are `MatCache` fields. A material absent from this table keeps its
 * canvas texture — that is the default, not a gap.
 */
export const PHOTO_UPGRADES: Record<string, PhotoUpgrade> = {
  /* Floors — the largest continuous surfaces in any view, and the ones where
     canvas grain reads worst. */
  floorParquet: { set: 'parquet', fallbackRepeat: [3, 3], normalScale: 0.55 },
  floorWalnut: { set: 'walnut', fallbackRepeat: [4, 4], normalScale: 0.35 },
  floorVinylLight: { set: 'laminate', fallbackRepeat: [4, 4], normalScale: 0.3 },
  floorVinylDark: { set: 'laminate', fallbackRepeat: [4, 4], normalScale: 0.3 },
  floorSlate: { set: 'slate', fallbackRepeat: [4, 4], normalScale: 0.75 },

  /* Walls — second-largest, and plaster is the surface the eye uses to judge
     whether a room is lit correctly. */
  wallPlaster: { set: 'plaster', fallbackRepeat: [4, 2], normalScale: 0.45 },
  wallConcrete: { set: 'concrete', fallbackRepeat: [3, 2], normalScale: 0.6 },

  /* Furniture surfaces. */
  woodOak: { set: 'oak', fallbackRepeat: [2, 2], normalScale: 0.5 },
  woodWalnut: { set: 'walnut', fallbackRepeat: [2, 2], normalScale: 0.5 },
  woodDark: { set: 'walnut', fallbackRepeat: [2, 2], normalScale: 0.45 },
  deckWeathered: { set: 'oak', fallbackRepeat: [3, 3], normalScale: 0.8 },
  marble: { set: 'marble', fallbackRepeat: [2, 2], normalScale: 0.35 },
  leatherBlack: { set: 'leather', fallbackRepeat: [3, 3], normalScale: 0.7 },
  rug: { set: 'carpet', fallbackRepeat: [3, 3], normalScale: 0.9 },

  /* Upholstery and bedding all share one weave; the materials keep their own
     colour, so one linen scan serves beige, grey and blue. */
  fabric: { set: 'linen', fallbackRepeat: [4, 4], normalScale: 0.6 },
  fabricGray: { set: 'linen', fallbackRepeat: [4, 4], normalScale: 0.6 },
  fabricBlue: { set: 'linen', fallbackRepeat: [4, 4], normalScale: 0.6 },
  bedding: { set: 'linen', fallbackRepeat: [3, 3], normalScale: 0.7 },
  pillow: { set: 'linen', fallbackRepeat: [2, 2], normalScale: 0.7 },
}

/** Base-aware URL for one map (works under the GitHub Pages sub-path). */
export function photoTextureUrl(set: PhotoSet, kind: MapKind): string {
  return `${import.meta.env.BASE_URL}textures/${set.dir}/${set.base}_${kind}.jpg`
}

/** Does this set provide the given map? */
export function hasMap(set: PhotoSet, kind: MapKind): boolean {
  return set.maps.includes(kind)
}

/**
 * The distinct sets needed for a list of material keys.
 *
 * Deduplicated on purpose: eleven sets serve eighteen materials, and decoding
 * one linen scan three times would cost three times the memory for identical
 * pixels. Each set is decoded once and cloned per material, so a clone carries
 * its own tiling while sharing the image.
 */
export function requiredSets(materialKeys: readonly string[]): PhotoSetKey[] {
  const wanted = new Set<PhotoSetKey>()
  for (const key of materialKeys) {
    const upgrade = PHOTO_UPGRADES[key]
    if (upgrade) wanted.add(upgrade.set)
  }
  return [...wanted].sort()
}

/**
 * Should the upgrade run at all?
 *
 * Tied to the profile flag that already gates roughness detail maps: a device
 * that cannot afford an extra texture sample per fragment certainly cannot
 * afford eleven 1k PBR sets in GPU memory. `detailMaps` is the existing,
 * explicit vote on exactly that trade.
 */
export function shouldUpgrade(profile: { detailMaps: boolean }): boolean {
  return profile.detailMaps
}

/**
 * Photographic maps for the *generated* furniture.
 *
 * `tools/blender` authors those assets with a solid Principled BSDF per role
 * and no UVs at all — deliberately, because a 15 KB wardrobe that carries no
 * maps is the whole reason they are cheap enough to ship. The cost is that they
 * read as flat colour next to a photoscan, however good the silhouette is.
 *
 * They do not need their own textures to fix that. Every one of them names its
 * materials after a role from the shared palette (`oak`, `fabric_beige`,
 * `linen`, …), and this repo already ships and loads scanned PBR sets for those
 * exact roles. So the role name is the join: bind the same decoded texture that
 * the procedural room surfaces use, generate coordinates by box projection, and
 * the asset gains real grain for no extra download at all — the maps are shared
 * with the rest of the scene and decoded once.
 *
 * Keys are the material names inside the GLB. A role that is absent stays flat,
 * and that is a decision rather than a gap: painted steel, soft-touch black and
 * warm white have no grain to show, and giving them wood would be worse than
 * leaving them alone.
 */
export interface GeneratedUpgrade {
  set: PhotoSetKey
  /** World size of one texture repeat, metres. Keeps grain physically sized. */
  metresPerTile: number
  normalScale?: number
}

export const GENERATED_MATERIAL_UPGRADES: Record<string, GeneratedUpgrade> = {
  // Wood — the roles that carry most of the visible surface area.
  oak: { set: 'oak', metresPerTile: 1.1, normalScale: 0.5 },
  walnut: { set: 'walnut', metresPerTile: 1.1, normalScale: 0.5 },
  // Upholstery. One linen scan serves all three colourways: the material keeps
  // its own base colour and only gains the weave.
  fabric_beige: { set: 'linen', metresPerTile: 0.5, normalScale: 0.6 },
  fabric_gray: { set: 'linen', metresPerTile: 0.5, normalScale: 0.6 },
  fabric_blue: { set: 'linen', metresPerTile: 0.5, normalScale: 0.6 },
  linen: { set: 'linen', metresPerTile: 0.6, normalScale: 0.55 },
  leather_black: { set: 'leather', metresPerTile: 0.7, normalScale: 0.7 },
  // Stone.
  slate: { set: 'slate', metresPerTile: 0.9, normalScale: 0.7 },
}

/** The distinct sets the generated assets need. */
export function requiredGeneratedSets(materialNames: readonly string[]): PhotoSetKey[] {
  const wanted = new Set<PhotoSetKey>()
  for (const name of materialNames) {
    const upgrade = GENERATED_MATERIAL_UPGRADES[name]
    if (upgrade) wanted.add(upgrade.set)
  }
  return [...wanted].sort()
}
