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
 */
import { useGLTF, Clone } from '@react-three/drei'
import { fitScale, modelUrl, type ModelDef } from '@/assets/modelRegistry'

export default function GltfModelImpl({ def, target }: {
  def: ModelDef
  target?: readonly [number, number]
}) {
  const gltf = useGLTF(modelUrl(def.file))
  const s = def.scale ?? 1
  const fit = fitScale(def, target)
  return (
    <group scale={fit}>
      <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
        <Clone object={gltf.scene} />
      </group>
    </group>
  )
}
