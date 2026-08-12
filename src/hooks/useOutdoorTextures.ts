/**
 * useOutdoorTextures — start the baked outdoor library loading, and re-render
 * once it lands.
 *
 * The canvas library renders immediately and the baked images replace it a
 * moment later, so the value returned here is a *version*, not data: put it in
 * a material memo's dependencies and that memo rebuilds against the new pixels
 * exactly once. Both the plan's own house and the generated neighbourhood build
 * their materials in such a memo, and both need it — otherwise the upgrade
 * would only appear after a reload.
 */

import { useEffect, useState } from 'react'
import { resetProceduralTextures } from '@/lib/proceduralTextures'
import {
  outdoorTextureVersion, preloadOutdoorTextures, subscribeOutdoorTextures,
} from '@/lib/outdoorTextureLoader'

export function useOutdoorTextures(): number {
  const [version, setVersion] = useState(outdoorTextureVersion)

  useEffect(() => {
    const unsubscribe = subscribeOutdoorTextures(() => setVersion(outdoorTextureVersion()))
    void preloadOutdoorTextures(() => {
      // The canvas surfaces are cached module-wide and cloned per use, so they
      // have to be dropped before anything asks for a surface again — otherwise
      // the generators keep handing out the drawing they already made.
      resetProceduralTextures()
    })
    return unsubscribe
  }, [])

  return version
}
