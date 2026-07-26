/**
 * Central type definitions for OMEGA Atelier 2.0.
 * All domain objects live here.
 */

export type UUID = string
export type ISODateTime = string

// ───────────────────────── Ecosystems / Devices ─────────────────────────

export type Ecosystem =
  | 'apple-home'
  | 'google-home'
  | 'alexa'
  | 'home-assistant'
  | 'matter'
  | 'philips-hue'
  | 'ikea-dirigera'
  | 'aqara'
  | 'shelly'
  | 'sonos'
  | 'eve'
  | 'hue-sync'
  | 'samsung-smartthings'
  | 'lutron'
  | 'nuki'
  | 'tado'
  | 'bosch-sh'
  | 'netatmo'
  | 'fritzbox'
  | 'homey'
  | 'fibaro'
  | 'loxone'
  | 'kindermatte'
  | 'hue-secure'
  // v16 — additional ecosystems
  | 'switchbot'
  | 'lockin'
  | 'govee'
  | 'smart-life'
  | 'tuya'
  | 'osaio'
  | 'arenti'
  | 'custom'

export type DeviceCategory =
  | 'light'
  | 'switch'
  | 'sensor'
  | 'climate'
  | 'camera'
  | 'lock'
  | 'speaker'
  | 'tv'
  | 'blind'
  | 'outlet'
  | 'hub'
  | 'appliance'
  | 'alarm'
  | 'irrigation'
  | 'other'

export interface DeviceCatalogEntry {
  id: string
  name: string
  brand: string
  ecosystem: Ecosystem
  category: DeviceCategory
  protocol: ('zigbee' | 'z-wave' | 'wifi' | 'matter' | 'thread' | 'bt' | 'wired')[]
  price?: number // EUR
  power?: number // Watts (avg)
  requires?: string[] // ids of required hubs/bridges
  tags?: string[]
  icon?: string // lucide-react name
  /** Which omega modes this device supports */
  modeTags?: ModeKey[]
}

// ───────────────────────── Furniture ─────────────────────────

export type FurnitureCategory =
  | 'sofa'
  | 'bed'
  | 'table'
  | 'chair'
  | 'storage'
  | 'kitchen'
  | 'bath'
  | 'decor'
  | 'outdoor'
  | 'other'

export interface FurnitureCatalogEntry {
  id: string
  name: string
  category: FurnitureCategory
  /** default footprint in cm (width × depth) */
  size: [number, number]
}

// ───────────────────────── Plan / Editor ─────────────────────────

export interface Point {
  x: number
  y: number
}

export type LayerKey = 'walls' | 'furniture' | 'devices' | 'labels'

export type WallSubtype = 'wall' | 'door' | 'window'

export interface Wall {
  id: UUID
  a: Point
  b: Point
  thickness: number // cm
  label?: string
  /** v18 — wall sub-element. Default 'wall' = solid. */
  subtype?: WallSubtype
  /** Opening width (cm) along the wall. Used for door/window. Default: 90 (door) / 120 (window). */
  openingWidth?: number
  /** Opening height (cm). Used for window only. Default: 100 (window) */
  openingHeight?: number
  /** Opening sill height (cm above floor). Window default: 90; door always 0. */
  openingSill?: number
}

export interface Room {
  id: UUID
  name: string
  polygon: Point[]
  color?: string
  /** Catalog material id for the floor surface (refs src/data/materials.ts). */
  floorMaterialId?: string
  /** Catalog material id for the walls of this room. */
  wallMaterialId?: string
  /** Catalog material id for the ceiling of this room. */
  ceilingMaterialId?: string
  /** @deprecated v18 floor variant — kept for back-compat; resolved into a
   *  catalog material by `resolveFloorMaterial`. Prefer `floorMaterialId`. */
  floorVariant?: 'parquet' | 'vinylLight' | 'vinylDark' | 'slate'
  /** @deprecated kept for back-compat; resolved by `resolveWallMaterial`. */
  wallVariant?: 'plaster' | 'concrete' | 'wallpaper'
  /** v26 — zone type: indoor (default) | outdoor (terrace/balcony/garden) */
  zoneType?: 'indoor' | 'outdoor'
}

export interface PlacedDevice {
  id: UUID
  deviceId: string // refs DeviceCatalogEntry.id
  position: Point
  rotation?: number
  roomId?: UUID
  note?: string
  /** per-mode state: modeKey → { on, brightness, temperature, ... } */
  modeState?: Record<string, Record<string, string | number | boolean>>
}

