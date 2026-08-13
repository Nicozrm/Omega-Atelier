/**
 * Lazy GLTF model implementation. Kept in its own module so the GLTF loader is
 * only pulled in (as a separate async chunk) when the registry actually has a
 * model to load — with an empty registry this code never loads, keeping the
 * bundle constant and offline-first intact.
 *
 * The two nested groups matter. The inner one is the asset's own placement
 * (offset, front-facing rotation, authored scale); the outer one fits the
 * result to the footprint the item is actually placed at, in world axes, so the
 * fit is unaffected by whichever way the asset had to be turned to face front.
 *
 * ## Shadows
 *
 * `castShadow`/`receiveShadow` are per-*object* flags, and a mesh loaded from a
 * glTF file arrives with both `false`. Nothing else sets them, so every piece of
 * furniture that had a built model — which is the whole point of the Blender
 * pipeline — stood in the room casting nothing, while the procedural fallback
 * beside it (whose meshes are authored with `castShadow`) grounded properly. The
 * tell is a sofa with a crisp shadow next to a bed with none.
 *
 * `Clone` applies the flags to every mesh it copies, so they cost one prop.
 */
import { useEffect } from 'react'
import { useGLTF, Clone } from '@react-three/drei'
import { fitScale, modelUrl, type ModelDef } from '@/assets/modelRegistry'
import { requestShadowRefresh } from './ShadowController'

export default function GltfModelImpl({ def, target }: {
  def: ModelDef
  target?: readonly [number, number]
}) {
  const gltf = useGLTF(modelUrl(def.file))
  const s = def.scale ?? 1
  const fit = fitScale(def, target)
  // The sun's shadow map is on manual update, and a lazily-loaded model lands
  // whenever the network hands it over — routinely after the last refresh the
  // world change triggered. Without this the piece would be missing from an
  // otherwise correct map until something else in the scene moved.
  useEffect(() => { requestShadowRefresh(0.4) }, [gltf.scene])
  return (
    <group scale={fit}>
      <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
        <Clone object={gltf.scene} castShadow receiveShadow />
      </group>
    </group>
  )
}
