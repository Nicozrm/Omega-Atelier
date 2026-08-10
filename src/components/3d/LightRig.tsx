/**
 * LightRig — every dynamic point light in the interior, on a fixed budget.
 *
 * ## The problem it solves
 *
 * three.js is a forward renderer: each enabled light runs in the fragment shader
 * of every lit surface. The interior previously mounted a downlight and two cove
 * washes per room plus one per placed luminaire, so a ten-room plan shaded each
 * floor pixel against ~40 lights — through `MeshPhysicalMaterial`'s clearcoat and
 * sheen lobes. That was the dominant frame cost.
 *
 * Mounting/unmounting lights is worse than it looks: the light *count* is
 * compiled into every material's shader program, so a changing count triggers a
 * scene-wide recompile — the stutter you feel mid-orbit.
 *
 * ## How it works
 *
 * One pool of `budget` lights is mounted for the lifetime of the scene and
 * re-pointed at whichever sources currently matter (see `lib/render/lightBudget`
 * for the ranking). The count is constant, so shader programs stay hot and the
 * per-frame work is a handful of uniform writes.
 *
 * Slots crossfade rather than cut: when a slot is reassigned its intensity ramps
 * from zero, so a light entering or leaving the budget dissolves instead of
 * popping. Combined with the ranking's hysteresis, reassignment is rare enough
 * that the rig is visually invisible.
 *
 * The *emissive* parts of the fixtures — cove strips, downlight discs — are
 * plain meshes and stay mounted in `Scene`; they cost nothing per light and
 * should never disappear just because their wash light lost its slot.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PlacedDevice, Room, ModeKey } from '@/types'
import { deriveLightSources, type CategoryLookup } from '@/lib/lighting'
import { selectLights, assignSlots, lightBudgetForTier, type PointLightSpec } from '@/lib/render/lightBudget'
import { readTier } from '@/lib/render/tier'
import { twinManager, type TwinView } from '@/twin/twinManager'
import { resolveRoomBinding, deriveRoomLiveState } from '@/twin/binding'
import { lightIntensity } from '@/twin/reflection'

const M = (cm: number) => cm / 100

/** Ceiling-mount height for a placed luminaire, just below a 250 cm ceiling. */
const LAMP_MOUNT_CM = 235
/** Recessed downlight height. */
const DOWNLIGHT_CM = 245
/** Cove wash height — tucked under the strip so it grazes the wall. */
const COVE_LIGHT_CM = 226
/** Cove strips are inset this far from the wall face (matches `CoveLighting`). */
const COVE_INSET_CM = 9

/** Seconds a reassigned slot takes to ramp to its target intensity. */
const CROSSFADE_SECONDS = 0.28
/** Re-rank at most this often — the ranking is stable, polling it is waste. */
const RESELECT_INTERVAL = 0.12
/** …but re-rank immediately once the camera has travelled this far (metres). */
const RESELECT_MOVE = 0.75

/**
 * Semantic weights — a placed luminaire outranks ambient architectural light.
 * A *live* lamp (a real fixture that is actually on in the user's home right
 * now, via a connector) outranks everything: it is the whole point of the
 * digital twin, so it must never lose its slot to decorative cove light.
 */
const PRIORITY_LIVE = 1.4
const PRIORITY_LAMP = 1.0
const PRIORITY_DOWNLIGHT = 0.75
const PRIORITY_COVE = 0.45

/** Polygon centroid in plan centimetres. */
function centroid(polygon: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const p of polygon) {
    x += p.x
    y += p.y
  }
  return { x: x / polygon.length, y: y / polygon.length }
}

/**
 * Every point light the interior would like to have, before budgeting.
 *
 * Mirrors the fixtures `Scene` draws: one wash per placed luminaire that is on,
 * one recessed downlight per indoor room, and two cove washes per room placed on
 * opposite runs of its perimeter.
 */
