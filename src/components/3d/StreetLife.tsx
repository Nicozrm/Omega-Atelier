/**
 * StreetLife — the moving part of the Living World.
 *
 * Cars, vans, buses and bicycles drive the street graph; people walk, jog, push
 * prams and walk dogs along the pavements. Both read their position from the
 * pure route model in `@/lib/world/traffic`, so this component owns meshes and
 * nothing else — it never decides where anything goes.
 *
 * Per-frame discipline, because this is the only part of the world that is not
 * static geometry:
 *   • Each actor is **one group** whose transform is written directly; no React
 *     state changes, no re-render, no allocation in the loop.
 *   • Bodies are built once into a pooled set of meshes and reused.
 *   • Indicators, brake lights and beacons are emissive-intensity writes on
 *     shared materials — a handful of scalar assignments per frame.
 *   • The whole layer is skipped when the tier is low or the user turns it off.
 *
 * The scene's own time of day drives the lighting: headlights and tail lights
 * come on with the street lamps, which is what makes an evening fly-around read
 * as evening rather than as a dark day.
 */

import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { DayPhase } from '@/lib/environment'
import { sampleRoute, type Neighbourhood, type Person, type Route, type Vehicle } from '@/lib/world'

const GROUND_Y = -0.13

interface Props {
  world: Neighbourhood
  phase: DayPhase
  daylightScale: number
  /** Full detail (wheels, limbs, dog) only where it can be seen. */
  rich: boolean
}

/** Body dimensions per vehicle kind: [width, height, length]. */
const VEHICLE_BOX: Record<Vehicle['kind'], [number, number, number]> = {
  car: [1.82, 0.52, 4.3],
  van: [2.0, 1.5, 5.4],
  bus: [2.5, 2.1, 11],
  truck: [2.4, 2.0, 7.5],
  garbage: [2.4, 2.2, 8],
  ambulance: [2.1, 1.8, 5.8],
  motorbike: [0.5, 0.5, 2.0],
  bicycle: [0.42, 0.5, 1.7],
}

const BODY_COLORS = ['#20242c', '#6b1f22', '#2b3a4d', '#c9c4bc', '#3d5a44', '#8d8f95']
const CLOTHES = ['#3b4a63', '#7a3b3b', '#3f5f47', '#6a5a3a', '#4a3f5f', '#8a8f96', '#2f3a44', '#a06a4a']

