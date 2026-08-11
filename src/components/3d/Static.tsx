/**
 * Static.tsx — draw-call batching for scenery that never moves.
 *
 * The generated world is thousands of small meshes: kerbs, sills, fence posts,
 * bins, gutters. Drawn individually they would swamp the renderer, but they all
 * share a handful of materials and none of them ever moves, so they can be
 * merged into one geometry per material and drawn in a single call.
 *
 * `Static` does exactly that on mount: it walks its subtree, groups meshes by a
 * full material signature (see `materialSignature`), merges each group into one
 * baked mesh, and hides the originals. `freeze` additionally marks the group's
 * matrices as non-auto-updating, which removes it from the per-frame matrix
 * walk entirely.
 *
 * Extracted from the 3D view so the neighbourhood renderer can batch the same
 * way without importing the view itself.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const BATCH_MIN = 8 // below this a merge isn't worth the memory

// The scene builds materials ad-hoc per mesh, so thousands of visually
// IDENTICAL materials exist as separate instances — grouping by `uuid` would
// therefore almost never find a batch. This hashes what actually reaches the
// shader instead, so equal-looking surfaces batch together. Any property that
// changes the pixels must be part of the signature.
const MAT_NUM_KEYS = [
  'roughness', 'metalness', 'opacity', 'emissiveIntensity', 'envMapIntensity',
  'bumpScale', 'displacementScale', 'clearcoat', 'clearcoatRoughness',
  'transmission', 'ior', 'thickness', 'reflectivity', 'sheen', 'alphaTest',
  'aoMapIntensity', 'normalScale',
] as const
const MAT_FLAG_KEYS = [
  'side', 'flatShading', 'vertexColors', 'wireframe', 'toneMapped',
  'depthWrite', 'depthTest', 'transparent', 'fog', 'dithering', 'premultipliedAlpha',
] as const
const MAT_MAP_KEYS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'bumpMap', 'alphaMap', 'displacementMap', 'lightMap', 'envMap', 'clearcoatMap',
] as const

export function materialSignature(m: THREE.Material): string {
  const any = m as unknown as Record<string, unknown>
  const parts: string[] = [m.type]
  for (const c of ['color', 'emissive', 'specular', 'attenuationColor', 'sheenColor'] as const) {
    const col = any[c] as THREE.Color | undefined
    if (col && typeof (col as THREE.Color).getHexString === 'function') parts.push(c + ':' + col.getHexString())
  }
  for (const k of MAT_NUM_KEYS) {
    const v = any[k]
    if (typeof v === 'number') parts.push(k + ':' + v.toFixed(4))
    else if (v && typeof (v as THREE.Vector2).x === 'number') parts.push(k + ':' + (v as THREE.Vector2).x.toFixed(3) + ',' + (v as THREE.Vector2).y.toFixed(3))
  }
  for (const k of MAT_FLAG_KEYS) {
    const v = any[k]
    if (v !== undefined) parts.push(k + ':' + String(v))
  }
  for (const k of MAT_MAP_KEYS) {
    const t = any[k] as THREE.Texture | null | undefined
    if (!t) continue
    // Same texture with different tiling/offset shades differently.
    parts.push(k + ':' + t.uuid + '@' + t.repeat.x.toFixed(3) + ',' + t.repeat.y.toFixed(3) + '+' + t.offset.x.toFixed(3) + ',' + t.offset.y.toFixed(3) + ':' + t.colorSpace)
  }
  return parts.join('|')
}

export function batchStatic(g: THREE.Group, minBatch = BATCH_MIN): { created: THREE.Mesh[]; hidden: THREE.Mesh[] } {
  const created: THREE.Mesh[] = []
  const hidden: THREE.Mesh[] = []
  const groups = new Map<string, THREE.Mesh[]>()

  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return
    if (!m.visible) return
    const mat = m.material
    if (!mat || Array.isArray(mat)) return
    // Transparent meshes depend on per-object depth sorting — merging them
    // would collapse that ordering, so they keep their own draw calls.
    if ((mat as THREE.Material).transparent) return
    const geo = m.geometry
    if (!geo?.attributes?.position) return
    if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) return
    const attrs = Object.keys(geo.attributes).sort().join(',')
    const key = [
      materialSignature(mat as THREE.Material), attrs, geo.index ? 'i' : 'n',
      m.castShadow ? 1 : 0, m.receiveShadow ? 1 : 0, m.renderOrder, m.layers.mask,
    ].join('|')
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  })

  // Bake into the container's space, not world space, so a transformed
  // container doesn't apply its matrix a second time.
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert()
  const local = new THREE.Matrix4()

  for (const list of groups.values()) {
    if (list.length < minBatch) continue
    const parts: THREE.BufferGeometry[] = []
    for (const m of list) {
      const c = m.geometry.clone()
      local.multiplyMatrices(inv, m.matrixWorld)
      c.applyMatrix4(local) // also transforms normals via the normal matrix
      parts.push(c)
    }
    let merged: THREE.BufferGeometry | null = null
    try { merged = mergeGeometries(parts, false) } catch { merged = null }
    parts.forEach((c) => c.dispose())
    if (!merged) continue

    const first = list[0]
    const mesh = new THREE.Mesh(merged, first.material as THREE.Material)
    mesh.castShadow = first.castShadow
    mesh.receiveShadow = first.receiveShadow
    mesh.renderOrder = first.renderOrder
    mesh.layers.mask = first.layers.mask
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    g.add(mesh)
    created.push(mesh)
    for (const m of list) { m.visible = false; hidden.push(m) }
  }
  return { created, hidden }
}

export function Static({ children, batch = true, freeze = true, minBatch = BATCH_MIN }: {
  children: React.ReactNode; batch?: boolean; freeze?: boolean; minBatch?: number
}) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    const g = ref.current
    if (!g) return
    g.updateMatrixWorld(true)
    const { created, hidden } = batch ? batchStatic(g, minBatch) : { created: [], hidden: [] }
    g.updateMatrixWorld(true)
    // Freezing is for scenery that never moves. A batched subtree that still
    // animates (hover lift on a piece of furniture) must keep its matrices
    // live, or the merged geometry stops following its parent.
    if (freeze) g.traverse((o) => { o.matrixWorldAutoUpdate = false })
    return () => {
      if (freeze) g.traverse((o) => { o.matrixWorldAutoUpdate = true })
      for (const m of created) { g.remove(m); m.geometry.dispose() }
      for (const m of hidden) { m.visible = true }
    }
  }, [children, batch, freeze, minBatch])
  return <group ref={ref}>{children}</group>
}
