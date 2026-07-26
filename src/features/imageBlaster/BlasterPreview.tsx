/**
 * BlasterPreview — the live 3D viewport of the Image Blaster studio.
 *
 * Renders the generated MeshData with its PBR maps under a small studio
 * lighting rig (key/fill/rim + contact shadows — no network HDRIs, the app
 * is an offline-capable PWA). Exposes an imperative api (snapshot, reset,
 * current mesh for the exporters) through `apiRef`.
 */

import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { pixelsToCanvas } from './useBlasterEngine'
import type { BlasterResult } from './useBlasterEngine'
import type { MaterialSettings, MeshMode } from '@/lib/imageBlaster'

export interface BlasterPreviewApi {
  /** PNG data-URL of the current framing, or null when unavailable. */
  snapshot: () => string | null
  /** The live object (textured mesh, or point cloud) for the exporters. */
  getObject: () => THREE.Object3D | null
  resetView: () => void
}

interface Props {
  result: BlasterResult
  material: MaterialSettings
  mode: MeshMode
  /** Point diameter in world units (points mode). */
  pointSize: number
  wireframe: boolean
  turntable: boolean
  apiRef: MutableRefObject<BlasterPreviewApi | null>
}

/** Shared turntable wrapper. */
function Turntable({ turntable, children }: { turntable: boolean; children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (turntable && groupRef.current) groupRef.current.rotation.y += delta * 0.45
  })
  return <group ref={groupRef}>{children}</group>
}

interface BlasterPointsProps {
  cloud: NonNullable<BlasterResult['pointCloud']>
  pointSize: number
  turntable: boolean
  pointsRef: RefObject<THREE.Points>
}

function BlasterPoints({ cloud, pointSize, turntable, pointsRef }: BlasterPointsProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3))
    return g
  }, [cloud])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <Turntable turntable={turntable}>
      <points ref={pointsRef} geometry={geometry}>
        {/* toneMapped=false keeps the sampled image colors vivid — ACES would
            wash the tiny points out against the dark studio backdrop. */}
        <pointsMaterial vertexColors size={pointSize} sizeAttenuation toneMapped={false} />
      </points>
    </Turntable>
  )
}

interface BlasterMeshProps {
  result: BlasterResult
  meshData: NonNullable<BlasterResult['meshData']>
  material: MaterialSettings
  mode: MeshMode
  wireframe: boolean
  turntable: boolean
  meshRef: RefObject<THREE.Mesh>
}

function BlasterMesh({ result, meshData, material, mode, wireframe, turntable, meshRef }: BlasterMeshProps) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(meshData.indices, 1))
    return g
  }, [meshData])

  const maps = useMemo(() => {
    const albedo = new THREE.CanvasTexture(pixelsToCanvas(result.albedo))
    albedo.flipY = false // UVs are authored top-down; keeps glTF exports aligned
    albedo.colorSpace = THREE.SRGBColorSpace
    albedo.anisotropy = 4

    const normal = new THREE.CanvasTexture(pixelsToCanvas(result.normalMap))
    normal.flipY = false

    let roughness: THREE.CanvasTexture | null = null
    if (result.roughnessMap) {
      roughness = new THREE.CanvasTexture(pixelsToCanvas(result.roughnessMap))
      roughness.flipY = false
    }

    let alpha: THREE.CanvasTexture | null = null
    if (mode === 'billboard') {
      // Billboard cutout — the segmentation mask becomes the alpha map.
      const p = result.mask
      const rgba = new Uint8ClampedArray(p.width * p.height * 4)
      for (let i = 0; i < p.data.length; i++) {
        const v = Math.max(0, Math.min(1, p.data[i])) * 255
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255
      }
      alpha = new THREE.CanvasTexture(pixelsToCanvas({ data: rgba, width: p.width, height: p.height }))
      alpha.flipY = false
    }
    return { albedo, normal, roughness, alpha }
  }, [result.albedo, result.normalMap, result.roughnessMap, result.mask, mode])

  // Dispose GPU resources when maps/geometry are replaced or unmounted.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => {
    maps.albedo.dispose()
    maps.normal.dispose()
    maps.roughness?.dispose()
    maps.alpha?.dispose()
  }, [maps])

  return (
    <Turntable turntable={turntable}>
      <mesh ref={meshRef} geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          map={maps.albedo}
          normalMap={maps.normal}
          roughnessMap={maps.roughness ?? undefined}
          alphaMap={maps.alpha ?? undefined}
          transparent={mode === 'billboard'}
          alphaTest={mode === 'billboard' ? 0.5 : 0}
          metalness={material.metalness}
          roughness={material.roughness}
          side={material.doubleSided || mode === 'billboard' ? THREE.DoubleSide : THREE.FrontSide}
          wireframe={wireframe}
          envMapIntensity={0.9}
        />
      </mesh>
    </Turntable>
  )
}

function StudioRig() {
  return (
    <>
      <hemisphereLight args={['#cdd8ea', '#1a1410', 0.55]} />
      <directionalLight
        position={[2.2, 3, 2.5]}
        intensity={2.1}
        color="#fff2df"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
      />
      <directionalLight position={[-2.5, 1.2, -1.5]} intensity={0.5} color="#7fb2ff" />
      <directionalLight position={[0, 1.5, -3]} intensity={0.9} color="#ffd9a8" />
    </>
  )
}

export function BlasterPreview({ result, material, mode, pointSize, wireframe, turntable, apiRef }: Props) {
  const meshRef = useRef<THREE.Mesh>(null)
  const pointsRef = useRef<THREE.Points>(null)
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const glRef = useRef<THREE.WebGLRenderer | null>(null)

  useEffect(() => {
    apiRef.current = {
      snapshot: () => glRef.current?.domElement.toDataURL('image/png') ?? null,
      getObject: () => meshRef.current ?? pointsRef.current,
      resetView: () => controlsRef.current?.reset(),
    }
    return () => { apiRef.current = null }
  }, [apiRef])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0.75, 0.45, 1.35], fov: 40 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
        glRef.current = gl
      }}
      style={{ background: 'transparent' }}
    >
      <StudioRig />
      {result.pointCloud ? (
        <BlasterPoints
          cloud={result.pointCloud}
          pointSize={pointSize}
          turntable={turntable}
          pointsRef={pointsRef}
        />
      ) : result.meshData ? (
        <BlasterMesh
          result={result}
          meshData={result.meshData}
          material={material}
          mode={mode}
          wireframe={wireframe}
          turntable={turntable}
          meshRef={meshRef}
        />
      ) : null}
      <ContactShadows position={[0, -0.62, 0]} opacity={0.55} scale={4} blur={2.4} far={1.4} resolution={512} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        minDistance={0.5}
        maxDistance={4}
        target={[0, 0, 0]}
      />
    </Canvas>
  )
}
