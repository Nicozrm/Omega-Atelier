/**
 * BlasterAsset3D — renders a placed Image-Blaster asset inside the 3D scene.
 *
 * The plan stores only the recipe (source data-URL + settings snapshot); this
 * component re-runs the deterministic pipeline in the browser and caches the
 * result per recipe, so switching floors/views never recomputes. Geometry and
 * textures are shared across instances of the same recipe; materials are
 * per-instance (they depend on placement size in points mode).
 */

import { useEffect, useState } from 'react'
import * as THREE from 'three'
import type { PlacedBlasterAsset } from '@/types'
import {
  buildBillboardMesh,
  buildExtrudeMesh,
  buildPointCloud,
  buildReliefMesh,
  downsample,
  estimateDepth,
  normalMapFromDepth,
  normalizeSettings,
  roughnessMapFromImage,
  segmentMask,
  type BlasterSettings,
  type PixelGrid,
} from '@/lib/imageBlaster'

const M = (cm: number) => cm / 100
/** Work resolution for in-plan assets — lighter than the studio's. */
const PLAN_WORK_EDGE = 224
const PLAN_ALBEDO_EDGE = 512

interface BuiltMesh {
  kind: 'mesh'
  geometry: THREE.BufferGeometry
  albedo: THREE.Texture
  normal: THREE.Texture
  roughness: THREE.Texture | null
  settings: BlasterSettings
}
interface BuiltPoints {
  kind: 'points'
  geometry: THREE.BufferGeometry
  settings: BlasterSettings
}
type Built = BuiltMesh | BuiltPoints

// Recipe → build promise. Assets per plan are few and recipes are stable, so
// entries live for the session (no GPU disposal churn on floor/view switches).
const buildCache = new Map<string, Promise<Built>>()

function pixelsToTexture(p: PixelGrid, srgb: boolean): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = p.width
  canvas.height = p.height
  canvas.getContext('2d')?.putImageData(
    new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0,
  )
  const tex = new THREE.CanvasTexture(canvas)
  tex.flipY = false // UVs are authored top-down (see lib/imageBlaster/mesh.ts)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

async function decodeDataUrl(url: string): Promise<PixelGrid> {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = Math.min(1, PLAN_ALBEDO_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  return { data: data.data, width: w, height: h }
}

function geometryFrom(positions: Float32Array, extras: (g: THREE.BufferGeometry) => void): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  extras(g)
  return g
}

async function buildAsset(image: string, rawSettings: unknown): Promise<Built> {
  const settings = normalizeSettings(rawSettings)
  const full = await decodeDataUrl(image)
  const work = downsample(full, PLAN_WORK_EDGE)
  const depth = estimateDepth(work, settings.depth)

  if (settings.mesh.mode === 'points') {
    const cloud = buildPointCloud(depth, work, settings.mesh)
    const geometry = geometryFrom(cloud.positions, (g) => {
      g.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3))
    })
    return { kind: 'points', geometry, settings }
  }

  let meshData
  if (settings.mesh.mode === 'relief') {
    meshData = buildReliefMesh(depth, settings.mesh)
  } else if (settings.mesh.mode === 'extrude') {
    const mask = segmentMask(work, settings.mesh.segmentSource, settings.mesh.threshold)
    meshData = buildExtrudeMesh(mask, settings.mesh) ?? buildReliefMesh(depth, settings.mesh)
  } else {
    meshData = buildBillboardMesh(work.width, work.height)
  }
  const geometry = geometryFrom(meshData.positions, (g) => {
    g.setAttribute('normal', new THREE.BufferAttribute(meshData.normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(meshData.uvs, 2))
    g.setIndex(new THREE.BufferAttribute(meshData.indices, 1))
  })
  return {
    kind: 'mesh',
    geometry,
    albedo: pixelsToTexture(full, true),
    normal: pixelsToTexture(normalMapFromDepth(depth, settings.material.normalStrength), false),
    roughness: settings.material.roughnessFromImage
      ? pixelsToTexture(roughnessMapFromImage(work, settings.material.roughness), false)
      : null,
    settings,
  }
}

function getBuilt(image: string, rawSettings: unknown): Promise<Built> {
  const key = `${image}|${JSON.stringify(rawSettings)}`
  let p = buildCache.get(key)
  if (!p) {
    p = buildAsset(image, rawSettings)
    buildCache.set(key, p)
    p.catch(() => buildCache.delete(key)) // don't cache failures
  }
  return p
}

export function BlasterAsset3D({ asset }: { asset: PlacedBlasterAsset }) {
  const [built, setBuilt] = useState<Built | null>(null)

  useEffect(() => {
    let alive = true
    getBuilt(asset.image, asset.settings).then(
      (b) => { if (alive) setBuilt(b) },
      () => { /* unrenderable recipe — asset stays invisible */ },
    )
    return () => { alive = false }
  }, [asset.image, asset.settings])

  if (!built) return null

  const s = M(asset.width) // recipe meshes span 1 unit on the longer edge
  const rot = (asset.rotation * Math.PI) / 180

  return (
    <group
      position={[M(asset.position.x), M(asset.elevation), M(asset.position.y)]}
      rotation={[0, rot, 0]}
      scale={[s, s, s]}
    >
      {built.kind === 'points' ? (
        <points geometry={built.geometry}>
          {/* PointsMaterial.size ignores object scale → bake the scale in. */}
          <pointsMaterial
            vertexColors
            sizeAttenuation
            toneMapped={false}
            size={built.settings.mesh.pointSize * s}
          />
        </points>
      ) : (
        <mesh geometry={built.geometry} castShadow receiveShadow>
          <meshStandardMaterial
            map={built.albedo}
            normalMap={built.normal}
            roughnessMap={built.roughness ?? undefined}
            transparent={built.settings.mesh.mode === 'billboard'}
            alphaTest={built.settings.mesh.mode === 'billboard' ? 0.5 : 0}
            metalness={built.settings.material.metalness}
            roughness={built.settings.material.roughness}
            side={
              built.settings.material.doubleSided || built.settings.mesh.mode === 'billboard'
                ? THREE.DoubleSide
                : THREE.FrontSide
            }
            envMapIntensity={0.8}
          />
        </mesh>
      )}
    </group>
  )
}
