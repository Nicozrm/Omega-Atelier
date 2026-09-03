/**
 * Lazy GLTF model implementation. Kept in its own module so the GLTF loader is
 * only pulled in (as a separate async chunk) when the registry actually has a
 * model to load — with an empty registry this code never loads, keeping the
 * bundle constant and offline-first intact.
 *
 * Assets are Draco-compressed (see `scripts/assets/optimize.mjs`), so the loader
 * needs a decoder. drei defaults that to a Google CDN, which would quietly break
 * the project's offline-first guarantee the first time someone opened the 3D view
 * without a network — and, because Draco is marked *required* in these files,
 * every model would fail to load rather than degrade. The decoder is therefore
 * served from `public/draco/` alongside the models, under the app's base URL so
 * it also resolves under the GitHub Pages sub-path.
 */
import { useGLTF, Clone } from '@react-three/drei'
import { modelUrl, type ModelDef } from '@/assets/modelRegistry'
import { MODEL_SIZES } from '@/assets/modelSizes'
import { fitScale } from '@/assets/modelFit'

/** Self-hosted Draco decoder directory. Trailing slash required by DRACOLoader. */
const DRACO_DECODER_PATH = `${import.meta.env.BASE_URL}draco/`

export default function GltfModelImpl({ def, footprint }: {
  def: ModelDef
  /** Instance footprint in centimetres, `[width, depth]`. */
  footprint?: readonly [number, number]
}) {
  const gltf = useGLTF(modelUrl(def.file), DRACO_DECODER_PATH)
  // An explicit `scale` in the registry is an override for assets the pipeline
  // cannot fit automatically; otherwise the model is fitted to the footprint the
  // plan reserved for this instance.
  const s = def.scale ?? (footprint
    ? fitScale(MODEL_SIZES[def.file], footprint[0] / 100, footprint[1] / 100)
    : 1)
  return (
    <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
      <Clone object={gltf.scene} />
    </group>
  )
}
