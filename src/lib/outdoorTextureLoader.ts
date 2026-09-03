/**
 * outdoorTextureLoader.ts — load the baked outdoor sets and hand them to the
 * canvas library as drop-in replacements.
 *
 * Split from `outdoorTextures` so the table and its rules stay testable without
 * a WebGL context or an image decoder.
 *
 * The substitution point is deliberate. `proceduralTextures` already caches one
 * `Surface` per material and clones it per use, so replacing what those cached
 * surfaces *are* upgrades every consumer at once — the plan's own house, the
 * generated neighbourhood, the cadastre buildings — without a single call site
 * changing. Until the images arrive, the canvas surfaces stand, which keeps the
 * first frame immediate and the app working with no files at all.
 */

import * as THREE from 'three'
import { activeProfile } from '@/lib/render/quality'
import {
  hasOutdoorMap, outdoorConstant, outdoorSetNames, outdoorTextureUrl, shouldUseBakedOutdoor,
  type OutdoorMap, type OutdoorSetKey,
} from './outdoorTextures'

/** The four textures a baked set provides, shaped like the canvas `Surface`. */
export interface BakedSurface {
  map: THREE.Texture
  bump: THREE.Texture
  normal: THREE.Texture
  roughness: THREE.Texture
}

const loaded = new Map<OutdoorSetKey, BakedSurface>()
const listeners = new Set<() => void>()
let pending: Promise<number> | null = null
let version = 0

let loader: THREE.TextureLoader | null = null
const textureLoader = (): THREE.TextureLoader => (loader ??= new THREE.TextureLoader())

/** Resolves to `null` rather than rejecting — a missing file keeps the canvas. */
function loadMap(url: string, srgb: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    textureLoader().load(
      url,
      (texture) => {
        if (srgb) texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        texture.anisotropy = activeProfile().anisotropy
        resolve(texture)
      },
      undefined,
      () => resolve(null),
    )
  })
}

/**
 * A 1×1 texture carrying one value.
 *
 * For the maps the bake found constant. The `Surface` contract wants a texture
 * in every slot, and a single texel is the honest way to supply one — cheaper
 * than the 512² image of a single number that would otherwise be shipped.
 */
function constantTexture(value: number): THREE.DataTexture {
  const v = Math.max(0, Math.min(255, Math.round(value * 255)))
  const texture = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

async function loadSet(name: OutdoorSetKey): Promise<BakedSurface | null> {
  const kinds: OutdoorMap[] = ['diff', 'nor', 'rough', 'bump']
  const results = await Promise.all(
    kinds.map((kind) =>
      hasOutdoorMap(name, kind)
        ? loadMap(outdoorTextureUrl(name, kind), kind === 'diff')
        : Promise.resolve(null),
    ),
  )
  const [diff, nor, rough, bumpMap] = results
  // The colour map is the one that must exist; without it there is nothing to
  // upgrade and the canvas surface is left alone.
  if (!diff) return null

  const roughConstant = outdoorConstant(name, 'rough')
  return {
    map: diff,
    normal: nor ?? diff,
    bump: bumpMap ?? diff,
    roughness: rough ?? (roughConstant !== undefined ? constantTexture(roughConstant) : diff),
  }
}

/**
 * Load every baked set once. Safe to call repeatedly.
 *
 * `onReady` fires after the sets are in place so the caller can drop its cached
 * materials and rebuild them against the new pixels.
 */
export function preloadOutdoorTextures(onReady?: () => void): Promise<number> {
  if (!shouldUseBakedOutdoor(activeProfile())) return Promise.resolve(0)
  if (pending) return pending

  pending = (async () => {
    const names = outdoorSetNames()
    const sets = await Promise.all(names.map((n) => loadSet(n)))
    let count = 0
    names.forEach((name, i) => {
      const set = sets[i]
      if (!set) return
      loaded.set(name, set)
      count++
    })
    if (count > 0) {
      version++
      onReady?.()
      for (const listener of listeners) listener()
    }
    return count
  })()

  return pending
}

/** The baked surface for a generator's material, or null while it is not there. */
export function bakedOutdoorSurface(name: OutdoorSetKey): BakedSurface | null {
  return loaded.get(name) ?? null
}

/** Bumps whenever a batch of sets lands — a render dependency, not a value. */
export function outdoorTextureVersion(): number {
  return version
}

export function subscribeOutdoorTextures(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Drop everything — the quality profile bakes anisotropy into each texture. */
export function resetOutdoorTextures(): void {
  for (const set of loaded.values()) {
    const seen = new Set<THREE.Texture>()
    for (const texture of [set.map, set.normal, set.roughness, set.bump]) {
      if (seen.has(texture)) continue
      seen.add(texture)
      texture.dispose()
    }
  }
  loaded.clear()
  pending = null
}
