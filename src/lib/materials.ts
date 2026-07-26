import type { Room } from '@/types'
import {
  MATERIALS,
  DEFAULT_FLOOR_MATERIAL_ID,
  DEFAULT_WALL_MATERIAL_ID,
  DEFAULT_CEILING_MATERIAL_ID,
  LEGACY_FLOOR_VARIANT_TO_ID,
  LEGACY_WALL_VARIANT_TO_ID,
  type Material,
  type SurfaceKind,
} from '@/data/materials'

/**
 * materials.ts (lib) — the pure access layer over the material catalog.
 *
 * Every renderer and UI surface resolves a room's material **through here**, so
 * the precedence rules (explicit id → legacy variant → default) live in exactly
 * one place. Dependency-light (no three/React).
 */

const BY_ID: ReadonlyMap<string, Material> = new Map(MATERIALS.map((m) => [m.id, m]))

export function getMaterial(id: string | undefined): Material | undefined {
  return id ? BY_ID.get(id) : undefined
}

/** All catalog materials applicable to a given surface (for pickers). */
export function materialsForSurface(surface: SurfaceKind): Material[] {
  return MATERIALS.filter((m) => m.surfaces.includes(surface))
}

/**
 * Resolve the effective floor material for a room. Precedence:
 *   1. explicit `floorMaterialId` (the modern field),
 *   2. legacy `floorVariant` mapped into the catalog (lossless back-compat),
 *   3. catalog default.
 * Always returns a valid Material — never throws, never null.
 */
export function resolveFloorMaterial(room: Pick<Room, 'floorMaterialId' | 'floorVariant'>): Material {
  const byId = getMaterial(room.floorMaterialId)
  if (byId) return byId
  const legacyId = room.floorVariant ? LEGACY_FLOOR_VARIANT_TO_ID[room.floorVariant] : undefined
  const byLegacy = getMaterial(legacyId)
  if (byLegacy) return byLegacy
  return BY_ID.get(DEFAULT_FLOOR_MATERIAL_ID)!
}

/** Resolve the effective wall material for a room (same precedence as floors). */
export function resolveWallMaterial(room: Pick<Room, 'wallMaterialId' | 'wallVariant'>): Material {
  const byId = getMaterial(room.wallMaterialId)
  if (byId) return byId
  const legacyId = room.wallVariant ? LEGACY_WALL_VARIANT_TO_ID[room.wallVariant] : undefined
  const byLegacy = getMaterial(legacyId)
  if (byLegacy) return byLegacy
  return BY_ID.get(DEFAULT_WALL_MATERIAL_ID)!
}

/** Resolve the effective ceiling material for a room (explicit id → default). */
export function resolveCeilingMaterial(room: Pick<Room, 'ceilingMaterialId'>): Material {
  return getMaterial(room.ceilingMaterialId) ?? BY_ID.get(DEFAULT_CEILING_MATERIAL_ID)!
}

const DEFAULT_BY_SURFACE: Record<SurfaceKind, string> = {
  floor: DEFAULT_FLOOR_MATERIAL_ID,
  wall: DEFAULT_WALL_MATERIAL_ID,
  ceiling: DEFAULT_CEILING_MATERIAL_ID,
}

/**
 * Resolve a bare material id for a given surface, falling back to that surface's
 * default. For scene-global selections (e.g. the 3D wall picker) where there is
 * no room to resolve against — keeps renderers consuming a resolver, never the
 * raw catalog.
 */
export function resolveSurfaceMaterialId(id: string | undefined, surface: SurfaceKind): Material {
  return getMaterial(id) ?? BY_ID.get(DEFAULT_BY_SURFACE[surface])!
}
