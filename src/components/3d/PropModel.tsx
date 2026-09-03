/**
 * PropModel — a Blender-built piece of street furniture, wearing the scene's
 * own materials.
 *
 * Lazy and Suspense-gated like `PlantModel`, and for the same reasons: with no
 * prop on screen the GLTF loader never enters the bundle, and a load failure
 * falls back to the procedural version, so a missing file costs a silhouette and
 * never the street.
 *
 * ## The axis turn
 *
 * The models are authored Z-up with the front at −Y, the pipeline's convention.
 * glTF is Y-up, and the exporter turns the asset on the way out: Blender −Y
 * becomes glTF +Z. So a prop arrives already standing on its feet and facing
 * +z, and the caller only has to rotate it about Y like any other object in the
 * scene. Nothing here re-orients anything — the note exists because the *next*
 * prop is the one that will get it wrong.
 */

import { Suspense, lazy, Component, type ReactNode } from 'react'
import type * as THREE from 'three'
import { PROPS, type PropId, type PropMaterialRole } from '@/assets/propRegistry'

const Impl = lazy(() => import('./PropModelImpl'))

class PropErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** The scene material each role resolves to. */
export type PropMaterials = Record<PropMaterialRole, THREE.Material>

export function PropModel({ id, materials, fallback }: {
  id: PropId
  materials: PropMaterials
  fallback: ReactNode
}) {
  return (
    <PropErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Impl def={PROPS[id]} materials={materials} />
      </Suspense>
    </PropErrorBoundary>
  )
}
