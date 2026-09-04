import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader'

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
      // Ensure the material is standard-ish so it responds to env lighting
      try {
        // Some GLBs use non-serialisable material shapes; leave as-is if not.
        if (m.material && (m.material as any).isMeshStandardMaterial === undefined) {
          // no-op: preserve author materials for faithful look
        }
      } catch {}
    }
  })

  return clone
}