export function collectInteriorSources(
  rooms: readonly Room[],
  devices: readonly PlacedDevice[],
  mode: ModeKey | undefined,
  categoryOf: CategoryLookup,
): PointLightSpec[] {
  const sources: PointLightSpec[] = []

  // ── Placed luminaires — colour, brightness and on/off come from the domain.
  if (mode) {
    for (const s of deriveLightSources({ devices: devices as PlacedDevice[], lookup: categoryOf, mode })) {
      if (!s.on) continue
      sources.push({
        key: `lamp:${s.deviceId}`,
        position: [M(s.position.x), M(LAMP_MOUNT_CM), M(s.position.y)],
        color: s.color,
        intensity: 0.35 + s.intensity * 1.85,
        distance: 5.5,
        decay: 2.0,
        priority: PRIORITY_LAMP,
      })
    }
  }

  const indoor = rooms.filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)

  for (const room of indoor) {
    const c = centroid(room.polygon)

    // ── Recessed downlight at the room centre.
    sources.push({
      key: `down:${room.id}`,
      position: [M(c.x), M(DOWNLIGHT_CM), M(c.y)],
      color: '#ffdcb0',
      intensity: 4.2,
      distance: 5.5,
      decay: 2.2,
      priority: PRIORITY_DOWNLIGHT,
    })

    // ── Cove washes on the perimeter, inset toward the room interior. Only the
    //    long runs carry a strip, matching the geometry `CoveLighting` draws.
    const runs: Array<[number, number]> = []
    for (let i = 0; i < room.polygon.length; i++) {
      const p = room.polygon[i]
      const q = room.polygon[(i + 1) % room.polygon.length]
      const dx = q.x - p.x
      const dy = q.y - p.y
      const len = Math.hypot(dx, dy)
      if (len < 40) continue
      const mx = (p.x + q.x) / 2
      const my = (p.y + q.y) / 2
      // Inward normal: the perpendicular that points at the centroid.
      let nx = -dy / len
      let ny = dx / len
      if ((c.x - mx) * nx + (c.y - my) * ny < 0) {
        nx = -nx
        ny = -ny
      }
      runs.push([mx + nx * (COVE_INSET_CM + 14), my + ny * (COVE_INSET_CM + 14)])
    }
    // Two washes per room, taken from opposite ends of the perimeter so they
    // light the room from both sides instead of doubling up on one wall.
    const picks = runs.length > 0 ? [runs[0], runs[Math.floor(runs.length / 2)]] : []
    picks.forEach(([lx, ly], k) => {
      sources.push({
        key: `cove:${room.id}:${k}`,
        position: [M(lx), M(COVE_LIGHT_CM), M(ly)],
        color: '#ffcf9a',
        intensity: 2.0,
        distance: 4.0,
        decay: 2.2,
        priority: PRIORITY_COVE,
      })
    })
  }

  return sources
}

/**
 * Point lights for rooms whose bound devices report lights on *right now*.
 *
 * Uses the same twin runtime and the same `resolveRoomBinding` /
 * `deriveRoomLiveState` as `LiveTwinReflection` and the 2D floorplan, so live
 * state is derived in exactly one place. That component keeps the visual glow;
 * only the light itself moves here, so live rooms compete for the same pool as
 * everything else rather than adding to it.
 */
function useTwinLightSources(rooms: readonly Room[]): PointLightSpec[] {
  const manager = twinManager()
  const [view, setView] = useState<TwinView>(() => manager.view())
  useEffect(() => manager.subscribe(setView), [manager])

  return useMemo(() => {
    const binding = resolveRoomBinding(view.devices, rooms as Room[], view.bindings)
    const sources: PointLightSpec[] = []
    for (const room of rooms) {
      if (room.polygon.length < 3) continue
      const devices = binding.byRoom.get(room.id)
      if (!devices || devices.length === 0) continue
      const live = deriveRoomLiveState(devices)
      if (live.lightsOn <= 0 || !live.glow) continue
      const c = centroid(room.polygon)
      sources.push({
        key: `live:${room.id}`,
        position: [M(c.x), M(LAMP_MOUNT_CM), M(c.y)],
        color: live.glow,
        intensity: lightIntensity(live.brightness, live.lightsOn),
        distance: 7,
        decay: 1.8,
        priority: PRIORITY_LIVE,
      })
    }
    return sources
  }, [view.devices, view.bindings, rooms])
}

/** Mutable per-slot state — lives outside React so `useFrame` can write it freely. */
interface Slot {
  key: string | null
  target: number
  current: number
}

