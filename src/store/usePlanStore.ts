/**
 * Plan store — the single source of truth for the editor.
 *
 * Features:
 *  - Immutable snapshots for undo/redo (up to UNDO_LIMIT)
 *  - Cloud persistence via Supabase
 *  - Local fallback via localStorage (offline-friendly)
 *  - Selective subscriptions per Zustand best practices
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  PlanDocument,
  Floor,
  PlacedDevice,
  PlacedFurniture,
  Wall,
  WallSubtype,
  Room,
  Label,
  Selection,
  Tool,
  Viewport,
  ModeKey,
  LayerKey,
  UUID,
  Point,
} from '@/types'
import { supabase, supabaseReady } from '@/lib/supabase'
import { uuid, debounce } from '@/lib/utils'
import { createBlankPlan } from '@/data/templates'
import { DEVICES } from '@/data/devices'
import { modeStateFor } from '@/lib/modeState'
import { parsePlanJSON, coercePlan } from '@/lib/planSchema'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))

const UNDO_LIMIT = 80
const LOCAL_KEY = 'omega.plan.current'

/** Random ID for THIS browser tab. Used to detect echoes of our own
 *  realtime writes — much more reliable than comparing timestamps. */
const SESSION_CLIENT_ID = (() => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return 'tab-' + Math.random().toString(36).slice(2, 12)
})()
export function getSessionClientId(): string {
  return SESSION_CLIENT_ID
}

type DraftMutator = (doc: PlanDocument) => void

interface PlanState {
  // ----- document -----
  doc: PlanDocument | null
  loadedFromCloud: boolean
  isSaving: boolean
  lastSavedAt: number | null
  /** Last cloud-sync error message, or null when the last sync was clean. */
  lastSyncError: string | null
  /** When the local user last touched the doc (for conflict detection). */
  lastLocalChangeAt: number | null

  // ----- editor transient -----
  tool: Tool
  selection: Selection
  viewport: Viewport
  hoverDeviceCatalogId: string | null
  hoverFurnitureCatalogId: string | null

  // ----- history -----
  past: PlanDocument[]
  future: PlanDocument[]

  // ----- actions -----
  newBlank: (title?: string) => void
  loadDocument: (doc: PlanDocument, fromCloud?: boolean) => void
  updateDoc: (mut: DraftMutator, opts?: { history?: boolean }) => void

  undo: () => void
  redo: () => void

  setTool: (t: Tool) => void
  setSelection: (sel: Selection) => void
  setViewport: (v: Partial<Viewport>) => void
  /** Compute zoom + offset so the active floor fills the given canvas size with padding. */
  fitToView: (canvasW: number, canvasH: number, padding?: number) => void
  setHoverDevice: (id: string | null) => void
  setHoverFurniture: (id: string | null) => void

  // floor ops
  addFloor: (name: string) => void
  removeFloor: (id: UUID) => void
  renameFloor: (id: UUID, name: string) => void
  setActiveFloor: (id: UUID) => void
  toggleLayer: (layer: LayerKey) => void

  // object ops (operate on active floor)
  addDevice: (catalogId: string, position: Point) => UUID
  addFurniture: (catalogId: string, position: Point, size?: [number, number]) => UUID
  addWall: (a: Point, b: Point, thickness?: number, subtype?: WallSubtype, openingWidth?: number) => UUID
  addRoom: (polygon: Point[], name: string, zoneType?: 'indoor' | 'outdoor') => UUID
  addLabel: (position: Point, text: string) => UUID
  moveSelection: (dx: number, dy: number) => void
  deleteSelection: () => void
  rotateSelection: (deg: number) => void
  /** Resize selected furniture items. Pass NEW size in cm. */
  resizeFurniture: (id: string, w: number, h: number, dx?: number, dy?: number) => void

  setActiveMode: (key: ModeKey) => void
  /** Stamp every device's modeState with the recipe for that mode.
   *  If `key` is omitted, uses the currently active mode.
   *  Returns counts of touched and skipped devices. */
  applyMode: (key?: ModeKey) => { applied: number; skipped: number }

  // persistence
  /** Saves to cloud. Returns either the row id (success) or a conflict descriptor. */
  saveToCloud: (planRowId?: UUID) => Promise<UUID | { conflict: true; remoteVersion: number } | null>
  /** Reload doc from server, throwing away local unsaved changes. */
  reloadFromCloud: (planRowId: UUID) => Promise<boolean>
  _persistLocal: () => void
}

