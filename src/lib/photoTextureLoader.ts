/**
 * photoTextureLoader.ts — load the PBR sets and swap them onto live materials.
 *
 * Split from `photoTextures` so the table and its rules stay testable without a
 * WebGL context or an image decoder; everything three.js-shaped lives here.
 *
 * The swap is in-place on the material instances the scene already shares, so
 * nothing re-renders structurally and no mesh needs to know this happened. A
 * material that is mid-frame simply gets a better map on the next one.
 */

import * as THREE from 'three'
import { activeProfile } from '@/lib/render/quality'
import {
  GENERATED_MATERIAL_UPGRADES, PHOTO_SETS, PHOTO_UPGRADES, hasMap, photoTextureUrl,
  requiredGeneratedSets, requiredSets, shouldUpgrade,
  type MapKind, type PhotoSetKey,
} from './photoTextures'
import { boxProjectUV } from '@/lib/render/boxProjectUV'

/** One decoded set, shared by every material that uses it. */
type LoadedSet = Partial<Record<MapKind, THREE.Texture>>

const cache = new Map<PhotoSetKey, Promise<LoadedSet>>()
let loader: THREE.TextureLoader | null = null

function textureLoader(): THREE.TextureLoader {
  if (!loader) loader = new THREE.TextureLoader()
  return loader
}

/**
 * Load one map. Resolves to `null` rather than rejecting: a missing file must
 * degrade to the canvas texture, never take the scene down with it.
 */
