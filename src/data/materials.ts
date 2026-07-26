/**
 * materials.ts — the single, renderer-neutral material catalog.
 *
 * This is the source of truth for *which* surface materials exist and *what
 * they physically are*, expressed in renderer-agnostic descriptors so that
 * every consumer reads from the same place:
 *   - the 2D canvas       → `color` + `pattern`
 *   - the 3D view         → `color` + `roughness` + `metalness` (+ a texture
 *                           bridge for legacy entries, owned by the 3D adapter)
 *   - the inspector picker→ `color` (swatch) + `name`
 *   - future connectors / texture packs → extend the descriptor, not the renderers
 *
 * Deliberately dependency-free (no three, no React) so it can live in the main
 * bundle and be imported anywhere — including the persistence layer.
 *
 * Design rule (per platform vision): surfaces reference materials **by id**.
 * Rooms never embed visual properties directly; they point at a catalog entry.
 * Swapping or enriching a material (e.g. adding a PBR texture, or mapping it to
 * a real-world product via a connector) happens in one place.
 */

export type MaterialCategory =
  | 'wood'
  | 'vinyl'
  | 'stone'
  | 'tile'
  | 'carpet'
  | 'concrete'
  | 'plaster'
  | 'wallpaper'

export type SurfaceKind = 'floor' | 'wall' | 'ceiling'

/**
 * Renderer-neutral surface pattern hint. Each renderer interprets it in its own
 * idiom (the 2D canvas draws plank/tile/weave/speckle lines; the 3D view can
 * later map it to a tiling texture). 'smooth' means no visible structure.
 */
export type MaterialPattern = 'planks' | 'tiles' | 'speckle' | 'weave' | 'smooth'

export interface Material {
  /** Stable id; written into Room.floorMaterialId / Room.wallMaterialId. */
  id: string
  /** Display name (de). */
  name: string
  category: MaterialCategory
  /** Which surfaces this material may be applied to. */
  surfaces: SurfaceKind[]
  /** Base colour (hex) — the shared visual anchor for every renderer. */
  color: string
  /** Microsurface roughness 0 (mirror) … 1 (fully matte). */
  roughness: number
  /** Metalness 0 (dielectric) … 1 (metal). */
  metalness: number
  /** Renderer-neutral surface structure hint. */
  pattern: MaterialPattern
}

export const MATERIALS: Material[] = [
  // ─── Floors ────────────────────────────────────────────────
  { id: 'floor-oak-parquet',     name: 'Eichenparkett',      category: 'wood',     surfaces: ['floor'], color: '#b5854f', roughness: 0.70, metalness: 0.05, pattern: 'planks' },
  { id: 'floor-walnut-parquet',  name: 'Nussbaumparkett',    category: 'wood',     surfaces: ['floor'], color: '#6f4a2d', roughness: 0.68, metalness: 0.05, pattern: 'planks' },
  { id: 'floor-vinyl-light',     name: 'Vinyl Hell',         category: 'vinyl',    surfaces: ['floor'], color: '#d8cdb8', roughness: 0.45, metalness: 0.04, pattern: 'planks' },
  { id: 'floor-vinyl-dark',      name: 'Vinyl Dunkel',       category: 'vinyl',    surfaces: ['floor'], color: '#4d453d', roughness: 0.45, metalness: 0.04, pattern: 'planks' },
  { id: 'floor-slate',           name: 'Schiefer',           category: 'stone',    surfaces: ['floor'], color: '#3c4650', roughness: 0.55, metalness: 0.10, pattern: 'tiles'  },
  { id: 'floor-ceramic-light',   name: 'Feinsteinzeug Hell', category: 'tile',     surfaces: ['floor'], color: '#d9d6cf', roughness: 0.30, metalness: 0.04, pattern: 'tiles'  },
  { id: 'floor-carpet-warm',     name: 'Teppich Warm',       category: 'carpet',   surfaces: ['floor'], color: '#b8a98e', roughness: 0.96, metalness: 0.00, pattern: 'weave'  },
  { id: 'floor-concrete',        name: 'Sichtestrich',       category: 'concrete', surfaces: ['floor'], color: '#b3b0a9', roughness: 0.40, metalness: 0.05, pattern: 'speckle'},

  // ─── Walls ─────────────────────────────────────────────────
  { id: 'wall-plaster',          name: 'Putz',               category: 'plaster',  surfaces: ['wall'],  color: '#f3ede0', roughness: 0.92, metalness: 0.00, pattern: 'smooth' },
  { id: 'wall-concrete',         name: 'Sichtbeton',         category: 'concrete', surfaces: ['wall'],  color: '#c9c5be', roughness: 0.85, metalness: 0.04, pattern: 'speckle'},
  { id: 'wall-wallpaper',        name: 'Tapete',             category: 'wallpaper',surfaces: ['wall'],  color: '#ece4d2', roughness: 0.88, metalness: 0.00, pattern: 'smooth' },

  // ─── Ceilings ──────────────────────────────────────────────
  { id: 'ceiling-white',         name: 'Decke Weiß',         category: 'plaster',  surfaces: ['ceiling'], color: '#f7f4ee', roughness: 0.95, metalness: 0.00, pattern: 'smooth' },
  { id: 'ceiling-plaster',       name: 'Decke Putz',         category: 'plaster',  surfaces: ['ceiling'], color: '#efe9dc', roughness: 0.93, metalness: 0.00, pattern: 'smooth' },
]

export const DEFAULT_FLOOR_MATERIAL_ID = 'floor-oak-parquet'
export const DEFAULT_WALL_MATERIAL_ID = 'wall-plaster'
export const DEFAULT_CEILING_MATERIAL_ID = 'ceiling-white'

/**
 * Migration bridges from the pre-catalog hardcoded variants (Room.floorVariant /
 * Room.wallVariant) to catalog ids. Used by the resolver so legacy plans render
 * losslessly without a data migration.
 */
export const LEGACY_FLOOR_VARIANT_TO_ID: Record<string, string> = {
  parquet: 'floor-oak-parquet',
  vinylLight: 'floor-vinyl-light',
  vinylDark: 'floor-vinyl-dark',
  slate: 'floor-slate',
}

export const LEGACY_WALL_VARIANT_TO_ID: Record<string, string> = {
  plaster: 'wall-plaster',
  concrete: 'wall-concrete',
  wallpaper: 'wall-wallpaper',
}