export function LightRig({ rooms, devices, mode, categoryOf }: {
  rooms: readonly Room[]
  devices: readonly PlacedDevice[]
  mode: ModeKey | undefined
  categoryOf: CategoryLookup
}) {
  const camera = useThree((s) => s.camera)

  const planSources = useMemo(
    () => collectInteriorSources(rooms, devices, mode, categoryOf),
    [rooms, devices, mode, categoryOf],
  )
  const liveSources = useTwinLightSources(rooms)
  const sources = useMemo(
    () => (liveSources.length > 0 ? [...planSources, ...liveSources] : planSources),
    [planSources, liveSources],
  )

  // Pool size changes only when the plan or mode changes — never while orbiting —
  // so shader programs survive interaction. Clamped to the sources that exist so
  // a two-lamp plan does not pay for eight.
  const tier = readTier()
  const budget = Math.min(lightBudgetForTier(tier), sources.length)

  const lightRefs = useRef<Array<THREE.PointLight | null>>([])
  const slots = useRef<Slot[]>([])
  const selection = useRef<string[]>([])
  const sinceReselect = useRef(0)
  const lastCamera = useRef(new THREE.Vector3(Infinity, Infinity, Infinity))
  const camPos = useRef<[number, number, number]>([0, 0, 0])

  // Rebuild the pool only when its *size* changes — that is the moment the
  // mounted lights are replaced. Sources coming and going need no reset: the
  // next re-selection simply hands the affected slot a different spec, and a
  // stale key in `selection` just fails to match an incumbent. Resetting on
  // every source change would restart crossfades on each live-twin tick.
  useEffect(() => {
    slots.current = Array.from({ length: budget }, () => ({ key: null, target: 0, current: 0 }))
    selection.current = []
    lastCamera.current.set(Infinity, Infinity, Infinity)
  }, [budget])

  useFrame((_, delta) => {
    if (budget === 0) return
    // `delta` can spike after a tab is backgrounded; clamp so crossfades do not
    // jump and so a stall cannot be mistaken for a long idle.
    const dt = Math.min(delta, 0.1)

    sinceReselect.current += dt
    const moved = camera.position.distanceToSquared(lastCamera.current)
    if (sinceReselect.current >= RESELECT_INTERVAL || moved > RESELECT_MOVE * RESELECT_MOVE) {
      sinceReselect.current = 0
      lastCamera.current.copy(camera.position)
      camPos.current[0] = camera.position.x
      camPos.current[1] = camera.position.y
      camPos.current[2] = camera.position.z

      const picked = selectLights({
        sources,
        camera: camPos.current,
        budget,
        previous: selection.current,
      })
      selection.current = picked.map((p) => p.key)
      const specByKey = new Map(picked.map((spec) => [spec.key, spec]))
      const nextKeys = assignSlots(slots.current.map((slot) => slot.key), selection.current)

      for (let i = 0; i < slots.current.length; i++) {
        const slot = slots.current[i]
        const light = lightRefs.current[i]
        if (!light) continue

        const key = nextKeys[i]
        const spec = key === null ? undefined : specByKey.get(key)
        if (!spec) {
          // Nothing to drive this slot — fade it out, but keep it mounted so
          // the light count (and every compiled shader) stays put.
          slot.key = null
          slot.target = 0
          continue
        }

        // Written every time, not only on handover: a source's colour and
        // brightness can change while it holds its slot — a live twin lamp
        // dimming or shifting to warm white is exactly that — and the pool
        // would otherwise keep showing the values it was first handed.
        light.position.set(spec.position[0], spec.position[1], spec.position[2])
        light.color.set(spec.color)
        light.distance = spec.distance
        light.decay = spec.decay

        if (slot.key !== spec.key) {
          // Handover: ramp in from zero so the swap dissolves instead of popping.
          slot.key = spec.key
          slot.current = 0
        }
        slot.target = spec.intensity
      }
    }

    // Crossfade every slot toward its target — cheap, and the only per-frame work.
    for (let i = 0; i < slots.current.length; i++) {
      const slot = slots.current[i]
      const light = lightRefs.current[i]
      if (!light) continue
      if (slot.current !== slot.target) {
        const step = (dt / CROSSFADE_SECONDS) * Math.max(slot.target, slot.current, 1)
        slot.current = slot.current < slot.target
          ? Math.min(slot.target, slot.current + step)
          : Math.max(slot.target, slot.current - step)
        light.intensity = slot.current
      }
    }
  })

  return (
    <>
      {Array.from({ length: budget }, (_, i) => (
        <pointLight
          key={`rig-${i}`}
          ref={(el: THREE.PointLight | null) => { lightRefs.current[i] = el }}
          intensity={0}
          // Shadow casting stays off across the pool: interior point-light
          // shadows would mean a cube-map render per light per frame, which is
          // exactly the cost this rig exists to avoid. The sun casts the scene's
          // real shadows; contact darkening comes from AO.
          castShadow={false}
        />
      ))}
    </>
  )
}