export function StreetLife({ world, phase, daylightScale, rich }: Props) {
  const lit = phase === 'night' || phase === 'dusk' || phase === 'goldenHour'
  const night = phase === 'night' || phase === 'dusk'

  const kit = useMemo(() => {
    const K = daylightScale
    const dim = (c: string) => '#' + new THREE.Color(c).multiplyScalar(K).getHexString()
    const S = (c: string, rough = 0.6, metal = 0.2) =>
      new THREE.MeshStandardMaterial({ color: dim(c), roughness: rough, metalness: metal })

    /*
     * Autolack ist zweischichtig — dieselbe Korrektur wie in `Neighbourhood3D`.
     *
     * Vorher `roughness 0.35, metalness 0.5`: ein halb metallischer Körper.
     * Metallizität ist in der Realität binär, eine Fläche ist Leiter oder
     * nicht; Zwischenwerte gibt es nur als Übergang in einer Textur. Ein Auto
     * bei 0.5 ist deshalb kein lackiertes Blech, sondern poliertes Chrom mit
     * Farbstich — und in einer Wohnstraße stehen davon zwanzig.
     *
     * Richtig ist eine pigmentierte, diffuse Basis (metalness 0) unter einem
     * klaren Decklack, der spiegelt: `clearcoat`. Die Spiegelung sitzt dann in
     * der Schicht darüber statt in der Farbe.
     */
    const bodies = BODY_COLORS.map((c) => new THREE.MeshPhysicalMaterial({
      color: dim(c), roughness: 0.45, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2,
    }))
    const clothes = CLOTHES.map((c) => S(c, 0.85, 0))
    // Autoglas ist ein Dielektrikum: metalness 0. Der Wert 0.3 hat die Scheibe
    // wie getöntes Metall spiegeln lassen.
    const glass = new THREE.MeshStandardMaterial({ color: dim('#12151b'), roughness: 0.1, metalness: 0 })
    const tyre = S('#0f1012', 0.95, 0)
    const rim = S('#8b9096', 0.4, 0.7)
    const skin = S('#c9a184', 0.9, 0)
    const dog = S('#6b5340', 0.9, 0)

    // Lights are shared: one material per role, so switching them on at dusk is
    // two writes rather than a walk over every vehicle.
    const head = new THREE.MeshStandardMaterial({
      color: '#dfe6ee', emissive: new THREE.Color(lit ? '#fff2d6' : '#000000'),
      emissiveIntensity: lit ? 2.6 : 0, roughness: 0.2, metalness: 0.6,
    })
    const tail = new THREE.MeshStandardMaterial({
      color: '#6b1418', emissive: new THREE.Color(lit ? '#ff2a20' : '#3a0e0e'),
      emissiveIntensity: lit ? 1.8 : 0.1, roughness: 0.3,
    })
    const indicatorL = new THREE.MeshStandardMaterial({
      color: '#8a6a20', emissive: new THREE.Color('#ff9a20'), emissiveIntensity: 0, roughness: 0.3,
    })
    const indicatorR = indicatorL.clone()
    const beaconBlue = new THREE.MeshStandardMaterial({
      color: '#243a6b', emissive: new THREE.Color('#3a7bff'), emissiveIntensity: 0, roughness: 0.3,
    })

    const all: THREE.Material[] = [...bodies, ...clothes, glass, tyre, rim, skin, dog, head, tail, indicatorL, indicatorR, beaconBlue]
    return { bodies, clothes, glass, tyre, rim, skin, dog, head, tail, indicatorL, indicatorR, beaconBlue, all }
  }, [daylightScale, lit])

  useEffect(() => () => { kit.all.forEach((m) => m.dispose()) }, [kit])

  const vehicleRefs = useRef<(THREE.Group | null)[]>([])
  const personRefs = useRef<(THREE.Group | null)[]>([])
  const limbRefs = useRef<(THREE.Group | null)[]>([])
  const indicatorState = useRef<{ left: number; right: number }>({ left: 0, right: 0 })

  const vehicles = world.vehicles
  const people = world.people
  const vRoutes = world.vehicleRoutes
  const wRoutes = world.walkRoutes

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // One shared blink phase — real indicators all run at ~1.5 Hz anyway, and
    // sharing it keeps this to a single sine per frame instead of one per car.
    const blink = Math.sin(t * 9) > 0 ? 1 : 0
    let anyLeft = false
    let anyRight = false

    for (let i = 0; i < vehicles.length; i++) {
      const g = vehicleRefs.current[i]
      if (!g) continue
      const v = vehicles[i]
      const route: Route | undefined = vRoutes[v.routeIndex]
      if (!route) continue
      const s = sampleRoute(route, v.offsetM + t * v.speedMps)
      g.position.set(s.at.x, GROUND_Y, s.at.z)
      // Heading is measured from +x toward +z; a mesh whose length runs along
      // −z (the way the bodies are built) needs the extra quarter turn.
      g.rotation.y = -s.heading + Math.PI / 2
      // Lean into the corner, just enough to read as weight transfer.
      g.rotation.z = -s.turning * s.cornerT * 0.035
      if (s.turning === -1) anyLeft = true
      if (s.turning === 1) anyRight = true
    }

    if (indicatorState.current.left !== (anyLeft ? blink : 0)) {
      indicatorState.current.left = anyLeft ? blink : 0
      kit.indicatorL.emissiveIntensity = indicatorState.current.left * 3.2
    }
    if (indicatorState.current.right !== (anyRight ? blink : 0)) {
      indicatorState.current.right = anyRight ? blink : 0
      kit.indicatorR.emissiveIntensity = indicatorState.current.right * 3.2
    }
    kit.beaconBlue.emissiveIntensity = (Math.sin(t * 14) > 0.3 ? 1 : 0) * 4

    for (let i = 0; i < people.length; i++) {
      const g = personRefs.current[i]
      if (!g) continue
      const p = people[i]
      const route = wRoutes[p.routeIndex]
      if (!route) continue
      const s = sampleRoute(route, p.offsetM + t * p.speedMps * p.dir)
      g.position.set(s.at.x, GROUND_Y, s.at.z)
      g.rotation.y = -s.heading + Math.PI / 2
      // A gentle bob plus a swinging stride — enough motion to read as walking
      // without any skeletal rig.
      const cadence = p.kind === 'jogger' ? 9 : 5
      g.position.y = GROUND_Y + Math.abs(Math.sin(t * cadence + i)) * (p.kind === 'jogger' ? 0.07 : 0.03)
      const limbs = limbRefs.current[i]
      if (limbs) limbs.rotation.x = Math.sin(t * cadence + i) * (p.kind === 'jogger' ? 0.9 : 0.5)
    }
  })

  return (
    <group>
      {vehicles.map((v, i) => (
        <group key={v.id} ref={(el) => { vehicleRefs.current[i] = el }}>
          {vehicleMesh(v, kit, rich, night)}
        </group>
      ))}
      {people.map((p, i) => (
        <group key={p.id} ref={(el) => { personRefs.current[i] = el }}>
          {personMesh(p, kit, rich, (el) => { limbRefs.current[i] = el })}
        </group>
      ))}
    </group>
  )
}

