/**
 * planSchema.ts — versioned migration + structural validation for PlanDocuments.
 *
 * Plans enter the app from three untrusted boundaries: localStorage, the cloud
 * row (`PlanRow.doc`), and realtime broadcast payloads. Previously the local
 * loader did `schemaVersion !== 2 → return null` (silently discarding the
 * user's work, no migration, no validation) and the cloud/realtime paths did
 * **no** checking at all — a malformed document flowed straight into the store
 * and could white-screen the editor (inconsistent state) or lose data.
 *
 * `coercePlan` is the single hardened gate every boundary uses. It:
 *   1. rejects non-objects,
 *   2. migrates older schema versions forward through a registered chain,
 *   3. structurally validates and *repairs* recoverable documents (missing
 *      arrays → [], missing settings fields → defaults, dangling
 *      `activeFloorId`/`activeModeKey` → sane fallbacks),
 *   4. returns a clean `PlanDocument`, or `null` only when the document is
 *      genuinely unsalvageable (e.g. no valid floor at all).
 *
 * Dependency-light by design (no three.js) so it can sit on every load path.
 */

import type {
  PlanDocument,
  PlanSettings,
  Floor,
  Wall,
  Room,
  PlacedDevice,
  PlacedFurniture,
  Label,
  ModeKey,
  LayerKey,
  Point,
} from '@/types'
import { OMEGA_MODES } from '@/lib/constants'
import { uuid } from '@/lib/utils'

export const CURRENT_SCHEMA_VERSION = 2

/* ─────────────────────────── type guards ─────────────────────────── */

type AnyObj = Record<string, unknown>

const isObj = (v: unknown): v is AnyObj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isArr = Array.isArray
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isPoint = (v: unknown): v is Point => isObj(v) && isNum(v.x) && isNum(v.y)

/* ─────────────────────────── defaults ─────────────────────────── */

const DEFAULT_SETTINGS: PlanSettings = {
  unit: 'cm',
  gridSize: 50,
  snap: true,
  snapStep: 10,
  showGrid: true,
  magnet: true,
  theme: 'dark',
}

const DEFAULT_EXTENT = { width: 1000, height: 800 }

const VALID_MODE_KEYS = new Set<ModeKey>(OMEGA_MODES.map((m) => m.key))
const LAYER_KEYS: LayerKey[] = ['walls', 'furniture', 'devices', 'labels']

/* ─────────────────────────── migrations ─────────────────────────── */

/**
 * Forward migrations keyed by the version they upgrade *from*. Each is pure.
 * To add a v2→v3 migration later, register `2: (d) => …` here — `coercePlan`
 * applies them in sequence up to `CURRENT_SCHEMA_VERSION`.
 */
const MIGRATIONS: Record<number, (d: AnyObj) => AnyObj> = {
  // 1 → 2: v1 predates several optional fields (wall subtypes, room zones,
  // per-room material variants). Those are all additive/optional, so the
  // structural repair below produces a valid v2 shape; this step just bumps
  // the marker and is the hook for any field renames a real v1 would need.
  1: (d) => ({ ...d, schemaVersion: 2 }),
}

function detectVersion(d: AnyObj): number {
  const v = d.schemaVersion
  return isNum(v) && v >= 1 ? Math.floor(v) : 1 // missing/garbage → treat as oldest
}

/* ─────────────────────────── repair helpers ─────────────────────────── */

function repairLayers(raw: unknown): Record<LayerKey, boolean> {
  const src = isObj(raw) ? raw : {}
  const out = {} as Record<LayerKey, boolean>
  for (const k of LAYER_KEYS) out[k] = isBool(src[k]) ? src[k] : true
  return out
}

function repairExtent(raw: unknown): { width: number; height: number } {
  if (isObj(raw) && isNum(raw.width) && isNum(raw.height) && raw.width > 0 && raw.height > 0) {
    return { width: raw.width, height: raw.height }
  }
  return { ...DEFAULT_EXTENT }
}

/** Keep only structurally-valid walls (must have two points + numeric thickness). */
function repairWalls(raw: unknown): Wall[] {
  if (!isArr(raw)) return []
  const out: Wall[] = []
  for (const w of raw) {
    if (isObj(w) && isPoint(w.a) && isPoint(w.b)) {
      out.push({
        ...(w as object),
        id: isStr(w.id) ? w.id : uuid(),
        a: { x: w.a.x, y: w.a.y },
        b: { x: w.b.x, y: w.b.y },
        thickness: isNum(w.thickness) ? w.thickness : 14,
      } as Wall)
    }
  }
  return out
}

function repairRooms(raw: unknown): Room[] {
  if (!isArr(raw)) return []
  const out: Room[] = []
  for (const r of raw) {
    if (isObj(r) && isArr(r.polygon) && r.polygon.every(isPoint) && r.polygon.length >= 3) {
      out.push({
        ...(r as object),
        id: isStr(r.id) ? r.id : uuid(),
        name: isStr(r.name) ? r.name : 'Raum',
        polygon: r.polygon as Point[],
      } as Room)
    }
  }
  return out
}

