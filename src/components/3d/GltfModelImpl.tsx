/**
 * Lazy GLTF model implementation. Kept in its own module so the GLTF loader is
 * only pulled in (as a separate async chunk) when the registry actually has a
 * model to load — with an empty registry this code never loads, keeping the
 * bundle constant and offline-first intact.
 *

 */
import { useEffect } from 'react'
import { useGLTF, Clone } from '@react-three/drei'

  return (
    <group scale={fit}>
      <group position={def.offset ?? [0, 0, 0]} rotation={[0, def.rotationY ?? 0, 0]} scale={[s, s, s]}>
        <Clone object={gltf.scene} castShadow receiveShadow />
      </group>
    </group>
  )
}
