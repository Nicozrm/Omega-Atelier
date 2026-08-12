import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { X, Play, Pause, Home, Trash2, Battery, Clock, Ruler, Loader2, MapPin } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { activeProfile } from '@/lib/render/quality'
import {
  bbox, polygonArea, pathLength, pointInPolygon, buildRoute, flattenRoute, resample,
  type Pt, type RouteSegment,
} from '@/lib/vacuumCoverage'

const M = (cm: number) => cm / 100
const REAL_SPEED = 0.30            // real Roborock ~0.3 m/s (drives the shown duration)
const SIM_SPEED = 1.15             // scene m/s — a watchable pace, not real-time

// Muted per-room segmentation tints (Roborock-style room colouring, tuned for
// the dark Noir map so they read as distinct rooms without glare).
const ROOM_TINTS = ['#3b4b5e', '#4b4257', '#3f5248', '#564b3a', '#4a3f50', '#38545a', '#524a4a', '#414a5e', '#455c4e', '#5c4550']

type Phase = 'idle' | 'cleaning' | 'paused' | 'charging'
interface Stats { areaCleaned: number; areaTotal: number; battery: number; minutes: number; phase: Phase; room: string }

// ── The map: room-segmented floors + low walls, Roborock look ──
function MapMesh({ rooms, walls }: {
  rooms: Array<{ id: string; name: string; poly: Pt[] }>
  walls: Array<{ a: Pt; b: Pt; thickness: number }>
}) {
  const floors = useMemo(() => rooms.map((r, i) => {
    const shape = new THREE.Shape()
    r.poly.forEach((p, k) => (k === 0 ? shape.moveTo(M(p.x), M(p.y)) : shape.lineTo(M(p.x), M(p.y))))
    shape.closePath()
    const geo = new THREE.ShapeGeometry(shape)
    return { id: r.id, geo, tint: ROOM_TINTS[i % ROOM_TINTS.length] }
  }), [rooms])

  useEffect(() => () => floors.forEach((f) => f.geo.dispose()), [floors])

  return (
    <group>
      {/* Room-segmented floor slabs (soft distinct tints, like a Roborock map) */}
      {floors.map((f) => (
        <mesh key={f.id} geometry={f.geo} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <meshStandardMaterial
            color={f.tint}
            roughness={0.95}
            metalness={0}
            emissive={f.tint}
            emissiveIntensity={0.12}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* Walls — extruded low grey blocks, the Roborock "carved" look */}
      {walls.map((w, i) => {
        const ax = M(w.a.x), az = M(w.a.y), bx = M(w.b.x), bz = M(w.b.y)
        const len = Math.hypot(bx - ax, bz - az)
        if (len < 0.02) return null
        const midX = (ax + bx) / 2, midZ = (az + bz) / 2
        const angle = Math.atan2(bz - az, bx - ax)
        const th = Math.max(0.06, M(w.thickness))
        return (
          <mesh key={i} position={[midX, 0.16, midZ]} rotation={[0, -angle, 0]} castShadow receiveShadow>
            <boxGeometry args={[len + th, 0.32, th]} />
            <meshStandardMaterial color="#5a5f68" roughness={0.9} metalness={0.05} />
          </mesh>
        )
      })}
    </group>
  )
}

// ── The dock (charging base) ──
function Dock({ at }: { at: Pt }) {
  return (
    <group position={[M(at.x), 0, M(at.y)]}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[0.34, 0.06, 0.24]} />
        <meshStandardMaterial color="#e8e9ec" roughness={0.5} metalness={0.1} />
      </mesh>
      <mesh position={[0, 0.14, -0.09]} castShadow>
        <boxGeometry args={[0.30, 0.22, 0.05]} />
        <meshStandardMaterial color="#d6d8dc" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.05, 0.02]}>
        <boxGeometry args={[0.14, 0.02, 0.02]} />
        <meshStandardMaterial color="#41bd84" emissive="#41bd84" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ── The robot + growing cleaning trail + swept-area fill; drives the sim ──
function RobotRunner({ route, rooms, dock, extent, phase, onStats, resetKey }: {
  route: RouteSegment[]
  rooms: Array<{ name: string; poly: Pt[] }>
  dock: Pt
  extent: { width: number; height: number }
  phase: Phase
  onStats: (s: Partial<Stats>) => void
  resetKey: number
}) {
  const groupRef = useRef<THREE.Group>(null)

  // Precompute the resampled path (metres for the scene, cm for painting).
  const plan = useMemo(() => {
    const flatCm = flattenRoute(dock, route)
    const rs = resample(flatCm, 4)
    const pts = rs.map((p) => new THREE.Vector3(M(p.x), 0.05, M(p.y)))
    return { pts, cm: rs, lenM: pathLength(rs) / 100 }
  }, [route, dock])

  // Trail line with progressive reveal.
  const trail = useMemo(() => {
    const positions = new Float32Array(plan.pts.length * 3)
    plan.pts.forEach((v, i) => { positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setDrawRange(0, 0)
    const mat = new THREE.LineBasicMaterial({ color: '#8fe0ff', transparent: true, opacity: 0.85, toneMapped: false })
    return new THREE.Line(geo, mat)
  }, [plan])

  useEffect(() => () => { trail.geometry.dispose(); (trail.material as THREE.Material).dispose() }, [trail])

  // Swept-area fill: a canvas texture on a ground plane that we paint with a
  // soft brush along the robot's path — the signature Roborock "cleaned" region.
  const fill = useMemo(() => {
    const s = Math.min(900 / extent.width, 900 / extent.height, 0.8) // px per cm
    const CW = Math.max(64, Math.round(extent.width * s))
    const CH = Math.max(64, Math.round(extent.height * s))
    const canvas = document.createElement('canvas')
    canvas.width = CW; canvas.height = CH
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    const geo = new THREE.PlaneGeometry(M(extent.width), M(extent.height))
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = Math.PI / 2
    mesh.position.set(M(extent.width) / 2, 0.03, M(extent.height) / 2)
    return { ctx, tex, mesh, CW, CH, r: 22 * s } // r: brush radius in px (~22 cm)
  }, [extent])

  useEffect(() => () => { fill.tex.dispose(); fill.mesh.geometry.dispose(); (fill.mesh.material as THREE.Material).dispose() }, [fill])

  const stampedIdx = useRef(0)
  const paintTo = (count: number) => {
    const { ctx, CW, CH, r } = fill
    const cm = plan.cm
    for (let i = stampedIdx.current; i < count && i < cm.length; i++) {
      const px = (cm[i].x / extent.width) * CW
      const py = (1 - cm[i].y / extent.height) * CH
      const g = ctx.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, 'rgba(120,208,255,0.85)')
      g.addColorStop(0.65, 'rgba(96,196,255,0.5)')
      g.addColorStop(1, 'rgba(96,196,255,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill()
    }
    if (count > stampedIdx.current) { stampedIdx.current = count; fill.tex.needsUpdate = true }
  }

  const dist = useRef(0)            // metres travelled
  const lastReport = useRef(0)
  const areaTotal = useMemo(() => route.reduce((a, s) => a + s.area, 0) / 10000, [route]) // m²

  // Reset progress when the route or a new run starts.
  useEffect(() => {
    dist.current = 0
    trail.geometry.setDrawRange(0, 0)
    stampedIdx.current = 0
    fill.ctx.clearRect(0, 0, fill.CW, fill.CH)
    fill.tex.needsUpdate = true
  }, [resetKey, trail, fill])

  useFrame((_, dt) => {
    const g = groupRef.current
    if (!g) return
    const pts = plan.pts
    if (pts.length < 2) return
    const totalLen = plan.lenM

    if (phase === 'cleaning' && dist.current < totalLen) {
      dist.current = Math.min(totalLen, dist.current + dt * SIM_SPEED)
    }
    const frac = totalLen > 0 ? dist.current / totalLen : 0
    const fIdx = frac * (pts.length - 1)
    const i0 = Math.min(pts.length - 1, Math.floor(fIdx))
    const i1 = Math.min(pts.length - 1, i0 + 1)
    const t = fIdx - i0
    const p = pts[i0].clone().lerp(pts[i1], t)
    g.position.set(p.x, 0, p.z)
    // face travel direction
    const dir = pts[i1].clone().sub(pts[i0])
    if (dir.lengthSq() > 1e-6) g.rotation.y = Math.atan2(dir.x, dir.z)

    // reveal trail up to the robot + paint the swept-area fill
    const revealed = Math.max(2, Math.floor(frac * pts.length))
    trail.geometry.setDrawRange(0, revealed)
    paintTo(revealed)

    // report stats ~6×/s
    lastReport.current += dt
    if (lastReport.current > 0.16) {
      lastReport.current = 0
      const minutes = (dist.current / REAL_SPEED) / 60
      const here = { x: p.x * 100, y: p.z * 100 }   // robot position in cm
      const room = rooms.find((r) => pointInPolygon(here, r.poly))?.name ?? ''
      onStats({
        areaCleaned: areaTotal * frac,
        areaTotal,
        minutes,
        room,
        // battery: 100 → ~55 over a full run
        battery: Math.max(4, Math.round(100 - frac * 45)),
      })
    }
  })

  return (
    <group>
      <primitive object={fill.mesh} />
      <primitive object={trail} />
      <group ref={groupRef} position={[M(dock.x), 0, M(dock.y)]}>
        {/* body */}
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.17, 0.17, 0.09, 32]} />
          <meshStandardMaterial color="#2b2e35" roughness={0.5} metalness={0.2} />
        </mesh>
        {/* top plate */}
        <mesh position={[0, 0.098, 0]}>
          <cylinderGeometry args={[0.165, 0.165, 0.008, 32]} />
          <meshStandardMaterial color="#3a3e46" roughness={0.4} metalness={0.3} />
        </mesh>
        {/* LIDAR turret */}
        <mesh position={[0, 0.125, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.05, 20]} />
          <meshStandardMaterial color="#1c1e23" roughness={0.6} />
        </mesh>
        {/* front bumper indicator */}
        <mesh position={[0, 0.05, 0.15]}>
          <boxGeometry args={[0.12, 0.05, 0.02]} />
          <meshStandardMaterial color="#63c9ff" emissive="#63c9ff" emissiveIntensity={1.2} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function Rig({ span, cx, cz }: { span: number; cx: number; cz: number }) {
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update: () => void } | null
  const cam = useThree((s) => s.camera)
  useEffect(() => {
    const d = span * 1.05
    cam.position.set(cx + d * 0.55, d * 0.95, cz + d * 0.9)
    cam.lookAt(cx, 0, cz)
    if (controls) { controls.target.set(cx, 0, cz); controls.update() }
  }, [span, cx, cz, cam, controls])
  return null
}

export function VacuumRobotView({ onClose }: { onClose: () => void }) {
  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo(() => doc?.floors.find((f) => f.id === doc?.activeFloorId) ?? doc?.floors[0], [doc])

  const rooms = useMemo(
    () => (floor?.rooms ?? []).filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)
      .map((r) => ({ id: r.id, name: r.name, poly: r.polygon as Pt[] })),
    [floor],
  )
  const walls = useMemo(() => (floor?.walls ?? []).map((w) => ({ a: w.a as Pt, b: w.b as Pt, thickness: w.thickness })), [floor])
  const extent = useMemo(() => floor?.extent ?? { width: 1000, height: 800 }, [floor])

  // Dock: near a corner of the first room (by the wall).
  const dock = useMemo<Pt>(() => {
    if (!rooms.length) return { x: 40, y: 40 }
    const b = bbox(rooms[0].poly)
    return { x: b.minX + 45, y: b.minY + 45 }
  }, [rooms])

  const [mode, setMode] = useState<'alles' | 'raum' | 'zone'>('alles')
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [resetKey, setResetKey] = useState(0)
  const [stats, setStats] = useState<Stats>({ areaCleaned: 0, areaTotal: 0, battery: 100, minutes: 0, phase: 'idle', room: '' })

  // The active route depends on the mode/room selection.
  const activeRooms = useMemo(() => {
    if ((mode === 'raum' || mode === 'zone') && selectedRoom) return rooms.filter((r) => r.id === selectedRoom)
    return rooms
  }, [mode, selectedRoom, rooms])
  const route = useMemo(() => buildRoute(activeRooms, dock, 26, 16), [activeRooms, dock])

  const homeArea = useMemo(() => rooms.reduce((a, r) => a + polygonArea(r.poly), 0) / 10000, [rooms])

  const cx = M(extent.width) / 2, cz = M(extent.height) / 2
  const span = Math.max(M(extent.width), M(extent.height))
  // This view is a single storey seen from above, so it can live one step below
  // the plan view's budget — but the *ceiling* still has to be the profile's.
  const vacuumShadowMap = Math.min(2048, activeProfile().shadowMapSize)

  function start() {
    if ((mode === 'raum' || mode === 'zone') && !selectedRoom) { useUIStore.getState().pushToast({ kind: 'info', title: 'Raum wählen', description: 'Tippe unten einen Raum an.' }); return }
    setResetKey((k) => k + 1)
    setPhase('cleaning')
  }
  const statsRef = useRef<Stats>(stats)
  statsRef.current = stats
  const done = stats.areaTotal > 0 && stats.areaCleaned >= stats.areaTotal - 0.01
  useEffect(() => { if (phase === 'cleaning' && done) setPhase('charging') }, [phase, done])
  // One completion summary when a run finishes and the robot heads to the dock.
  useEffect(() => {
    if (phase !== 'charging') return
    const s = statsRef.current
    useUIStore.getState().pushToast({
      kind: 'success',
      title: 'Reinigung abgeschlossen',
      description: `${s.areaCleaned.toFixed(1)} m² in ${Math.max(1, Math.floor(s.minutes))} min · zurück zur Basis`,
    })
  }, [phase])

  const statusLabel = phase === 'cleaning' ? `Reinigt${stats.room ? ' · ' + stats.room : ''}…`
    : phase === 'paused' ? 'Pausiert'
    : phase === 'charging' ? 'Fertig · lädt'
    : 'Bereit'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0c0d10] omega-noise animate-pop-in">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)]">
        <div className="flex items-center gap-2.5">
          <MapPin size={18} className="text-[color:var(--accent)]" />
          <div>
            <div className="text-[14px] font-semibold">Saugroboter · Karte</div>
            <div className="text-[11px] text-[color:var(--muted)]">{statusLabel}</div>
          </div>
        </div>
        <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Schließen"><X size={18} /></button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-px bg-[color:var(--border)] border-b border-[color:var(--border)]">
        <Stat icon={<Ruler size={14} />} value={`${stats.areaCleaned.toFixed(1)} m²`} label={`von ${homeArea.toFixed(1)} m²`} />
        <Stat icon={<Battery size={14} />} value={`${stats.battery}%`} label="Akkustand" />
        <Stat icon={<Clock size={14} />} value={`${Math.floor(stats.minutes)} min`} label="Reinigungsdauer" />
      </div>

      {/* Map */}
      <div className="relative flex-1 min-h-0">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [span, span, span], fov: 34 }}
          gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
          style={{ background: 'radial-gradient(120% 120% at 50% 20%, #16181d 0%, #0c0d10 70%)' }}
        >
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#cfd6e2', '#20242c', 0.5]} />
          <directionalLight
            position={[cx + span * 0.5, span * 1.4, cz + span * 0.2]}
            intensity={1.1} castShadow
            // Same budget source as the main 3D view: a flat 2048 here meant a
            // phone opening the robot map paid a 2048² depth pass for a scene
            // it can barely afford to shade.
            shadow-mapSize-width={vacuumShadowMap} shadow-mapSize-height={vacuumShadowMap}
            shadow-camera-near={0.5} shadow-camera-far={span * 4}
            shadow-camera-left={-span} shadow-camera-right={span}
            shadow-camera-top={span} shadow-camera-bottom={-span}
            shadow-bias={-0.0004}
          />
          <Rig span={span} cx={cx} cz={cz} />
          <MapMesh rooms={rooms} walls={walls} />
          <Dock at={dock} />
          <RobotRunner route={route} rooms={rooms} dock={dock} extent={extent} phase={phase} resetKey={resetKey}
            onStats={(s) => setStats((prev) => ({ ...prev, ...s, phase }))} />
          <ContactShadows position={[cx, 0.01, cz]} scale={span * 2.2} blur={2.2} opacity={0.45} far={span} resolution={1024} color="#000000" />
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={span * 0.4} maxDistance={span * 2.4} maxPolarAngle={Math.PI / 2.15} target={[cx, 0, cz]} />
        </Canvas>

        {/* Room chips (Raum/Zone mode) */}
        {(mode === 'raum' || mode === 'zone') && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 max-w-[92%] overflow-x-auto px-1.5 py-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setSelectedRoom(r.id)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] transition-colors ${selectedRoom === r.id ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'}`}>
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="absolute bottom-3 left-4 z-10 text-[10px] text-[color:var(--muted)]">Drag drehen · Scroll zoomen</div>
      </div>

      {/* Controls */}
      <div className="border-t border-[color:var(--border)] px-4 py-3 space-y-3">
        {/* Mode tabs */}
        <div className="flex items-center justify-center gap-0.5 p-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-2)] w-fit mx-auto">
          {([['alles', 'Alles'], ['raum', 'Raum'], ['zone', 'Zone']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${mode === k ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-center gap-2.5">
          <button onClick={() => useUIStore.getState().pushToast({ kind: 'info', title: 'Staubbehälter', description: 'Entleeren gestartet.' })}
            className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"><Trash2 size={15} /> Staubbehälter</button>
          {phase === 'cleaning' ? (
            <button onClick={() => setPhase('paused')} className="btn btn-primary inline-flex items-center gap-2 px-6"><Pause size={16} /> Stopp</button>
          ) : (
            <button onClick={phase === 'paused' ? () => setPhase('cleaning') : start} className="btn btn-primary inline-flex items-center gap-2 px-6">
              {phase === 'charging' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {phase === 'paused' ? 'Weiter' : 'Reinigen'}
            </button>
          )}
          <button onClick={() => { setPhase('idle'); setResetKey((k) => k + 1); setStats((s) => ({ ...s, areaCleaned: 0, minutes: 0, battery: 100 })) }}
            className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"><Home size={15} /> Zur Basis</button>
        </div>
      </div>
    </div>
  )
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center bg-[#0c0d10] py-3">
      <div className="flex items-center gap-1.5 text-[color:var(--accent)]">{icon}<span className="text-[17px] font-semibold tabular-nums text-[color:var(--fg)]">{value}</span></div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mt-0.5">{label}</div>
    </div>
  )
}
