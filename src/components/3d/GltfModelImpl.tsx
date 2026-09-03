/**
 * Lazy GLTF model implementation. Kept in its own module so the GLTF loader is
 * only pulled in (as a separate async chunk) when the registry actually has a
 * model to load — with an empty registry this code never loads, keeping the
 * bundle constant and offline-first intact.
 * Two independent corrections stack here, and only ever one of them applies:
 *
 *  · `fitScale(def, footprint)` — the *generated* assets know the footprint they
 *    were authored at, so a resized instance is stretched per axis by the ratio
 *    between the two.
 *  · `uniformFit(MODEL_SIZES[def.file], …)` — the *downloaded* CC0 assets carry
 *    no such measurement, so they are fitted uniformly to the footprint from
 *    their measured bounding box, which is what lets one plant serve all three
 *    plant ids.
 *
 * An asset has either a `nominal` or a measured size, never both, so the other
 * factor is the identity and nothing is scaled twice.
 */
import { useGLTF, Clone } from '@react-three/drei'
import { fitScale, modelUrl, type ModelDef } from '@/assets/modelRegistry'
import { MODEL_SIZES } from '@/assets/modelSizes'
import { fitScale as uniformFit } from '@/assets/modelFit'

export default function GltfModelImpl({ def, footprint }: {
  def: ModelDef
  footprint?: readonly [number, number]
}) {
  const gltf = useGLTF(modelUrl(def.file))

  const fit = fitScale(def, footprint)
  const s = def.scale ?? (footprint && !def.nominal
    ? uniformFit(MODEL_SIZES[def.file], footprint[0], footprint[1])
    : 1)

  return (
    <group scale={fit}>
      <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
        <Clone object={gltf.scene} castShadow receiveShadow />
      </group>
    </group>
  )
}