function repairDevices(raw: unknown): PlacedDevice[] {
  if (!isArr(raw)) return []
  const out: PlacedDevice[] = []
  for (const d of raw) {
    if (isObj(d) && isStr(d.deviceId) && isPoint(d.position)) {
      out.push({
        ...(d as object),
        id: isStr(d.id) ? d.id : uuid(),
        deviceId: d.deviceId,
        position: { x: d.position.x, y: d.position.y },
      } as PlacedDevice)
    }
  }
  return out
}

function repairFurniture(raw: unknown): PlacedFurniture[] {
  if (!isArr(raw)) return []
  const out: PlacedFurniture[] = []
  for (const f of raw) {
    if (isObj(f) && isStr(f.furnitureId) && isPoint(f.position)) {
      out.push({
        ...(f as object),
        id: isStr(f.id) ? f.id : uuid(),
        furnitureId: f.furnitureId,
        position: { x: f.position.x, y: f.position.y },
      } as PlacedFurniture)
    }
  }
  return out
}

function repairLabels(raw: unknown): Label[] {
  if (!isArr(raw)) return []
  const out: Label[] = []
  for (const l of raw) {
    if (isObj(l) && isPoint(l.position) && isStr(l.text)) {
      out.push({
        ...(l as object),
        id: isStr(l.id) ? l.id : uuid(),
        position: { x: l.position.x, y: l.position.y },
        text: l.text,
      } as Label)
    }
  }
  return out
}

/** Repair one floor. Returns null if it has no usable identity at all. */
function repairFloor(raw: unknown, index: number): Floor | null {
  if (!isObj(raw)) return null
  return {
    id: isStr(raw.id) ? raw.id : uuid(),
    name: isStr(raw.name) ? raw.name : `Etage ${index}`,
    index: isNum(raw.index) ? raw.index : index,
    walls: repairWalls(raw.walls),
    rooms: repairRooms(raw.rooms),
    devices: repairDevices(raw.devices),
    furniture: repairFurniture(raw.furniture),
    labels: repairLabels(raw.labels),
    layers: repairLayers(raw.layers),
    extent: repairExtent(raw.extent),
  }
}

function repairSettings(raw: unknown): PlanSettings {
  const s = isObj(raw) ? raw : {}
  return {
    unit: s.unit === 'm' || s.unit === 'cm' ? s.unit : DEFAULT_SETTINGS.unit,
    gridSize: isNum(s.gridSize) && s.gridSize > 0 ? s.gridSize : DEFAULT_SETTINGS.gridSize,
    snap: isBool(s.snap) ? s.snap : DEFAULT_SETTINGS.snap,
    snapStep: isNum(s.snapStep) && s.snapStep > 0 ? s.snapStep : DEFAULT_SETTINGS.snapStep,
    showGrid: isBool(s.showGrid) ? s.showGrid : DEFAULT_SETTINGS.showGrid,
    magnet: isBool(s.magnet) ? s.magnet : DEFAULT_SETTINGS.magnet,
    theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : DEFAULT_SETTINGS.theme,
  }
}

/* ─────────────────────────── main gate ─────────────────────────── */

/**
 * Validate, migrate and repair an untrusted value into a `PlanDocument`.
 * Returns `null` if the value cannot represent a usable plan.
 */
export function coercePlan(raw: unknown): PlanDocument | null {
  if (!isObj(raw)) return null

  // 1. migrate forward through the registered chain
  let obj: AnyObj = raw
  let version = detectVersion(obj)
  while (version < CURRENT_SCHEMA_VERSION && MIGRATIONS[version]) {
    obj = MIGRATIONS[version](obj)
    version += 1
  }

  // 2. floors are the irreducible core — without at least one, bail out
  const rawFloors = isArr(obj.floors) ? obj.floors : []
  const floors = rawFloors
    .map((f, i) => repairFloor(f, i))
    .filter((f): f is Floor => f !== null)
  if (floors.length === 0) return null

  // 3. activeFloorId must point at a real floor
  const activeFloorId =
    isStr(obj.activeFloorId) && floors.some((f) => f.id === obj.activeFloorId)
      ? obj.activeFloorId
      : floors[0].id

  // 4. activeModeKey must be a known mode
  const activeModeKey: ModeKey =
    isStr(obj.activeModeKey) && VALID_MODE_KEYS.has(obj.activeModeKey as ModeKey)
      ? (obj.activeModeKey as ModeKey)
      : 'auto'

  // 5. modes: keep a provided non-empty array, else fall back to canonical
  const modes = isArr(obj.modes) && obj.modes.length > 0 ? obj.modes : OMEGA_MODES

  const now = new Date().toISOString()

  const doc: PlanDocument = {
    // preserve unknown-but-harmless fields (tags, description, docVersion, …)
    ...(obj as object),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: isStr(obj.id) ? obj.id : uuid(),
    title: isStr(obj.title) ? obj.title : 'Unbenannter Plan',
    floors,
    activeFloorId,
    activeModeKey,
    modes: modes as PlanDocument['modes'],
    settings: repairSettings(obj.settings),
    createdAt: isStr(obj.createdAt) ? obj.createdAt : now,
    updatedAt: isStr(obj.updatedAt) ? obj.updatedAt : now,
  }
  return doc
}

/** Parse a JSON string from storage and coerce it. Never throws. */
export function parsePlanJSON(raw: string | null): PlanDocument | null {
  if (!raw) return null
  try {
    return coercePlan(JSON.parse(raw))
  } catch {
    return null
  }
}
