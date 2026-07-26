/**
 * GltfModel — renders a real GLB for a furniture/device id if one is registered,
 * otherwise the procedural `fallback`. Loading is lazy + Suspense-gated, and any
 * load error falls back to the procedural mesh (so a missing/broken asset never
 * breaks the scene). With an empty registry this is a zero-cost pass-through.
 */
import { Suspense, lazy, Component, type ReactNode } from 'react'
import { MODELS, hasModel } from '@/assets/modelRegistry'

const Impl = lazy(() => import('./GltfModelImpl'))

class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function GltfModel({ id, fallback }: { id: string; fallback: ReactNode }) {
  if (!hasModel(id)) return <>{fallback}</>
  return (
    <ModelErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <Impl def={MODELS[id]} />
      </Suspense>
    </ModelErrorBoundary>
  )
}