function cloneDoc(doc: PlanDocument): PlanDocument {
  return structuredClone(doc)
}

function activeFloor(doc: PlanDocument): Floor | undefined {
  return doc.floors.find((f) => f.id === doc.activeFloorId)
}

/** Debounced localStorage save so we don't thrash on every keystroke. */
const persistLocalDebounced = debounce((doc: PlanDocument | null) => {
  try {
    if (doc) localStorage.setItem(LOCAL_KEY, JSON.stringify(doc))
  } catch {
    /* quota etc. — non-fatal */
  }
}, 400)

export const usePlanStore = create<PlanState>()(
  subscribeWithSelector((set, get) => ({
    doc: null,
    loadedFromCloud: false,
    isSaving: false,
    lastSavedAt: null,
    lastSyncError: null,
    lastLocalChangeAt: null,

    tool: 'select',
    selection: { type: null, ids: [] },
    viewport: { zoom: 0.5, offsetX: 100, offsetY: 80 },
    hoverDeviceCatalogId: null,
    hoverFurnitureCatalogId: null,

    past: [],
    future: [],

    // ---------- Core doc handling ----------
    newBlank: (title) => {
      const doc = createBlankPlan(title)
      set({ doc, past: [], future: [], loadedFromCloud: false, selection: { type: null, ids: [] } })
      get()._persistLocal()
    },

    loadDocument: (doc, fromCloud = false) => {
      set({
        doc: cloneDoc(doc),
        past: [],
        future: [],
        loadedFromCloud: fromCloud,
        selection: { type: null, ids: [] },
        // A fresh cloud load means local state equals the cloud → mark synced.
        ...(fromCloud ? { lastSavedAt: Date.now(), lastSyncError: null } : {}),
      })
      get()._persistLocal()
    },

    updateDoc: (mut, opts) => {
      const { doc, past } = get()
      if (!doc) return
      const next = cloneDoc(doc)
      mut(next)
      next.updatedAt = new Date().toISOString()
      next.clientId = SESSION_CLIENT_ID
      const history = opts?.history ?? true
      set({
        doc: next,
        past: history ? [...past, doc].slice(-UNDO_LIMIT) : past,
        future: history ? [] : get().future,
        lastLocalChangeAt: Date.now(),
      })
      get()._persistLocal()
    },

    undo: () => {
      const { doc, past, future } = get()
      if (!doc || past.length === 0) return
      const prev = past[past.length - 1]
      set({
        doc: prev,
        past: past.slice(0, -1),
        future: [doc, ...future].slice(0, UNDO_LIMIT),
      })
      get()._persistLocal()
    },

    redo: () => {
      const { doc, past, future } = get()
      if (!doc || future.length === 0) return
      const next = future[0]
      set({
        doc: next,
        past: [...past, doc].slice(-UNDO_LIMIT),
        future: future.slice(1),
      })
      get()._persistLocal()
    },

    // ---------- Tool / selection / viewport ----------
    setTool: (t) => set({ tool: t }),
    setSelection: (sel) => set({ selection: sel }),
    setViewport: (v) => set({ viewport: { ...get().viewport, ...v } }),
    fitToView: (canvasW, canvasH, padding = 60) => {
      const { doc } = get()
      if (!doc || canvasW <= 0 || canvasH <= 0) return
      const f = activeFloor(doc)
      if (!f) return
      const innerW = Math.max(1, canvasW - padding * 2)
      const innerH = Math.max(1, canvasH - padding * 2)
      const zx = innerW / Math.max(1, f.extent.width)
      const zy = innerH / Math.max(1, f.extent.height)
      const z = Math.min(zx, zy, 6)
      set({
        viewport: {
          zoom: z,
          offsetX: (canvasW - f.extent.width * z) / 2,
          offsetY: (canvasH - f.extent.height * z) / 2,
        },
      })
    },
    setHoverDevice: (id) => set({ hoverDeviceCatalogId: id }),
    setHoverFurniture: (id) => set({ hoverFurnitureCatalogId: id }),

    // ---------- Floor ops ----------
    addFloor: (name) =>
      get().updateDoc((d) => {
        const newFloor: Floor = {
          id: uuid(),
          name,
          index: d.floors.length,
          walls: [],
          rooms: [],
          devices: [],
          furniture: [],
          labels: [],
          layers: { walls: true, furniture: true, devices: true, labels: true },
          extent: { width: 2000, height: 1500 },
        }
        d.floors.push(newFloor)
        d.activeFloorId = newFloor.id
      }),

    removeFloor: (id) =>
      get().updateDoc((d) => {
        if (d.floors.length <= 1) return
        d.floors = d.floors.filter((f) => f.id !== id)
        if (d.activeFloorId === id) d.activeFloorId = d.floors[0].id
      }),

    renameFloor: (id, name) =>
      get().updateDoc((d) => {
        const f = d.floors.find((x) => x.id === id)
        if (f) f.name = name
      }),

    setActiveFloor: (id) =>
      get().updateDoc(
        (d) => {
          d.activeFloorId = id
        },
        { history: false },
      ),

    toggleLayer: (layer) =>
      get().updateDoc(
        (d) => {
          const f = activeFloor(d)
          if (f) f.layers[layer] = !f.layers[layer]
        },
        { history: false },
      ),

    // ---------- Object ops ----------
    addDevice: (catalogId, position) => {
      const id = uuid()
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const placed: PlacedDevice = { id, deviceId: catalogId, position, rotation: 0 }
        f.devices.push(placed)
      })
      return id
    },

    addFurniture: (catalogId, position, size) => {
      const id = uuid()
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const placed: PlacedFurniture = { id, furnitureId: catalogId, position, rotation: 0, size }
        f.furniture.push(placed)
      })
      return id
    },

    addWall: (a, b, thickness = 14, subtype, openingWidth) => {
      const id = uuid()
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const w: Wall = { id, a, b, thickness }
        if (subtype && subtype !== 'wall') {
          w.subtype = subtype
          w.openingWidth = openingWidth ?? (subtype === 'door' ? 90 : 120)
          if (subtype === 'window') { w.openingHeight = 100; w.openingSill = 90 }
        }
        f.walls.push(w)
      })
      return id
    },

    addRoom: (polygon, name, zoneType = 'indoor') => {
      const id = uuid()
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const room: Room = {
          id,
          name,
          polygon,
          zoneType,
          ...(zoneType === 'outdoor' ? { floorVariant: 'slate' as const } : {}),
        }
        f.rooms.push(room)
      })
      return id
    },

    addLabel: (position, text) => {
      const id = uuid()
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const l: Label = { id, position, text }
        f.labels.push(l)
      })
      return id
    },

    moveSelection: (dx, dy) => {
      const { selection } = get()
      if (!selection.type || selection.ids.length === 0) return
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const bucket =
          selection.type === 'device' ? f.devices
          : selection.type === 'furniture' ? f.furniture
          : selection.type === 'label' ? f.labels
          : null
        if (!bucket) return
        for (const item of bucket) {
          if (selection.ids.includes(item.id)) {
            item.position = { x: item.position.x + dx, y: item.position.y + dy }
          }
        }
      })
    },

    deleteSelection: () => {
      const { selection } = get()
      if (!selection.type || selection.ids.length === 0) return
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        if (selection.type === 'device')     f.devices     = f.devices.filter((x) => !selection.ids.includes(x.id))
        if (selection.type === 'furniture')  f.furniture   = f.furniture.filter((x) => !selection.ids.includes(x.id))
        if (selection.type === 'label')      f.labels      = f.labels.filter((x) => !selection.ids.includes(x.id))
        if (selection.type === 'wall')       f.walls       = f.walls.filter((x) => !selection.ids.includes(x.id))
        if (selection.type === 'room')       f.rooms       = f.rooms.filter((x) => !selection.ids.includes(x.id))
      })
      set({ selection: { type: null, ids: [] } })
    },

    rotateSelection: (deg) => {
      const { selection } = get()
      if (!selection.type || selection.ids.length === 0) return
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const bucket =
          selection.type === 'device' ? f.devices
          : selection.type === 'furniture' ? f.furniture
          : null
        if (!bucket) return
        for (const item of bucket) {
          if (selection.ids.includes(item.id)) {
            item.rotation = ((item.rotation ?? 0) + deg) % 360
          }
        }
      })
    },

    resizeFurniture: (id, w, h, dx = 0, dy = 0) => {
      get().updateDoc((d) => {
        const f = activeFloor(d)
        if (!f) return
        const item = f.furniture.find((x) => x.id === id)
        if (!item) return
        // Clamp to a sane min size (10 cm) and max (1000 cm)
        const cw = Math.max(10, Math.min(1000, w))
        const ch = Math.max(10, Math.min(1000, h))
        item.size = [cw, ch]
        if (dx !== 0 || dy !== 0) {
          item.position = { x: item.position.x + dx, y: item.position.y + dy }
        }
      })
    },

    // ---------- Modes ----------
    setActiveMode: (key) =>
      get().updateDoc(
        (d) => {
          d.activeModeKey = key
        },
        { history: false },
      ),

    applyMode: (key) => {
      const { doc } = get()
      if (!doc) return { applied: 0, skipped: 0 }
      const target: ModeKey = key ?? doc.activeModeKey
      let applied = 0, skipped = 0
      get().updateDoc((d) => {
        for (const f of d.floors) {
          for (const dev of f.devices) {
            const entry = DEVICE_MAP[dev.deviceId]
            if (!entry) { skipped++; continue }
            // Only apply to devices that explicitly support this mode.
            if (target !== 'auto' && !entry.modeTags?.includes(target)) {
              skipped++; continue
            }
            const next = modeStateFor(entry.category, target)
            if (Object.keys(next).length === 0) { skipped++; continue }
            if (!dev.modeState) dev.modeState = {}
            dev.modeState[target] = next
            applied++
          }
        }
        d.activeModeKey = target
      })
      return { applied, skipped }
    },

    // ---------- Persistence ----------
    saveToCloud: async (planRowId) => {
      const { doc } = get()
      if (!doc) return null
      if (!supabaseReady) return null

      // Ensure doc has our session id stamped before persisting.
      if (doc.clientId !== SESSION_CLIENT_ID) {
        doc.clientId = SESSION_CLIENT_ID
      }

      set({ isSaving: true, lastSyncError: null })
      try {
        const { data: userData } = await supabase.auth.getUser()
        const userId = userData.user?.id
        if (!userId) throw new Error('Nicht angemeldet')

        if (planRowId) {
          // Optimistic locking: read remote version, abort on conflict.
          const { data: existing, error: readErr } = await supabase
            .from('plans')
            .select('doc')
            .eq('id', planRowId)
            .maybeSingle()
          if (readErr) throw readErr
          const remoteVersion = (existing?.doc as PlanDocument | undefined)?.docVersion ?? 0
          const localVersion = doc.docVersion ?? 0
          if (remoteVersion > localVersion) {
            return { conflict: true as const, remoteVersion }
          }
          const nextDoc: PlanDocument = { ...doc, docVersion: localVersion + 1 }
          const { error } = await supabase
            .from('plans')
            .update({ doc: nextDoc, title: nextDoc.title })
            .eq('id', planRowId)
          if (error) throw error
          set({ doc: nextDoc, lastSavedAt: Date.now() })
          return planRowId
        } else {
          const nextDoc: PlanDocument = { ...doc, docVersion: 1 }
          const { data, error } = await supabase
            .from('plans')
            .insert({
              owner_id: userId,
              title: nextDoc.title,
              doc: nextDoc,
              is_public: false,
            })
            .select('id')
            .single()
          if (error) throw error
          set({ doc: nextDoc, lastSavedAt: Date.now() })
          return data.id as UUID
        }
      } catch (err) {
        console.error('[omega] saveToCloud failed', err)
        set({ lastSyncError: err instanceof Error ? err.message : 'Unbekannter Fehler' })
        return null
      } finally {
        set({ isSaving: false })
      }
    },

    reloadFromCloud: async (planRowId) => {
      if (!supabaseReady) return false
      const { data, error } = await supabase
        .from('plans')
        .select('doc')
        .eq('id', planRowId)
        .maybeSingle()
      if (error || !data) return false
      // Validate/migrate the remote payload instead of trusting it blindly —
      // this is the last cloud-load path; the others already coerce.
      const remoteDoc = coercePlan(data.doc)
      if (!remoteDoc) return false
      set({
        doc: remoteDoc,
        past: [],
        future: [],
        loadedFromCloud: true,
        lastSyncError: null,
        selection: { type: null, ids: [] },
      })
      return true
    },

    _persistLocal: () => {
      persistLocalDebounced(get().doc)
    },
  })),
)

/** Read local snapshot (used on first boot). Migrates + validates legacy or
 *  partial data instead of silently discarding it. */
export function loadLocalPlan(): PlanDocument | null {
  return parsePlanJSON(localStorage.getItem(LOCAL_KEY))
}
