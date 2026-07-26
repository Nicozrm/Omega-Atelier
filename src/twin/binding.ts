/**
 * binding.ts — connecting the live twin to the plan's rooms.
 *
 * Live devices come from connectors carrying a room *label* (`metadata.room`);
 * the plan defines rooms with *geometry* and an id. This layer resolves which
 * plan room each live device belongs to (auto by name, with manual overrides)
 * and aggregates a room's live state into a renderer-neutral shape — so the 2D
 * floorplan can paint it now and a 3D view can consume the identical data later.
 *
 * Pure app-layer logic: no core change, no renderer, no connector specifics.
 */

import { findCapability, type Device } from '@/domain'
import { kelvinToHex } from '@/lib/lighting'
import type { Room } from '@/types'

const norm = (s: string) => s.trim().toLowerCase()

/** Match a connector room label to a plan room (exact, then token-contains). */
export function matchRoomByName(label: string | undefined, rooms: Room[]): Room | undefined {
  if (!label) return undefined
  const l = norm(label)
  const exact = rooms.find((r) => norm(r.name) === l)
  if (exact) return exact
  // token-contains: "Flur" ↔ "Flur / Bad"
  return rooms.find((r) => {
    const rn = norm(r.name)
    if (rn.includes(l) || l.includes(rn)) return true
    return rn.split(/[\s/]+/).some((tok) => tok && (tok === l || l.includes(tok)))
  })
}

export interface RoomBinding {
  /** plan roomId → devices bound to it */
  byRoom: Map<string, Device[]>
  /** devices that matched no plan room */
  unassigned: Device[]
  /** deviceId → plan roomId (resolved, auto or override) */
  roomOf: Map<string, string>
}

/** Resolve every device to a plan room: manual override first, else name match. */
export function resolveRoomBinding(
  devices: Device[],
  rooms: Room[],
  overrides: Record<string, string> = {},
): RoomBinding {
  const byRoom = new Map<string, Device[]>()
  const unassigned: Device[] = []
  const roomOf = new Map<string, string>()
  const roomIds = new Set(rooms.map((r) => r.id))

  for (const device of devices) {
    const override = overrides[device.id]
    const roomId = override && roomIds.has(override)
      ? override
      : matchRoomByName(device.metadata?.room, rooms)?.id
    if (roomId) {
      const list = byRoom.get(roomId) ?? []
      list.push(device)
      byRoom.set(roomId, list)
      roomOf.set(device.id, roomId)
    } else {
      unassigned.push(device)
    }
  }
  return { byRoom, unassigned, roomOf }
}

/** Renderer-neutral aggregate of a room's live state. */
export interface RoomLiveState {
  deviceCount: number
  lightTotal: number
  lightsOn: number
  brightness?: number
  /** Room tint from the on-lights' colour temperature / colour. */
  glow?: string
  temperature?: number
  humidity?: number
  motion: boolean
  energyW?: number
  hasLock: boolean
  locked?: boolean
}

const isLight = (d: Device) => d.category === 'light' || findCapability(d.capabilities, 'Brightness') !== undefined

/** Aggregate a set of devices into one room-level live state. */
export function deriveRoomLiveState(devices: Device[]): RoomLiveState {
  const lights = devices.filter(isLight)
  let lightsOn = 0
  let brightnessSum = 0
  let brightnessCount = 0
  let glow: string | undefined
  for (const d of lights) {
    const on = findCapability(d.capabilities, 'OnOff')
    const isOn = on ? on.on : true
    if (!isOn) continue
    lightsOn++
    const b = findCapability(d.capabilities, 'Brightness')
    if (b) { brightnessSum += b.percent; brightnessCount++ }
    if (!glow) {
      const ct = findCapability(d.capabilities, 'ColorTemperature')
      const col = findCapability(d.capabilities, 'Color')
      glow = col ? col.hex : ct ? kelvinToHex(ct.kelvin) : '#ffd9a0'
    }
  }

  let temperature: number | undefined
  let humidity: number | undefined
  let motion = false
  let energyW: number | undefined
  let hasLock = false
  let locked: boolean | undefined

  for (const d of devices) {
    const t = findCapability(d.capabilities, 'Temperature')
    if (t && temperature === undefined) temperature = t.celsius
    const h = findCapability(d.capabilities, 'Humidity')
    if (h && humidity === undefined) humidity = h.percent
    const m = findCapability(d.capabilities, 'Motion')
    if (m && m.detected) motion = true
    const e = findCapability(d.capabilities, 'Energy')
    if (e) energyW = (energyW ?? 0) + e.watts
    const lk = findCapability(d.capabilities, 'Lock')
    if (lk) { hasLock = true; locked = (locked ?? true) && lk.locked }
  }

  return {
    deviceCount: devices.length,
    lightTotal: lights.length,
    lightsOn,
    brightness: brightnessCount ? Math.round(brightnessSum / brightnessCount) : undefined,
    glow,
    temperature,
    humidity,
    motion,
    energyW,
    hasLock,
    locked,
  }
}