export interface PlacedFurniture {
  id: UUID
  furnitureId: string
  position: Point
  rotation?: number
  size?: [number, number]
  roomId?: UUID
  label?: string
  /** Hidden items stay in the plan but render in neither 2D nor 3D. */
  hidden?: boolean
  /** Optional override for the primary material of this furniture item.
   *  E.g. 'fabricBeige' / 'fabricGray' / 'leatherBlack' for a sofa,
   *  'oak' / 'walnut' for a wooden item. */
  materialKey?: string
}

export interface Label {
  id: UUID
  position: Point
  text: string
  size?: number
}

export interface Floor {
  id: UUID
  name: string
  index: number // 0 = ground floor, 1 = 1st floor, -1 = basement
  walls: Wall[]
  rooms: Room[]
  devices: PlacedDevice[]
  furniture: PlacedFurniture[]
  labels: Label[]
  /** visibility per layer */
  layers: Record<LayerKey, boolean>
  /** canvas extent in cm */
  extent: { width: number; height: number }
}

// ───────────────────────── Omega Modes ─────────────────────────

export type ModeKey =
  | 'auto'
  | 'morning'
  | 'day-office'
  | 'film'
  | 'night'
  | 'relax'
  | 'away'
  | 'party'
  | 'alarm'

export interface OmegaMode {
  key: ModeKey
  name: string
  description: string
  icon: string
  accent: string // hex
  trigger: {
    manual: boolean
    time?: { from: string; to: string } // "HH:mm"
    presence?: 'home' | 'away' | 'any'
    geofence?: { lat: number; lng: number; radius: number }
  }
  /** Bewertung: welche Geräte-Kategorien braucht dieser Modus */
  requiredCategories: DeviceCategory[]
}

// ───────────────────────── Plan ─────────────────────────

export interface PlanSettings {
  unit: 'cm' | 'm'
  gridSize: number // cm
  snap: boolean
  snapStep: number // cm
  showGrid: boolean
  /** Snap dragged items to nearby walls (the "Magnet" toggle). */
  magnet?: boolean
  theme: 'dark' | 'light'
}

export interface PlanDocument {
  schemaVersion: 2
  id: UUID
  title: string
  description?: string
  /** Optimistic-locking version. Incremented on every cloud save. */
  docVersion?: number
  floors: Floor[]
  activeFloorId: UUID
  activeModeKey: ModeKey
  modes: OmegaMode[]
  settings: PlanSettings
  /** free-form tags e.g. "penthouse", "studio" */
  tags?: string[]
  createdAt: ISODateTime
  updatedAt: ISODateTime
  /** Random per-browser-session ID, used to detect echo of own writes
   *  in realtime collaboration. Stable for the lifetime of one tab. */
  clientId?: string
}

// ───────────────────────── Supabase rows ─────────────────────────

export interface PlanRow {
  id: UUID
  owner_id: UUID
  title: string
  description: string | null
  doc: PlanDocument
  is_public: boolean
  cover_url: string | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface PlanVersionRow {
  id: UUID
  plan_id: UUID
  version: number
  doc: PlanDocument
  created_by: UUID
  created_at: ISODateTime
  note: string | null
}

export type CollaboratorRole = 'viewer' | 'editor'

export interface PlanCollaboratorRow {
  plan_id: UUID
  user_id: UUID
  role: CollaboratorRole
  invited_by: UUID | null
  created_at: ISODateTime
}

export interface CommentRow {
  id: UUID
  plan_id: UUID
  floor_id: UUID | null
  target_id: UUID | null // device/room/wall id
  author_id: UUID
  body: string
  resolved: boolean
  created_at: ISODateTime
}

export interface ProfileRow {
  id: UUID
  display_name: string | null
  avatar_url: string | null
  email: string | null
  created_at: ISODateTime
}

// ───────────────────────── Editor tooling ─────────────────────────

export type Tool =
  | 'select'
  | 'wall'
  | 'door'
  | 'window'
  | 'terrace'
  | 'room'
  | 'device'
  | 'furniture'
  | 'label'
  | 'pan'
  | 'measure'

export interface Selection {
  type: 'device' | 'furniture' | 'wall' | 'room' | 'label' | null
  ids: UUID[]
}

export interface Viewport {
  zoom: number // 1.0 = 1px per cm (approx)
  offsetX: number
  offsetY: number
}

export interface RemoteCursor {
  userId: UUID
  name: string
  color: string
  x: number
  y: number
  floorId: UUID
  tool: Tool
  ts: number
}
