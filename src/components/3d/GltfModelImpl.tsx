/**
 * Lazy GLTF model implementation. Kept in its own module so the GLTF loader is
 * only pulled in (as a separate async chunk) when the registry actually has a
 * model to load — with an empty registry this code never loads, keeping the
 * bundle constant and offline-first intact.
 */
import { useGLTF, Clone } from '@react-three/drei'
import { modelUrl, type ModelDef } from '@/assets/modelRegistry'

export default function GltfModelImpl({ def }: { def: ModelDef }) {
  const gltf = useGLTF(modelUrl(def.file))
  const s = def.scale ?? 1
  return (
    <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
      <Clone object={gltf.scene} />
    </group>
  )
}
