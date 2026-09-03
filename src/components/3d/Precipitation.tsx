import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { activeProfile } from '@/lib/render/quality'
import { precipParams, seedField, advanceField, type Precip } from '@/lib/precipitation'

/**
 * Precipitation — rain and snow as one point field.
 *
 * The simulation itself is not here: `lib/precipitation` owns it as pure
 * functions over a flat xyz buffer, which is why the awkward parts — recycling
 * particles that fall through the floor, re-scattering them so the field does
 * not collapse into visible lanes, clamping a tabbed-out `dt` so nothing
 * teleports — are unit-tested rather than eyeballed. This component is the thin
 * shell that hands that buffer to the GPU.
 *
 * One draw call, one buffer, no allocation per frame: the same `Float32Array` is
 * advanced in place and uploaded, so a thousand flakes cost one attribute
 * update. Precipitation is atmosphere and must never be the thing that costs
 * the frame — hence the profile-scaled count, and nothing at all on the
 * performance profile.
 *
 * The field is parented to the camera in x/z so it always surrounds the viewer;
 * a fixed box would run out exactly when the camera moves toward its edge.
 */

export interface PrecipitationProps {
  kind: Precip
  /** Scene span in metres — sizes the box the field falls through. */
  span: number
}

/** Profile → the tier vocabulary the pure module scales its counts by. */
function tierFor(id: string): 'ultra' | 'high' | 'low' | 'off' {
  if (id === 'ultra') return 'ultra'
  if (id === 'high') return 'high'
  if (id === 'balanced') return 'low'
  return 'off'
}

export function Precipitation({ kind, span }: PrecipitationProps) {
  const profile = activeProfile()
  const pointsRef = useRef<THREE.Points>(null)

  const boxSpan = Math.max(40, span * 2.2)
  const boxHeight = Math.max(18, span * 0.9)

  const params = useMemo(
    () => precipParams(kind, tierFor(profile.id)),
    [kind, profile.id],
  )

  const geometry = useMemo(() => {
    if (!params) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(seedField(params.count, boxSpan, boxHeight, 7), 3),
    )
    return g
    // Re-seeding on a size change is correct: the box the field lives in moved.
  }, [params, boxSpan, boxHeight])

  const material = useMemo(() => {
    if (!params) return null
    return new THREE.PointsMaterial({
      color: params.color,
      size: params.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: params.opacity,
      depthWrite: false,
      // Precipitation is lit by the sky, not by the room's lamps; a lit material
      // would make every flake flicker as it passed a point light.
      fog: false,
      toneMapped: false,
    })
  }, [params])

  useEffect(() => () => { geometry?.dispose(); material?.dispose() }, [geometry, material])

  useFrame((state, dt) => {
    const pts = pointsRef.current
    if (!pts || !geometry || !params) return
    // Follow the camera horizontally so the field never runs out sideways; the
    // vertical box stays anchored to the ground, otherwise flakes would appear
    // to hang still while the camera climbed.
    pts.position.x = state.camera.position.x
    pts.position.z = state.camera.position.z
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    advanceField(
      attr.array as Float32Array,
      dt,
      params,
      boxSpan,
      boxHeight,
      state.clock.elapsedTime,
    )
    attr.needsUpdate = true
  })

  if (!params || !geometry || !material) return null
  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
}
