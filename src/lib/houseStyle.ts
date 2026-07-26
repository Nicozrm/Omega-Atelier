/**
 * houseStyle.ts — the **Bau-Studio** domain (renderer-neutral).
 *
 * Everything the own-house shell can be built as — construction (Bauart), stone
 * or render colour (Steinfarbe), roof shape (Dachform) and roof colour — as pure
 * data + material hints. No THREE, no React: the 3D view reads the hints and the
 * option catalogs, and every choice is testable on its own. Tints multiply the
 * existing procedural textures, so each combination keeps the archviz material
 * response instead of turning flat.
 */

export type FacadeKind = 'klinker' | 'plaster' | 'stone' | 'board'
export type RoofKind = 'gable' | 'hip' | 'flat'

export interface HouseStyle {
  facade: FacadeKind
  /** Stone / render tint — multiplies the facade albedo. */
  facadeTint: string
  roof: RoofKind
  /** Roof tint — multiplies the tile albedo. */
  roofTint: string
}

export interface Option { id: string; label: string; swatch: string }

/** Bauart — the facade construction. */
export const FACADE_KINDS: { id: FacadeKind; label: string; swatch: string }[] = [
  { id: 'klinker', label: 'Klinker', swatch: '#a95c44' },
  { id: 'plaster', label: 'Putz', swatch: '#e9e4da' },
  { id: 'stone', label: 'Naturstein', swatch: '#8d8478' },
  { id: 'board', label: 'Holz', swatch: '#9c6b3f' },
]

/** Steinfarbe — the stone/render tint (multiplies the facade albedo). */
export const STONE_COLORS: Option[] = [
  { id: 'natur', label: 'Natur', swatch: '#ffffff' },
  { id: 'sand', label: 'Sand', swatch: '#e6cdaa' },
  { id: 'greige', label: 'Greige', swatch: '#cabfae' },
  { id: 'terracotta', label: 'Terracotta', swatch: '#c98a6a' },
  { id: 'anthrazit', label: 'Anthrazit', swatch: '#8f9096' },
  { id: 'graphit', label: 'Graphit', swatch: '#63656c' },
]

/** Dachform. */
export const ROOF_KINDS: { id: RoofKind; label: string; swatch: string }[] = [
  { id: 'gable', label: 'Satteldach', swatch: '#5b4a42' },
  { id: 'hip', label: 'Walmdach', swatch: '#4a4038' },
  { id: 'flat', label: 'Flachdach', swatch: '#3d3f43' },
]

/** Dachfarbe (multiplies the tile albedo). */
export const ROOF_COLORS: Option[] = [
  { id: 'anthrazit', label: 'Anthrazit', swatch: '#8b9099' },
  { id: 'ziegelrot', label: 'Ziegelrot', swatch: '#c67b56' },
  { id: 'braun', label: 'Braun', swatch: '#9a7256' },
  { id: 'schiefer', label: 'Schiefer', swatch: '#7f8790' },
  { id: 'schwarz', label: 'Schwarz', swatch: '#5f6167' },
]

export const DEFAULT_HOUSE_STYLE: HouseStyle = {
  facade: 'klinker', facadeTint: '#ffffff', roof: 'gable', roofTint: '#8b9099',
}

/** Material hints for a facade construction — consumed by the renderer. */
export interface FacadeHints {
  /** Carry the brick/stone bump+albedo map, or render as a smooth face. */
  textured: boolean
  /** Which procedural texture to sample: brick klinker vs. board/plank. */
  map: 'brick' | 'board' | 'none'
  roughness: number
  metalness: number
  /** Extra bump strength on top of the map default. */
  bumpScale: number
}

export function facadeHints(kind: FacadeKind): FacadeHints {
  switch (kind) {
    case 'klinker': return { textured: true, map: 'brick', roughness: 0.86, metalness: 0, bumpScale: 0.014 }
    case 'stone': return { textured: true, map: 'brick', roughness: 0.95, metalness: 0, bumpScale: 0.02 }
    case 'board': return { textured: true, map: 'board', roughness: 0.7, metalness: 0, bumpScale: 0.01 }
    case 'plaster':
    default: return { textured: false, map: 'none', roughness: 0.92, metalness: 0, bumpScale: 0 }
  }
}

/** Roof-shape hints — the geometry family + a pitch factor (rise / half-span). */
export function roofHints(kind: RoofKind): { pitch: number; hasRidge: boolean; flat: boolean } {
  switch (kind) {
    case 'flat': return { pitch: 0, hasRidge: false, flat: true }
    case 'hip': return { pitch: 0.6, hasRidge: true, flat: false }
    case 'gable':
    default: return { pitch: 0.62, hasRidge: true, flat: false }
  }
}

const KEY = 'omega.houseStyle.v2'

/** Coerce an unknown/partial value into a complete, valid HouseStyle. */
export function resolveHouseStyle(v: unknown): HouseStyle {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<HouseStyle>
  const facade = FACADE_KINDS.some((f) => f.id === s.facade) ? s.facade! : DEFAULT_HOUSE_STYLE.facade
  const roof = ROOF_KINDS.some((r) => r.id === s.roof) ? s.roof! : DEFAULT_HOUSE_STYLE.roof
  const hex = /^#[0-9a-fA-F]{6}$/
  return {
    facade,
    roof,
    facadeTint: typeof s.facadeTint === 'string' && hex.test(s.facadeTint) ? s.facadeTint : DEFAULT_HOUSE_STYLE.facadeTint,
    roofTint: typeof s.roofTint === 'string' && hex.test(s.roofTint) ? s.roofTint : DEFAULT_HOUSE_STYLE.roofTint,
  }
}

export function loadHouseStyle(): HouseStyle {
  try { return resolveHouseStyle(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return DEFAULT_HOUSE_STYLE }
}
export function saveHouseStyle(s: HouseStyle): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode */ }
}
