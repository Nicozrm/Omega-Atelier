/**
 * PlantModel — a Blender-built tree, wearing the scene's own materials.
 *
 * Lazy and Suspense-gated like `GltfModel`, and for the same reason: with no
 * plant on screen the GLTF loader never enters the bundle. A load failure falls
 * back to the procedural tree, so a missing file costs a silhouette, never the
 * scene.
 *
 * The material swap is the part that matters. The neighbourhood tints foliage by
 * season and daylight — snow, autumn, dusk — and a clone that kept the file's
 * baked greens would sit at high summer through a snowstorm. So only geometry
 * comes from the file; every mesh is reassigned the material the surrounding
 * scene would have given a procedural tree of the same kind.
 */

import { Suspense, lazy, Component, type ReactNode } from 'react'
import type * as THREE from 'three'
import { PLANTS, hasPlant } from '@/assets/plantRegistry'
import type { TreeKind } from '@/lib/world'

const Impl = lazy(() => import('./PlantModelImpl'))

class PlantErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export interface PlantMaterials {
  foliage: THREE.Material
  bark: THREE.Material
}

export function PlantModel({ kind, scale, materials, fallback }: {
  kind: TreeKind
  /** The world model's tree scale — 1 means the procedural tree's natural size. */
  scale: number
  materials: PlantMaterials
  fallback: ReactNode
}) {
  if (!hasPlant(kind)) return <>{fallback}</>
  return (
    <PlantErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Impl def={PLANTS[kind]!} scale={scale} materials={materials} />
      </Suspense>
    </PlantErrorBoundary>
  )
}
