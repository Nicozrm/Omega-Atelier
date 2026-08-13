/**
 * Lazy plant implementation — kept in its own module so the GLTF loader is only
 * pulled in (as a separate async chunk) when a plant is actually rendered.
 */

import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { plantMaterialRole, plantScale, plantUrl, type PlantDef } from '@/assets/plantRegistry'
import type { PlantMaterials } from './PlantModel'

export default function PlantModelImpl({ def, scale, materials }: {
  def: PlantDef
  scale: number
  materials: PlantMaterials
}) {
  const gltf = useGLTF(plantUrl(def.file))

  /**
   * A fresh clone per plant, with the scene's materials swapped in.
   *
   * Deliberately not drei's `<Clone>`: that keeps the file's own materials, and
   * these have to wear the neighbourhood's season- and daylight-tinted ones or
   * every tree stays at high summer. Geometry is shared by reference across
   * clones — only the object wrappers are new — so a street of these costs
   * almost nothing beyond the nodes themselves, and `Static` then merges them
   * by material exactly as it merges the procedural meshes.
   */
  const object = useMemo(() => {
    const root = gltf.scene.clone(true)
    root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const source = mesh.material
      const name = Array.isArray(source) ? (source[0]?.name ?? '') : (source?.name ?? '')
      mesh.material = plantMaterialRole(name) === 'foliage' ? materials.foliage : materials.bark
      mesh.castShadow = true
      // A tree also stands in other trees' shade — without this a crown stays
      // uniformly lit while the ground beneath it is dark, which reads as a
      // cut-out rather than as a plant.
      mesh.receiveShadow = true
    })
    return root
  }, [gltf.scene, materials.foliage, materials.bark])

  const s = plantScale(def, scale)
  return <primitive object={object} scale={[s, s, s]} />
}
