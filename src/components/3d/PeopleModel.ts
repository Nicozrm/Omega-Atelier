import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * Clone a loaded people GLTF into a standalone THREE.Group suitable for
 * attaching to the resident rig. The clone walk animation (if any) is not
 * wired — the procedural rig drives motion and the GLB is only a visual.
 */
export function instantiatePersonFromGltf(gltf: GLTF): THREE.Group {
  // shallow clone of the scene; `clone(true)` duplicates geometries/meshes
  const clone = gltf.scene.clone(true) as THREE.Group

  // Ensure all meshes cast / receive shadows and are frustum-culled normally
  clone.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const m = o as THREE.Mesh
      m.castShadow = true
      m.receiveShadow = true
      // Materials are deliberately left untouched: a GLB's authored material
      // is the faithful look, and non-standard material shapes still respond
      // to the scene's environment map.
    }
  })

  return clone
}
