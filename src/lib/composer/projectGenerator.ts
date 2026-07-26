/**
 * projectGenerator.ts — the ProjectGenerator.
 *
 * Wraps a {@link OmegaSceneDraft} into a fully-formed, editable
 * {@link PlanDocument}: it materialises ids, layer flags, modes and settings,
 * so the generated twin drops straight into the existing editor and every
 * element (walls, rooms, furniture, devices, labels) stays editable exactly like
 * a hand-drawn plan. The result passes through the same shape the store expects;
 * nothing about the existing plan model is changed.
 */

import type {
  Floor,
  Label,
  PlacedDevice,
  PlacedFurniture,
  PlanDocument,
  Room,
  Wall,
} from '@/types'
import { uuid } from '@/lib/utils'
import { OMEGA_MODES } from '@/lib/constants'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import type { DetectedScene } from './types'
import { buildScene, type DraftFloor, type OmegaSceneDraft } from './sceneBuilder'

const DEVICE_IDS = new Set(DEVICES.map((d) => d.id))
const FURNITURE_IDS = new Set(FURNITURE.map((f) => f.id))

function draftFloorToFloor(df: DraftFloor): Floor {
  const walls: Wall[] = df.walls.map((w) => {
    const wall: Wall = { id: uuid(), a: w.a, b: w.b, thickness: w.thickness }
    if (w.subtype && w.subtype !== 'wall') {
      wall.subtype = w.subtype
      wall.openingWidth = w.openingWidth
      if (w.openingHeight !== undefined) wall.openingHeight = w.openingHeight
      if (w.openingSill !== undefined) wall.openingSill = w.openingSill
    }
    return wall
  })

  const rooms: Room[] = df.rooms.map((r) => ({
    id: uuid(),
    name: r.name,
    polygon: r.polygon,
    ...(r.zoneType ? { zoneType: r.zoneType } : {}),
    ...(r.floorMaterialId ? { floorMaterialId: r.floorMaterialId } : {}),
  }))

  // Only emit catalog-known ids so every item renders. Unknown ids are dropped
  // rather than shipped as invisible ghosts.
  const furniture: PlacedFurniture[] = df.furniture
    .filter((f) => FURNITURE_IDS.has(f.furnitureId))
    .map((f) => ({
      id: uuid(),
      furnitureId: f.furnitureId,
      position: { x: f.x, y: f.y },
      rotation: f.rotation ?? 0,
      size: f.size,
      ...(f.label ? { label: f.label } : {}),
    }))

  const devices: PlacedDevice[] = df.devices
    .filter((d) => DEVICE_IDS.has(d.deviceId))
    .map((d) => ({
      id: uuid(),
      deviceId: d.deviceId,
      position: { x: d.x, y: d.y },
      rotation: d.rotation ?? 0,
      ...(d.note ? { note: d.note } : {}),
    }))

  const labels: Label[] = df.labels.map((l) => ({
    id: uuid(),
    position: { x: l.x, y: l.y },
    text: l.text,
    ...(l.size ? { size: l.size } : {}),
  }))

  return {
    id: uuid(),
    name: df.name,
    index: df.index,
    walls,
    rooms,
    devices,
    furniture,
    labels,
    layers: { walls: true, furniture: true, devices: true, labels: true },
    extent: df.extent,
  }
}

/** Build a PlanDocument from an already-built scene draft. */
export function draftToProject(draft: OmegaSceneDraft, title?: string): PlanDocument {
  const floors = draft.floors.map(draftFloorToFloor)
  const now = new Date().toISOString()
  return {
    schemaVersion: 2,
    id: uuid(),
    title: title ?? draft.title,
    description: draft.description,
    floors,
    activeFloorId: floors[0].id,
    activeModeKey: 'auto',
    modes: OMEGA_MODES,
    settings: { unit: 'cm', gridSize: 50, snap: true, snapStep: 10, showGrid: true, magnet: true, theme: 'dark' },
    tags: draft.tags,
    createdAt: now,
    updatedAt: now,
  }
}

/** Convenience: detected scene → editable PlanDocument in one call. */
export function generateProject(scene: DetectedScene, title?: string): PlanDocument {
  const doc = draftToProject(buildScene(scene), title)
  // The plan remembers where it was captured — the real-world anchor for
  // satellite ground, location-true sun studies and future geo features.
  doc.geo = { lat: scene.origin.lat, lng: scene.origin.lng }
  return doc
}

export const ProjectGenerator = {
  id: 'project-generator',
  fromScene: generateProject,
  fromDraft: draftToProject,
}