/** The shared material set every actor draws from. */
interface Kit {
  bodies: THREE.Material[]
  clothes: THREE.Material[]
  glass: THREE.Material
  tyre: THREE.Material
  rim: THREE.Material
  skin: THREE.Material
  dog: THREE.Material
  head: THREE.Material
  tail: THREE.Material
  indicatorL: THREE.MeshStandardMaterial
  indicatorR: THREE.MeshStandardMaterial
  beaconBlue: THREE.MeshStandardMaterial
  all: THREE.Material[]
}

/** Wheels for a four-wheeled body, sized to its box. */
function wheels(box: [number, number, number], kit: Kit, rich: boolean) {
  const [w, , l] = box
  const r = Math.min(0.42, l * 0.09)
  const offsets: [number, number][] = [
    [-w / 2 + 0.12, l * 0.31], [w / 2 - 0.12, l * 0.31],
    [-w / 2 + 0.12, -l * 0.31], [w / 2 - 0.12, -l * 0.31],
  ]
  return offsets.map(([wx, wz], i) => (
    <group key={i} position={[wx, r, wz]} rotation={[0, 0, Math.PI / 2]}>
      <mesh material={kit.tyre}><cylinderGeometry args={[r, r, 0.22, rich ? 12 : 6]} /></mesh>
      {rich && <mesh position={[0, -Math.sign(wx) * 0.12, 0]} material={kit.rim}><cylinderGeometry args={[r * 0.57, r * 0.57, 0.04, 8]} /></mesh>}
    </group>
  ))
}

function vehicleMesh(v: Vehicle, kit: Kit, rich: boolean, night: boolean) {
  const box = VEHICLE_BOX[v.kind]
  const [w, h, l] = box
  const body = kit.bodies[v.colorIndex % kit.bodies.length]

  if (v.kind === 'bicycle' || v.kind === 'motorbike') {
    const r = v.kind === 'bicycle' ? 0.34 : 0.3
    return (
      <group>
        <mesh position={[0, 0.62, 0]} castShadow material={v.kind === 'bicycle' ? kit.clothes[v.colorIndex % kit.clothes.length] : body}>
          <boxGeometry args={[w, 0.34, l]} />
        </mesh>
        {/* Rider: torso and head, facing along the frame. */}
        <mesh position={[0, 1.15, -0.1]} castShadow material={kit.clothes[(v.colorIndex + 2) % kit.clothes.length]}>
          <capsuleGeometry args={[0.17, 0.42, 3, 6]} />
        </mesh>
        <mesh position={[0, 1.55, -0.08]} material={kit.skin}><sphereGeometry args={[0.13, 8, 6]} /></mesh>
        {[l / 2 - 0.2, -l / 2 + 0.2].map((wz, i) => (
          <group key={i} position={[0, r, wz]} rotation={[0, 0, Math.PI / 2]}>
            <mesh material={kit.tyre}><torusGeometry args={[r, 0.035, 4, rich ? 12 : 6]} /></mesh>
          </group>
        ))}
        {night && <mesh position={[0, 0.75, l / 2]} material={kit.head}><sphereGeometry args={[0.06, 6, 5]} /></mesh>}
      </group>
    )
  }

  const isBox = v.kind === 'van' || v.kind === 'bus' || v.kind === 'truck' || v.kind === 'garbage' || v.kind === 'ambulance'
  return (
    <group>
      {isBox ? (
        <>
          <mesh position={[0, h / 2 + 0.32, 0]} castShadow material={v.kind === 'ambulance' ? kit.clothes[5] : body}>
            <boxGeometry args={[w, h, l]} />
          </mesh>
          {/* Cab glazing wraps the front third. */}
          <mesh position={[0, h * 0.75, l / 2 - 0.06]} material={kit.glass}><boxGeometry args={[w * 0.9, h * 0.34, 0.08]} /></mesh>
          {v.kind === 'bus' && rich && Array.from({ length: 5 }).map((_, i) => (
            <mesh key={i} position={[w / 2 + 0.01, h * 0.72, l / 2 - 2 - i * 1.7]} material={kit.glass}><boxGeometry args={[0.04, h * 0.4, 1.3]} /></mesh>
          ))}
          {v.kind === 'garbage' && (
            <mesh position={[0, h + 0.5, -l / 2 + 0.4]} castShadow material={kit.rim}><boxGeometry args={[w * 0.9, 0.7, 0.8]} /></mesh>
          )}
          {v.beacon && (
            <mesh position={[0, h + 0.42, l / 2 - 1.1]} material={kit.beaconBlue}><boxGeometry args={[w * 0.7, 0.14, 0.3]} /></mesh>
          )}
        </>
      ) : (
        <>
          <mesh position={[0, 0.46, 0]} castShadow material={body}><boxGeometry args={[w, h, l]} /></mesh>
          <mesh position={[0, 0.88, -0.2]} castShadow material={body}><boxGeometry args={[w * 0.9, 0.5, l * 0.52]} /></mesh>
          <mesh position={[0, 0.88, -0.2]} material={kit.glass}><boxGeometry args={[w * 0.92, 0.4, l * 0.48]} /></mesh>
        </>
      )}
      {/* Head, tail and corner indicators — the corner lamps are what make a
          turn legible from above, which is where this scene is usually viewed. */}
      {[-1, 1].map((s) => (
        <mesh key={`h${s}`} position={[s * w * 0.32, isBox ? 0.75 : 0.54, l / 2 + 0.02]} material={kit.head}>
          <boxGeometry args={[w * 0.24, 0.1, 0.06]} />
        </mesh>
      ))}
      <mesh position={[0, isBox ? 0.8 : 0.56, -l / 2 - 0.02]} material={kit.tail}><boxGeometry args={[w * 0.8, 0.09, 0.06]} /></mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={`i${s}`}
          position={[s * (w / 2 + 0.02), isBox ? 0.78 : 0.56, l / 2 - 0.25]}
          material={s < 0 ? kit.indicatorL : kit.indicatorR}
        >
          <boxGeometry args={[0.06, 0.1, 0.22]} />
        </mesh>
      ))}
      {wheels(box, kit, rich)}
    </group>
  )
}