function loadMap(url: string, srgb: boolean): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    textureLoader().load(
      url,
      (texture) => {
        // Colour maps are authored in sRGB; normal and roughness carry data and
        // must stay linear, or the lighting is quietly wrong everywhere.
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

function loadSet(key: PhotoSetKey): Promise<LoadedSet> {
  const cached = cache.get(key)
  if (cached) return cached

  const set = PHOTO_SETS[key]
  const pending = (async (): Promise<LoadedSet> => {
    const kinds: MapKind[] = (['diff', 'nor', 'rough'] as const).filter((k) => hasMap(set, k))
    const loaded = await Promise.all(kinds.map((k) => loadMap(photoTextureUrl(set, k), k === 'diff')))
    const out: LoadedSet = {}
    kinds.forEach((kind, i) => {
      const texture = loaded[i]
      if (texture) out[kind] = texture
    })
    return out
  })()

  cache.set(key, pending)
  return pending
}

/**
 * Copy the tiling of the map being replaced.
 *
 * The canvas repeats were tuned against the real mesh UVs, so inheriting them
 * keeps every surface at the density it was designed at. Only when a material
 * carries no map at all does the table's fallback apply.
 */
function applyTiling(target: THREE.Texture, previous: THREE.Texture | null, fallback: [number, number]): void {
  if (previous) {
    target.repeat.copy(previous.repeat)
    target.offset.copy(previous.offset)
    target.center.copy(previous.center)
    target.rotation = previous.rotation
  } else {
    target.repeat.set(fallback[0], fallback[1])
  }
}

/** A material that may carry the standard PBR map slots. */
type Mappable = THREE.Material & {
  map?: THREE.Texture | null
  normalMap?: THREE.Texture | null
  roughnessMap?: THREE.Texture | null
  normalScale?: THREE.Vector2
}

/**
 * Upgrade one material in place. Returns true when anything was swapped.
 *
 * Each texture is cloned per material: a clone shares the decoded image but
 * owns its own repeat, which is what lets one linen scan serve three
 * differently-tiled upholstery materials without a second decode.
 */
export function upgradeMaterial(material: THREE.Material, key: string, loaded: LoadedSet): boolean {
  const upgrade = PHOTO_UPGRADES[key]
  if (!upgrade) return false
  const mat = material as Mappable
  const reference = mat.map ?? null
  let changed = false

  if (loaded.diff) {
    const map = loaded.diff.clone()
    applyTiling(map, reference, upgrade.fallbackRepeat)
    map.needsUpdate = true
    mat.map = map
    changed = true
  }
  if (loaded.nor) {
    const normal = loaded.nor.clone()
    applyTiling(normal, reference, upgrade.fallbackRepeat)
    normal.needsUpdate = true
    mat.normalMap = normal
    if (upgrade.normalScale !== undefined) {
      // Scanned normals are stronger than the canvas ones derived from a
      // hand-drawn height field; without this most surfaces read as embossed.
      mat.normalScale = new THREE.Vector2(upgrade.normalScale, upgrade.normalScale)
    }
    changed = true
  }
  // Only where the material already opted into a roughness map — that slot is
  // the profile's own decision about per-fragment cost, and this pass must not
  // overrule it.
  if (loaded.rough && mat.roughnessMap) {
    const rough = loaded.rough.clone()
    applyTiling(rough, reference, upgrade.fallbackRepeat)
    rough.needsUpdate = true
    mat.roughnessMap = rough
    changed = true
  }

  if (changed) material.needsUpdate = true
  return changed
}

/**
 * Load every set the given materials need and swap them in.
 *
 * Fire-and-forget by design: the caller does not wait, the scene renders from
 * the canvas materials meanwhile, and each material improves as its set
 * arrives. Returns the number of materials upgraded, which is what the test
 * and the diagnostics read.
 */
export async function applyPhotoTextures(
  materials: Record<string, THREE.Material>,
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!opts.force && !shouldUpgrade(activeProfile())) return 0

  const keys = Object.keys(materials).filter((k) => PHOTO_UPGRADES[k])
  const sets = requiredSets(keys)
  const bySet = new Map<PhotoSetKey, LoadedSet>()
  await Promise.all(sets.map(async (s) => { bySet.set(s, await loadSet(s)) }))

  let upgraded = 0
  for (const key of keys) {
    const loaded = bySet.get(PHOTO_UPGRADES[key].set)
    if (loaded && upgradeMaterial(materials[key], key, loaded)) upgraded++
  }
  return upgraded
}

/** Drop the decode cache — used when the quality profile changes. */
/**
 * Give a Blender-generated model the scanned PBR maps its material roles name.
 *
 * Two things have to happen, in this order:
 *
 *  1. **Coordinates.** These assets ship with `POSITION` and `NORMAL` only, so
 *     there is nothing for a texture to be sampled against. Box projection
 *     supplies it (see `render/boxProjectUV`) — right for the axis-aligned
 *     slabs this geometry is made of, and it needs no per-asset authoring.
 *  2. **Maps.** Bound from the same cache the room surfaces use, so a shared
 *     oak scan is decoded once for the whole scene rather than per model.
 *
 * Materials are cloned first. A glTF loaded through `useGLTF` is cached and
 * shared between every instance of that model, so mutating its materials in
 * place would leak one piece's tiling onto another — and re-running the upgrade
 * on an already-upgraded material would stack clones every time one mounted.
 *
 * Safe to call on anything: a model whose roles carry no photo set is left
 * exactly as it was.
 *
 * @returns how many materials were upgraded.
 */
export async function upgradeGeneratedModel(root: THREE.Object3D): Promise<number> {
  if (!shouldUpgrade(activeProfile())) return 0

  const names: string[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      if (material?.name) names.push(material.name)
    }
  })
  const sets = requiredGeneratedSets(names)
  if (sets.length === 0) return 0

  const loaded = new Map<PhotoSetKey, LoadedSet>()
  await Promise.all(sets.map(async (key) => { loaded.set(key, await loadSet(key)) }))

  let upgraded = 0
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = materials.map((material) => {
      const upgrade = material?.name ? GENERATED_MATERIAL_UPGRADES[material.name] : undefined
      const set = upgrade ? loaded.get(upgrade.set) : undefined
      if (!upgrade || !set) return material

      ensureBoxUv(mesh.geometry, upgrade.metresPerTile)
      const clone = material.clone() as Mappable
      clone.name = material.name
      const repeat: [number, number] = [1, 1]   // the UVs already carry the scale
      if (set.diff) {
        clone.map = set.diff.clone()
        clone.map.repeat.set(repeat[0], repeat[1])
        clone.map.needsUpdate = true
      }
      if (set.nor) {
        clone.normalMap = set.nor.clone()
        clone.normalMap.repeat.set(repeat[0], repeat[1])
        clone.normalMap.needsUpdate = true
        if (clone.normalScale && upgrade.normalScale !== undefined) {
          clone.normalScale.set(upgrade.normalScale, upgrade.normalScale)
        }
      }
      if (set.rough) {
        clone.roughnessMap = set.rough.clone()
        clone.roughnessMap.repeat.set(repeat[0], repeat[1])
        clone.roughnessMap.needsUpdate = true
      }
      clone.needsUpdate = true
      upgraded++
      return clone as THREE.Material
    })
    mesh.material = Array.isArray(mesh.material) ? next : next[0]
  })
  return upgraded
}

/**
 * Attach box-projected coordinates, once per geometry.
 *
 * The geometry is shared across every instance of a model, so this is both the
 * cheap place to do it and the place where doing it twice must be avoided.
 */
function ensureBoxUv(geometry: THREE.BufferGeometry, metresPerTile: number): void {
  if (geometry.getAttribute('uv')) return
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  if (!position || !normal) return
  const uv = boxProjectUV(
    position.array as ArrayLike<number>,
    normal.array as ArrayLike<number>,
    metresPerTile,
  )
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
}

export function resetPhotoTextures(): void {
  for (const pending of cache.values()) {
    void pending.then((set) => {
      for (const texture of Object.values(set)) texture?.dispose()
    })
  }
  cache.clear()
}
