/**
 * Lazy prop implementation — kept in its own module so the GLTF loader is only
 * pulled in (as a separate async chunk) when a prop is actually rendered.
 */

import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { propMaterialRole, propUrl, type PropDef } from '@/assets/propRegistry'
import type { PropMaterials } from './PropModel'

export default function PropModelImpl({ def, materials }: {
  def: PropDef
  materials: PropMaterials
}) {
  const gltf = useGLTF(propUrl(def.file))

  /**
   * A fresh clone per placement, with the scene's materials swapped in.
   *
   * Deliberately not drei's `<Clone>`: that keeps the file's own materials, and
   * a street of parked cars all wearing the same baked grey is worse than the
   * boxes it replaces. Geometry is shared by reference across clones — only the
   * object wrappers are new — so `Static` then merges them by material exactly
   * as it merges the procedural meshes around them.
   */
  const object = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.material
      const name = Array.isArray(source) ? (source[0]?.name ?? '') : (source?.name ?? '')
      mesh.material = materials[propMaterialRole(name)]
      mesh.castShadow = true
      mesh.receiveShadow = true
    })
    return root
  }, [gltf.scene, materials])

  return <primitive object={object} />
}