function personMesh(p: Person, kit: Kit, rich: boolean, limbRef: (el: THREE.Group | null) => void) {
  const shirt = kit.clothes[p.colorIndex % kit.clothes.length]
  const trousers = kit.clothes[(p.colorIndex + 3) % kit.clothes.length]
  const scale = p.kind === 'child' ? 0.68 : 1

  return (
    <group scale={scale}>
      {/* Torso + head. Deliberately abstract: at this scale a stylised figure
          reads better — and costs a fraction — of an articulated character. */}
      <mesh position={[0, 1.02, 0]} castShadow material={shirt}><capsuleGeometry args={[0.17, 0.46, 3, 6]} /></mesh>
      <mesh position={[0, 1.5, 0]} castShadow material={kit.skin}><sphereGeometry args={[0.135, 8, 6]} /></mesh>
      <group ref={limbRef} position={[0, 0.72, 0]}>
        <mesh position={[-0.09, -0.34, 0]} material={trousers}><capsuleGeometry args={[0.075, 0.5, 3, 5]} /></mesh>
        <mesh position={[0.09, -0.34, 0]} material={trousers}><capsuleGeometry args={[0.075, 0.5, 3, 5]} /></mesh>
      </group>

      {p.kind === 'stroller' && (
        <group position={[0, 0, 0.55]}>
          <mesh position={[0, 0.62, 0]} rotation={[0.3, 0, 0]} castShadow material={kit.rim}><boxGeometry args={[0.46, 0.44, 0.6]} /></mesh>
          <mesh position={[0, 0.9, -0.18]} material={kit.tyre}><cylinderGeometry args={[0.02, 0.02, 0.5, 5]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.22, 0.16, 0.2]} rotation={[0, 0, Math.PI / 2]} material={kit.tyre}><cylinderGeometry args={[0.15, 0.15, 0.05, 8]} /></mesh>
          ))}
        </group>
      )}

      {p.kind === 'dogWalker' && rich && (
        <group position={[0.42, 0, 0.75]}>
          <mesh position={[0, 0.4, 0]} castShadow material={kit.dog}><capsuleGeometry args={[0.11, 0.36, 3, 5]} /></mesh>
          <mesh position={[0, 0.52, 0.26]} material={kit.dog}><sphereGeometry args={[0.1, 6, 5]} /></mesh>
          <mesh position={[0, 0.55, -0.24]} rotation={[0.7, 0, 0]} material={kit.dog}><cylinderGeometry args={[0.02, 0.03, 0.22, 4]} /></mesh>
          {([[-0.07, 0.16], [0.07, 0.16], [-0.07, -0.16], [0.07, -0.16]] as const).map(([dx, dz], i) => (
            <mesh key={i} position={[dx, 0.16, dz]} material={kit.dog}><cylinderGeometry args={[0.025, 0.025, 0.32, 4]} /></mesh>
          ))}
        </group>
      )}

      {p.kind === 'courier' && (
        <mesh position={[0, 1.02, -0.24]} castShadow material={kit.clothes[7]}><boxGeometry args={[0.36, 0.34, 0.26]} /></mesh>
      )}

      {p.kind === 'gardener' && (
        <mesh position={[0.3, 0.7, 0.1]} rotation={[0, 0, 0.5]} material={kit.tyre}><cylinderGeometry args={[0.02, 0.02, 1.1, 5]} /></mesh>
      )}
    </group>
  )
}
