import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { Point, Room } from '@/types'
import { twinManager, type TwinView } from '@/twin/twinManager'
import { resolveRoomBinding, deriveRoomLiveState } from '@/twin/binding'
import { climateColor, glowOpacity } from '@/twin/reflection'

/**
 * LiveTwinReflection — the live Digital Twin reflected into the 3D scene.
 *
 * It uses the SAME `twinManager()` runtime and the SAME `resolveRoomBinding` +
 * `deriveRoomLiveState` as the 2D SVG floorplan — zero duplicate logic. Per plan
 * room it paints the aggregated live state: a floor glow + point light (lights),
 * a climate orb (temperature) and a motion pulse. Additive and self-contained;
 * the subscription lives here so only this layer re-renders on live ticks.
 */

const M = (cm: number) => cm / 100
const centroid = (pts: Point[]): Point => {
  const n = pts.length || 1
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n }
}
const shapeOf = (polygon: Point[]): THREE.Shape => {
  const shape = new THREE.Shape()
  shape.moveTo(M(polygon[0].x), -M(polygon[0].y))
  for (let i = 1; i < polygon.length; i++) shape.lineTo(M(polygon[i].x), -M(polygon[i].y))
  shape.closePath()
  return shape
}

function MotionPulse({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (!ref.current) return
    const t = (Math.sin(state.clock.elapsedTime * 3) + 1) / 2
    ref.current.scale.setScalar(M(6) + t * M(5))
    ;(ref.current.material as THREE.MeshBasicMaterial).opacity = 0.35 + t * 0.5
  })
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial color="#C7A24E" transparent opacity={0.7} depthWrite={false} />
    </mesh>
  )
}

export function LiveTwinReflection({ rooms }: { rooms: Room[] }) {
  const manager = twinManager()
  const [view, setView] = useState<TwinView>(() => manager.view())
  useEffect(() => manager.subscribe(setView), [manager])

  const binding = useMemo(
    () => resolveRoomBinding(view.devices, rooms, view.bindings),
    [view.devices, view.bindings, rooms],
  )

  // Room outlines, memoised on the rooms rather than rebuilt inline.
  //
  // R3F reconstructs an object whenever its `args` change, comparing the array
  // element-wise by reference — so a freshly built `THREE.Shape` on each render
  // means a fresh `ShapeGeometry`, i.e. a full earcut triangulation. This
  // component re-renders on every live-twin tick, so that was a re-triangulation
  // of every lit room's floor several times a second, for outlines that only
  // change when the plan does.
  const shapes = useMemo(() => {
    const byRoom = new Map<string, THREE.Shape>()
    for (const room of rooms) {
      if (room.polygon.length >= 3) byRoom.set(room.id, shapeOf(room.polygon))
    }
    return byRoom
  }, [rooms])

  return (
    <>
      {rooms.map((room) => {
        if (room.polygon.length < 3) return null
        const devices = binding.byRoom.get(room.id)
        if (!devices || devices.length === 0) return null
        const live = deriveRoomLiveState(devices)
        const c = centroid(room.polygon)
        const climate = climateColor(live.temperature)
        const lit = live.lightsOn > 0 && !!live.glow
        return (
          <group key={`live-${room.id}`}>
            {/* Floor glow only. The room's live point light is mounted by
                `LightRig`, so live rooms compete for the same fixed light pool
                as every other fixture instead of adding an unbounded light per
                connected room — see that module for why the count is the
                frame budget in a forward renderer. */}
            {lit && (
              <mesh position={[0, M(3), 0]} rotation={[Math.PI / 2, 0, 0]}>
                <shapeGeometry args={[shapes.get(room.id)]} />
                <meshBasicMaterial color={live.glow} transparent opacity={glowOpacity(live.brightness)} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            )}
            {climate && (
              <mesh position={[M(c.x), M(145), M(c.y)]}>
                <sphereGeometry args={[M(8), 16, 16]} />
                <meshBasicMaterial color={climate} transparent opacity={0.85} />
              </mesh>
            )}
            {live.motion && <MotionPulse position={[M(c.x), M(70), M(c.y)]} />}
          </group>
        )
      })}
    </>
  )
}
