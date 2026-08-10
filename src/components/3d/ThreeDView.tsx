/**
 * 3D View — v14 visual overhaul.
 *
 * Goals:
 *  - Premium look: ACES tone-map, soft shadows, hemi+directional+ambient lighting,
 *    PBR materials with metalness/roughness, subtle reflections.
 *  - Recognizable per-category meshes (lamp, speaker, camera, lock, sensor, hub,
 *    blind, climate, tv, ...) instead of flat colored cubes.
 *  - Furniture meshes built from `furnitureId` (sofa, bed, table, wardrobe, ...).
 *  - Smooth damped orbit controls. Hover-lift animation. Selection highlight ring.
 *  - Multi-floor stacking when more than one floor exists.
 *
 * The whole file is wrapped in `@ts-nocheck` because R3F's intrinsic JSX types
 * are notoriously fiddly and not worth the friction; runtime is solid.
 */


import { useEffect, useMemo, useRef, useState, Suspense, Component } from 'react'
import type { ReactNode, TouchEvent as ReactTouchEvent } from 'react'
import { EffectComposer, Bloom, N8AO, SMAA, Vignette, ChromaticAberration, BrightnessContrast, HueSaturation, DepthOfField } from '@react-three/postprocessing'
import type { DepthOfFieldEffect } from 'postprocessing'
import type { Wall, WallSubtype, Room, Floor, PlacedDevice, PlacedFurniture, Point } from '@/types'

// ── v51 Rendering-Layer: Post-Processing (isoliert, tier-gegated, fallback-sicher)
const CA_OFFSET = new THREE.Vector2(0.0005, 0.0005)
class RenderFXBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}
import { DEFAULT_WALL_MATERIAL_ID, type Material } from '@/data/materials'
import { resolveFloorMaterial, resolveSurfaceMaterialId, resolveCeilingMaterial, materialsForSurface } from '@/lib/materials'
import { LightRig } from './LightRig'
import { SunLight } from './SunLight'
import { ShadowController } from './ShadowController'
import { SkyEnvironment, type EnvPreset } from './SkyEnvironment'
import type { CategoryLookup } from '@/lib/lighting'
import { readTier } from '@/lib/render/tier'
import { enablePcssShadows } from '@/lib/render/pcssShadows'
import { deriveEnvironment, type EnvironmentState, type DayPhase } from '@/lib/environment'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, ContactShadows, PointerLockControls, PerformanceMonitor, RoundedBox, MeshReflectorMaterial } from '@react-three/drei'
import { usePlanStore } from '@/store/usePlanStore'
import { LiveTwinReflection } from './LiveTwinReflection'
import { VirtualResidents, type ResidentStatus } from './VirtualResidents'
import { RESIDENT_DOORS } from './residentsBus'
import { GltfModel } from './GltfModel'
import { BlasterAsset3D } from './BlasterAsset3D'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { DEVICE_COLORS } from '@/lib/canvasGlyphs'
import { getTextures, getTexturesAsync, makeTex, type TextureBundle } from '@/lib/textures'
import { X, Camera, Sun, Moon, Eye, Footprints, Palette, Box, Boxes, LayoutGrid, Square, ImageDown, Maximize2, Home, Users, Clapperboard, CircleDot, Layers, Lock, Aperture } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { computeFloorStack } from '@/lib/floorStack'
import { useTier } from '@/hooks/useTier'
import {
  type HouseStyle, facadeHints, roofHints,
  FACADE_KINDS, STONE_COLORS, ROOF_KINDS, ROOF_COLORS,
  DEFAULT_HOUSE_STYLE, loadHouseStyle, saveHouseStyle,
} from '@/lib/houseStyle'
import { cinematicReact } from '@/lib/cinematic'
import { useUIStore } from '@/store/useUIStore'
import * as THREE from 'three'

const DEVICE_MAP = Object.fromEntries(DEVICES.map((d) => [d.id, d] as const))
const FURN_MAP = Object.fromEntries(FURNITURE.map((f) => [f.id, f] as const))

/** Catalogue lookup for the lighting domain. Module-level so the reference is
 *  stable — `LightRig` memoises its source list on it. */
const deviceCategoryOf: CategoryLookup = (id) => DEVICE_MAP[id]?.category

// World units: 1 unit = 1 meter. Plan coords are in cm → divide by 100.
const M = (cm: number) => cm / 100
const PHASE_LABEL: Record<DayPhase, string> = {
  night: 'Nacht', dawn: 'Dämmerung', goldenHour: 'Golden Hour', day: 'Tag', dusk: 'Abendrot',
}
function formatClock(h: number): string {
  const hh = Math.floor(h) % 24
  const mm = Math.round((h - Math.floor(h)) * 60) % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────────────
// Materials — lazily built once, then SHARED across all meshes.
// `MAT.fabric()` returns the same material instance every call, which
// keeps `material={MAT.fabric()}` cheap during R3F re-renders.
// Each material has its own `tex.repeat` baked-in for natural scale.
// ─────────────────────────────────────────────────────────────────────

interface MatCache {
  // Floors — multiple options
  floorParquet:   THREE.Material
  floorWalnut:    THREE.Material
  floorVinylLight: THREE.Material
  floorVinylDark:  THREE.Material
  floorSlate:      THREE.Material
  // Walls — multiple options
  wallPlaster:     THREE.Material
  wallConcrete:    THREE.Material
  wallWallpaper:   THREE.Material
  wallSel:         THREE.Material
  // Furniture / device materials
  woodOak:    THREE.Material
  woodWalnut: THREE.Material
  fabric:     THREE.Material
  fabricGray: THREE.Material
  fabricBlue: THREE.Material
  leatherBlack: THREE.Material
  bedding:    THREE.Material
  pillow:     THREE.Material
  marble:     THREE.Material
  steel:      THREE.Material
  brass:      THREE.Material
  chrome:     THREE.Material
  glass:      THREE.Material
  rug:        THREE.Material
  matteWhite: THREE.Material
  matteBlack: THREE.Material
  brushedSteel: THREE.Material
  darkPanel:   THREE.Material
  shellDark:   THREE.Material
  glazedCeramic: THREE.Material
  aluminium:   THREE.Material
  softBlack:   THREE.Material
  woodDark:    THREE.Material
}

let _mat: MatCache | null = null

function buildMaterials(): MatCache {
  const T = getTextures()
  // Roughness micro-detail maps are uploaded only on the 'high' tier — they add
  // a (cheap, per-fragment) texture sample but cost GPU memory/bandwidth, so weak
  // devices skip them and keep the lean path.
  const HQ = readTier() === 'high'
  const rough = (c: HTMLCanvasElement, r: [number, number]) =>
    HQ ? { roughnessMap: makeTex(c, r, false) } : {}
  return {
    // ─── Floors ──────────────────────────────────────────────
    // Finished floors use a clearcoat layer: the matte grain/stone base (map +
    // normalMap + roughness) stays untouched, and a thin glossy seal on top
    // sharply reflects the local IBL — exactly how lacquered wood / glazed tile
    // reads in reality. Cheap: bounded to the few floor meshes, no new texture.
    floorParquet: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.parquetC, [3, 3]),
      normalMap: makeTex(T.parquetN, [3, 3], false),
      ...rough(T.parquetR, [3, 3]),
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.7,
      metalness: 0.05,
      clearcoat: 0.7,             // lacquered wood seal
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.35,      // soft polished reflection of the warm interior
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    // Warm dark walnut planks — the archviz-grade default. Shares the parquet
    // plank normal/roughness (same geometry); only the colour map is deeper.
    floorWalnut: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.parquetWalnutC, [4, 4]),
      normalMap: makeTex(T.parquetN, [4, 4], false),
      ...rough(T.parquetR, [4, 4]),
      // Gentle normal + a soft, low clearcoat so the plank seams don't fracture
      // the warm/cool IBL into a coloured quilt — an even satin wood reflection.
      normalScale: new THREE.Vector2(0.18, 0.18),
      // Multiplied over the photo texture: pulls the parquet toward the
      // reference's dark espresso walnut (white walls / dark floor contrast).
      color: '#8f7e6e',
      roughness: 0.68,
      metalness: 0.0,
      // Polished lacquer seal: a stronger, sharper clearcoat + boosted env
      // reflection gives the floor a soft polished sheen that mirrors the warm
      // interior (the Twinmotion/archviz look) without muddying the wood grain.
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.35,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    floorVinylLight: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.vinylLightC, [4, 4]),
      normalMap: makeTex(T.vinylLightN, [4, 4], false),
      ...rough(T.vinylLightR, [4, 4]),
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.45,            // vinyl has a satin finish
      metalness: 0.04,
      clearcoat: 0.6,             // satin vinyl topcoat
      clearcoatRoughness: 0.35,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    floorVinylDark: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.vinylDarkC, [4, 4]),
      normalMap: makeTex(T.vinylDarkN, [4, 4], false),
      ...rough(T.vinylDarkR, [4, 4]),
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.45,
      metalness: 0.04,
      clearcoat: 0.6,             // satin vinyl topcoat
      clearcoatRoughness: 0.35,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
    floorSlate: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.slateC, [3, 3]),
      normalMap: makeTex(T.slateN, [3, 3], false),
      ...rough(T.slateR, [3, 3]),
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.55,
      metalness: 0.10,
      clearcoat: 0.7,             // glazed/polished stone seal
      clearcoatRoughness: 0.2,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),

    // ─── Walls ──────────────────────────────────────────────
    wallPlaster: new THREE.MeshStandardMaterial({
      map: makeTex(T.plasterC, [2, 2]),
      normalMap: makeTex(T.plasterN, [2, 2], false),
      ...rough(T.plasterR, [2, 2]),
      normalScale: new THREE.Vector2(0.2, 0.2),
      // Near-white with a hint of warmth — the reference interiors read as
      // white walls against dark floors; warm light provides the tint.
      color: '#eceae5',
      roughness: 0.93,
      metalness: 0.0,
    }),
    wallConcrete: new THREE.MeshStandardMaterial({
      map: makeTex(T.concreteC, [2, 2]),
      normalMap: makeTex(T.concreteN, [2, 2], false),
      normalScale: new THREE.Vector2(0.5, 0.5),
      ...rough(T.concreteR, [2, 2]),
      color: '#c9c5be',
      roughness: 0.85,
      metalness: 0.04,
    }),
    wallWallpaper: new THREE.MeshStandardMaterial({
      map: makeTex(T.wallpaperC, [2, 3]),
      normalMap: makeTex(T.wallpaperN, [2, 3], false),
      normalScale: new THREE.Vector2(0.25, 0.25),
      ...rough(T.wallpaperR, [2, 3]),
      color: '#ece4d2',
      roughness: 0.88,
      metalness: 0.0,
    }),
    wallSel: new THREE.MeshStandardMaterial({
      map: makeTex(T.plasterC, [2, 2]),
      color: '#cdd9ee',
      roughness: 0.7,
      metalness: 0.05,
      emissive: '#9A7B36',
      emissiveIntensity: 0.18,
    }),

    // ─── Furniture / device materials ──────────────────────
    // Finished wood: matte grain (map+normal) under a light oil/lacquer seal
    // (clearcoat) — furniture wood reads as cared-for, not raw-sawn.
    woodOak: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.woodOakC, [2, 1]),
      normalMap: makeTex(T.woodOakN, [2, 1], false),
      ...rough(T.woodOakR, [2, 1]),
      normalScale: new THREE.Vector2(0.5, 0.5),
      // Honey oak — the pale pine-yellow read as untreated builder wood; the
      // reference's furniture oak is deeper and warmer under an oil finish.
      color: '#c2ab8b',
      roughness: 0.55,
      metalness: 0.05,
      clearcoat: 0.25,
      clearcoatRoughness: 0.4,
    }),
    woodWalnut: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.woodWalnutC, [2, 1]),
      normalMap: makeTex(T.woodWalnutN, [2, 1], false),
      ...rough(T.woodWalnutR, [2, 1]),
      normalScale: new THREE.Vector2(0.4, 0.4),
      color: '#8a7565',
      roughness: 0.5,
      metalness: 0.05,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
    }),
    // Dark-stained walnut — near-black dining table / statement furniture.
    // Same grain, deep espresso tint under a satin lacquer.
    woodDark: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.woodWalnutC, [2, 1]),
      normalMap: makeTex(T.woodWalnutN, [2, 1], false),
      ...rough(T.woodWalnutR, [2, 1]),
      normalScale: new THREE.Vector2(0.35, 0.35),
      color: '#463830',
      roughness: 0.42,
      metalness: 0.05,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
    }),
    // Upholstery fabrics use sheen: the soft retro-reflective glow woven cloth
    // shows at grazing angles. metalness 0 (cloth is dielectric); the weave
    // colour/normal stay as-is. sheenColor is a light tint of the base.
    fabric: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.fabricBeigeC, [3, 2]),
      normalMap: makeTex(T.fabricBeigeN, [3, 2], false),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.9,
      sheenColor: '#d8d0bf',
    }),
    fabricGray: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.fabricGrayC, [3, 2]),
      normalMap: makeTex(T.fabricGrayN, [3, 2], false),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.9,
      sheenColor: '#cfd0cf',
    }),
    fabricBlue: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.fabricBlueC, [3, 2]),
      normalMap: makeTex(T.fabricBlueN, [3, 2], false),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.9,
      sheenColor: '#bfccdc',
    }),
    leatherBlack: new THREE.MeshStandardMaterial({
      map: makeTex(T.leatherBlackC, [3, 2]),
      normalMap: makeTex(T.leatherBlackN, [3, 2], false),
      normalScale: new THREE.Vector2(0.45, 0.45),
      // Leather has a satin-ish sheen — lower roughness than wool, slight specular boost
      roughness: 0.55,
      metalness: 0.10,
    }),
    bedding: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.beddingC, [3, 3]),
      normalMap: makeTex(T.beddingN, [3, 3], false),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.85,
      sheenColor: '#eae6dd',
    }),
    pillow: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.linenWhiteC, [2, 2]),
      normalMap: makeTex(T.linenWhiteN, [2, 2], false),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.95,
      metalness: 0.0,
      sheen: 1.0,
      sheenRoughness: 0.85,
      sheenColor: '#ece8df',
    }),
    // Polished marble: the veined base under a clear seal (clearcoat) — the
    // glossy reflection of real honed-and-sealed stone, reflecting the IBL.
    marble: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.marbleC, [1, 1]),
      ...rough(T.marbleR, [1, 1]),
      roughness: 0.25,
      metalness: 0.05,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.0,
    }),
    steel: new THREE.MeshStandardMaterial({
      map: makeTex(T.steelC, [1, 1]),
      normalMap: makeTex(T.steelN, [1, 1], false),
      ...rough(T.steelR, [1, 1]),
      normalScale: new THREE.Vector2(0.2, 0.2),
      roughness: 0.4,
      metalness: 0.85,
    }),
    // Brushed brass — handles, caps, decorative accents. Full metalness + a
    // mild anisotropic grain (reuses the brass normal) for a satin finish.
    brass: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.brassC, [1, 1]),
      normalMap: makeTex(T.brassN, [1, 1], false),
      ...rough(T.brassR, [1, 1]),
      normalScale: new THREE.Vector2(0.2, 0.2),
      color: '#d4b063',
      roughness: 0.35,
      metalness: 1.0,
      anisotropy: 0.4,
      envMapIntensity: 1.0,
    }),
    // Polished chrome — bathroom/kitchen faucets. Near-mirror dielectric-free
    // metal; texture-less, the IBL provides the bright reflections.
    chrome: new THREE.MeshPhysicalMaterial({
      color: '#e8eaec',
      roughness: 0.08,
      metalness: 1.0,
      envMapIntensity: 1.2,
    }),
    // Real glazing: a light, see-through dielectric pane (was an opaque near-black
    // mirror). Low opacity makes windows transparent; the local IBL still reflects
    // off the smooth surface via Fresnel, so panes read as glass, not holes.
    // depthWrite:false blends the pane over the opaque geometry behind it.
    // Real physical glazing: transmission (refraction) on the 'high' tier for
    // that thick, light-bending picture-window look; a cheap transparent
    // dielectric elsewhere so mid/low tiers stay fast. Same singleton either way.
    glass: readTier() === 'high'
      ? new THREE.MeshPhysicalMaterial({
          color: '#eef3f7',
          roughness: 0.06,
          metalness: 0.0,
          transmission: 1.0,       // true refractive glass
          thickness: 0.05,         // thin pane
          ior: 1.5,                // window glass
          transparent: true,
          depthWrite: false,
          envMapIntensity: 1.3,
          specularIntensity: 1.0,
          attenuationColor: '#dfe8ee',
          attenuationDistance: 6,
        })
      : new THREE.MeshStandardMaterial({
          color: '#bfc9d4',
          roughness: 0.05,
          metalness: 0.0,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
          envMapIntensity: 1.2,
        }),
    // Premium wool rug — color + heavy normal for that thick-pile look.
    // polygonOffset pushes it slightly forward of the floor at the same Y → no z-fighting.
    rug: new THREE.MeshStandardMaterial({
      map: makeTex(T.rugWoolC, [2, 2]),
      normalMap: makeTex(T.rugWoolN, [2, 2], false),
      normalScale: new THREE.Vector2(1.2, 1.2),
      // Grounded greige — the reference rugs sit a step darker than the sofa
      // so the seating island reads anchored, not floating on cream.
      color: '#bdb3a1',
      roughness: 0.97,
      metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }),
    matteWhite: new THREE.MeshStandardMaterial({
      map: makeTex(T.matteWhiteC, [1, 1]),
      // Warm off-white, higher roughness — pure bright white clips to paper
      // under the downlights; lacquer furniture reads a step darker.
      color: '#e9e3d6',
      roughness: 0.78,
      metalness: 0.03,
    }),
    matteBlack: new THREE.MeshStandardMaterial({
      map: makeTex(T.matteBlackC, [1, 1]),
      color: '#1a1a1d',
      roughness: 0.5,
      metalness: 0.2,
    }),
    // Brushed stainless steel — appliance fronts/bodies, stovetop, kitchen sink.
    // Anisotropic micro-grain (reuses the existing steel normal); full metalness +
    // the local IBL give it that cool product-grade sheen. No new texture.
    brushedSteel: new THREE.MeshPhysicalMaterial({
      map: makeTex(T.steelC, [1, 1]),
      normalMap: makeTex(T.steelN, [1, 1], false),
      ...rough(T.steelR, [1, 1]),
      normalScale: new THREE.Vector2(0.12, 0.12),
      color: '#c9ccd2',
      roughness: 0.32,
      metalness: 1.0,
      anisotropy: 0.5,
      anisotropyRotation: Math.PI / 2,   // vertical brushing
      envMapIntensity: 1.0,
    }),
    // Opaque high-gloss dark panel — displays/screens and appliance fronts.
    // This is NOT the transparent window glass: a sealed near-black surface with
    // a clearcoat sheen, so screens and fronts read as solid product, not holes.
    darkPanel: new THREE.MeshPhysicalMaterial({
      color: '#0e0f12',
      roughness: 0.18,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.1,
    }),
    // Glazed sanitary ceramic — toilet, washbasin, bathtub. A smooth porcelain
    // body under a glossy glaze (clearcoat), so fixtures read as new sanitary
    // ware rather than matte plastic. Texture-less: the glaze is uniform.
    glazedCeramic: new THREE.MeshPhysicalMaterial({
      color: '#f4f2ec',
      roughness: 0.25,
      metalness: 0.0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.0,
    }),
    // Anodised aluminium — premium device bodies (speaker/cam/lamp), the matte
    // metal of high-end consumer hardware. Full metal, fine satin roughness.
    aluminium: new THREE.MeshPhysicalMaterial({
      color: '#cfd2d6',
      roughness: 0.42,
      metalness: 0.9,
      clearcoat: 0.15,
      clearcoatRoughness: 0.3,
      envMapIntensity: 1.0,
    }),
    // Soft-touch black — the matte dielectric plastic of premium electronics
    // (speakers, consoles) with a faint clearcoat sheen, not a flat black.
    softBlack: new THREE.MeshPhysicalMaterial({
      color: '#17181b',
      roughness: 0.55,
      metalness: 0.0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
    }),
    // Dollhouse shell — matte warm anthracite for cut wall tops, exterior
    // cladding and the base plinth. The dark shell frames the warm interiors
    // like a display case (the defining archviz-reference look).
    shellDark: new THREE.MeshStandardMaterial({
      color: '#22242a',
      roughness: 0.85,
      metalness: 0.05,
    }),
  }
}

/** Lazy-cached material factory. Returns the SAME instance on repeat calls. */
/**
 * On non-'high' devices, strip the per-light-expensive PBR lobes (clearcoat /
 * sheen / anisotropy) from the built materials. three then compiles the cheaper
 * shader program, restoring performance on weaker GPUs. Base colour, maps,
 * roughness/metalness and transparency are untouched, so the look degrades
 * gracefully rather than breaking.
 */
function leanizeForPerf(cache: MatCache): void {
  for (const mat of Object.values(cache)) {
    const p = mat as THREE.MeshPhysicalMaterial
    if (!p.isMeshPhysicalMaterial) continue
    if (p.clearcoat) p.clearcoat = 0
    if (p.sheen) p.sheen = 0
    if (p.anisotropy) p.anisotropy = 0
    p.needsUpdate = true
  }
}

function ensureMat(): MatCache {
  if (!_mat) {
    _mat = buildMaterials()
    if (readTier() !== 'high') leanizeForPerf(_mat)
  }
  return _mat
}

/** Floor variants the UI can switch between. */
export type FloorVariant = 'walnut' | 'parquet' | 'vinylLight' | 'vinylDark' | 'slate' | 'tile'

function floorMat(v: FloorVariant | undefined): THREE.Material {
  const m = ensureMat()
  switch (v) {
    case 'parquet':    return m.floorParquet
    case 'vinylLight': return m.floorVinylLight
    case 'vinylDark':  return m.floorVinylDark
    case 'slate':      return m.floorSlate
    case 'tile':       return floorTileMat()
    default:           return m.floorWalnut
  }
}

const MAT = {
  // Floor: legacy alias keeps `MAT.floor()` working — routes to parquet.
  floor:      () => ensureMat().floorParquet,
  floorWalnut: () => ensureMat().floorWalnut,
  // New: floor by variant
  floorByType: floorMat,
  // Walls: legacy alias → plaster
  wall:       () => ensureMat().wallPlaster,
  wallSel:    () => ensureMat().wallSel,
  // Existing API — `wood` keeps backward-compat by aliasing to oak
  wood:       () => ensureMat().woodOak,
  woodOak:    () => ensureMat().woodOak,
  woodWalnut: () => ensureMat().woodWalnut,
  fabric:     () => ensureMat().fabric,
  fabricGray: () => ensureMat().fabricGray,
  fabricBlue: () => ensureMat().fabricBlue,
  leatherBlack: () => ensureMat().leatherBlack,
  bedding:    () => ensureMat().bedding,
  pillow:     () => ensureMat().pillow,
  marble:     () => ensureMat().marble,
  metal:      () => ensureMat().steel,
  steel:      () => ensureMat().steel,
  brass:      () => ensureMat().brass,
  chrome:     () => ensureMat().chrome,
  glass:      () => ensureMat().glass,
  rug:        () => ensureMat().rug,
  matteWhite: () => ensureMat().matteWhite,
  matteBlack: () => ensureMat().matteBlack,
  brushedSteel: () => ensureMat().brushedSteel,
  darkPanel:  () => ensureMat().darkPanel,
  glazedCeramic: () => ensureMat().glazedCeramic,
  aluminium:  () => ensureMat().aluminium,
  softBlack:  () => ensureMat().softBlack,
  woodDark:   () => ensureMat().woodDark,
  slate:      () => ensureMat().floorSlate,
  shellDark:  () => ensureMat().shellDark,
} as const

/* ─── Material catalog → 3D bridge (single source of truth) ───
 * Catalog ids that already have a rich textured material reuse it (no visual
 * regression); any new catalog material is built from its renderer-neutral
 * descriptors. Cached so each material is created once. */
const CATALOG_TO_LEGACY: Record<string, () => THREE.Material> = {
  'floor-oak-parquet': () => ensureMat().floorParquet,
  'floor-vinyl-light': () => ensureMat().floorVinylLight,
  'floor-vinyl-dark':  () => ensureMat().floorVinylDark,
  'floor-slate':       () => ensureMat().floorSlate,
  'wall-plaster':      () => ensureMat().wallPlaster,
  'wall-concrete':     () => ensureMat().wallConcrete,
  'wall-wallpaper':    () => ensureMat().wallWallpaper,
}
const catalogMatCache = new Map<string, THREE.Material>()
function matFromCatalog(material: Material, opts?: { doubleSide?: boolean }): THREE.Material {
  if (opts?.doubleSide) {
    const key = `${material.id}:double`
    let cached = catalogMatCache.get(key)
    if (!cached) {
      cached = matFromCatalog(material).clone()
      ;(cached as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      catalogMatCache.set(key, cached)
    }
    return cached
  }
  const legacy = CATALOG_TO_LEGACY[material.id]
  if (legacy) return legacy()
  let m = catalogMatCache.get(material.id)
  if (!m) {
    // Material-dependent finish (no flat defaults):
    //  - glazed tile / polished stone / sealed wood / polished screed → clearcoat,
    //  - carpet → sheen (it is a textile; soft grazing glow like the upholstery),
    //  - plaster / wallpaper → stay matte.
    const GLOSS: Record<string, { clearcoat: number; clearcoatRoughness: number }> = {
      tile:     { clearcoat: 0.7, clearcoatRoughness: 0.15 },
      stone:    { clearcoat: 0.5, clearcoatRoughness: 0.25 },
      wood:     { clearcoat: 0.3, clearcoatRoughness: 0.35 },
      concrete: { clearcoat: 0.2, clearcoatRoughness: 0.45 },
    }
    const g = GLOSS[material.category]
    // The clearcoat/sheen finishes are per-light-expensive; only build them on
    // 'high' devices, otherwise fall back to the cheap standard material.
    const hq = readTier() === 'high'
    // Catalog floors that had no map render as a flat solid colour. Bind existing
    // textures (reuse — no new generation): concrete screed, wool carpet, walnut
    // parquet. Smooth ceramic stays untextured (polished = flat is correct).
    const TEX: Record<string, { map: keyof TextureBundle; normal: keyof TextureBundle; rough?: keyof TextureBundle; repeat: [number, number] }> = {
      'floor-concrete':       { map: 'concreteC', normal: 'concreteN', rough: 'concreteR', repeat: [3, 3] },
      'floor-carpet-warm':    { map: 'rugWoolC',  normal: 'rugWoolN',                       repeat: [4, 4] },
      'floor-walnut-parquet': { map: 'parquetC',  normal: 'parquetN', rough: 'parquetR',    repeat: [3, 3] },
    }
    const tx = TEX[material.id]
    const T = tx ? getTextures() : null
    const texProps = (tx && T)
      ? {
          map: makeTex(T[tx.map], tx.repeat),
          normalMap: makeTex(T[tx.normal], tx.repeat, false),
          ...(hq && tx.rough ? { roughnessMap: makeTex(T[tx.rough], tx.repeat, false) } : {}),
        }
      : {}
    const base = {
      ...texProps,
      color: material.color,
      roughness: material.roughness,
      metalness: material.metalness,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }
    m = hq && material.category === 'carpet'
      ? new THREE.MeshPhysicalMaterial({ ...base, sheen: 1.0, sheenRoughness: 0.95, sheenColor: '#e8e2d6' })
      : hq && g
        ? new THREE.MeshPhysicalMaterial({ ...base, clearcoat: g.clearcoat, clearcoatRoughness: g.clearcoatRoughness })
        : new THREE.MeshStandardMaterial(base)
    catalogMatCache.set(material.id, m)
  }
  return m
}

/**
 * v17 — material slots.
 * User can choose between several upholstery/wood finishes for placed
 * furniture items via PropertyPanel. We expose two catalogs with the
 * `materialKey` strings, swatch colors and material lookups.
 */
export interface MaterialSlotEntry {
  key: string
  label: string
  swatch: string  // CSS color for the picker swatch
  material: () => THREE.Material
}
/**
 * Tinted, cached clone of a base material: colour variants share the base's
 * texture set (weave/grain stays, only the tint changes) and are built once.
 */
const SLOT_MAT_CACHE = new Map<string, THREE.Material>()
function tintedSlot(
  key: string,
  base: () => THREE.Material,
  color: string,
  tune?: (m: THREE.MeshStandardMaterial) => void,
): () => THREE.Material {
  return () => {
    let m = SLOT_MAT_CACHE.get(key)
    if (!m) {
      m = base().clone()
      const p = m as THREE.MeshStandardMaterial
      p.color = new THREE.Color(color)
      tune?.(p)
      SLOT_MAT_CACHE.set(key, m)
    }
    return m
  }
}

export const UPHOLSTERY_SLOTS: MaterialSlotEntry[] = [
  { key: 'fabricBeige',  label: 'Stoff Beige',  swatch: '#cdb992', material: () => MAT.fabric() },
  { key: 'fabricGray',   label: 'Stoff Grau',   swatch: '#9b9b96', material: () => MAT.fabricGray() },
  { key: 'fabricBlue',   label: 'Stoff Blau',   swatch: '#5a7da0', material: () => MAT.fabricBlue() },
  { key: 'fabricGreen',  label: 'Stoff Salbei', swatch: '#7f9078', material: tintedSlot('fabricGreen', () => MAT.fabricGray(), '#7f9078') },
  { key: 'fabricTerra',  label: 'Stoff Terrakotta', swatch: '#c1826a', material: tintedSlot('fabricTerra', () => MAT.fabricGray(), '#c1826a') },
  { key: 'fabricAnthracite', label: 'Stoff Anthrazit', swatch: '#54565c', material: tintedSlot('fabricAnthracite', () => MAT.fabricGray(), '#54565c') },
  { key: 'leatherBlack', label: 'Leder Schwarz', swatch: '#2a2724', material: () => MAT.leatherBlack() },
  {
    key: 'leatherCognac', label: 'Leder Cognac', swatch: '#a3653a',
    // Keep the leather grain (normal map), drop the near-black colour map —
    // multiplying a tint onto black could never lighten it.
    material: tintedSlot('leatherCognac', () => MAT.leatherBlack(), '#8f5a34', (m) => { m.map = null; m.roughness = 0.5 }),
  },
]
export const WOOD_SLOTS: MaterialSlotEntry[] = [
  { key: 'oak',    label: 'Eiche',   swatch: '#bb8a59', material: () => MAT.woodOak() },
  { key: 'walnut', label: 'Walnuss', swatch: '#7a4d2d', material: () => MAT.woodWalnut() },
  { key: 'ash',    label: 'Esche Hell', swatch: '#dcc9a8', material: tintedSlot('ash', () => MAT.woodOak(), '#e0d2b4') },
  { key: 'darkOak', label: 'Dunkel gebeizt', swatch: '#463830', material: () => MAT.woodDark() },
  { key: 'whiteWash', label: 'Weiß lasiert', swatch: '#eceae2', material: tintedSlot('whiteWash', () => MAT.woodOak(), '#efece4', (m) => { m.roughness = 0.62 }) },
]

/** Pick the upholstery material for a furniture item, defaulting to beige fabric. */
function upholsteryFor(item: PlacedFurniture): THREE.Material {
  const key = item?.materialKey
  if (key) {
    const found = UPHOLSTERY_SLOTS.find((s) => s.key === key)
    if (found) return found.material()
  }
  return MAT.fabric()
}
/** Pick the wood material for a furniture item, defaulting to walnut. */
function woodFor(item: PlacedFurniture, defaultKey: 'oak' | 'walnut' = 'walnut'): THREE.Material {
  const key = item?.materialKey
  if (key) {
    const found = WOOD_SLOTS.find((s) => s.key === key)
    if (found) return found.material()
  }
  return defaultKey === 'oak' ? MAT.woodOak() : MAT.woodWalnut()
}

// ─────────────────────────────────────────────────────────────────────
// Walls — extruded boxes with a subtle accent cap on top
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute corner extensions for each wall endpoint by checking if any
 * other wall ends at (or very near) that endpoint. If yes, extend the
 * current wall outward by half the connecting wall's thickness, so the
 * boxes overlap into a clean square corner instead of leaving a gap.
 *
 * Returns the endpoint-snap radius used (for joint-cap placement).
 */
const CORNER_SNAP_CM = 6  // walls within 6 cm of each other are considered "connected"

interface WallLike { id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }

function cornerExtensionsFor(wall: WallLike, allWalls: WallLike[]): { extA: number; extB: number } {
  let extA = 0, extB = 0
  for (const other of allWalls) {
    if (other.id === wall.id) continue
    // Endpoint a of `wall` close to either endpoint of `other`?
    const dAa = Math.hypot(wall.a.x - other.a.x, wall.a.y - other.a.y)
    const dAb = Math.hypot(wall.a.x - other.b.x, wall.a.y - other.b.y)
    if (dAa < CORNER_SNAP_CM || dAb < CORNER_SNAP_CM) {
      extA = Math.max(extA, other.thickness / 2)
    }
    // Endpoint b of `wall`?
    const dBa = Math.hypot(wall.b.x - other.a.x, wall.b.y - other.a.y)
    const dBb = Math.hypot(wall.b.x - other.b.x, wall.b.y - other.b.y)
    if (dBa < CORNER_SNAP_CM || dBb < CORNER_SNAP_CM) {
      extB = Math.max(extB, other.thickness / 2)
    }
  }
  return { extA, extB }
}

function Wall3D({ id, a, b, thickness, height = 250, selected, material, extA = 0, extB = 0, subtype = 'wall', openingWidth, openingHeight, openingSill, interiorSign = 1, outNx = 0, outNz = 0, dim = false }: {
  id?: string; a: Point; b: Point; thickness: number; height?: number; selected?: boolean;
  material: Material; extA?: number; extB?: number; subtype?: WallSubtype;
  openingWidth?: number; openingHeight?: number; openingSill?: number; interiorSign?: number;
  /** Plan-space outward normal (unit) + auto-dim flag for camera wall fade. */
  outNx?: number; outNz?: number; dim?: boolean;
}) {
  // Direction unit vector along the wall
  const dx = b.x - a.x
  const dy = b.y - a.y
  const baseLen = Math.hypot(dx, dy) || 1
  const ux = dx / baseLen
  const uy = dy / baseLen
  // Extended endpoints in world (cm) space — push each endpoint outward by its `ext`
  const ax = a.x - ux * extA
  const ay = a.y - uy * extA
  const bx = b.x + ux * extB
  const by = b.y + uy * extB

  const length = Math.hypot(bx - ax, by - ay)
  const angle = Math.atan2(by - ay, bx - ax)
  const midX = (ax + bx) / 2
  const midY = (ay + by) / 2
  // Per-wall CLONED materials so we can fade this wall independently. Each
  // clone remembers its base opacity / transparency so the fade multiplies
  // instead of clobbering (glass stays glass; opaque plaster stays opaque).
  const fade = useMemo(() => {
    const clones = {
      body:   (selected ? MAT.wallSel() : matFromCatalog(material)).clone(),
      cap:    MAT.shellDark().clone(),
      glass:  MAT.glass().clone(),
      skirt:  MAT.matteWhite().clone(),
    }
    const list = (Object.values(clones) as THREE.Material[]).map((mm) => {
      const rec = {
        m: mm,
        base: (mm as THREE.MeshStandardMaterial).opacity ?? 1,
        tr: mm.transparent,
        dw: mm.depthWrite,
      }
      mm.transparent = true
      return rec
    })
    return { ...clones, list }
  }, [selected, material])
  useEffect(() => {
    const list = fade.list
    return () => list.forEach((r) => r.m.dispose())
  }, [fade])
  const opac = useRef(1)
  // Door auto-open: residents write a per-wall target into RESIDENT_DOORS; the
  // leaf eases toward it and swings on its hinge. Empty map ⇒ target 0 ⇒ closed.
  const doorPivot = useRef<THREE.Group>(null)
  const doorOpen = useRef(0)
  useFrame((state, dt) => {
    if (subtype === 'door' && doorPivot.current) {
      const tgt = id ? (RESIDENT_DOORS.get(id) ?? 0) : 0
      doorOpen.current += (tgt - doorOpen.current) * (1 - Math.exp(-6 * Math.min(dt, 0.05)))
      doorPivot.current.rotation.y = doorOpen.current * Math.PI * 0.5
    }
    let target = 1
    if (dim) {
      const vx = state.camera.position.x - M(midX)
      const vz = state.camera.position.z - M(midY)
      const vl = Math.hypot(vx, vz) || 1
      const facing = (vx * outNx + vz * outNz) / vl   // >0 → camera on the outside of this wall
      const t = Math.max(0, Math.min(1, (facing - 0.05) / 0.4))
      target = 1 - t * 0.86                            // fade to ~0.14 when clearly blocking
    }
    opac.current += (target - opac.current) * (1 - Math.exp(-7 * Math.min(dt, 0.05)))
    const f = opac.current
    const faded = f < 0.985
    for (const r of fade.list) {
      r.m.opacity = r.base * f
      r.m.transparent = r.tr || faded
      r.m.depthWrite = faded ? false : r.dw
    }
  })
  const mat = fade.body
  const cap = fade.cap
  const glass = fade.glass
  const lengthM = M(length)
  const thickM = M(thickness)
  const heightM = M(height)

  // Solid wall — clean plaster body + a crisp white skirting board.
  if (subtype === 'wall' || subtype === undefined) {
    // Modern white skirting (Sockelleiste): matte white, ~8cm tall, protruding a
    // touch past the wall face on both sides so it reads as real trim where the
    // wall meets the floor — the archviz "finished room" detail.
    const baseboardHeight = 0.08
    const baseMaterial = fade.skirt
    // Exterior walls (thick perimeter walls) get dark cladding on the outside
    // face so the dollhouse reads as a dark shell around warm interiors.
    const isExterior = thickness >= 20
    return (
      <group position={[M(midX), heightM / 2, M(midY)]} rotation={[0, -angle, 0]}>
        {/* Main wall body */}
        <mesh castShadow receiveShadow material={mat}>
          <boxGeometry args={[lengthM, heightM, thickM]} />
        </mesh>
        {/* Cut-section cap — dark anthracite band along the sliced top */}
        <mesh position={[0, heightM / 2 + 0.015, 0]} material={cap}>
          <boxGeometry args={[lengthM + 0.004, 0.03, thickM + 0.004]} />
        </mesh>
        {/* Dark exterior cladding (outside face only) */}
        {isExterior && (
          <mesh position={[0, 0, -interiorSign * (thickM / 2 + 0.004)]} material={cap}>
            <boxGeometry args={[lengthM + 0.004, heightM + 0.03, 0.008]} />
          </mesh>
        )}
        {/* White skirting board */}
        <mesh position={[0, -heightM / 2 + baseboardHeight / 2, 0]} castShadow material={baseMaterial}>
          <boxGeometry args={[lengthM + 0.002, baseboardHeight, thickM + 0.02]} />
        </mesh>
      </group>
    )
  }

  // Door / window — split wall into segments around the opening
  const isDoor = subtype === 'door'
  const opW   = M(Math.min(openingWidth  ?? (isDoor ? 90  : 120), Math.max(20, length - 20)))
  const opH   = M(isDoor ? 200 : (openingHeight ?? 100))
  const opSill = M(isDoor ? 0 : (openingSill ?? 90))
  const sideW = (lengthM - opW) / 2  // left/right side widths
  const lintelH = heightM - (opSill + opH)

  return (
    <group position={[M(midX), 0, M(midY)]} rotation={[0, -angle, 0]}>
      {/* Left side — full height */}
      {sideW > 0 && (
        <mesh position={[-(opW / 2 + sideW / 2), heightM / 2, 0]} castShadow receiveShadow material={mat}>
          <boxGeometry args={[sideW, heightM, thickM]} />
        </mesh>
      )}
      {/* Right side — full height */}
      {sideW > 0 && (
        <mesh position={[(opW / 2 + sideW / 2), heightM / 2, 0]} castShadow receiveShadow material={mat}>
          <boxGeometry args={[sideW, heightM, thickM]} />
        </mesh>
      )}
      {/* Lintel — above opening */}
      {lintelH > 0 && (
        <mesh position={[0, opSill + opH + lintelH / 2, 0]} castShadow receiveShadow material={mat}>
          <boxGeometry args={[opW, lintelH, thickM]} />
        </mesh>
      )}
      {/* Sill — only for windows */}
      {!isDoor && opSill > 0 && (
        <mesh position={[0, opSill / 2, 0]} castShadow receiveShadow material={mat}>
          <boxGeometry args={[opW, opSill, thickM]} />
        </mesh>
      )}
      {/* Cut-section cap — dark anthracite band along the sliced top */}
      <mesh position={[0, heightM + 0.015, 0]} material={cap}>
        <boxGeometry args={[lengthM + 0.004, 0.03, thickM + 0.004]} />
      </mesh>
      {/* Door — white modern flush door with a slim white casing + chrome lever */}
      {isDoor && (
        <group position={[0, opH / 2, 0]}>
          {/* White casing around the opening */}
          <mesh position={[-opW / 2 + 0.025, 0, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.05, opH + 0.05, thickM * 1.1]} />
          </mesh>
          <mesh position={[opW / 2 - 0.025, 0, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.05, opH + 0.05, thickM * 1.1]} />
          </mesh>
          <mesh position={[0, opH / 2 - 0.025, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[opW, 0.05, thickM * 1.1]} />
          </mesh>
          {/* Hinged leaf — pivots at the left jamb so it swings open into the
              room. Children are shifted +opW/2 so their layout is unchanged. */}
          <group ref={doorPivot} position={[-opW / 2, 0, 0]}>
            {/* White flush leaf, slightly inset */}
            <mesh position={[opW / 2, 0, 0]} castShadow receiveShadow material={MAT.matteWhite()}>
              <boxGeometry args={[opW * 0.9, opH * 0.97, 0.04]} />
            </mesh>
            {/* Chrome lever handle on a round rose */}
            <mesh position={[opW * 0.30 + opW / 2, 0, 0.026]} rotation={[Math.PI / 2, 0, 0]} material={MAT.chrome()}>
              <cylinderGeometry args={[0.018, 0.018, 0.008, 20]} />
            </mesh>
            <mesh position={[opW * 0.27 + opW / 2, 0, 0.045]} castShadow material={MAT.chrome()}>
              <boxGeometry args={[0.10, 0.016, 0.018]} />
            </mesh>
          </group>
        </group>
      )}
      {/* Window — real transparent glazing in a slim white aluminium frame */}
      {!isDoor && (
        <group position={[0, opSill + opH / 2, 0]}>
          <mesh material={glass}>
            <boxGeometry args={[opW * 0.94, opH * 0.94, 0.012]} />
          </mesh>
          {/* Frame: top, bottom, two stiles + a centre mullion */}
          <mesh position={[0, opH / 2 - 0.02, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[opW, 0.04, thickM * 1.05]} />
          </mesh>
          <mesh position={[0, -opH / 2 + 0.02, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[opW, 0.04, thickM * 1.05]} />
          </mesh>
          <mesh position={[-opW / 2 + 0.02, 0, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.04, opH, thickM * 1.05]} />
          </mesh>
          <mesh position={[opW / 2 - 0.02, 0, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.04, opH, thickM * 1.05]} />
          </mesh>
          <mesh material={MAT.matteWhite()}>
            <boxGeometry args={[0.03, opH, thickM * 1.05]} />
          </mesh>
          {/* Window sill — a slim ledge below the opening */}
          <mesh position={[0, -opH / 2 - 0.02, thickM * 0.4]} castShadow receiveShadow material={MAT.matteWhite()}>
            <boxGeometry args={[opW + 0.06, 0.03, thickM * 1.5]} />
          </mesh>
          {/* Radiator — slim modern flat panel below the window, interior side.
              Sized from the sill height; skipped when there is no room for it. */}
          {(() => {
            const radH = Math.min(0.5, opSill - 0.18)
            if (radH < 0.28) return null
            const radW = opW * 0.85
            const zr = interiorSign * (thickM / 2 + 0.055)
            // group is centred on the glazing → hang the panel 8 cm below the sill
            const yr = -opH / 2 - 0.08 - radH / 2
            return (
              <group position={[0, yr, zr]}>
                {/* Flat front panel */}
                <mesh castShadow receiveShadow material={MAT.matteWhite()}>
                  <boxGeometry args={[radW, radH, 0.055]} />
                </mesh>
                {/* Top grille — dark inset line reads as the air vent */}
                <mesh position={[0, radH / 2 - 0.008, 0]} material={MAT.softBlack()}>
                  <boxGeometry args={[radW - 0.05, 0.012, 0.045]} />
                </mesh>
                {/* Side end caps */}
                {[-1, 1].map((s) => (
                  <mesh key={s} position={[s * (radW / 2 - 0.012), 0, 0]} castShadow material={MAT.matteWhite()}>
                    <boxGeometry args={[0.028, radH + 0.015, 0.06]} />
                  </mesh>
                ))}
                {/* Thermostat valve — chrome body + white head (smart TRV look) */}
                <group position={[radW / 2 + 0.045, radH / 2 - 0.05, 0]}>
                  <mesh rotation={[0, 0, Math.PI / 2]} material={MAT.chrome()}>
                    <cylinderGeometry args={[0.014, 0.014, 0.05, 12]} />
                  </mesh>
                  <mesh position={[0.045, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.matteWhite()}>
                    <cylinderGeometry args={[0.021, 0.021, 0.055, 16]} />
                  </mesh>
                </group>
              </group>
            )
          })()}
          {/* Curtains — two soft linen panels + a slim rod, hung on the room side */}
          {(() => {
            const zc = interiorSign * (thickM / 2 + 0.06)
            // Floor-length panels (reference look): from just above the frame
            // down to ~2cm over the floor.
            const drop = opSill + opH + 0.16
            const panelW = Math.min(0.26, opW * 0.22)
            const yTop = opH / 2 + 0.18
            const yc = yTop - drop / 2
            return (
              <group>
                {/* Rod */}
                <mesh position={[0, yTop, zc]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.aluminium()}>
                  <cylinderGeometry args={[0.012, 0.012, opW + 0.24, 12]} />
                </mesh>
                {/* Each panel = 4 alternating pleat strips (soft folded look
                    instead of a flat slab) */}
                {[-1, 1].map((s) => {
                  const px = s * (opW / 2 + 0.06 - panelW / 2)
                  const stripW = panelW / 4
                  return (
                    <group key={s}>
                      {[0, 1, 2, 3].map((i) => (
                        <mesh
                          key={i}
                          position={[px - panelW / 2 + (i + 0.5) * stripW, yc, zc + (i % 2 === 0 ? 0.012 : -0.012)]}
                          castShadow material={MAT.fabric()}
                        >
                          <boxGeometry args={[stripW + 0.006, drop, 0.035]} />
                        </mesh>
                      ))}
                    </group>
                  )
                })}
              </group>
            )
          })()}
        </group>
      )}
    </group>
  )
}

/**
 * Vertical pillar at a wall corner. Covers any tiny seam between two
 * extended-and-overlapping walls. Renders only ONCE per unique corner.
 */
function CornerPillar({ x, z, size, height, material }: {
  x: number; z: number; size: number; height: number; material: Material;
}) {
  const mat = useMemo(() => matFromCatalog(material), [material])
  return (
    <group>
      <mesh position={[M(x), height / 2, M(z)]} castShadow receiveShadow material={mat}>
        <boxGeometry args={[M(size), height, M(size)]} />
      </mesh>
      {/* Dark cut cap, flush with the wall caps */}
      <mesh position={[M(x), height + 0.015, M(z)]} material={MAT.shellDark()}>
        <boxGeometry args={[M(size) + 0.004, 0.03, M(size) + 0.004]} />
      </mesh>
    </group>
  )
}

/**
 * Find unique corner points by clustering wall endpoints — any two
 * endpoints within CORNER_SNAP_CM are treated as the same corner.
 * Returns one representative point per cluster, with the maximum
 * thickness of any wall meeting at that corner.
 */
function findCorners(walls: WallLike[]): Array<{ x: number; y: number; size: number; count: number }> {
  const out: Array<{ x: number; y: number; size: number; count: number }> = []
  const points: Array<{ x: number; y: number; t: number }> = []
  for (const w of walls) {
    points.push({ x: w.a.x, y: w.a.y, t: w.thickness })
    points.push({ x: w.b.x, y: w.b.y, t: w.thickness })
  }
  const used = new Array(points.length).fill(false)
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue
    let cx = points[i].x, cy = points[i].y, maxT = points[i].t, count = 1
    used[i] = true
    for (let j = i + 1; j < points.length; j++) {
      if (used[j]) continue
      if (Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y) <= CORNER_SNAP_CM) {
        used[j] = true
        cx = (cx * count + points[j].x) / (count + 1)
        cy = (cy * count + points[j].y) / (count + 1)
        maxT = Math.max(maxT, points[j].t)
        count++
      }
    }
    if (count >= 2) out.push({ x: cx, y: cy, size: maxT, count })
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Devices — per-category recognizable meshes
// ─────────────────────────────────────────────────────────────────────

function DeviceMesh({ deviceId, category, on, hint }: { deviceId?: string; category: string; on: boolean | null; hint?: string }) {
  const colorBase = DEVICE_COLORS[category] ?? DEVICE_COLORS.other

  // ─── Premium device-specific meshes (override category default) ───
  if (deviceId) {
    // WeLock — black oval retrofit smart lock: thumb-turn knob + round button,
    // mounted on the door over the cylinder (the reference's front-door lock).
    if (deviceId === 'welock-lock') {
      return (
        <group>
          {/* Oval black body — a rounded cylinder capped by a half-sphere */}
          <mesh position={[0, 0.12, 0]} castShadow material={MAT.matteBlack()}>
            <cylinderGeometry args={[0.045, 0.045, 0.16, 24]} />
          </mesh>
          <mesh position={[0, 0.20, 0]} castShadow material={MAT.matteBlack()}>
            <sphereGeometry args={[0.045, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          {/* Thumb-turn dial + silver bar */}
          <mesh position={[0, 0.205, 0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.chrome()}>
            <cylinderGeometry args={[0.026, 0.026, 0.012, 20]} />
          </mesh>
          <mesh position={[0, 0.205, 0.038]} castShadow material={MAT.steel()}>
            <boxGeometry args={[0.006, 0.042, 0.006]} />
          </mesh>
          {/* Round button */}
          <mesh position={[0, 0.085, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.008, 20]} />
            <meshStandardMaterial color="#2a2a2c" roughness={0.5} metalness={0.2} />
          </mesh>
          {/* Status LED */}
          <mesh position={[0, 0.15, 0.038]}>
            <circleGeometry args={[0.004, 12]} />
            <meshStandardMaterial color={on === false ? '#ff5a5a' : '#37d67a'} emissive={on === false ? '#ff5a5a' : '#37d67a'} emissiveIntensity={1.3} toneMapped={false} />
          </mesh>
        </group>
      )
    }
    // Lockin G30 — premium fingerprint smart lock
    if (deviceId === 'lockin-g30') {
      return (
        <group>
          {/* Main body — slim vertical handle housing in brushed aluminum */}
          <mesh position={[0, 0.13, 0]} castShadow material={MAT.steel()}>
            <boxGeometry args={[0.07, 0.26, 0.04]} />
          </mesh>
          {/* Black glass fingerprint panel on front */}
          <mesh position={[0, 0.18, 0.022]} material={MAT.glass()}>
            <boxGeometry args={[0.05, 0.06, 0.003]} />
          </mesh>
          {/* Status LED dot */}
          <mesh position={[0, 0.13, 0.022]}>
            <circleGeometry args={[0.004, 16]} />
            <meshStandardMaterial color={on === false ? '#FF4D4D' : '#2EE59D'} emissive={on === false ? '#FF4D4D' : '#2EE59D'} emissiveIntensity={1.2} />
          </mesh>
          {/* Door handle protruding to the right */}
          <mesh position={[0.05, 0.10, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.steel()}>
            <cylinderGeometry args={[0.008, 0.008, 0.06, 16]} />
          </mesh>
        </group>
      )
    }
    // Lockin G30 WiFi Bridge — small sleek cylinder
    if (deviceId === 'lockin-g30-bridge') {
      return (
        <group>
          <mesh position={[0, 0.025, 0]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.025, 0.030, 0.05, 24]} />
          </mesh>
          <mesh position={[0, 0.025, 0.026]}>
            <circleGeometry args={[0.003, 12]} />
            <meshStandardMaterial color={'#7cba7a'} emissive={'#7cba7a'} emissiveIntensity={1} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Lock Pro — black puck on door
    if (deviceId === 'switchbot-lock-pro') {
      return (
        <group>
          <mesh position={[0, 0.04, 0]} castShadow material={MAT.matteBlack()}>
            <boxGeometry args={[0.07, 0.08, 0.05]} />
          </mesh>
          {/* Top finger ring */}
          <mesh position={[0, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.steel()}>
            <torusGeometry args={[0.018, 0.005, 12, 24]} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Bot — small white square button-presser
    if (deviceId === 'switchbot-bot') {
      return (
        <group>
          <mesh position={[0, 0.022, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.045, 0.044, 0.045]} />
          </mesh>
          {/* Plunger arm */}
          <mesh position={[0, 0.022, 0.024]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.02, 0.005, 0.012]} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Curtain 3 — long horizontal track motor
    if (deviceId === 'switchbot-curtain-3') {
      return (
        <group>
          <mesh position={[0, 0.05, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.10, 0.05, 0.03]} />
          </mesh>
          {/* Hook */}
          <mesh position={[0, 0.085, 0]} castShadow material={MAT.steel()}>
            <torusGeometry args={[0.012, 0.002, 8, 16]} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Hub 2 — flat tablet
    if (deviceId === 'switchbot-hub-2') {
      return (
        <group>
          <mesh position={[0, 0.04, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.12, 0.07, 0.02]} />
          </mesh>
          {/* Display screen */}
          <mesh position={[0, 0.04, 0.011]} material={MAT.glass()}>
            <boxGeometry args={[0.07, 0.04, 0.001]} />
          </mesh>
        </group>
      )
    }
    // Govee Glide Hexa — wall-mounted hexagonal RGB light
    if (deviceId === 'govee-glide-hexa') {
      const onColor = on === true ? '#ff60d8' : '#222'
      return (
        <group>
          {/* Three hexagonal panels in a cluster */}
          {[
            [0, 0.10, 0],
            [-0.05, 0.18, 0],
            [0.05, 0.18, 0],
          ].map(([x, y, z], i) => (
            <mesh key={i} position={[x, y, z]} castShadow>
              <cylinderGeometry args={[0.04, 0.04, 0.012, 6]} />
              <meshStandardMaterial color={'#1a1a1d'} roughness={0.5} metalness={0.3} />
            </mesh>
          ))}
          {/* Glow planes on top */}
          {[
            [0, 0.107, 0],
            [-0.05, 0.187, 0],
            [0.05, 0.187, 0],
          ].map(([x, y, z], i) => (
            <mesh key={`g${i}`} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.034, 6]} />
              <meshStandardMaterial color={onColor} emissive={onColor} emissiveIntensity={on === true ? 0.9 : 0} />
            </mesh>
          ))}
        </group>
      )
    }
    // Govee Floor Lamp Pro — slim cylindrical column
    if (deviceId === 'govee-floor-lamp') {
      const onColor = on === true ? '#ff80c0' : '#444'
      return (
        <group>
          {/* Base */}
          <mesh position={[0, 0.02, 0]} castShadow material={MAT.matteBlack()}>
            <cylinderGeometry args={[0.08, 0.10, 0.04, 32]} />
          </mesh>
          {/* Tall column */}
          <mesh position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 1.0, 24]} />
            <meshStandardMaterial color={onColor} emissive={onColor} emissiveIntensity={on === true ? 0.7 : 0} roughness={0.6} />
          </mesh>
        </group>
      )
    }
    // Govee LED Strip — glowing line on wall
    if (deviceId === 'govee-rgbic-strip-pro' || deviceId === 'switchbot-strip-light') {
      const onColor = on === true ? '#ff66ff' : '#666'
      return (
        <group>
          <mesh position={[0, 0.10, 0]} castShadow>
            <boxGeometry args={[0.40, 0.012, 0.008]} />
            <meshStandardMaterial color={onColor} emissive={onColor} emissiveIntensity={on === true ? 1.2 : 0} roughness={0.5} />
          </mesh>
        </group>
      )
    }
    // Govee Outdoor String / Curtain Lights
    if (deviceId === 'govee-string-lights' || deviceId === 'govee-curtain-lights') {
      const onColor = on === true ? '#fff0a0' : '#888'
      return (
        <group>
          {[-0.10, -0.05, 0, 0.05, 0.10].map((x, i) => (
            <mesh key={i} position={[x, 0.06 + (i % 2) * 0.02, 0]}>
              <sphereGeometry args={[0.008, 16, 12]} />
              <meshStandardMaterial color={onColor} emissive={onColor} emissiveIntensity={on === true ? 1.4 : 0} />
            </mesh>
          ))}
        </group>
      )
    }
    // Osaio + Arenti outdoor cameras — sleek bullet form
    if (deviceId === 'osaio-outdoor-4mp' || deviceId === 'arenti-out6q' || deviceId === 'arenti-go1') {
      return (
        <group>
          {/* Mount arm */}
          <mesh position={[0, 0.04, -0.025]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.02, 0.04, 0.05]} />
          </mesh>
          {/* Camera body */}
          <mesh position={[0, 0.06, 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.025, 0.028, 0.08, 24]} />
          </mesh>
          {/* Lens */}
          <mesh position={[0, 0.06, 0.062]} rotation={[Math.PI / 2, 0, 0]} material={MAT.glass()}>
            <cylinderGeometry args={[0.02, 0.02, 0.005, 24]} />
          </mesh>
          {/* IR ring */}
          <mesh position={[0, 0.06, 0.064]}>
            <ringGeometry args={[0.020, 0.024, 32]} />
            <meshBasicMaterial color={'#221'} />
          </mesh>
        </group>
      )
    }
    // Osaio doorbell — vertical pill
    if (deviceId === 'osaio-doorbell') {
      return (
        <group>
          <mesh position={[0, 0.07, 0]} castShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.035, 0.10, 0.022]} />
          </mesh>
          <mesh position={[0, 0.085, 0.012]} material={MAT.glass()}>
            <circleGeometry args={[0.012, 24]} />
          </mesh>
          <mesh position={[0, 0.045, 0.012]}>
            <circleGeometry args={[0.008, 24]} />
            <meshStandardMaterial color={'#E8C879'} metalness={0.6} roughness={0.3} emissive={'#E8C879'} emissiveIntensity={0.4} />
          </mesh>
        </group>
      )
    }
    // Arenti IN1Q — small cube indoor cam
    if (deviceId === 'arenti-in1q' || deviceId === 'osaio-indoor-2k') {
      return (
        <group>
          {/* Stand — anodised aluminium */}
          <mesh position={[0, 0.012, 0]} castShadow material={MAT.aluminium()}>
            <cylinderGeometry args={[0.025, 0.030, 0.024, 24]} />
          </mesh>
          {/* Body — anodised aluminium */}
          <mesh position={[0, 0.05, 0]} castShadow material={MAT.aluminium()}>
            <boxGeometry args={[0.05, 0.05, 0.05]} />
          </mesh>
          {/* Lens */}
          <mesh position={[0, 0.05, 0.026]} rotation={[Math.PI / 2, 0, 0]} material={MAT.glass()}>
            <cylinderGeometry args={[0.015, 0.015, 0.005, 24]} />
          </mesh>
        </group>
      )
    }
    // Smart Life / Tuya plugs — rounded square
    if (deviceId === 'smartlife-plug' || deviceId === 'switchbot-plug-mini') {
      return (
        <group>
          <mesh position={[0, 0.03, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.05, 0.06, 0.03]} />
          </mesh>
          {/* Two pin holes */}
          <mesh position={[-0.008, 0.035, 0.016]}>
            <circleGeometry args={[0.003, 16]} />
            <meshBasicMaterial color={'#333'} />
          </mesh>
          <mesh position={[0.008, 0.035, 0.016]}>
            <circleGeometry args={[0.003, 16]} />
            <meshBasicMaterial color={'#333'} />
          </mesh>
        </group>
      )
    }
    // Tuya/Smart+ mmWave/PIR — small dome
    if (deviceId === 'tuya-mmwave' || deviceId === 'tuya-pir-motion' || deviceId === 'tuya-motion-zigbee' || deviceId === 'switchbot-motion') {
      return (
        <group>
          <mesh position={[0, 0.025, 0]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.024, 0.028, 0.012, 24]} />
          </mesh>
          <mesh position={[0, 0.034, 0]} castShadow>
            <sphereGeometry args={[0.022, 24, 12]} />
            <meshStandardMaterial color={'#f5f0e6'} roughness={0.5} metalness={0.05} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Meter Plus — tiny screen
    if (deviceId === 'switchbot-meter-plus') {
      return (
        <group>
          <mesh position={[0, 0.025, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.05, 0.05, 0.014]} />
          </mesh>
          {/* LCD */}
          <mesh position={[0, 0.028, 0.0073]}>
            <boxGeometry args={[0.038, 0.030, 0.001]} />
            <meshStandardMaterial color={'#a0c4a0'} emissive={'#a0c4a0'} emissiveIntensity={0.2} />
          </mesh>
        </group>
      )
    }
    // Sonos Arc — long rounded soundbar: soft-black shell, a real perforated
    // acoustic grille wrapping the front/top, a recessed touch strip and LED.
    if (/^sonos-arc/.test(deviceId)) {
      const grille = sonosGrilleMat()
      // Soundbars live on the lowboard, not the floor
      return (
        <group position={[0, 0.51, 0]}>
          {/* Shell */}
          <RoundedBox position={[0, 0.055, 0]} castShadow receiveShadow material={MAT.softBlack()} args={[1.1, 0.095, 0.115]} radius={0.046} smoothness={4} />
          {/* Perforated grille wrapping the front face */}
          <mesh position={[0, 0.052, 0.0585]} material={grille}>
            <boxGeometry args={[1.05, 0.072, 0.006]} />
          </mesh>
          {/* Perforated grille on the curved top */}
          <mesh position={[0, 0.104, 0.012]} rotation={[-Math.PI / 2, 0, 0]} material={grille}>
            <planeGeometry args={[1.05, 0.07]} />
          </mesh>
          {/* Recessed capacitive touch strip (centre top) */}
          <mesh position={[0, 0.1045, -0.028]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.darkPanel()}>
            <planeGeometry args={[0.2, 0.045]} />
          </mesh>
          {/* Status LED */}
          <mesh position={[0, 0.1046, -0.028]}>
            <circleGeometry args={[0.0035, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#dfe8ff" emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
        </group>
      )
    }
    // Echo Dot — fabric-wrapped puck: acoustic mesh sphere, a matte top with
    // four control buttons, and the blue light ring glowing at the base.
    if (/^echo-dot/.test(deviceId)) {
      const fabric = echoFabricMat()
      return (
        <group>
          {/* Fabric mesh body — a squat sphere (the Dot's rounded puck) */}
          <mesh position={[0, 0.045, 0]} scale={[1, 0.82, 1]} castShadow material={fabric}>
            <sphereGeometry args={[0.05, 28, 20]} />
          </mesh>
          {/* Matte top cap with 4 control buttons */}
          <mesh position={[0, 0.083, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.matteBlack()}>
            <circleGeometry args={[0.042, 28]} />
          </mesh>
          {([[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]] as const).map(([bx, bz], i) => (
            <mesh key={i} position={[bx, 0.085, bz]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.006, 12]} />
              <meshStandardMaterial color="#1a1c1f" roughness={0.6} />
            </mesh>
          ))}
          {/* Blue activity light ring at the base */}
          <mesh position={[0, 0.012, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.046, 0.006, 12, 40]} />
            <meshStandardMaterial color="#2f7fe8" emissive="#3d8ffb" emissiveIntensity={1.7} toneMapped={false} />
          </mesh>
        </group>
      )
    }
    // Apple TV — small glossy black rounded puck with a matte top inlay and a
    // dim front status LED (on the lowboard)
    if (/^apple-tv/.test(deviceId)) {
      return (
        <group position={[0, 0.528, 0]}>
          {/* Glossy body */}
          <RoundedBox castShadow receiveShadow material={MAT.darkPanel()} args={[0.098, 0.033, 0.098]} radius={0.014} smoothness={4} />
          {/* Matte top inlay (the soft-touch top surface) */}
          <mesh position={[0, 0.0175, 0]} rotation={[-Math.PI / 2, 0, 0]} material={MAT.matteBlack()}>
            <planeGeometry args={[0.072, 0.072]} />
          </mesh>
          {/* Dim front status LED */}
          <mesh position={[0, -0.002, 0.05]}>
            <circleGeometry args={[0.0022, 10]} />
            <meshStandardMaterial color="#ffffff" emissive="#fff4e0" emissiveIntensity={0.9} toneMapped={false} />
          </mesh>
        </group>
      )
    }
    // Hue Bridge — flat white rounded square with three status LEDs
    if (/^hue-bridge/.test(deviceId)) {
      return (
        <group>
          <RoundedBox position={[0, 0.014, 0]} castShadow receiveShadow material={MAT.matteWhite()} args={[0.09, 0.026, 0.09]} radius={0.01} smoothness={2} />
          {[-0.02, 0, 0.02].map((x, i) => (
            <mesh key={i} position={[x, 0.028, 0.01]}>
              <circleGeometry args={[0.0035, 8]} />
              <meshStandardMaterial color="#9fd0ff" emissive="#7db9ff" emissiveIntensity={1.4} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )
    }
    // Smoke detector (Bosch Twinguard & co) — CEILING-mounted white disc with
    // vent ring; a smoke alarm on the floor breaks the illusion instantly.
    if (/twinguard|smoke|rauch/.test(deviceId)) {
      return (
        <group position={[0, 2.42, 0]}>
          <mesh castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.065, 0.075, 0.05, 28]} />
          </mesh>
          <mesh position={[0, -0.028, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.03, 0.055, 28]} />
            <meshStandardMaterial color="#d8d8d4" roughness={0.8} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )
    }
    // Aqara FP2 presence sensor — small white wall puck mounted high
    if (/^aqara-fp2/.test(deviceId)) {
      return (
        <group position={[0, 2.15, 0]}>
          <RoundedBox castShadow material={MAT.matteWhite()} args={[0.05, 0.05, 0.02]} radius={0.008} smoothness={2} />
        </group>
      )
    }
    // Eve Thermo — white panel radiator + smart valve with tiny display
    if (/^eve-thermo/.test(deviceId)) {
      return (
        <group>
          {/* Panel radiator (ribbed) */}
          <RoundedBox position={[0, 0.32, 0]} castShadow receiveShadow material={MAT.matteWhite()} args={[0.6, 0.5, 0.07]} radius={0.012} smoothness={2} />
          {[-0.22, -0.11, 0, 0.11, 0.22].map((x, i) => (
            <mesh key={i} position={[x, 0.32, 0.037]} material={MAT.matteWhite()}>
              <boxGeometry args={[0.06, 0.46, 0.006]} />
            </mesh>
          ))}
          {/* Smart valve on the side */}
          <mesh position={[0.34, 0.16, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.026, 0.026, 0.08, 16]} />
          </mesh>
          <mesh position={[0.381, 0.16, 0]} rotation={[0, 0, Math.PI / 2]}>
            <circleGeometry args={[0.018, 16]} />
            <meshStandardMaterial color="#111" emissive="#2a3a4a" emissiveIntensity={0.8} />
          </mesh>
        </group>
      )
    }
    // SwitchBot Keypad
    if (deviceId === 'switchbot-keypad') {
      return (
        <group>
          <mesh position={[0, 0.05, 0]} castShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.05, 0.085, 0.014]} />
          </mesh>
          {/* Keypad area */}
          <mesh position={[0, 0.05, 0.0075]}>
            <boxGeometry args={[0.04, 0.06, 0.001]} />
            <meshStandardMaterial color={'#222'} roughness={0.3} metalness={0.5} />
          </mesh>
        </group>
      )
    }
    // Nuki Smart Lock 4 Pro — the unmistakable matte-black cylinder that clamps
    // over the door's thumb-turn and projects into the room, with a brushed
    // grip ring on the face and an LED status ring (green = locked/armed).
    // Placed at handle height; d.rotation orients it onto the door leaf.
    if (deviceId === 'nuki-smart-lock-4') {
      const armed = on !== false
      const ledColor = armed ? '#37d67a' : '#ff9d3d'
      return (
        <group position={[0, 1.0, 0]}>
          {/* Body — cylinder projecting horizontally out from the door */}
          <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow material={MAT.softBlack()}>
            <cylinderGeometry args={[0.033, 0.035, 0.06, 44]} />
          </mesh>
          {/* Front turn-knob face (matte, slightly proud) */}
          <mesh position={[0, 0, 0.061]} castShadow material={MAT.softBlack()}>
            <circleGeometry args={[0.031, 40]} />
          </mesh>
          {/* Rotatable brushed grip ring on the front rim */}
          <mesh position={[0, 0, 0.058]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.brushedSteel()}>
            <torusGeometry args={[0.031, 0.004, 16, 44]} />
          </mesh>
          {/* LED status ring around the body near the front */}
          <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.0345, 0.0025, 16, 48]} />
            <meshStandardMaterial color={ledColor} emissive={ledColor} emissiveIntensity={1.5} toneMapped={false} />
          </mesh>
          {/* Base collar clamping onto the euro-cylinder */}
          <mesh position={[0, 0, 0.006]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.matteBlack()}>
            <cylinderGeometry args={[0.036, 0.038, 0.012, 44]} />
          </mesh>
        </group>
      )
    }
    // Philips Hue Motion Sensor — small white rounded body with a milky Fresnel
    // PIR lens on the front, on a ball-joint mount. Corner/wall mounted high so
    // it reads as a real occupancy sensor rather than a puck on the floor.
    if (deviceId === 'hue-motion') {
      return (
        <group position={[0, 2.05, 0]}>
          {/* White rounded body */}
          <RoundedBox castShadow receiveShadow material={MAT.matteWhite()} args={[0.036, 0.036, 0.03]} radius={0.008} smoothness={3} />
          {/* Milky Fresnel PIR lens (slight dome) on the front face */}
          <mesh position={[0, 0, 0.016]} rotation={[-Math.PI / 2, 0, 0]}>
            <sphereGeometry args={[0.012, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#eceae4" roughness={0.35} metalness={0.05} />
          </mesh>
          {/* Ball-joint mount stub behind */}
          <mesh position={[0, -0.006, -0.022]} castShadow material={MAT.matteWhite()}>
            <sphereGeometry args={[0.009, 16, 12]} />
          </mesh>
          <mesh position={[0, -0.006, -0.03]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.006, 0.006, 0.012, 16]} />
          </mesh>
        </group>
      )
    }
    // Philips Hue Lightstrip Plus — a thin flexible LED strip (TV backlight),
    // not a floor lamp. A slim white channel with an emissive diffuser running
    // its length and the small controller nub at one end.
    if (deviceId === 'hue-lightstrip-plus') {
      const glowI = on === true ? 2.4 : 0.9
      // TV bias-lighting: the strip hugs the wall at TV height so the diffuser
      // faces the wall and spills a warm halo (you see the glow, not a bar on
      // the floor). Mounted just behind the media wall's TV centre.
      return (
        <group position={[0, 1.15, 0.02]}>
          {/* Flexible strip base — long thin flat channel against the wall */}
          <mesh position={[0, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.014, 0.006]} />
            <meshStandardMaterial color="#f4f4f4" roughness={0.5} metalness={0.1} />
          </mesh>
          {/* Emissive diffuser facing the wall (warm-white default) */}
          <mesh position={[0, 0, -0.004]}>
            <boxGeometry args={[0.88, 0.009, 0.0015]} />
            <meshStandardMaterial color="#fff2da" emissive="#ffd9a0" emissiveIntensity={glowI} />
          </mesh>
          {/* Controller nub at one end */}
          <mesh position={[-0.47, 0, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.02, 0.02, 0.014]} />
          </mesh>
        </group>
      )
    }
    // Eve Energy — glossy-white smart plug on a wall socket (here powering the
    // coffee machine). Round pass-through socket, side button, status LED.
    // Mounted at backsplash-socket height so it reads as a real plug, not a
    // box on the floor. d.rotation seats it against the wall.
    if (deviceId === 'eve-energy') {
      const lit = on === true
      return (
        <group position={[0, 1.05, 0]}>
          {/* Body — glossy white rounded block plugged into the wall */}
          <RoundedBox castShadow receiveShadow material={MAT.matteWhite()} args={[0.055, 0.062, 0.05]} radius={0.006} smoothness={3} />
          {/* Front pass-through socket recess */}
          <mesh position={[0, -0.006, 0.026]}>
            <circleGeometry args={[0.02, 32]} />
            <meshStandardMaterial color="#e9e7e0" roughness={0.65} />
          </mesh>
          {/* Two socket pin holes */}
          {[-0.007, 0.007].map((x, i) => (
            <mesh key={i} position={[x, -0.006, 0.0262]}>
              <circleGeometry args={[0.0028, 12]} />
              <meshStandardMaterial color="#2a2a2a" roughness={0.6} />
            </mesh>
          ))}
          {/* Physical button top-right */}
          <mesh position={[0.017, 0.022, 0.026]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.006, 0.006, 0.004, 20]} />
          </mesh>
          {/* Status LED */}
          <mesh position={[-0.015, 0.024, 0.0262]}>
            <circleGeometry args={[0.0022, 12]} />
            <meshStandardMaterial color={lit ? '#37d67a' : '#556'} emissive={lit ? '#37d67a' : '#223'} emissiveIntensity={lit ? 1.3 : 0.25} toneMapped={false} />
          </mesh>
        </group>
      )
    }
    // Shelly 1PM Mini — a hidden in-wall relay; what's visible is the load it
    // switches. Here its note is "Deckenleuchte", so we render the flush ceiling
    // luminaire it controls (glowing warm when on) rather than a floor box.
    if (deviceId === 'shelly-1pm-mini') {
      const glow = on === true ? 2.0 : 0.55
      return (
        <group position={[0, 2.4, 0]}>
          {/* Slim white ceiling housing */}
          <mesh castShadow receiveShadow material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.11, 0.115, 0.028, 40]} />
          </mesh>
          {/* Emissive diffuser on the underside */}
          <mesh position={[0, -0.015, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.10, 40]} />
            <meshStandardMaterial color="#fff4e2" emissive="#ffe9c8" emissiveIntensity={glow} side={THREE.DoubleSide} />
          </mesh>
        </group>
      )
    }
  }

  switch (category) {
    case 'light': {
      // Floor lamp — slim pole + warm fabric drum shade (a real luminaire like
      // the reference, not a 20cm puck). The shade always carries a faint warm
      // glow (a lamp in a dusk render reads lit); explicitly ON burns brighter.
      const glow = on === true ? 1.6 : 0.5
      // Bedside/table variant: a 1.4m floor lamp standing on a nightstand looks
      // wrong. When the placement note reads "Bett"/"Nachttisch"/bedside/table,
      // render a compact ~40cm table lamp instead of the floor luminaire.
      const bedside = /bett|nacht|bedside|tisch(?!ler)|desk/i.test(hint ?? '')
      if (bedside) {
        return (
          <group>
            {/* Ceramic base */}
            <mesh position={[0, 0.02, 0]} castShadow receiveShadow material={MAT.matteWhite()}>
              <cylinderGeometry args={[0.055, 0.065, 0.04, 28]} />
            </mesh>
            {/* Slim brass stem */}
            <mesh position={[0, 0.16, 0]} castShadow material={MAT.brass()}>
              <cylinderGeometry args={[0.008, 0.008, 0.26, 12]} />
            </mesh>
            {/* Fabric drum shade with warm inner glow */}
            <mesh position={[0, 0.33, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.11, 0.15, 28, 1, true]} />
              <meshStandardMaterial color="#e8dcc4" roughness={0.9} metalness={0} emissive="#ffd9a8" emissiveIntensity={glow} side={THREE.DoubleSide} />
            </mesh>
            {/* Bottom diffuser glow */}
            <mesh position={[0, 0.262, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.09, 28]} />
              <meshStandardMaterial color="#fff2da" emissive="#ffcf96" emissiveIntensity={glow + 0.3} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )
      }
      return (
        <group>
          {/* Base disc */}
          <mesh position={[0, 0.015, 0]} castShadow receiveShadow material={MAT.metal()}>
            <cylinderGeometry args={[0.14, 0.15, 0.03, 24]} />
          </mesh>
          {/* Slim pole */}
          <mesh position={[0, 0.72, 0]} castShadow material={MAT.aluminium()}>
            <cylinderGeometry args={[0.012, 0.012, 1.4, 12]} />
          </mesh>
          {/* Fabric drum shade with warm inner glow */}
          <mesh position={[0, 1.5, 0]} castShadow>
            <cylinderGeometry args={[0.16, 0.18, 0.26, 24, 1, true]} />
            <meshStandardMaterial
              color="#e8dcc4" roughness={0.9} metalness={0}
              emissive="#ffd9a8" emissiveIntensity={glow}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Glowing diffuser (top + bottom of the drum) */}
          <mesh position={[0, 1.38, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.16, 24]} />
            <meshStandardMaterial color="#fff2da" emissive="#ffcf96" emissiveIntensity={glow + 0.4} side={THREE.DoubleSide} />
          </mesh>
          {/* NOTE: no extra pointLight here — RoomLights already places one real
              light per "on" lamp from the lighting model; the mesh only glows. */}
        </group>
      )
    }
    case 'speaker': {
      return (
        <group>
          {/* Body — soft-touch black (premium speaker finish) */}
          <mesh position={[0, 0.07, 0]} castShadow receiveShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.16, 0.14, 0.10]} />
          </mesh>
          {/* Large woofer driver */}
          <mesh position={[0, 0.07, 0.052]} castShadow>
            <circleGeometry args={[0.045, 24]} />
            <meshStandardMaterial color={'#3a3a40'} roughness={0.95} metalness={0.0} />
          </mesh>
          {/* Large woofer ring */}
          <mesh position={[0, 0.07, 0.053]} material={MAT.brass()}>
            <ringGeometry args={[0.045, 0.05, 32]} />
          </mesh>
          {/* Small tweeter driver */}
          <mesh position={[0, 0.12, 0.052]} castShadow>
            <circleGeometry args={[0.025, 24]} />
            <meshStandardMaterial color={'#3a3a40'} roughness={0.95} metalness={0.0} />
          </mesh>
          {/* Small tweeter ring */}
          <mesh position={[0, 0.12, 0.053]} material={MAT.brass()}>
            <ringGeometry args={[0.025, 0.03, 32]} />
          </mesh>
          {/* Base plinth */}
          <mesh position={[0, 0.02, 0]} castShadow receiveShadow material={MAT.matteBlack()}>
            <boxGeometry args={[0.18, 0.04, 0.12]} />
          </mesh>
        </group>
      )
    }
    case 'camera': {
      return (
        <group>
          {/* Body — anodised aluminium */}
          <mesh position={[0, 0.05, 0]} castShadow material={MAT.aluminium()}>
            <cylinderGeometry args={[0.04, 0.04, 0.06, 24]} />
          </mesh>
          {/* Lens */}
          <mesh position={[0, 0.05, 0.041]} rotation={[Math.PI / 2, 0, 0]} material={MAT.glass()}>
            <cylinderGeometry args={[0.022, 0.022, 0.02, 24]} />
          </mesh>
          {/* Stand */}
          <mesh position={[0, 0.01, 0]} castShadow material={MAT.metal()}>
            <boxGeometry args={[0.05, 0.02, 0.05]} />
          </mesh>
        </group>
      )
    }
    case 'lock': {
      return (
        <group>
          {/* Body */}
          <mesh position={[0, 0.05, 0]} castShadow material={MAT.brass()}>
            <boxGeometry args={[0.07, 0.10, 0.04]} />
          </mesh>
          {/* Knob */}
          <mesh position={[0, 0.05, 0.025]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.metal()}>
            <cylinderGeometry args={[0.012, 0.012, 0.02, 16]} />
          </mesh>
        </group>
      )
    }
    case 'climate': {
      // Thermostat / heating slab
      return (
        <group>
          <mesh position={[0, 0.04, 0]} castShadow material={MAT.aluminium()}>
            <boxGeometry args={[0.12, 0.08, 0.02]} />
          </mesh>
          <mesh position={[0, 0.04, 0.011]} material={MAT.glass()}>
            <circleGeometry args={[0.025, 24]} />
          </mesh>
        </group>
      )
    }
    case 'sensor': {
      return (
        <group>
          {/* Dome */}
          <mesh position={[0, 0.04, 0]} castShadow material={MAT.matteWhite()}>
            <sphereGeometry args={[0.035, 24, 16]} />
          </mesh>
        </group>
      )
    }
    case 'hub': {
      return (
        <group>
          {/* Smooth cylindrical hub body — anodised aluminium */}
          <mesh position={[0, 0.025, 0]} castShadow receiveShadow material={MAT.aluminium()}>
            <cylinderGeometry args={[0.06, 0.06, 0.05, 32]} />
          </mesh>
          {/* LED ring near base */}
          <mesh position={[0, 0.0125, 0]}>
            <torusGeometry args={[0.06, 0.004, 24, 48]} />
            <meshStandardMaterial color={'#7cba7a'} emissive={'#7cba7a'} emissiveIntensity={0.8} />
          </mesh>
        </group>
      )
    }
    case 'tv': {
      return (
        <group>
          {/* Base stand — anodised aluminium */}
          <mesh position={[0, 0.00, 0]} castShadow material={MAT.aluminium()}>
            <boxGeometry args={[0.18, 0.01, 0.10]} />
          </mesh>
          {/* Vertical support connecting base to TV */}
          <mesh position={[0, 0.06, 0]} castShadow material={MAT.aluminium()}>
            <boxGeometry args={[0.02, 0.12, 0.02]} />
          </mesh>
          {/* Screen panel — opaque glossy display (not see-through) */}
          <mesh position={[0, 0.12, 0.02]} castShadow material={MAT.darkPanel()}>
            <boxGeometry args={[0.42, 0.24, 0.02]} />
          </mesh>
          {/* Back panel / frame — soft-touch black bezel */}
          <mesh position={[0, 0.12, -0.01]} castShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.44, 0.26, 0.04]} />
          </mesh>
        </group>
      )
    }
    case 'blind': {
      // Vertical slats hanging
      return (
        <group>
          <mesh position={[0, 0.10, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.18, 0.20, 0.005]} />
          </mesh>
          {[-0.06, -0.02, 0.02, 0.06].map((x, i) => (
            <mesh key={i} position={[x, 0.10, 0.004]}>
              <boxGeometry args={[0.001, 0.20, 0.001]} />
              <meshStandardMaterial color={'#7E93B5'} />
            </mesh>
          ))}
        </group>
      )
    }
    case 'switch':
    case 'outlet': {
      return (
        <group>
          <mesh position={[0, 0.025, 0]} castShadow material={MAT.matteWhite()}>
            <boxGeometry args={[0.06, 0.05, 0.015]} />
          </mesh>
          <mesh position={[0, 0.025, 0.009]} material={MAT.metal()}>
            <boxGeometry args={[0.025, 0.025, 0.002]} />
          </mesh>
        </group>
      )
    }
    case 'alarm': {
      return (
        <group>
          {/* Bell-like */}
          <mesh position={[0, 0.05, 0]} castShadow>
            <coneGeometry args={[0.04, 0.06, 24]} />
            <meshStandardMaterial color={'#FF4D4D'} roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, 0.018, 0]} castShadow material={MAT.metal()}>
            <cylinderGeometry args={[0.015, 0.025, 0.015, 16]} />
          </mesh>
        </group>
      )
    }
    case 'appliance': {
      return (
        <group>
          <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.10, 0.12, 0.10]} />
            <meshStandardMaterial color={'#d6cdb6'} roughness={0.5} metalness={0.3} />
          </mesh>
        </group>
      )
    }
    default: {
      return (
        <mesh position={[0, 0.04, 0]} castShadow>
          <sphereGeometry args={[0.04, 24, 16]} />
          <meshStandardMaterial color={colorBase} roughness={0.5} metalness={0.2} />
        </mesh>
      )
    }
  }
}

// Devices are modelled at true physical size, which is tiny at room scale and
// hard to spot/select. A modest uniform up-scale plus a grounding pad makes
// every device legible as a placed object without looking toy-like.
const DEVICE_VIEW_SCALE = 1.32

function Device3D({ d }: { d: PlacedDevice }) {
  const meshRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const entry = DEVICE_MAP[d.deviceId]
  const cat = entry?.category ?? 'other'
  const doc = usePlanStore((s) => s.doc)
  const setSelection = usePlanStore((s) => s.setSelection)
  const selection = usePlanStore((s) => s.selection)
  const isSelected = selection.type === 'device' && selection.ids.includes(d.id)

  const ms = doc?.activeModeKey ? d.modeState?.[doc.activeModeKey] : undefined
  const on = ms === undefined ? null : ms.on === true ? true : ms.on === false ? false : null

  // Hover lift animation
  useFrame((_, dt) => {
    if (!meshRef.current) return
    const target = (hovered || isSelected) ? 0.04 : 0
    meshRef.current.position.y += (target - meshRef.current.position.y) * Math.min(1, dt * 8)
  })

  return (
    <group
      position={[M(d.position.x), 0, M(d.position.y)]}
      rotation={[0, ((d.rotation ?? 0) * Math.PI) / 180, 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = '' }}
      onClick={(e) => { e.stopPropagation(); setSelection({ type: 'device', ids: [d.id] }) }}
    >
      <group ref={meshRef}>
        {/* Grounding pad — a subtle installation disc so every device reads as a
            placed object even at a distance. */}
        <mesh position={[0, 0.0015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[0.085, 40]} />
          <meshStandardMaterial color="#111114" roughness={0.85} metalness={0.1} transparent opacity={0.32} />
        </mesh>
        {/* Device model — scaled up for legibility at room scale */}
        <group scale={DEVICE_VIEW_SCALE}>
          <GltfModel id={d.deviceId} fallback={<DeviceMesh deviceId={d.deviceId} category={cat} on={on} hint={d.note} />} />
        </group>
        {/* Selection ring (thin accent disc on the floor) */}
        {(isSelected || hovered) && (
          <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.095, 0.11, 48]} />
            <meshBasicMaterial color={isSelected ? '#C7A24E' : '#E6CC86'} transparent opacity={isSelected ? 0.9 : 0.55} />
          </mesh>
        )}
      </group>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Furniture — id-based recognizable meshes
// ─────────────────────────────────────────────────────────────────────

/**
 * Animated TV screen — a fully procedural, copyright-free "program": a
 * stylised sunset landscape (drifting sun, colour cycle, silhouetted hills)
 * with subtle scanlines + vignette so it reads as a smart-TV that is on.
 * GPU-only (a small fragment shader with one time uniform), toneMapped off so
 * the panel glows. Frame updates throttle to ~20 fps to stay cheap.
 */
const TV_FRAG = `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.06;
    float horizon = 0.44;
    vec3 skyTop = mix(vec3(0.10,0.15,0.40), vec3(0.85,0.42,0.28), 0.5 + 0.5*sin(t));
    vec3 skyBot = mix(vec3(0.95,0.55,0.35), vec3(1.0,0.82,0.55), 0.5 + 0.5*sin(t));
    vec3 col;
    if (uv.y > horizon) {
      float f = (uv.y - horizon) / (1.0 - horizon);
      col = mix(skyBot, skyTop, f);
      vec2 sunP = vec2(0.5 + 0.28*sin(t*0.6), horizon + 0.26 + 0.05*cos(t*0.6));
      float d = distance(vec2(uv.x, uv.y), sunP);
      col += vec3(1.0,0.88,0.62) * smoothstep(0.10, 0.0, d) * 1.1;
      col += vec3(1.0,0.7,0.45) * smoothstep(0.32, 0.0, d) * 0.18;
    } else {
      float hill = horizon - 0.05 - 0.05*sin(uv.x*7.0 + 1.0) - 0.025*sin(uv.x*15.0);
      float hill2 = horizon - 0.02 - 0.08*sin(uv.x*4.0 + 3.0);
      vec3 far = mix(vec3(0.20,0.12,0.16), vec3(0.06,0.05,0.09), (horizon - uv.y)/horizon);
      col = far;
      if (uv.y < hill2) col = mix(col, vec3(0.05,0.04,0.06), smoothstep(hill2, hill2-0.03, uv.y));
      if (uv.y < hill)  col = mix(col, vec3(0.02,0.02,0.03), smoothstep(hill, hill-0.03, uv.y));
    }
    col *= 0.94 + 0.06*sin(uv.y*420.0);           // scanlines
    float vig = smoothstep(1.15, 0.35, distance(uv, vec2(0.5)));
    col *= 0.82 + 0.18*vig;                        // vignette
    gl_FragColor = vec4(col, 1.0);
  }
`
const TV_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
function TVScreen({ w, h, y, z }: { w: number; h: number; y: number; z: number }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: Math.random() * 100 } },
      vertexShader: TV_VERT,
      fragmentShader: TV_FRAG,
      toneMapped: false,
    }),
    [],
  )
  const acc = useRef(0)
  useFrame((_, dt) => {
    acc.current += dt
    // ~20 fps update is plenty for an ambient screen; keeps the shader cheap.
    if (acc.current >= 0.05) {
      mat.uniforms.uTime.value += acc.current
      acc.current = 0
    }
  })
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <mesh position={[0, y, z]} material={mat}>
      <planeGeometry args={[w, h]} />
    </mesh>
  )
}

function FurnitureMesh({ furnitureId, w, h, item }: {
  furnitureId: string; w: number; h: number; item: PlacedFurniture;
}) {
  const wM = M(w)
  const hM = M(h)
  const id = furnitureId

  // CORNER SOFA — L-shape: long back section + chaise on the left, plump
  // seat/back cushions, rounded armrests (the reference living-room piece).
  if (/^sofa-corner/i.test(id)) {
    const upholstery = upholsteryFor(item)
    const depth = Math.min(0.95, hM * 0.42)          // seat depth of the long side
    const chaiseW = Math.min(1.0, wM * 0.38)         // chaise width (left)
    return (
      <group>
        {/* Base: long section along the back (-z), chaise arm down the left */}
        <RoundedBox position={[0, 0.2, -hM / 2 + depth / 2]} castShadow receiveShadow material={upholstery} args={[wM, 0.4, depth]} radius={0.05} smoothness={3} />
        <RoundedBox position={[-wM / 2 + chaiseW / 2, 0.2, depth / 2]} castShadow receiveShadow material={upholstery} args={[chaiseW, 0.4, hM - depth]} radius={0.05} smoothness={3} />
        {/* Backrest along the back + short return on the left */}
        <RoundedBox position={[0, 0.52, -hM / 2 + 0.09]} castShadow material={upholstery} args={[wM, 0.45, 0.18]} radius={0.05} smoothness={3} />
        <RoundedBox position={[-wM / 2 + 0.09, 0.52, 0]} castShadow material={upholstery} args={[0.18, 0.45, hM]} radius={0.05} smoothness={3} />
        {/* Seat cushions: 3 on the long side, 1 on the chaise */}
        {[0, 1, 2].map((i) => {
          const cw = (wM - chaiseW - 0.06) / 2
          const x = -wM / 2 + chaiseW + (i - 0.0) * cw + cw / 2
          return i < 2 ? (
            <RoundedBox key={i} position={[x, 0.43, -hM / 2 + depth / 2 + 0.03]} castShadow material={upholstery} args={[cw - 0.02, 0.12, depth - 0.24]} radius={0.045} smoothness={3} />
          ) : null
        })}
        <RoundedBox position={[-wM / 2 + chaiseW / 2 + 0.05, 0.43, depth / 2 + 0.06]} castShadow material={upholstery} args={[chaiseW - 0.16, 0.12, hM - depth - 0.2]} radius={0.045} smoothness={3} />
        {/* Back cushions */}
        {[0.3, 0.62].map((f, i) => (
          <RoundedBox key={`b${i}`} position={[-wM / 2 + chaiseW + (wM - chaiseW) * f, 0.58, -hM / 2 + 0.24]} rotation={[-0.22, 0, 0]} castShadow material={upholstery} args={[(wM - chaiseW) / 2 - 0.08, 0.36, 0.13]} radius={0.05} smoothness={3} />
        ))}
        {/* Accent pillows — charcoal + rust */}
        <RoundedBox position={[wM / 2 - 0.35, 0.56, -hM / 2 + 0.28]} rotation={[-0.25, -0.15, 0]} castShadow args={[0.4, 0.38, 0.12]} radius={0.05} smoothness={3}>
          <meshStandardMaterial color="#3c4046" roughness={0.92} />
        </RoundedBox>
        <RoundedBox position={[-wM / 2 + chaiseW - 0.1, 0.56, -hM / 2 + 0.3]} rotation={[-0.25, 0.2, 0]} castShadow args={[0.36, 0.34, 0.12]} radius={0.05} smoothness={3}>
          <meshStandardMaterial color="#8a5a3c" roughness={0.92} />
        </RoundedBox>
        {/* Folded knit throw resting on the chaise seat — two stacked layers read
            as a neatly folded blanket (warm oatmeal, a cozy accent textile) */}
        <RoundedBox position={[-wM / 2 + chaiseW / 2, 0.52, depth / 2 + 0.16]} rotation={[0, 0.08, 0]} castShadow args={[chaiseW * 0.72, 0.05, 0.42]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color="#71856a" roughness={0.98} metalness={0} />
        </RoundedBox>
        <RoundedBox position={[-wM / 2 + chaiseW / 2 + 0.02, 0.565, depth / 2 + 0.13]} rotation={[0, 0.08, 0]} castShadow args={[chaiseW * 0.66, 0.04, 0.34]} radius={0.03} smoothness={3}>
          <meshStandardMaterial color="#849a7b" roughness={0.98} metalness={0} />
        </RoundedBox>
        {/* Armrest on the right end */}
        <RoundedBox position={[wM / 2 - 0.09, 0.42, -hM / 2 + depth / 2]} castShadow material={upholstery} args={[0.18, 0.26, depth]} radius={0.06} smoothness={3} />
        {/* Slim black feet */}
        {([[-wM / 2 + 0.08, -hM / 2 + 0.08], [wM / 2 - 0.08, -hM / 2 + 0.08], [-wM / 2 + 0.08, hM / 2 - 0.08], [wM / 2 - 0.08, -hM / 2 + depth - 0.08], [-wM / 2 + chaiseW - 0.08, hM / 2 - 0.08]] as const).map(([x, z], i) => (
          <mesh key={`f${i}`} position={[x, 0.05, z]} castShadow material={MAT.softBlack()}>
            <cylinderGeometry args={[0.015, 0.02, 0.1, 10]} />
          </mesh>
        ))}
      </group>
    )
  }

  // SOFA: base, backrest, 3 cushions
  if (/^sofa/i.test(id)) {
    const longSide = w >= h
    const upholstery = upholsteryFor(item)
    return (
      <group>
        {/* Base — soft rounded upholstery */}
        <RoundedBox position={[0, 0.20, 0]} castShadow receiveShadow material={upholstery} args={[wM, 0.40, hM]} radius={0.05} smoothness={3} />
        {/* Backrest */}
        {longSide ? (
          <RoundedBox position={[0, 0.50, -hM / 2 + 0.08]} castShadow material={upholstery} args={[wM, 0.40, 0.16]} radius={0.05} smoothness={3} />
        ) : (
          <RoundedBox position={[-wM / 2 + 0.08, 0.50, 0]} castShadow material={upholstery} args={[0.16, 0.40, hM]} radius={0.05} smoothness={3} />
        )}
        {/* Cushions: 3 seat + 3 plump leaning back cushions along the long side */}
        {[0, 1, 2].map((i) => {
          if (longSide) {
            const cushW = (wM - 0.04) / 3 - 0.02
            const x = -wM / 2 + (i + 0.5) * ((wM - 0.04) / 3) + 0.02
            return (
              <group key={i}>
                <RoundedBox position={[x, 0.42, hM / 2 - 0.30]} castShadow material={upholstery} args={[cushW, 0.10, hM - 0.40]} radius={0.04} smoothness={2} />
                <RoundedBox position={[x, 0.58, -hM / 2 + 0.20]} rotation={[-0.22, 0, 0]} castShadow material={upholstery} args={[cushW - 0.02, 0.36, 0.13]} radius={0.05} smoothness={3} />
              </group>
            )
          } else {
            const cushH = (hM - 0.04) / 3 - 0.02
            const z = -hM / 2 + (i + 0.5) * ((hM - 0.04) / 3) + 0.02
            return (
              <group key={i}>
                <RoundedBox position={[wM / 2 - 0.30, 0.42, z]} castShadow material={upholstery} args={[wM - 0.40, 0.10, cushH]} radius={0.04} smoothness={2} />
                <RoundedBox position={[-wM / 2 + 0.20, 0.58, z]} rotation={[0, 0, 0.22]} castShadow material={upholstery} args={[0.13, 0.36, cushH - 0.02]} radius={0.05} smoothness={3} />
              </group>
            )
          }
        })}
        {/* Accent throw pillows — charcoal + rust break the beige-on-beige
            (the contrast textiles every reference interior has) */}
        {longSide ? (
          <>
            <RoundedBox position={[-wM / 2 + 0.32, 0.56, -hM / 2 + 0.26]} rotation={[-0.25, 0.15, 0]} castShadow args={[0.42, 0.4, 0.12]} radius={0.05} smoothness={3}>
              <meshStandardMaterial color="#3c4046" roughness={0.92} />
            </RoundedBox>
            <RoundedBox position={[wM / 2 - 0.32, 0.55, -hM / 2 + 0.27]} rotation={[-0.25, -0.12, 0]} castShadow args={[0.4, 0.38, 0.12]} radius={0.05} smoothness={3}>
              <meshStandardMaterial color="#8a5a3c" roughness={0.92} />
            </RoundedBox>
          </>
        ) : (
          <>
            <RoundedBox position={[-wM / 2 + 0.26, 0.56, -hM / 2 + 0.32]} rotation={[0, 0.15, -0.25]} castShadow args={[0.12, 0.4, 0.42]} radius={0.05} smoothness={3}>
              <meshStandardMaterial color="#3c4046" roughness={0.92} />
            </RoundedBox>
            <RoundedBox position={[-wM / 2 + 0.27, 0.55, hM / 2 - 0.32]} rotation={[0, -0.12, -0.25]} castShadow args={[0.12, 0.38, 0.4]} radius={0.05} smoothness={3}>
              <meshStandardMaterial color="#8a5a3c" roughness={0.92} />
            </RoundedBox>
          </>
        )}
        {/* Armrests at both ends of the long axis */}
        {longSide ? (
          <>
            <RoundedBox position={[-wM / 2 + 0.09, 0.42, 0]} castShadow material={upholstery} args={[0.18, 0.26, hM - 0.06]} radius={0.06} smoothness={3} />
            <RoundedBox position={[ wM / 2 - 0.09, 0.42, 0]} castShadow material={upholstery} args={[0.18, 0.26, hM - 0.06]} radius={0.06} smoothness={3} />
          </>
        ) : (
          <>
            <RoundedBox position={[0, 0.42, -hM / 2 + 0.09]} castShadow material={upholstery} args={[wM - 0.06, 0.26, 0.18]} radius={0.06} smoothness={3} />
            <RoundedBox position={[0, 0.42,  hM / 2 - 0.09]} castShadow material={upholstery} args={[wM - 0.06, 0.26, 0.18]} radius={0.06} smoothness={3} />
          </>
        )}
        {/* Legs for sofa – slender wood support */}
        {([[-1,-1],[1,-1],[-1,1],[1,1]] as const).map(([sx, sz], i) => (
          <mesh key={`sofa-leg-${i}`} position={[sx * (wM / 2 - 0.05), 0.10, sz * (hM / 2 - 0.05)]} castShadow material={woodFor(item, 'walnut')}>
            <boxGeometry args={[0.08, 0.20, 0.08]} />
          </mesh>
        ))}
      </group>
    )
  }

  // BED: mattress + pillow strip
  if (/^bed/i.test(id)) {
    return (
      <group>
        {/* Frame */}
        <RoundedBox position={[0, 0.10, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')} args={[wM + 0.05, 0.20, hM + 0.05]} radius={0.02} smoothness={2} />
        {/* Mattress */}
        <RoundedBox position={[0, 0.30, 0]} castShadow material={MAT.bedding()} args={[wM, 0.14, hM]} radius={0.04} smoothness={2} />
        {/* Pillow pair — slightly tilted against the headboard */}
        <RoundedBox position={[-wM / 4 + 0.01, 0.42, -hM / 2 + 0.17]} rotation={[-0.18, 0, 0]} castShadow material={MAT.pillow()} args={[wM / 2 - 0.14, 0.09, 0.32]} radius={0.04} smoothness={3} />
        <RoundedBox position={[ wM / 4 - 0.01, 0.42, -hM / 2 + 0.17]} rotation={[-0.18, 0, 0]} castShadow material={MAT.pillow()} args={[wM / 2 - 0.14, 0.09, 0.32]} radius={0.04} smoothness={3} />
        {/* Throw blanket across the foot of the bed — muted accent textile */}
        <RoundedBox position={[0, 0.385, hM / 2 - 0.42]} castShadow args={[wM + 0.02, 0.035, 0.6]} radius={0.015} smoothness={2}>
          <meshStandardMaterial color="#8a7d6b" roughness={0.95} metalness={0} />
        </RoundedBox>
        {/* Headboard */}
        <RoundedBox position={[0, 0.55, -hM / 2 - 0.04]} castShadow material={woodFor(item, 'walnut')} args={[wM + 0.05, 0.70, 0.05]} radius={0.02} smoothness={2} />
        {/* Legs for bed */}
        {([[-1,-1],[1,-1],[-1,1],[1,1]] as const).map(([sx, sz], i) => (
          <mesh key={`bed-leg-${i}`} position={[sx * (wM / 2 - 0.05), 0.05, sz * (hM / 2 - 0.05)]} castShadow material={woodFor(item, 'walnut')}>
            <boxGeometry args={[0.08, 0.10, 0.08]} />
          </mesh>
        ))}
      </group>
    )
  }

  // COFFEE TABLE: low surface + 4 thin legs
  if (/^table-coffee/i.test(id)) {
    return (
      <group>
        <mesh position={[0, 0.30, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')}>
          <boxGeometry args={[wM, 0.04, hM]} />
        </mesh>
        {([[-1,-1],[1,-1],[-1,1],[1,1]] as const).map(([sx, sy], i) => (
          <mesh key={i} position={[sx * (wM / 2 - 0.04), 0.15, sy * (hM / 2 - 0.04)]} castShadow material={MAT.steel()}>
            <cylinderGeometry args={[0.012, 0.012, 0.30, 12]} />
          </mesh>
        ))}
        {/* Crossbars for stability */}
        <mesh position={[0, 0.05, 0]} castShadow material={MAT.steel()}>
          <boxGeometry args={[wM - 0.08, 0.02, 0.02]} />
        </mesh>
        <mesh position={[0, 0.05, 0]} castShadow material={MAT.steel()}>
          <boxGeometry args={[0.02, 0.02, hM - 0.08]} />
        </mesh>
        {/* Tabletop styling — book stack + ceramic bowl (lived-in detail) */}
        <mesh position={[-wM * 0.18, 0.335, hM * 0.1]} rotation={[0, 0.3, 0]} castShadow>
          <boxGeometry args={[0.22, 0.025, 0.16]} />
          <meshStandardMaterial color="#5e6b75" roughness={0.85} />
        </mesh>
        <mesh position={[-wM * 0.18, 0.36, hM * 0.1]} rotation={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.19, 0.02, 0.14]} />
          <meshStandardMaterial color="#a08a6a" roughness={0.85} />
        </mesh>
        <mesh position={[wM * 0.2, 0.35, -hM * 0.08]} castShadow material={MAT.glazedCeramic()}>
          <cylinderGeometry args={[0.07, 0.045, 0.06, 24]} />
        </mesh>
      </group>
    )
  }

  // DINING TABLE — with a black pendant lamp hanging over the centre (the
  // reference dining zone's defining fixture).
  // DINING TABLE — round dark pedestal table (the reference dining zone):
  // near-black stained top on a tapered centre column with a flat disc base.
  if (/^table-dining/i.test(id)) {
    const rT = Math.min(wM, hM) / 2
    return (
      <group>
        <mesh position={[0, 0.735, 0]} castShadow receiveShadow material={MAT.woodDark()}>
          <cylinderGeometry args={[rT, rT, 0.045, 48]} />
        </mesh>
        {/* Pedestal column + base disc */}
        <mesh position={[0, 0.38, 0]} castShadow material={MAT.woodDark()}>
          <cylinderGeometry args={[0.07, 0.11, 0.68, 24]} />
        </mesh>
        <mesh position={[0, 0.02, 0]} castShadow receiveShadow material={MAT.softBlack()}>
          <cylinderGeometry args={[rT * 0.55, rT * 0.6, 0.04, 36]} />
        </mesh>
        {/* Centrepiece — low ceramic bowl */}
        <mesh position={[0, 0.775, 0]} castShadow material={MAT.glazedCeramic()}>
          <cylinderGeometry args={[0.11, 0.075, 0.045, 24]} />
        </mesh>
        {/* Pendant: cord + matte black dome + warm glowing diffuser */}
        <mesh position={[0, 2.15, 0]} material={MAT.softBlack()}>
          <cylinderGeometry args={[0.004, 0.004, 0.7, 8]} />
        </mesh>
        <mesh position={[0, 1.76, 0]} castShadow material={MAT.softBlack()}>
          <cylinderGeometry args={[0.05, 0.17, 0.17, 24]} />
        </mesh>
        <mesh position={[0, 1.675, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.15, 24]} />
          <meshStandardMaterial color="#f4e2c2" emissive="#ffc383" emissiveIntensity={1.6} side={THREE.DoubleSide} />
        </mesh>
        {readTier() !== 'off' && (
          <pointLight position={[0, 1.55, 0]} color="#ffd9ae" intensity={2.1} distance={2.8} decay={2.2} castShadow={false} />
        )}
      </group>
    )
  }

  if (/^table/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.74, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 0.04, hM]} radius={0.012} smoothness={2} />
        {([[-1,-1],[1,-1],[-1,1],[1,1]] as const).map(([sx, sy], i) => (
          <mesh key={i} position={[sx * (wM / 2 - 0.06), 0.36, sy * (hM / 2 - 0.06)]} castShadow material={woodFor(item, 'oak')}>
            <boxGeometry args={[0.05, 0.72, 0.05]} />
          </mesh>
        ))}
        {/* Pendant: cord + matte black dome + warm glowing diffuser */}
        <mesh position={[0, 2.15, 0]} material={MAT.softBlack()}>
          <cylinderGeometry args={[0.004, 0.004, 0.7, 8]} />
        </mesh>
        <mesh position={[0, 1.76, 0]} castShadow material={MAT.softBlack()}>
          <cylinderGeometry args={[0.05, 0.17, 0.17, 24]} />
        </mesh>
        <mesh position={[0, 1.675, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.15, 24]} />
          <meshStandardMaterial color="#f4e2c2" emissive="#ffc383" emissiveIntensity={1.6} side={THREE.DoubleSide} />
        </mesh>
        {readTier() !== 'off' && (
          <pointLight position={[0, 1.55, 0]} color="#ffd9ae" intensity={2.1} distance={2.8} decay={2.2} castShadow={false} />
        )}
      </group>
    )
  }

  // WARDROBE — body on a recessed plinth, per-door split lines and long
  // vertical chrome bar handles (modern hinged-front wardrobe).
  if (/^wardrobe/i.test(id)) {
    const doors = Math.max(2, Math.round(wM / 0.55))
    const doorW = wM / doors
    return (
      <group>
        {/* Recessed plinth */}
        <mesh position={[0, 0.04, -0.01]} material={MAT.softBlack()}>
          <boxGeometry args={[wM - 0.04, 0.08, hM - 0.04]} />
        </mesh>
        {/* Body */}
        <RoundedBox position={[0, 1.14, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 2.12, hM]} radius={0.02} smoothness={2} />
        {/* Door split lines */}
        {Array.from({ length: doors - 1 }, (_, i) => (
          <mesh key={i} position={[-wM / 2 + (i + 1) * doorW, 1.14, hM / 2 + 0.002]}>
            <planeGeometry args={[0.006, 2.08]} />
            <meshBasicMaterial color={'#2a1c12'} />
          </mesh>
        ))}
        {/* Long vertical chrome handles beside each split */}
        {Array.from({ length: doors }, (_, i) => {
          const cxDoor = -wM / 2 + (i + 0.5) * doorW
          const side = i < doors / 2 ? 1 : -1
          return (
            <mesh key={`h${i}`} position={[cxDoor + side * (doorW / 2 - 0.05), 1.15, hM / 2 + 0.014]} castShadow material={MAT.chrome()}>
              <cylinderGeometry args={[0.008, 0.008, 0.34, 12]} />
            </mesh>
          )
        })}
      </group>
    )
  }

  // KITCHEN ROW
  if (/^kitchen/i.test(id)) {
    return (
      <group>
        {/* Base cabinets — matte graphite (the reference's dark premium
            kitchen), on a recessed black plinth, with per-unit door gaps */}
        <mesh position={[0, 0.04, -0.015]} material={MAT.softBlack()}>
          <boxGeometry args={[wM - 0.06, 0.08, hM - 0.05]} />
        </mesh>
        <RoundedBox position={[0, 0.49, 0]} castShadow receiveShadow material={MAT.darkPanel()} args={[wM, 0.82, hM]} radius={0.012} smoothness={2} />
        {[-wM / 4, 0, wM / 4].map((x, i) => (
          <mesh key={`g${i}`} position={[x, 0.49, hM / 2 + 0.002]}>
            <planeGeometry args={[0.006, 0.78]} />
            <meshBasicMaterial color={'#0c0d10'} />
          </mesh>
        ))}
        {/* Upper wall cabinets — walnut wood (warm contrast to the dark base) */}
        <RoundedBox position={[0, 1.75, -hM / 2 + 0.18]} castShadow receiveShadow material={woodFor(item, 'walnut')} args={[wM, 0.70, 0.35]} radius={0.012} smoothness={2} />
        <mesh position={[-wM * 0.2, 1.45, -hM / 2 + 0.16]} castShadow material={MAT.brushedSteel()}>
          <boxGeometry args={[0.5, 0.12, 0.42]} />
        </mesh>
        {/* Cabinet handle lines */}
        {[-wM * 0.28, 0, wM * 0.28].map((x, i) => (
          <mesh key={i} position={[x, 1.5, -hM / 2 + 0.355]} material={MAT.chrome()}>
            <boxGeometry args={[0.22, 0.012, 0.012]} />
          </mesh>
        ))}
        {/* Warm under-cabinet light strip + a soft pool on the countertop */}
        <mesh position={[0, 1.38, -hM / 2 + 0.34]}>
          <boxGeometry args={[wM * 0.94, 0.015, 0.03]} />
          <meshStandardMaterial color="#fff2dc" emissive="#ffcaa0" emissiveIntensity={1.8} toneMapped={false} />
        </mesh>
        {readTier() !== 'off' && (
          <pointLight position={[0, 1.3, -hM / 2 + 0.42]} color="#ffdcb0" intensity={2.2} distance={2.2} decay={2.4} castShadow={false} />
        )}
        {/* Tiled backsplash — real ceramic tiles with grout (Fugen) between the
            counter and the upper cabinets, on the back wall */}
        <mesh position={[0, 1.16, -hM / 2 + 0.012]} receiveShadow material={kitchenTileMat()}>
          <boxGeometry args={[wM, 0.46, 0.012]} />
        </mesh>
        {/* Countertop — marble */}
        <RoundedBox position={[0, 0.92, 0]} castShadow material={MAT.marble()} args={[wM + 0.02, 0.04, hM + 0.02]} radius={0.012} smoothness={2} />
        {/* Sink — stainless basin */}
        <mesh position={[wM * 0.2, 0.93, 0]} material={MAT.brushedSteel()}>
          <boxGeometry args={[0.40, 0.005, hM * 0.6]} />
        </mesh>
        {/* Stovetop rings — brushed steel */}
        {[-0.06, 0.06].map((dx, i) => (
          <mesh key={i} position={[-wM * 0.2 + dx, 0.94, dx]} material={MAT.brushedSteel()}>
            <ringGeometry args={[0.04, 0.05, 24]} />
          </mesh>
        ))}
      </group>
    )
  }

  // TV-SIDEBOARD — lowboard + wall-mounted TV with a warm LED backlight strip
  // (the reference living room's glowing TV wall). Back side = -z (to the wall).
  if (/^tv-sideboard|^sideboard/i.test(id)) {
    return (
      <group>
        {/* Lowboard on slim black feet, with drawer split lines */}
        <RoundedBox position={[0, 0.32, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')} args={[wM, 0.38, hM]} radius={0.015} smoothness={2} />
        {[-wM / 4, wM / 4].map((x, i) => (
          <mesh key={`s${i}`} position={[x, 0.32, hM / 2 + 0.002]}>
            <planeGeometry args={[0.005, 0.34]} />
            <meshBasicMaterial color={'#2a1c12'} />
          </mesh>
        ))}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh key={`ft${i}`} position={[sx * (wM / 2 - 0.08), 0.065, sz * (hM / 2 - 0.06)]} castShadow material={MAT.softBlack()}>
            <cylinderGeometry args={[0.014, 0.018, 0.13, 10]} />
          </mesh>
        ))}
        {/* Media wall — full-height walnut panel the TV + shelves mount on */}
        <mesh position={[0, 1.2, -hM / 2 + 0.006]} receiveShadow material={woodFor(item, 'walnut')}>
          <boxGeometry args={[wM, 2.4, 0.012]} />
        </mesh>
        {/* LED backlight halo — emissive plate behind the TV panel */}
        <mesh position={[0, 1.45, -hM / 2 + 0.016]}>
          <planeGeometry args={[wM * 0.80, 0.88]} />
          <meshStandardMaterial color="#f2debe" emissive="#ffb877" emissiveIntensity={1.5} />
        </mesh>
        {/* Open shelf compartments flanking the TV, with books + a vase */}
        {([[-1, 1.12], [-1, 1.62], [1, 1.38]] as const).map(([side, sy], i) => {
          const sx = side * (wM / 2 - 0.16)
          const shelfW = 0.30, shelfH = 0.34, shelfD = 0.22
          return (
            <group key={`sh${i}`} position={[sx, sy, -hM / 2 + 0.12]}>
              {/* Open box: bottom, top, two sides (front + back open) */}
              <mesh position={[0, -shelfH / 2, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')}>
                <boxGeometry args={[shelfW, 0.018, shelfD]} />
              </mesh>
              <mesh position={[0, shelfH / 2, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')}>
                <boxGeometry args={[shelfW, 0.018, shelfD]} />
              </mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * (shelfW / 2 - 0.009), 0, 0]} castShadow material={woodFor(item, 'walnut')}>
                  <boxGeometry args={[0.018, shelfH, shelfD]} />
                </mesh>
              ))}
              {/* Decor per compartment: leaning books or a small ceramic vase */}
              {i !== 2 ? (
                <group position={[-0.03, -shelfH / 2 + 0.075, 0]}>
                  {[['#8a6a52', 0], ['#5f6c78', 0.028], ['#3c4046', 0.054]].map(([c, dx], bi) => (
                    <mesh key={bi} position={[dx as number, 0, 0]} rotation={[0, 0, bi === 2 ? -0.16 : 0]} castShadow>
                      <boxGeometry args={[0.022, 0.13, 0.15]} />
                      <meshStandardMaterial color={c as string} roughness={0.85} />
                    </mesh>
                  ))}
                </group>
              ) : (
                <mesh position={[0, -shelfH / 2 + 0.055, 0]} castShadow material={MAT.glazedCeramic()}>
                  <cylinderGeometry args={[0.028, 0.04, 0.09, 16]} />
                </mesh>
              )}
            </group>
          )
        })}
        {/* Wall-mounted TV — dark glass panel + a live procedural program */}
        <mesh position={[0, 1.45, -hM / 2 + 0.045]} castShadow material={MAT.darkPanel()}>
          <boxGeometry args={[wM * 0.72, 0.78, 0.04]} />
        </mesh>
        <TVScreen w={wM * 0.72 * 0.95} h={0.78 * 0.92} y={1.45} z={-hM / 2 + 0.045 + 0.021} />
        {/* Cove LED line above the TV wall — warm horizontal light accent */}
        <mesh position={[0, 2.28, -hM / 2 + 0.02]}>
          <boxGeometry args={[wM * 0.9, 0.018, 0.02]} />
          <meshStandardMaterial color="#f2debe" emissive="#ffb877" emissiveIntensity={1.5} />
        </mesh>
        {readTier() !== 'off' && (
          <pointLight position={[0, 1.4, -hM / 2 + 0.35]} color="#ffd9ae" intensity={1.8} distance={2.4} decay={2.4} castShadow={false} />
        )}
      </group>
    )
  }

  // RUG: extruded slab — eliminates z-fighting on the floor and gives a real pile thickness
  if (/^rug/i.test(id)) {
    return (
      <group>
        {/* Main rug body (1.2cm thick, sits ON the floor not coplanar with it) */}
        <mesh position={[0, 0.006, 0]} receiveShadow castShadow material={MAT.rug()}>
          <boxGeometry args={[wM, 0.012, hM]} />
        </mesh>
        {/* Subtle inner border accent — slightly inset, raised 1mm */}
        <mesh position={[0, 0.0125, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.min(wM, hM) * 0.42, Math.min(wM, hM) * 0.45, 64]} />
          <meshBasicMaterial color="#5b3d20" transparent opacity={0.20} />
        </mesh>
      </group>
    )
  }

  // NIGHTSTAND
  if (/^nightstand/i.test(id)) {
    return (
      <RoundedBox position={[0, 0.25, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 0.50, hM]} radius={0.015} smoothness={2} />
    )
  }

  // DRESSER / KOMMODE — drawer fronts with slim chrome bar pulls, on feet
  if (/^dresser|^kommode/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.49, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')} args={[wM, 0.82, hM]} radius={0.018} smoothness={2} />
        {/* Drawer lines + chrome pulls */}
        {[0.28, 0.52, 0.76].map((y, i) => (
          <group key={i}>
            <mesh position={[0, y, hM / 2 + 0.002]}>
              <planeGeometry args={[wM - 0.05, 0.005]} />
              <meshBasicMaterial color={'#2a1c12'} />
            </mesh>
            <mesh position={[0, y + 0.11, hM / 2 + 0.012]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.chrome()}>
              <cylinderGeometry args={[0.006, 0.006, 0.22, 10]} />
            </mesh>
          </group>
        ))}
        {/* Feet */}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh key={`f${i}`} position={[sx * (wM / 2 - 0.05), 0.04, sz * (hM / 2 - 0.05)]} castShadow material={MAT.softBlack()}>
            <cylinderGeometry args={[0.015, 0.02, 0.08, 10]} />
          </mesh>
        ))}
      </group>
    )
  }

  if (/^shoe/i.test(id)) {
    return (
      <RoundedBox position={[0, 0.15, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 0.30, hM]} radius={0.015} smoothness={2} />
    )
  }

  // Chair — rounded upholstered seat pad on a wood frame, tilted slat back,
  // slim tapered round legs (modern dining chair, not five boxes).
  if (/^chair|^stuhl/i.test(id)) {
    return (
      <group>
        {/* Seat */}
        <RoundedBox position={[0, 0.45, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 0.04, hM]} radius={0.015} smoothness={2} />
        {/* Upholstered pad */}
        <RoundedBox position={[0, 0.48, 0]} castShadow material={upholsteryFor(item)} args={[wM - 0.04, 0.035, hM - 0.04]} radius={0.015} smoothness={2} />
        {/* Tilted backrest */}
        <RoundedBox position={[0, 0.74, -hM / 2 + 0.045]} rotation={[0.1, 0, 0]} castShadow material={woodFor(item, 'oak')} args={[wM - 0.02, 0.5, 0.035]} radius={0.014} smoothness={2} />
        {/* Slim tapered round legs */}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sy], i) => (
          <mesh key={i} position={[sx * (wM / 2 - 0.035), 0.22, sy * (hM / 2 - 0.035)]} castShadow material={woodFor(item, 'oak')}>
            <cylinderGeometry args={[0.014, 0.02, 0.44, 10]} />
          </mesh>
        ))}
      </group>
    )
  }

  // Bookshelf
  // Floating illuminated wall shelves — the reference's warm LED-backed
  // ledges. Three staggered walnut planks against the wall, each with a warm
  // strip glowing under it + a few small props (books, a vase, a bowl).
  if (/^wall-shelf|^floating-shelf/i.test(id)) {
    const depth = Math.max(hM, 0.22)
    const shelfT = 0.035
    const levels = [1.05, 1.52, 1.99]
    const propColor = ['#8a6a52', '#5f6c78', '#3c4046']
    return (
      <group>
        {levels.map((y, li) => (
          <group key={li} position={[0, y, 0]}>
            {/* Plank */}
            <mesh castShadow receiveShadow material={woodFor(item, 'walnut')}>
              <boxGeometry args={[wM, shelfT, depth]} />
            </mesh>
            {/* Warm LED strip tucked under the plank, facing forward */}
            <mesh position={[0, -shelfT / 2 - 0.006, depth / 2 - 0.02]}>
              <boxGeometry args={[wM - 0.08, 0.012, 0.02]} />
              {/* Warm shelf LED (the reference's floating-shelf glow) — tone-
                  mapped so it reads amber, not a clipped white line. */}
              <meshStandardMaterial color="#eccfa2" emissive="#ffab5c" emissiveIntensity={2.0} />
            </mesh>
            {/* Props: a leaning book stack on the left, a vase on the right,
                alternated per level so the shelves don't look cloned. */}
            {li !== 1 ? (
              <group position={[-wM / 2 + 0.14, shelfT / 2 + 0.075, 0]}>
                {propColor.map((c, bi) => (
                  <mesh key={bi} position={[bi * 0.03, 0, 0]} rotation={[0, 0, bi === 2 ? -0.14 : 0]} castShadow>
                    <boxGeometry args={[0.024, 0.14, depth * 0.7]} />
                    <meshStandardMaterial color={c} roughness={0.85} />
                  </mesh>
                ))}
              </group>
            ) : (
              <mesh position={[-wM / 2 + 0.16, shelfT / 2 + 0.06, 0]} castShadow material={MAT.glazedCeramic()}>
                <cylinderGeometry args={[0.035, 0.05, 0.12, 18]} />
              </mesh>
            )}
            {/* A small round bowl / plant toward the right on each level */}
            <mesh position={[wM / 2 - 0.18, shelfT / 2 + 0.03, 0]} castShadow material={li === 2 ? MAT.softBlack() : MAT.glazedCeramic()}>
              <cylinderGeometry args={[0.06, 0.045, 0.06, 20]} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }

  if (/^bookshelf/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 1.0, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 2.0, hM]} radius={0.018} smoothness={2} />
        {[0.4, 0.85, 1.30, 1.75].map((y, i) => (
          <mesh key={i} position={[0, y, hM/2 + 0.001]}>
            <planeGeometry args={[wM - 0.05, 0.005]} />
            <meshBasicMaterial color={'#3a2515'} />
          </mesh>
        ))}
      </group>
    )
  }

  // TV-Stand (low entertainment unit)
  if (/^tv-stand/i.test(id)) {
    return (
      <RoundedBox position={[0, 0.20, 0]} castShadow receiveShadow material={woodFor(item, 'walnut')} args={[wM, 0.40, hM]} radius={0.015} smoothness={2} />
    )
  }

  // Office desk
  if (/^desk/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.74, 0]} castShadow receiveShadow material={woodFor(item, 'oak')} args={[wM, 0.04, hM]} radius={0.012} smoothness={2} />
        {/* Two end-panel legs */}
        <mesh position={[-wM/2 + 0.025, 0.36, 0]} castShadow material={woodFor(item, 'oak')}>
          <boxGeometry args={[0.05, 0.72, hM - 0.10]} />
        </mesh>
        <mesh position={[ wM/2 - 0.025, 0.36, 0]} castShadow material={woodFor(item, 'oak')}>
          <boxGeometry args={[0.05, 0.72, hM - 0.10]} />
        </mesh>
      </group>
    )
  }

  // Armchair
  if (/^armchair/i.test(id)) {
    const upholstery = upholsteryFor(item)
    return (
      <group>
        <RoundedBox position={[0, 0.20, 0]} castShadow receiveShadow material={upholstery} args={[wM, 0.40, hM]} radius={0.05} smoothness={3} />
        <RoundedBox position={[0, 0.50, -hM/2 + 0.10]} castShadow material={upholstery} args={[wM, 0.50, 0.18]} radius={0.05} smoothness={3} />
        {/* Armrests */}
        <RoundedBox position={[-wM/2 + 0.08, 0.45, 0]} castShadow material={upholstery} args={[0.16, 0.30, hM - 0.20]} radius={0.05} smoothness={3} />
        <RoundedBox position={[ wM/2 - 0.08, 0.45, 0]} castShadow material={upholstery} args={[0.16, 0.30, hM - 0.20]} radius={0.05} smoothness={3} />
      </group>
    )
  }

  // Bathtub
  if (/^bathtub/i.test(id)) {
    return (
      <group>
        <mesh position={[0, 0.30, 0]} castShadow receiveShadow material={MAT.glazedCeramic()}>
          <boxGeometry args={[wM, 0.55, hM]} />
        </mesh>
        {/* Inner basin — glazed ceramic */}
        <mesh position={[0, 0.55, 0]} material={MAT.glazedCeramic()}>
          <boxGeometry args={[wM - 0.10, 0.005, hM - 0.10]} />
        </mesh>
      </group>
    )
  }

  // Shower
  // SHOWER — bodengleiche Walk-in-Dusche (1:1 nach Foto): weiße großformatige
  // Wandfliesen mit Fuge in der Ecke (−z / −x), beige-graue Bodenfliesen mit
  // quadratischem Punktablauf in der Mitte, eine rahmenlose Festglas-Wand auf
  // der offenen Seite (+x) + kurze Rückwand (+z), Regenbrause + Wandarmatur +
  // Handbrause an der Stange, plus Nischenregal mit Flaschen.
  if (/^shower/i.test(id)) {
    const wallH = 2.28
    return (
      <group>
        {/* Bodengleicher Fliesenboden (leicht zur Mitte geneigt gelesen) */}
        <mesh position={[0, 0.02, 0]} receiveShadow material={floorTileMat()}>
          <boxGeometry args={[wM, 0.04, hM]} />
        </mesh>
        {/* Quadratischer Punktablauf (Edelstahl, mittiges Kreuz-Gitter) */}
        <mesh position={[0, 0.041, 0]} material={MAT.brushedSteel()}>
          <boxGeometry args={[0.12, 0.006, 0.12]} />
        </mesh>
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[0.10, 0.004, 0.008]} />
          <meshStandardMaterial color="#2b2f31" roughness={0.6} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.045, 0]}>
          <boxGeometry args={[0.008, 0.004, 0.10]} />
          <meshStandardMaterial color="#2b2f31" roughness={0.6} metalness={0.5} />
        </mesh>
        {/* Weiße Fliesenwände — Rückwand (−z) + linke Wand (−x) mit Fuge */}
        <mesh position={[0, wallH / 2, -hM / 2 + 0.012]} castShadow receiveShadow material={bathTileMat()}>
          <boxGeometry args={[wM, wallH, 0.024]} />
        </mesh>
        <mesh position={[-wM / 2 + 0.012, wallH / 2, 0]} castShadow receiveShadow material={bathTileMat()}>
          <boxGeometry args={[0.024, wallH, hM]} />
        </mesh>
        {/* Eingelassenes Nischenregal in der linken Wand mit zwei Flaschen */}
        <mesh position={[-wM / 2 + 0.05, 1.15, hM * 0.18]} material={MAT.matteWhite()}>
          <boxGeometry args={[0.07, 0.02, 0.32]} />
        </mesh>
        <mesh position={[-wM / 2 + 0.055, 1.24, hM * 0.12]} material={MAT.matteBlack()}>
          <cylinderGeometry args={[0.022, 0.022, 0.16, 12]} />
        </mesh>
        <mesh position={[-wM / 2 + 0.055, 1.22, hM * 0.24]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.13, 12]} />
          <meshStandardMaterial color="#c7d8d0" roughness={0.5} metalness={0} />
        </mesh>
        {/* Rahmenlose Festglas-Wand auf der offenen Seite (+x) + kurze Rückkehr (+z) */}
        <mesh position={[wM / 2 - 0.006, 1.0, hM * 0.06]} material={MAT.glass()}>
          <boxGeometry args={[0.012, 2.0, hM * 0.86]} />
        </mesh>
        {/* Schmales Chrom-Profil (Stabilisator) oben an der Glaswand */}
        <mesh position={[wM / 2 - 0.006, 1.98, hM * 0.30]} material={MAT.chrome()}>
          <boxGeometry args={[0.02, 0.03, 0.5]} />
        </mesh>
        <mesh position={[wM * 0.18, 1.0, hM / 2 - 0.006]} material={MAT.glass()}>
          <boxGeometry args={[wM * 0.62, 2.0, 0.012]} />
        </mesh>
        {/* Regenbrause: Deckenarm von der Rückwand + quadratischer Kopf */}
        <mesh position={[wM * 0.02, 2.18, -hM / 2 + 0.16]} rotation={[Math.PI / 2, 0, 0]} material={MAT.chrome()}>
          <cylinderGeometry args={[0.012, 0.012, 0.30, 12]} />
        </mesh>
        <mesh position={[wM * 0.02, 2.16, -hM / 2 + 0.30]} castShadow material={MAT.chrome()}>
          <boxGeometry args={[0.26, 0.014, 0.26]} />
        </mesh>
        {/* Wand-Thermostat + Handbrause an vertikaler Stange (Rückwand −z) */}
        <mesh position={[wM * 0.30, 1.05, -hM / 2 + 0.05]} rotation={[Math.PI / 2, 0, 0]} material={MAT.chrome()}>
          <cylinderGeometry args={[0.03, 0.03, 0.06, 16]} />
        </mesh>
        <mesh position={[wM * 0.30, 1.05, -hM / 2 + 0.06]} material={MAT.softBlack()}>
          <cylinderGeometry args={[0.016, 0.016, 0.04, 12]} />
        </mesh>
        <mesh position={[-wM * 0.12, 1.35, -hM / 2 + 0.04]} material={MAT.chrome()}>
          <cylinderGeometry args={[0.009, 0.009, 0.7, 10]} />
        </mesh>
        <mesh position={[-wM * 0.12, 1.2, -hM / 2 + 0.075]} rotation={[0.5, 0, 0]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.02, 0.024, 0.14, 12]} />
        </mesh>
      </group>
    )
  }

  // TOILET — hängendes Wand-WC (1:1 nach Foto): schwebender Keramikkörper mit
  // verdeckter Vorwand-Zisterne, weiße Drückerplatte, SCHWARZER Sitz/Deckel und
  // ein schwarzer Bürsten-/Papierrollen-Ständer daneben.
  if (/^toilet/i.test(id)) {
    const seatBlack = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.45, metalness: 0.05 })
    return (
      <group>
        {/* Verdeckte Vorwand-Zisterne (weiße gefliese Vorwand) hinter dem WC */}
        <mesh position={[0, 0.55, -hM / 2 + 0.06]} castShadow receiveShadow material={bathTileMat()}>
          <boxGeometry args={[wM * 1.6, 1.1, 0.12]} />
        </mesh>
        {/* Drückerplatte (weiß, schmal) */}
        <mesh position={[0, 1.02, -hM / 2 + 0.13]} material={MAT.matteWhite()}>
          <boxGeometry args={[0.15, 0.22, 0.006]} />
        </mesh>
        {/* Schwebender Keramikkörper */}
        <mesh position={[0, 0.42, hM * 0.02]} castShadow receiveShadow material={MAT.glazedCeramic()}>
          <boxGeometry args={[wM * 0.9, 0.30, hM * 0.62]} />
        </mesh>
        {/* Verjüngung zur Wand (schwebt) */}
        <mesh position={[0, 0.44, -hM / 2 + 0.16]} castShadow material={MAT.glazedCeramic()}>
          <boxGeometry args={[wM * 0.7, 0.26, 0.16]} />
        </mesh>
        {/* Schwarzer Sitzring */}
        <mesh position={[0, 0.585, hM * 0.02]} castShadow material={seatBlack}>
          <boxGeometry args={[wM * 0.86, 0.03, hM * 0.6]} />
        </mesh>
        {/* Schwarzer Deckel (leicht schmaler, aufliegend) */}
        <mesh position={[0, 0.605, hM * 0.0]} castShadow material={seatBlack}>
          <boxGeometry args={[wM * 0.8, 0.014, hM * 0.5]} />
        </mesh>
        {/* Schwarzer Bürsten- + Papierrollenständer daneben (+x-Seite) */}
        <mesh position={[wM * 0.62, 0.24, hM * 0.14]} castShadow material={MAT.matteBlack()}>
          <cylinderGeometry args={[0.05, 0.055, 0.48, 20]} />
        </mesh>
        <mesh position={[wM * 0.62, 0.49, hM * 0.14]} material={MAT.matteBlack()}>
          <cylinderGeometry args={[0.012, 0.012, 0.14, 10]} />
        </mesh>
        {/* Ersatz-Papierrollen am Ständer (zwei weiße Rollen) */}
        {[0.30, 0.40].map((y, i) => (
          <mesh key={i} position={[wM * 0.62, y, hM * 0.14 - 0.075]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 0.045, 16]} />
            <meshStandardMaterial color="#f4f2ee" roughness={0.9} metalness={0} />
          </mesh>
        ))}
      </group>
    )
  }

  // WASHBASIN — kleines wandhängendes Keramik-Waschbecken (1:1 nach Foto):
  // schwebende flache Schale, Chrom-Einhebelmischer, verchromter Flaschensifon,
  // SCHWARZER Seifenspender + Zahnputzbecher, kleines Ablageregal mit Kerze.
  if (/^sink-bath/i.test(id)) {
    const black = new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.4, metalness: 0.1 })
    return (
      <group>
        {/* Weiße Fliesenwand dahinter (Fuge), von ~0.8 bis Kopfhöhe */}
        <mesh position={[0, 1.28, -hM / 2 - 0.004]} receiveShadow material={bathTileMat()}>
          <boxGeometry args={[Math.max(wM * 1.8, 1.1), 1.5, 0.012]} />
        </mesh>
        {/* Schwebende flache Keramikschale (wandhängend, ~0.88 m Oberkante) */}
        <RoundedBox position={[0, 0.85, 0.01]} castShadow receiveShadow material={MAT.glazedCeramic()} args={[wM, 0.12, hM]} radius={0.03} smoothness={3} />
        {/* Muldenvertiefung (flaches dunkles Innenbecken) */}
        <mesh position={[0, 0.905, 0.02]}>
          <boxGeometry args={[wM - 0.1, 0.02, hM - 0.1]} />
          <meshStandardMaterial color="#e9ebe9" roughness={0.25} metalness={0} />
        </mesh>
        {/* Verchromter Flaschensifon unter der Schale */}
        <mesh position={[0, 0.66, -hM / 2 + 0.12]} material={MAT.chrome()}>
          <cylinderGeometry args={[0.022, 0.022, 0.26, 14]} />
        </mesh>
        {/* Chrom-Einhebelmischer — Sockel + Auslauf */}
        <mesh position={[0, 0.94, -hM / 2 + 0.07]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.016, 0.018, 0.14, 16]} />
        </mesh>
        <mesh position={[0, 1.0, -hM / 2 + 0.12]} rotation={[Math.PI / 2.4, 0, 0]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.012, 0.012, 0.13, 16]} />
        </mesh>
        {/* Schwarzer Seifenspender */}
        <mesh position={[wM / 2 - 0.06, 0.955, 0.02]} castShadow material={black}>
          <cylinderGeometry args={[0.028, 0.032, 0.12, 18]} />
        </mesh>
        <mesh position={[wM / 2 - 0.06, 1.03, -0.02]} material={MAT.chrome()}>
          <boxGeometry args={[0.02, 0.02, 0.06]} />
        </mesh>
        {/* Schwarzer Zahnputzbecher */}
        <mesh position={[wM / 2 - 0.12, 0.945, 0.05]} castShadow material={black}>
          <cylinderGeometry args={[0.026, 0.022, 0.08, 16]} />
        </mesh>
        {/* Kleines Wandregal seitlich mit Kerze + Mini-Pflanze */}
        <mesh position={[-wM / 2 - 0.03, 1.18, 0]} material={MAT.matteWhite()}>
          <boxGeometry args={[0.16, 0.016, hM * 0.8]} />
        </mesh>
        <mesh position={[-wM / 2 - 0.03, 1.24, 0.06]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.1, 16]} />
          <meshStandardMaterial color="#efe7d8" roughness={0.8} metalness={0} />
        </mesh>
        <mesh position={[-wM / 2 - 0.03, 1.30, 0.06]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#ffcf7a" emissive="#ff9a3c" emissiveIntensity={2.4} />
        </mesh>
        <mesh position={[-wM / 2 - 0.03, 1.27, -0.08]} castShadow material={MAT.matteBlack()}>
          <cylinderGeometry args={[0.03, 0.026, 0.06, 12]} />
        </mesh>
        <mesh position={[-wM / 2 - 0.03, 1.33, -0.08]}>
          <sphereGeometry args={[0.05, 12, 10]} />
          <meshStandardMaterial color="#4f7a41" roughness={0.9} metalness={0} />
        </mesh>
      </group>
    )
  }

  // TOWEL RADIATOR — weißer Sprossen-Handtuchheizkörper (1:1 nach Foto): weißer
  // Leiter-Heizkörper an der Wand mit übergehängten SCHWARZEN Handtüchern.
  // Back gegen −z; front +z (per rotation an die Wand gedreht).
  if (/^towel-radiator/i.test(id)) {
    const rungs = 9
    const totalH = 1.05
    return (
      <group position={[0, 0.55, 0]}>
        {/* Zwei vertikale weiße Sammelrohre */}
        {[-wM / 2 + 0.05, wM / 2 - 0.05].map((x, i) => (
          <mesh key={`c${i}`} position={[x, 0, 0]} material={MAT.matteWhite()}>
            <cylinderGeometry args={[0.016, 0.016, totalH, 14]} />
          </mesh>
        ))}
        {/* Horizontale weiße Sprossen */}
        {Array.from({ length: rungs }).map((_, i) => {
          const y = -totalH / 2 + 0.06 + (i / (rungs - 1)) * (totalH - 0.12)
          return (
            <mesh key={`r${i}`} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} material={MAT.matteWhite()}>
              <cylinderGeometry args={[0.011, 0.011, wM - 0.06, 12]} />
            </mesh>
          )
        })}
        {/* Übergehängtes schwarzes Handtuch (großes Badetuch) */}
        <mesh position={[-wM * 0.12, -0.02, 0.03]} castShadow>
          <boxGeometry args={[wM * 0.42, 0.62, 0.03]} />
          <meshStandardMaterial color="#171717" roughness={0.96} metalness={0} />
        </mesh>
        {/* Zweites schwarzes Handtuch (Gästehandtuch) */}
        <mesh position={[wM * 0.22, 0.08, 0.032]} castShadow>
          <boxGeometry args={[wM * 0.3, 0.4, 0.03]} />
          <meshStandardMaterial color="#202020" roughness={0.96} metalness={0} />
        </mesh>
        {/* Thermostatventil unten */}
        <mesh position={[wM / 2 - 0.05, -totalH / 2 - 0.03, 0]} material={MAT.chrome()}>
          <cylinderGeometry args={[0.018, 0.018, 0.06, 12]} />
        </mesh>
      </group>
    )
  }

  // Towel rail — chrome wall bar on two brackets with a draped towel and a
  // folded accent towel. Mounted at ~1.1m; front faces +z (rotate for the wall).
  if (/^towel-rail/i.test(id)) {
    return (
      <group position={[0, 1.1, 0]}>
        {/* Two chrome wall brackets */}
        {[-0.28, 0.28].map((x, i) => (
          <mesh key={i} position={[x, 0, -0.015]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.chrome()}>
            <cylinderGeometry args={[0.008, 0.008, 0.05, 12]} />
          </mesh>
        ))}
        {/* Horizontal rail */}
        <mesh position={[0, 0, 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.01, 0.01, 0.62, 16]} />
        </mesh>
        {/* Draped towel folded over the rail (warm off-white) */}
        <mesh position={[-0.13, -0.15, 0.028]} castShadow>
          <boxGeometry args={[0.26, 0.36, 0.028]} />
          <meshStandardMaterial color="#ece6da" roughness={0.97} metalness={0} />
        </mesh>
        {/* Second folded towel (muted sage accent) */}
        <mesh position={[0.17, -0.11, 0.03]} castShadow>
          <boxGeometry args={[0.22, 0.30, 0.036]} />
          <meshStandardMaterial color="#9fb3ac" roughness={0.97} metalness={0} />
        </mesh>
      </group>
    )
  }

  // Bath mat — dunkelgraue Hochflor-Badematte (1:1 nach Foto): dicker, weicher
  // Flor (nicht die helle Wohnzimmer-Variante).
  if (/^bath-mat/i.test(id)) {
    return (
      <RoundedBox position={[0, 0.016, 0]} receiveShadow castShadow args={[wM, 0.032, hM]} radius={0.03} smoothness={2}>
        <meshStandardMaterial color="#3f4442" roughness={1} metalness={0} />
      </RoundedBox>
    )
  }

  // BATH CABINET — hoher weißer Hochschrank (1:1 nach Foto): schmaler wand-
  // hängender Schrank mit zwei grifflosen Türen. Back gegen −z; front +z.
  if (/^bath-cabinet/i.test(id)) {
    const bodyH = 1.5
    return (
      <group position={[0, 0.98, 0]}>
        {/* Korpus (weiß, matt) */}
        <RoundedBox position={[0, 0, 0]} castShadow receiveShadow material={MAT.matteWhite()} args={[wM, bodyH, hM]} radius={0.01} smoothness={2} />
        {/* Türfuge (senkrecht mittig) */}
        <mesh position={[0, 0, hM / 2 + 0.001]}>
          <boxGeometry args={[0.004, bodyH - 0.06, 0.004]} />
          <meshStandardMaterial color="#d4d6d3" roughness={0.6} />
        </mesh>
        {/* Zwei horizontale Türfugen (obere/untere Klappe) */}
        {[bodyH * 0.16, -bodyH * 0.16].map((y, i) => (
          <mesh key={i} position={[0, y, hM / 2 + 0.001]}>
            <boxGeometry args={[wM - 0.04, 0.004, 0.004]} />
            <meshStandardMaterial color="#d4d6d3" roughness={0.6} />
          </mesh>
        ))}
      </group>
    )
  }

  // Washing machine / fridge / dishwasher — brushed stainless body, dark-glass front
  if (/^washing-machine|^washer|^fridge|^dishwasher/i.test(id)) {
    return (
      <group>
        <mesh position={[0, 0.43, 0]} castShadow receiveShadow material={MAT.brushedSteel()}>
          <boxGeometry args={[wM, 0.85, hM]} />
        </mesh>
        {/* Door / front face — opaque dark glass panel (not see-through) */}
        <mesh position={[0, 0.43, hM/2 - 0.005]} material={MAT.darkPanel()}>
          <boxGeometry args={[wM * 0.85, 0.55, 0.005]} />
        </mesh>
      </group>
    )
  }

  // Piano
  if (/^piano/i.test(id)) {
    return (
      <group>
        {/* High-gloss black lacquer body */}
        <mesh position={[0, 0.55, 0]} castShadow receiveShadow material={MAT.darkPanel()}>
          <boxGeometry args={[wM, 1.10, hM]} />
        </mesh>
        {/* Keys strip */}
        <mesh position={[0, 0.65, hM/2 - 0.005]} material={MAT.matteWhite()}>
          <boxGeometry args={[wM * 0.85, 0.05, 0.005]} />
        </mesh>
      </group>
    )
  }

  // Plant — matte pot + a layered, slightly irregular foliage cluster (a single
  // sphere read as a lollipop; overlapping tinted lobes on a short trunk look
  // like a real potted plant).
  if (/^plant/i.test(id)) {
    const r = Math.min(wM, hM)
    const potH = Math.max(0.18, r * 0.6)
    const potR = r * 0.42
    // Deep, desaturated interior-plant greens (saturated golf-green reads as
    // plastic); three shades give the canopy self-shadow depth.
    const leaf = new THREE.MeshStandardMaterial({ color: '#39502f', roughness: 0.88, metalness: 0.0 })
    const leafDark = new THREE.MeshStandardMaterial({ color: '#2b3d24', roughness: 0.92, metalness: 0.0 })
    const leafLight = new THREE.MeshStandardMaterial({ color: '#48603a', roughness: 0.85, metalness: 0.0 })
    // Deterministic per-item jitter so no two plants share a silhouette.
    const seed = hashId(id + (item?.id ?? ''))
    const rj = mulberry32(seed)
    const lobes: Array<[number, number, number, number, number, THREE.Material]> = []
    const n = 6 + (seed % 3)
    for (let i = 0; i < n; i++) {
      const a = rj() * Math.PI * 2
      const rad = r * (0.08 + rj() * 0.26)
      lobes.push([
        Math.cos(a) * rad,
        potH + r * (0.35 + rj() * 0.7),
        Math.sin(a) * rad,
        r * (0.32 + rj() * 0.28),
        0.72 + rj() * 0.22, // y-squash — leaf clumps are wider than tall
        [leaf, leafDark, leafLight][i % 3],
      ])
    }
    return (
      <group>
        {/* Tapered matte ceramic pot — warm greige, not glow-white */}
        <mesh position={[0, potH / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[potR, potR * 0.82, potH, 28]} />
          <meshStandardMaterial color={'#8d8880'} roughness={0.85} metalness={0.0} />
        </mesh>
        {/* Soil */}
        <mesh position={[0, potH - 0.01, 0]}>
          <cylinderGeometry args={[potR * 0.92, potR * 0.92, 0.02, 24]} />
          <meshStandardMaterial color={'#2a1f16'} roughness={1} />
        </mesh>
        {/* Short trunk */}
        <mesh position={[0, potH + r * 0.18, 0]} castShadow material={woodFor(item, 'walnut')}>
          <cylinderGeometry args={[r * 0.05, r * 0.06, r * 0.4, 8]} />
        </mesh>
        {/* Foliage — squashed, staggered clumps; smooth segments so close-up
            walk-mode views stay organic */}
        {lobes.map(([x, y, z, rad, sy, m], i) => (
          <mesh key={i} position={[x, y, z]} scale={[1, sy, 1]} castShadow material={m}>
            <sphereGeometry args={[rad, 24, 18]} />
          </mesh>
        ))}
      </group>
    )
  }

  // Framed wall art — a slim walnut frame + canvas, hung at eye height. Placed
  // thin-side to the wall; the pictured side faces +z (rotate the item by 180°
  // for a wall on the opposite side). Size = [width, depth].
  if (/^art|^picture|^painting|^wall-art/i.test(id)) {
    const frameH = Math.max(0.4, wM * 0.72)
    const depth = Math.max(hM, 0.03)
    const canvasColors = ['#6b7f8c', '#a9895f', '#7d6b84', '#5f7d6a', '#9a5f5f']
    const cc = canvasColors[Math.abs(hashId(id + (item?.id ?? ''))) % canvasColors.length]
    return (
      <group position={[0, 1.55, 0]}>
        {/* Frame */}
        <mesh castShadow material={woodFor(item, 'walnut')}>
          <boxGeometry args={[wM, frameH, depth]} />
        </mesh>
        {/* Canvas */}
        <mesh position={[0, 0, depth / 2 + 0.003]}>
          <planeGeometry args={[wM - 0.06, frameH - 0.06]} />
          <meshStandardMaterial color={cc} roughness={0.9} metalness={0} />
        </mesh>
      </group>
    )
  }

  // Mirror — slim frame + a reflective pane with a BLUE/PURPLE RGB backlight glow
  // (die signature Govee-Hintergrundbeleuchtung des echten Bad-Spiegels).
  if (/^mirror/i.test(id)) {
    const frameH = Math.max(0.6, wM * 1.4)
    const depth = Math.max(hM, 0.03)
    return (
      <group position={[0, 1.35, 0]}>
        {/* RGB-Backlight-Halo — größere emissive Platte hinter dem Rahmen (blau/lila) */}
        <mesh position={[0, 0, depth / 2 - 0.002]}>
          <planeGeometry args={[wM + 0.10, frameH + 0.10]} />
          <meshStandardMaterial color="#dfe4ff" emissive="#5a4bff" emissiveIntensity={2.1} toneMapped={false} />
        </mesh>
        <mesh castShadow material={MAT.aluminium()}>
          <boxGeometry args={[wM, frameH, depth]} />
        </mesh>
        {/* Real reflection on 'high': a planar reflector mirrors the actual
            scene (deep mirror reflections). Lower tiers keep the cheap chrome. */}
        {readTier() === 'high' ? (
          <mesh position={[0, 0, depth / 2 + 0.004]}>
            <planeGeometry args={[wM - 0.04, frameH - 0.04]} />
            <MeshReflectorMaterial
              resolution={512}
              mirror={0.92}
              mixBlur={0.35}
              mixStrength={1.1}
              blur={[110, 40]}
              roughness={0.14}
              metalness={0.55}
              color="#e2e8ec"
            />
          </mesh>
        ) : (
          <mesh position={[0, 0, depth / 2 + 0.003]} material={MAT.chrome()}>
            <planeGeometry args={[wM - 0.04, frameH - 0.04]} />
          </mesh>
        )}
      </group>
    )
  }

  // Fairy-light branches in a glass floor vase — the reference's warm lit twigs
  // (they appear in almost every room of the real flat).
  if (/^branch-lights|^fairy/i.test(id)) {
    let s = Math.abs(hashId(id + (item?.id ?? ''))) || 1
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    const vaseR = Math.max(0.07, Math.min(wM, hM) * 0.3)
    const vaseH = 0.42
    const twigs: React.ReactNode[] = []
    const N = 8
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2 + rnd() * 0.6
      const lean = 0.14 + rnd() * 0.2
      const th = 1.0 + rnd() * 0.7
      const tx = Math.cos(ang) * lean, tz = Math.sin(ang) * lean
      twigs.push(
        <mesh key={`t${i}`} position={[tx * 0.5, vaseH + th / 2, tz * 0.5]} rotation={[tz * 0.35, 0, -tx * 0.35]}>
          <cylinderGeometry args={[0.004, 0.009, th, 6]} />
          <meshStandardMaterial color="#4a3a2a" roughness={0.9} />
        </mesh>,
      )
      const dc = 5 + Math.floor(rnd() * 3)
      for (let j = 0; j < dc; j++) {
        const f = 0.25 + (j / dc) * 0.8
        twigs.push(
          <mesh key={`d${i}_${j}`} position={[tx * f, vaseH + th * f, tz * f]}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshStandardMaterial color="#fff1c8" emissive="#ffd98a" emissiveIntensity={2.6} />
          </mesh>,
        )
      }
    }
    return (
      <group>
        <mesh position={[0, vaseH / 2, 0]} material={MAT.glass()}>
          <cylinderGeometry args={[vaseR, vaseR * 0.8, vaseH, 20]} />
        </mesh>
        {twigs}
      </group>
    )
  }

  // Pendant lamp — black wire-mesh shade on a cord + warm bulb, hanging from the
  // (missing) ceiling (the reference's dining/living pendants).
  if (/^pendant/i.test(id)) {
    const shadeY = 1.75
    return (
      <group>
        <mesh position={[0, 2.2, 0]} material={MAT.softBlack()}>
          <cylinderGeometry args={[0.006, 0.006, 0.9, 8]} />
        </mesh>
        <mesh position={[0, shadeY + 0.15, 0]} material={MAT.softBlack()}>
          <cylinderGeometry args={[0.16, 0.08, 0.06, 20]} />
        </mesh>
        <mesh position={[0, shadeY, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.26, 22, 1, true]} />
          <meshStandardMaterial color="#1a1a1d" roughness={0.6} metalness={0.3} transparent opacity={0.82} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, shadeY, 0]}>
          <sphereGeometry args={[0.05, 16, 16]} />
          <meshStandardMaterial color="#fff2d6" emissive="#ffcf8a" emissiveIntensity={2.4} />
        </mesh>
      </group>
    )
  }

  // Gymnastic rings / aerial straps hanging from the ceiling (the bedroom set).
  if (/^gym-rings|^rings/i.test(id)) {
    const top = 2.45, ringY = 1.35
    return (
      <group>
        {[-0.14, 0.14].map((x, i) => (
          <group key={i}>
            <mesh position={[x, (top + ringY) / 2, 0]} material={MAT.softBlack()}>
              <boxGeometry args={[0.03, top - ringY, 0.008]} />
            </mesh>
            <mesh position={[x, ringY, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.085, 0.014, 10, 24]} />
              <meshStandardMaterial color="#232326" roughness={0.5} metalness={0.25} />
            </mesh>
          </group>
        ))}
      </group>
    )
  }

  // Beamer projection / wall screen — a soft glowing panel on the wall with a
  // rainbow accent band (the bedroom's projected Google-TV screen).
  if (/^wall-screen|^projection|^beamer/i.test(id)) {
    const wProj = Math.max(wM, 1.2)
    const hProj = wProj * 0.56
    const depth = Math.max(hM, 0.02)
    return (
      <group position={[0, 1.55, 0]}>
        <mesh castShadow material={MAT.softBlack()}>
          <boxGeometry args={[wProj + 0.04, hProj + 0.04, depth]} />
        </mesh>
        <mesh position={[0, 0, depth / 2 + 0.004]}>
          <planeGeometry args={[wProj, hProj]} />
          <meshStandardMaterial color="#0e1420" emissive="#4a6bd8" emissiveIntensity={0.85} toneMapped={false} />
        </mesh>
        {['#ff5a5a', '#ffb14d', '#ffe24d', '#4dff88', '#4db8ff', '#a86bff'].map((c, i) => (
          <mesh key={i} position={[-wProj / 2 + (i + 0.5) * (wProj / 6), -hProj * 0.16, depth / 2 + 0.006]}>
            <planeGeometry args={[(wProj / 6) * 0.86, hProj * 0.3]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.0} toneMapped={false} />
          </mesh>
        ))}
      </group>
    )
  }

  // ── Eingang (entrance) — exact clone pieces from the reference photos ──

  // Entrance door leaf — white painted door + chrome lever handle + a white
  // door-frame contact sensor. Faces +z; place in the doorway rotated to the wall.
  if (/^entrance-door|^front-door/i.test(id)) {
    const doorH = 2.05
    const dz = Math.max(hM, 0.04)
    return (
      <group>
        <mesh position={[0, doorH / 2, 0]} castShadow receiveShadow material={MAT.matteWhite()}>
          <boxGeometry args={[wM, doorH, dz]} />
        </mesh>
        {/* Slim inset panel line */}
        <mesh position={[0, 1.15, dz / 2 + 0.002]}>
          <planeGeometry args={[wM - 0.14, 1.5]} />
          <meshStandardMaterial color="#efece5" roughness={0.85} />
        </mesh>
        {/* Chrome lever handle (right edge) + round rosette */}
        <mesh position={[wM / 2 - 0.14, 1.05, dz / 2 + 0.035]} rotation={[0, 0, Math.PI / 2]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.011, 0.011, 0.13, 12]} />
        </mesh>
        <mesh position={[wM / 2 - 0.09, 1.05, dz / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.chrome()}>
          <cylinderGeometry args={[0.022, 0.022, 0.02, 18]} />
        </mesh>
        {/* Lockin retrofit smart lock below the handle — anthracite oval body,
            thumb-turn dial with a raised bar, round button, status LED */}
        <group position={[wM / 2 - 0.09, 0.82, dz / 2 + 0.02]}>
          <RoundedBox position={[0, 0, 0.026]} args={[0.076, 0.14, 0.052]} radius={0.024} smoothness={3} castShadow material={MAT.shellDark()} />
          <mesh position={[0, 0.032, 0.055]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.chrome()}>
            <cylinderGeometry args={[0.023, 0.023, 0.01, 20]} />
          </mesh>
          <mesh position={[0, 0.032, 0.061]} castShadow material={MAT.steel()}>
            <boxGeometry args={[0.005, 0.036, 0.005]} />
          </mesh>
          <mesh position={[0, -0.032, 0.055]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.018, 0.018, 0.008, 18]} />
            <meshStandardMaterial color="#3a3a3e" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.055]}>
            <circleGeometry args={[0.003, 10]} />
            <meshStandardMaterial color="#3d8ffb" emissive="#3d8ffb" emissiveIntensity={1.2} toneMapped={false} />
          </mesh>
        </group>
        {/* White contact sensor on the hinge-frame side, up high */}
        <mesh position={[-wM / 2 + 0.03, 1.72, dz / 2 + 0.02]} castShadow material={MAT.matteWhite()}>
          <boxGeometry args={[0.03, 0.09, 0.022]} />
        </mesh>
      </group>
    )
  }

  // 3-tier shoe bench — black metal frame, wood top, sneakers on the shelves,
  // warm LED underglow strips (the reference's lit shoe bench).
  if (/^shoe-bench/i.test(id)) {
    const top = 0.42
    const shelfYs = [0.10, 0.26]
    const sneakerCols = ['#f1f1ef', '#e6e6e4', '#d6d4d0', '#2a2a2c', '#cdbfa6']
    const sneakers: React.ReactNode[] = []
    shelfYs.forEach((sy, si) => {
      const n = Math.max(3, Math.floor(wM / 0.16))
      for (let i = 0; i < n; i++) {
        const x = -wM / 2 + 0.12 + (i * (wM - 0.24)) / (n - 1)
        const c = sneakerCols[(si * 2 + i) % sneakerCols.length]
        sneakers.push(
          <group key={`sn${si}_${i}`} position={[x, sy + 0.055, 0]}>
            <mesh castShadow><boxGeometry args={[0.085, 0.06, 0.2]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
            <mesh position={[0, 0.03, 0.055]} castShadow><boxGeometry args={[0.085, 0.05, 0.09]} /><meshStandardMaterial color={c} roughness={0.7} /></mesh>
          </group>,
        )
      }
    })
    return (
      <group>
        {/* Dark espresso top */}
        <RoundedBox position={[0, top, 0]} castShadow receiveShadow material={MAT.woodDark()} args={[wM, 0.04, hM]} radius={0.008} smoothness={2} />
        {/* Two lower shelves */}
        {shelfYs.map((sy, i) => (
          <mesh key={`sh${i}`} position={[0, sy, 0]} castShadow receiveShadow material={MAT.softBlack()}>
            <boxGeometry args={[wM - 0.02, 0.015, hM - 0.04]} />
          </mesh>
        ))}
        {/* Black frame legs */}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh key={`lg${i}`} position={[sx * (wM / 2 - 0.02), top / 2, sz * (hM / 2 - 0.02)]} castShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.02, top, 0.02]} />
          </mesh>
        ))}
        {sneakers}
        {/* Warm LED underglow under each level */}
        {[top, ...shelfYs].map((sy, i) => (
          <mesh key={`gl${i}`} position={[0, sy - 0.022, hM / 2 - 0.02]}>
            <boxGeometry args={[wM - 0.08, 0.01, 0.014]} />
            <meshStandardMaterial color="#fff3d8" emissive="#ffcf82" emissiveIntensity={2.3} />
          </mesh>
        ))}
        {/* On the top: red-marble table lamp (left), Jordan box (right), succulent */}
        <group position={[-wM * 0.3, top + 0.02, 0]}>
          {/* Red marble round base */}
          <mesh position={[0, 0.016, 0]} castShadow>
            <cylinderGeometry args={[0.062, 0.062, 0.032, 26]} />
            <meshStandardMaterial color="#5a1f22" roughness={0.22} metalness={0.15} />
          </mesh>
          {/* Wood stem */}
          <mesh position={[0, 0.088, 0]} castShadow>
            <cylinderGeometry args={[0.012, 0.015, 0.11, 12]} />
            <meshStandardMaterial color="#8a6a45" roughness={0.7} />
          </mesh>
          {/* Red-glowing dome shade */}
          <mesh position={[0, 0.172, 0]}>
            <sphereGeometry args={[0.08, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
            <meshStandardMaterial color="#ff6a58" emissive="#ff3a26" emissiveIntensity={2.2} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <group position={[wM * 0.28, top + 0.07, 0]}>
          <mesh castShadow material={MAT.softBlack()}><boxGeometry args={[0.28, 0.14, 0.18]} /></mesh>
          <mesh position={[0, 0, 0.091]}>
            <planeGeometry args={[0.1, 0.05]} />
            <meshStandardMaterial color="#c9a24e" metalness={0.6} roughness={0.35} emissive="#3a2c10" emissiveIntensity={0.3} />
          </mesh>
        </group>
        <group position={[-wM * 0.03, top + 0.05, 0.02]}>
          <mesh castShadow material={MAT.softBlack()}><cylinderGeometry args={[0.03, 0.025, 0.06, 14]} /></mesh>
          <mesh position={[0, 0.055, 0]}><sphereGeometry args={[0.035, 12, 10]} /><meshStandardMaterial color="#5a7f4a" roughness={0.9} /></mesh>
        </group>
      </group>
    )
  }

  // Wall coat rail with hanging jackets (maroon / olive / black bombers).
  if (/^coat-rail/i.test(id)) {
    const railY = 1.55
    // black bomber, prominent beige puffer (centre), black, dark olive
    const cols = ['#242428', '#c1b493', '#2a2a2e', '#3a3a33']
    const jackets: React.ReactNode[] = []
    const n = 4
    for (let i = 0; i < n; i++) {
      const x = -wM / 2 + 0.14 + (i * (wM - 0.28)) / (n - 1)
      const c = cols[i % cols.length]
      const puffer = i === 1
      const bw = puffer ? 0.3 : 0.26, bd = puffer ? 0.16 : 0.13
      jackets.push(
        <group key={`jk${i}`} position={[x, railY - 0.34, puffer ? 0.09 : 0.07]}>
          <mesh castShadow><boxGeometry args={[bw, 0.12, bd]} /><meshStandardMaterial color={c} roughness={0.94} /></mesh>
          <mesh position={[0, -0.25, 0]} castShadow><boxGeometry args={[bw - 0.03, 0.44, bd - 0.02]} /><meshStandardMaterial color={c} roughness={0.94} /></mesh>
        </group>,
      )
    }
    return (
      <group>
        <mesh position={[0, railY, 0.02]} castShadow material={MAT.softBlack()}>
          <boxGeometry args={[wM, 0.03, 0.03]} />
        </mesh>
        {[-0.32, -0.11, 0.11, 0.32].map((f, i) => (
          <mesh key={`hk${i}`} position={[f * wM, railY - 0.035, 0.045]} castShadow material={MAT.softBlack()}>
            <boxGeometry args={[0.015, 0.05, 0.035]} />
          </mesh>
        ))}
        {jackets}
      </group>
    )
  }

  // Neon speech-bubble sign above the coat rail — a jagged/spiky pink neon ring,
  // hollow inside, with a small pointer tail (matches the reference).
  if (/^neon-sign/i.test(id)) {
    const parts: React.ReactNode[] = []
    const N = 24
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = 0.13 + (i % 2 === 0 ? 0.03 : 0)   // spiky outer edge
      parts.push(
        <mesh key={`nd${i}`} position={[Math.cos(a) * r, Math.sin(a) * r, 0]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#ffd2e6" emissive="#ff5c9e" emissiveIntensity={3.2} toneMapped={false} />
        </mesh>,
      )
    }
    // speech-bubble pointer tail at the bottom
    for (let j = 0; j < 3; j++) {
      parts.push(
        <mesh key={`nt${j}`} position={[0.02 + j * 0.012, -0.16 - j * 0.02, 0]}>
          <sphereGeometry args={[0.011, 8, 8]} />
          <meshStandardMaterial color="#ffd2e6" emissive="#ff5c9e" emissiveIntensity={3.2} toneMapped={false} />
        </mesh>,
      )
    }
    return <group position={[0, 1.92, 0.02]}>{parts}</group>
  }

  // White-dome portable table lamp with a warm glow (the Hue-style bench lamp).
  if (/^dome-lamp/i.test(id)) {
    return (
      <group>
        <mesh position={[0, 0.02, 0]} castShadow material={MAT.matteWhite()}>
          <cylinderGeometry args={[0.05, 0.06, 0.04, 20]} />
        </mesh>
        <mesh position={[0, 0.12, 0]} material={MAT.matteWhite()}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 10]} />
        </mesh>
        <mesh position={[0, 0.235, 0]}>
          <sphereGeometry args={[0.09, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#fff4e0" emissive="#ffdca6" emissiveIntensity={1.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
    )
  }

  // Jordan shoe box — black box with a gold wings emblem on the front.
  if (/^jordan-box|^shoe-box/i.test(id)) {
    return (
      <group>
        <mesh position={[0, 0.07, 0]} castShadow receiveShadow material={MAT.softBlack()}>
          <boxGeometry args={[wM, 0.14, hM]} />
        </mesh>
        <mesh position={[0, 0.08, hM / 2 + 0.002]}>
          <planeGeometry args={[0.11, 0.05]} />
          <meshStandardMaterial color="#c9a24e" metalness={0.6} roughness={0.35} emissive="#3a2c10" emissiveIntensity={0.3} />
        </mesh>
      </group>
    )
  }

  // RITTO wall intercom — white audio unit, handset + coiled cord, two round
  // buttons, and a SwitchBot Bot mounted over the door-release button.
  if (/^intercom/i.test(id)) {
    return (
      <group position={[0, 1.45, 0.02]}>
        <mesh castShadow material={MAT.matteWhite()}><boxGeometry args={[0.09, 0.17, 0.03]} /></mesh>
        {/* Handset on the left with coiled cord */}
        <mesh position={[-0.06, 0, 0.02]} castShadow material={MAT.matteWhite()}><boxGeometry args={[0.032, 0.14, 0.032]} /></mesh>
        <mesh position={[-0.06, -0.11, 0.02]} rotation={[0, 0, 0.2]}><cylinderGeometry args={[0.006, 0.006, 0.13, 8]} /><meshStandardMaterial color="#dddddd" /></mesh>
        {/* Two round buttons (light / door-release) */}
        {[-0.004, -0.032].map((y, i) => (
          <mesh key={i} position={[0.014, y, 0.016]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.009, 0.009, 0.006, 16]} /><meshStandardMaterial color="#8f8f8f" metalness={0.4} roughness={0.5} /></mesh>
        ))}
        {/* SwitchBot Bot pressing the door-release button */}
        <group position={[0.014, -0.062, 0.028]}>
          <mesh castShadow><boxGeometry args={[0.036, 0.036, 0.03]} /><meshStandardMaterial color="#f0f0ee" roughness={0.5} /></mesh>
          <mesh position={[0, 0.024, 0.008]}><boxGeometry args={[0.012, 0.012, 0.016]} /><meshStandardMaterial color="#e6e6e4" /></mesh>
        </group>
      </group>
    )
  }

  // Square LED ceiling panel — a flat framed luminaire that glows warm-white.
  if (/^ceiling-panel/i.test(id)) {
    return (
      <group position={[0, 2.42, 0]}>
        <mesh castShadow material={MAT.matteWhite()}><boxGeometry args={[wM, 0.05, hM]} /></mesh>
        <mesh position={[0, -0.027, 0]}>
          <boxGeometry args={[wM - 0.06, 0.006, hM - 0.06]} />
          <meshStandardMaterial color="#ffffff" emissive="#fff4e0" emissiveIntensity={2.6} toneMapped={false} />
        </mesh>
      </group>
    )
  }

  // Plush fur / sheepskin rug — soft cream, lies flat on the floor.
  if (/^fur-rug/i.test(id)) {
    return (
      <RoundedBox position={[0, 0.02, 0]} receiveShadow castShadow args={[wM, 0.04, hM]} radius={0.03} smoothness={2}>
        <meshStandardMaterial color="#e9e3d6" roughness={1} metalness={0} />
      </RoundedBox>
    )
  }

  // Illuminated moss / plant wall art — a framed dense green foliage panel with
  // warm fairy-light dots, a few pale flowers and a trailing vine (the Flur's
  // Mooswand from the reference).
  if (/^moss-wall|^plant-wall|^moss-art/i.test(id)) {
    let s = Math.abs(hashId(id + (item?.id ?? ''))) || 1
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    const fw = Math.max(wM, 0.55), fh = fw * 0.92
    const greens = ['#3f6b32', '#4f7a41', '#5f8a4a', '#365c2c', '#6b9455']
    const parts: React.ReactNode[] = []
    for (let i = 0; i < 46; i++) {
      const x = (rnd() - 0.5) * fw * 0.92, y = (rnd() - 0.5) * fh * 0.92
      const r = 0.04 + rnd() * 0.05
      parts.push(<mesh key={`mb${i}`} position={[x, y, 0.02 + rnd() * 0.03]}><sphereGeometry args={[r, 10, 8]} /><meshStandardMaterial color={greens[Math.floor(rnd() * greens.length)]} roughness={0.9} /></mesh>)
    }
    for (let i = 0; i < 6; i++) {
      const x = (rnd() - 0.5) * fw * 0.8, y = (rnd() - 0.5) * fh * 0.8
      parts.push(<mesh key={`mf${i}`} position={[x, y, 0.055]}><sphereGeometry args={[0.02, 8, 8]} /><meshStandardMaterial color="#eae0d0" roughness={0.85} /></mesh>)
    }
    for (let i = 0; i < 14; i++) {
      const x = (rnd() - 0.5) * fw * 0.85, y = (rnd() - 0.5) * fh * 0.85
      parts.push(<mesh key={`md${i}`} position={[x, y, 0.065]}><sphereGeometry args={[0.011, 8, 8]} /><meshStandardMaterial color="#fff1c8" emissive="#ffd98a" emissiveIntensity={2.6} /></mesh>)
    }
    for (let i = 0; i < 5; i++) {
      parts.push(<mesh key={`mv${i}`} position={[-fw * 0.16 + i * 0.03, -fh / 2 - 0.06 - rnd() * 0.1, 0.04]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color="#4f7a41" roughness={0.9} /></mesh>)
    }
    return (
      <group position={[0, 1.5, 0.02]}>
        <mesh castShadow material={MAT.softBlack()}><boxGeometry args={[fw + 0.04, fh + 0.04, 0.04]} /></mesh>
        <mesh position={[0, 0, 0.012]}><planeGeometry args={[fw, fh]} /><meshStandardMaterial color="#243318" roughness={1} /></mesh>
        {parts}
      </group>
    )
  }

  // ── Outdoor: SWIMMING POOL — travertine coping frame, reflective water that
  // mirrors the sky (IBL), a dark aqua liner, a waterline LED glow and entry
  // steps. One renderer serves the garden pool, the wellness indoor pool and the
  // rooftop plunge pool — the "Pools" the Omega residence is built around.
  if (/^pool/i.test(id)) {
    const cop = 0.16                         // coping width (m)
    const rim = 0.1                          // coping height above grade
    const depth = 0.6
    const iw = Math.max(0.4, wM - cop * 2)
    const ih = Math.max(0.4, hM - cop * 2)
    const waterY = rim - 0.05
    return (
      <group>
        {/* Coping — light travertine frame around the basin */}
        {([[0, -hM / 2 + cop / 2, wM, cop], [0, hM / 2 - cop / 2, wM, cop], [-wM / 2 + cop / 2, 0, cop, hM - cop * 2], [wM / 2 - cop / 2, 0, cop, hM - cop * 2]] as const).map(([x, z, bw, bd], i) => (
          <mesh key={`cp${i}`} position={[x, rim / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[bw, rim, bd]} />
            <meshStandardMaterial color="#d7cdb8" roughness={0.85} metalness={0.02} />
          </mesh>
        ))}
        {/* Basin liner — inward-facing dark aqua walls + floor */}
        <mesh position={[0, -depth / 2 + waterY, 0]}>
          <boxGeometry args={[iw, depth, ih]} />
          <meshStandardMaterial color="#0f5468" roughness={0.32} metalness={0.05} side={THREE.BackSide} />
        </mesh>
        {/* Water surface — low roughness so it reflects the sky */}
        <mesh position={[0, waterY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[iw - 0.02, ih - 0.02]} />
          <meshPhysicalMaterial color="#2b93bf" roughness={0.07} metalness={0} transparent opacity={0.82} transmission={0.35} ior={1.33} emissive="#0e4f6b" emissiveIntensity={0.16} />
        </mesh>
        {/* Waterline LED — a faint cool glow just under the surface */}
        <mesh position={[0, waterY - 0.05, 0]}>
          <boxGeometry args={[iw - 0.08, 0.02, ih - 0.08]} />
          <meshStandardMaterial color="#bfeaff" emissive="#79cff5" emissiveIntensity={0.9} transparent opacity={0.4} />
        </mesh>
        {/* Entry steps in the near corner */}
        {[0, 1, 2].map((s) => (
          <mesh key={`st${s}`} position={[wM / 2 - cop - 0.2 - s * 0.16, waterY - 0.05 - s * 0.12, -hM / 2 + cop + 0.32]} castShadow>
            <boxGeometry args={[0.34, 0.06, 0.52]} />
            <meshStandardMaterial color="#cfe6ef" roughness={0.4} />
          </mesh>
        ))}
      </group>
    )
  }

  // ── Outdoor: SUN LOUNGER — teak frame on legs, thick cream cushion, a raised
  // backrest and a rust accent pillow (the poolside piece).
  if (/^sunbed|^lounger|^deck-chair/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.18, 0]} args={[wM, 0.06, hM]} radius={0.02} smoothness={2} castShadow material={MAT.woodOak()} />
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh key={`lg${i}`} position={[sx * (wM / 2 - 0.09), 0.09, sz * (hM / 2 - 0.09)]} castShadow material={MAT.woodDark()}>
            <boxGeometry args={[0.05, 0.18, 0.05]} />
          </mesh>
        ))}
        <RoundedBox position={[0, 0.26, hM * 0.08]} args={[wM - 0.14, 0.1, hM * 0.64]} radius={0.04} smoothness={3} castShadow>
          <meshStandardMaterial color="#ece6d9" roughness={0.96} />
        </RoundedBox>
        <RoundedBox position={[0, 0.44, -hM / 2 + hM * 0.15]} rotation={[-0.95, 0, 0]} args={[wM - 0.14, 0.1, hM * 0.34]} radius={0.04} smoothness={3} castShadow>
          <meshStandardMaterial color="#ece6d9" roughness={0.96} />
        </RoundedBox>
        <RoundedBox position={[0, 0.52, -hM / 2 + hM * 0.1]} rotation={[-0.5, 0, 0]} args={[0.42, 0.3, 0.1]} radius={0.05} smoothness={3} castShadow>
          <meshStandardMaterial color="#8a5a3c" roughness={0.9} />
        </RoundedBox>
      </group>
    )
  }

  // ── Outdoor: KETTLE GRILL — anthracite cart, domed lid with a chrome handle,
  // a stainless side shelf, control knobs and wheels.
  if (/^grill|^bbq/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.55, 0]} args={[wM * 0.6, 0.5, hM * 0.78]} radius={0.05} smoothness={3} castShadow material={MAT.softBlack()} />
        <mesh position={[0, 0.86, 0]} castShadow>
          <sphereGeometry args={[hM * 0.42, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#26272b" roughness={0.4} metalness={0.5} />
        </mesh>
        <mesh position={[0, 0.87 + hM * 0.42, 0]} castShadow material={MAT.chrome()}>
          <boxGeometry args={[0.16, 0.04, 0.04]} />
        </mesh>
        <mesh position={[wM * 0.4, 0.6, 0]} castShadow material={MAT.steel()}>
          <boxGeometry args={[wM * 0.2, 0.03, hM * 0.6]} />
        </mesh>
        {([-1, 1] as const).map((sx) => (
          <group key={`leg${sx}`}>
            <mesh position={[sx * wM * 0.22, 0.28, hM * 0.28]} castShadow material={MAT.softBlack()}>
              <boxGeometry args={[0.05, 0.56, 0.05]} />
            </mesh>
            <mesh position={[sx * wM * 0.22, 0.11, -hM * 0.28]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.1, 0.1, 0.05, 16]} />
              <meshStandardMaterial color="#111214" roughness={0.8} />
            </mesh>
          </group>
        ))}
        {[-0.12, 0.12].map((x, i) => (
          <mesh key={`kn${i}`} position={[x, 0.78, hM * 0.38]} rotation={[Math.PI / 2, 0, 0]} castShadow material={MAT.chrome()}>
            <cylinderGeometry args={[0.03, 0.03, 0.03, 12]} />
          </mesh>
        ))}
      </group>
    )
  }

  // ── Outdoor: DINING/LOUNGE TABLE — teak slatted top on solid legs.
  if (/^outdoor-table/i.test(id)) {
    return (
      <group>
        <RoundedBox position={[0, 0.42, 0]} args={[wM, 0.06, hM]} radius={0.02} smoothness={2} castShadow material={MAT.woodOak()} />
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={`sl${i}`} position={[0, 0.452, -hM / 2 + (i + 0.5) * (hM / 6)]}>
            <boxGeometry args={[wM - 0.06, 0.004, 0.012]} />
            <meshStandardMaterial color="#6b4f33" roughness={0.8} />
          </mesh>
        ))}
        {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
          <mesh key={`lg${i}`} position={[sx * (wM / 2 - 0.1), 0.2, sz * (hM / 2 - 0.1)]} castShadow material={MAT.woodDark()}>
            <boxGeometry args={[0.06, 0.4, 0.06]} />
          </mesh>
        ))}
      </group>
    )
  }

  // Default: low slab
  return (
    <mesh position={[0, 0.15, 0]} castShadow receiveShadow material={upholsteryFor(item)}>
      <boxGeometry args={[wM, 0.30, hM]} />
    </mesh>
  )
}

/** Tiny deterministic string hash (for stable per-item variation). */
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0 }
  return h
}

function Furniture3D({ f }: { f: PlacedFurniture }) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const entry = FURN_MAP[f.furnitureId]
  const [w, h] = f.size ?? entry?.size ?? [60, 60]
  const setSelection = usePlanStore((s) => s.setSelection)
  const selection = usePlanStore((s) => s.selection)
  const isSelected = selection.type === 'furniture' && selection.ids.includes(f.id)

  // Subtle lift on hover
  useFrame((_, dt) => {
    if (!groupRef.current) return
    const target = hovered ? 0.015 : 0
    groupRef.current.position.y += (target - groupRef.current.position.y) * Math.min(1, dt * 8)
  })

  return (
    <group
      position={[M(f.position.x), 0, M(f.position.y)]}
      rotation={[0, ((f.rotation ?? 0) * Math.PI) / 180, 0]}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
      onPointerOut={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = '' }}
      onClick={(e) => { e.stopPropagation(); setSelection({ type: 'furniture', ids: [f.id] }) }}
    >
      <group ref={groupRef}>
        <GltfModel id={f.furnitureId} fallback={<FurnitureMesh furnitureId={f.furnitureId} w={w} h={h} item={f} />} />
        {(isSelected || hovered) && (
          <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[Math.max(M(w), M(h)) / 2 + 0.06, Math.max(M(w), M(h)) / 2 + 0.075, 64]} />
            <meshBasicMaterial color={isSelected ? '#C7A24E' : '#E6CC86'} transparent opacity={isSelected ? 0.7 : 0.35} />
          </mesh>
        )}
      </group>
    </group>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Floor + Scene
// ─────────────────────────────────────────────────────────────────────

/**
 * v18 — First-person Walk-Mode controller. WASD/arrow movement at eye height (~1.7m).
 * Click to lock pointer; Esc to release. Movement clamped to floor extent.
 */
/** Shared, render-free walk input. The mobile joystick (DOM) writes movement
 *  here; the R3F controller reads it each frame. mx = strafe, mz = forward, both
 *  −1…1 in camera space. */
const walkInput = { mx: 0, mz: 0 }

/** Coarse pointer (touch) → mobile controls; fine pointer (mouse) → pointer-lock. */
function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
}

/**
 * Pick a clear eye-level spawn for walk mode: candidate points around each
 * indoor room's centroid, scored by clearance to all furniture footprints —
 * so you never spawn inside a sofa. Looks toward the room's largest piece
 * (a composed first view instead of a random wall).
 */
function pickWalkSpawn(floor: { rooms: Room[]; furniture: PlacedFurniture[]; walls?: Wall[]; devices?: Array<{ position: { x: number; y: number } }>; extent: { width: number; height: number } }): { pos: [number, number]; look: [number, number] } {
  // Flat decor never blocks walking (rugs lie on the floor, art hangs on walls).
  const FLAT = /^rug|^wall-art|^mirror|^bath-mat/i
  const solid = floor.furniture.filter((f) => !FLAT.test(f.furnitureId) && !f.hidden)
  // Devices render as physical objects too (floor lamps, speakers) — treat
  // each as a small square obstacle so the camera never spawns inside one.
  const deviceObstacles = (floor.devices ?? []).map((d) => ({ position: d.position, size: [45, 45] as [number, number] }))
  const obstacles = [
    ...solid.map((f) => ({ position: f.position, size: (f.size ?? [60, 60]) as [number, number] })),
    ...deviceObstacles,
  ]
  // Point-to-AABB distance (rotation ignored — a conservative-enough proxy).
  const clearance = (x: number, y: number) => {
    let min = Infinity
    for (const f of obstacles) {
      const [w, h] = f.size
      const dx = Math.max(Math.abs(x - f.position.x) - w / 2, 0)
      const dy = Math.max(Math.abs(y - f.position.y) - h / 2, 0)
      const d = Math.hypot(dx, dy)
      if (d < min) min = d
    }
    return min
  }
  const area = (r: Room) => {
    let a = 0
    for (let i = 0; i < r.polygon.length; i++) {
      const p = r.polygon[i], q = r.polygon[(i + 1) % r.polygon.length]
      a += p.x * q.y - q.x * p.y
    }
    return Math.abs(a / 2)
  }
  // Ray-cast point-in-polygon — candidates must stay inside their room.
  const inPoly = (x: number, y: number, poly: Room['polygon']) => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i], pj = poly[j]
      if ((pi.y > y) !== (pj.y > y) && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
        inside = !inside
      }
    }
    return inside
  }
  // All rooms compete: candidates are scored by clearance, distance to the
  // room's hero piece (composed view, not a close-up) and a room-size bonus,
  // so a cramped living room still beats a technically-clearer bathroom.
  const rooms = floor.rooms
    .filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)
  const OFFSETS = [
    [0, 0], [90, 0], [-90, 0], [0, 90], [0, -90], [0, -140], [0, 140],
    [120, 0], [-120, 0], [90, 90], [-90, 90], [90, -90], [-90, -90], [160, 0], [-160, 0],
  ]
  let global: { x: number; y: number; look: [number, number]; score: number; room: Room } | null = null
  for (const r of rooms) {
    let cx = 0, cy = 0
    for (const p of r.polygon) { cx += p.x; cy += p.y }
    cx /= r.polygon.length; cy /= r.polygon.length
    const inRoom = solid.filter((f) => f.roomId === r.id)
    const target = inRoom.sort((a, b) => {
      const [aw, ah] = a.size ?? [60, 60]; const [bw, bh] = b.size ?? [60, 60]
      return bw * bh - aw * ah
    })[0]
    const areaBonus = Math.sqrt(area(r)) * 0.06
    // A living hero makes the better opening shot than a technically-clear
    // hallway or a shower stall — and the sofa outranks everything (the
    // reference tour always opens on the living room).
    const heroBonus = target && /^sofa/.test(target.furnitureId) ? 140
      : target && /^bed-|^table-dining|^tv-/.test(target.furnitureId) ? 45 : 0
    // Candidates: offsets around the room centroid PLUS a ring around the
    // hero piece — in a furnished room the centroid is often blocked while a
    // spot 1.6–2.2 m in front of the sofa/bed is exactly the view we want.
    const candidates: Array<[number, number]> = OFFSETS.map(([dx, dy]) => [cx + dx, cy + dy])
    if (target) {
      // Step back proportionally to the hero's size so a king bed or corner
      // sofa is framed, not cropped.
      const [tw, th] = target.size ?? [60, 60]
      const halfDiag = Math.hypot(tw, th) / 2
      for (const rad of [halfDiag + 130, halfDiag + 190]) {
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2
          candidates.push([target.position.x + Math.cos(ang) * rad, target.position.y + Math.sin(ang) * rad])
        }
      }
    }
    for (const [x, y] of candidates) {
      if (!inPoly(x, y, r.polygon)) continue
      const clear = clearance(x, y)
      if (clear < 25) continue
      const back = target ? Math.hypot(x - target.position.x, y - target.position.y) : 0
      // Penalise obstacles sitting on the camera→hero sight line (a floor
      // lamp in front of the sofa ruins the shot even from a clear spot).
      let blocked = 0
      if (target && back > 1) {
        const tx = target.position.x, ty = target.position.y
        for (const o of obstacles) {
          if (o.position.x === tx && o.position.y === ty) continue
          const t = Math.max(0, Math.min(1, ((o.position.x - x) * (tx - x) + (o.position.y - y) * (ty - y)) / (back * back)))
          if (t <= 0.05 || t >= 0.95) continue
          const px = x + t * (tx - x), py = y + t * (ty - y)
          const dLine = Math.hypot(o.position.x - px, o.position.y - py)
          const halfW = Math.max(o.size[0], o.size[1]) / 2
          if (dLine < halfW + 25) blocked += 60
        }
      }
      const score = Math.min(clear, 70) + Math.min(back, 260) * 0.35 + areaBonus + heroBonus - blocked
      if (!global || score > global.score) {
        global = { x, y, look: target ? [target.position.x, target.position.y] : [cx, cy], score, room: r }
      }
    }
  }
  if (global) {
    // Hero window shot — if the winning room has a large picture window, open
    // the walk looking OUT of it over the furniture (the reference hero frame):
    // stand deep in the room on the far side, aim at the window centre.
    const wv = windowViewSpawn(global.room, floor.walls ?? [], clearance, inPoly)
    if (wv) return wv
    return { pos: [global.x, global.y], look: global.look }
  }
  return { pos: [floor.extent.width / 2, floor.extent.height / 2], look: [floor.extent.width / 2, 0] }
}

/**
 * If `room` has a large exterior window (a picture window), return a spawn deep
 * in the room aimed at the window centre — so the opening walk shot looks out
 * over the furniture toward the glass (and the night-city backdrop), matching
 * the reference hero. Returns null when there's no big window or no clear spot.
 */
function windowViewSpawn(
  room: Room,
  walls: Wall[],
  clearance: (x: number, y: number) => number,
  inPoly: (x: number, y: number, poly: Room['polygon']) => boolean,
): { pos: [number, number]; look: [number, number] } | null {
  let cx = 0, cy = 0
  for (const p of room.polygon) { cx += p.x; cy += p.y }
  cx /= room.polygon.length; cy /= room.polygon.length
  // A wall belongs to this room if its midpoint sits on a polygon edge.
  const onBoundary = (w: Wall) => {
    const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2
    for (let i = 0; i < room.polygon.length; i++) {
      const p = room.polygon[i], q = room.polygon[(i + 1) % room.polygon.length]
      const dx = q.x - p.x, dy = q.y - p.y
      const len2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((mx - p.x) * dx + (my - p.y) * dy) / len2))
      const px = p.x + t * dx, py = p.y + t * dy
      if (Math.hypot(px - mx, py - my) < 18) return true
    }
    return false
  }
  // Prefer the biggest window on the room boundary.
  const windows = walls
    .filter((w) => w.subtype === 'window' && ((w.openingWidth ?? 0) >= 200 || (w.openingHeight ?? 0) >= 180) && onBoundary(w))
    .sort((a, b) => (b.openingWidth ?? 0) - (a.openingWidth ?? 0))
  if (windows.length === 0) return null
  const w = windows[0]
  const wc = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }
  // Inward normal (perpendicular to the wall, pointing to the room centroid).
  const wdx = w.b.x - w.a.x, wdy = w.b.y - w.a.y
  const wlen = Math.hypot(wdx, wdy) || 1
  let nx = -wdy / wlen, ny = wdx / wlen
  if ((cx - wc.x) * nx + (cy - wc.y) * ny < 0) { nx = -nx; ny = -ny }
  // March from deep in the room back toward the window; take the deepest clear,
  // in-room spot so the whole room composes in front of the glass.
  for (let d = 460; d >= 130; d -= 25) {
    const px = wc.x + nx * d, py = wc.y + ny * d
    if (!inPoly(px, py, room.polygon)) continue
    if (clearance(px, py) < 38) continue
    return { pos: [px, py], look: [wc.x + nx * 6, wc.y + ny * 6] }
  }
  return null
}

function WalkController({ floor }: { floor: { rooms: Room[]; furniture: PlacedFurniture[]; walls?: Wall[]; extent: { width: number; height: number } } }) {
  const { camera, gl } = useThree()
  const keysRef = useRef<Record<string, boolean>>({})
  const touch = useMemo(() => isCoarsePointer(), [])
  const euler = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const extent = floor.extent
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current[e.code] = true }
    const up   = (e: KeyboardEvent) => { keysRef.current[e.code] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    // Spawn at a furniture-clear point, eye height, facing the room's hero piece
    const spawn = pickWalkSpawn(floor)
    camera.position.set(M(spawn.pos[0]), 1.65, M(spawn.pos[1]))
    camera.lookAt(M(spawn.look[0]), 1.1, M(spawn.look[1]))
    euler.current.setFromQuaternion(camera.quaternion)
    // Wide interior lens — the dollhouse's 42° reads like a telephoto in a
    // closet at eye level; interior tours shoot wide (~66°). Restored on exit.
    const persp = camera as THREE.PerspectiveCamera
    const prevFov = persp.fov
    persp.fov = 66
    persp.updateProjectionMatrix()

    // ── Touch look: one finger on the right side of the screen drags to look ──
    const el = gl.domElement
    let lookId: number | null = null
    let lastX = 0, lastY = 0
    const sens = 0.0042
    const onStart = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (lookId === null && t.clientX > window.innerWidth * 0.4) {
          lookId = t.identifier; lastX = t.clientX; lastY = t.clientY
        }
      }
    }
    const onMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === lookId) {
          euler.current.y -= (t.clientX - lastX) * sens
          euler.current.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, euler.current.x - (t.clientY - lastY) * sens))
          lastX = t.clientX; lastY = t.clientY
          camera.quaternion.setFromEuler(euler.current)
          e.preventDefault()
        }
      }
    }
    const onEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookId = null
    }
    if (touch) {
      el.addEventListener('touchstart', onStart, { passive: false })
      el.addEventListener('touchmove', onMove, { passive: false })
      el.addEventListener('touchend', onEnd)
      el.addEventListener('touchcancel', onEnd)
    }
    return () => {
      persp.fov = prevFov
      persp.updateProjectionMatrix()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup',   up)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      walkInput.mx = 0; walkInput.mz = 0
    }
  }, [camera, gl, floor, extent, touch])
  useFrame((_, dt) => {
    const speed = 2.4 // m/sec
    const k = keysRef.current
    const dir = new THREE.Vector3()
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    forward.y = 0
    forward.normalize()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0))
    if (k['KeyW'] || k['ArrowUp'])    dir.add(forward)
    if (k['KeyS'] || k['ArrowDown'])  dir.sub(forward)
    if (k['KeyD'] || k['ArrowRight']) dir.add(right)
    if (k['KeyA'] || k['ArrowLeft'])  dir.sub(right)
    // Mobile joystick (camera-relative)
    if (walkInput.mz !== 0) dir.add(forward.clone().multiplyScalar(walkInput.mz))
    if (walkInput.mx !== 0) dir.add(right.clone().multiplyScalar(walkInput.mx))
    if (dir.lengthSq() > 0) {
      dir.normalize().multiplyScalar(speed * dt)
      camera.position.x += dir.x
      camera.position.z += dir.z
      // Clamp to floor extent + a little margin
      const wM = M(extent.width), hM = M(extent.height)
      camera.position.x = Math.max(0.3, Math.min(wM - 0.3, camera.position.x))
      camera.position.z = Math.max(0.3, Math.min(hM - 0.3, camera.position.z))
      // Lock eye height
      camera.position.y = 1.65
    }
  })
  // Touch devices use the custom drag-look above; mouse devices use pointer lock.
  return touch ? null : <PointerLockControls />
}

/** On-screen movement joystick for Walk-Mode on touch devices (bottom-left). */
function WalkJoystick() {
  const baseRef = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const update = (e: ReactTouchEvent) => {
    const base = baseRef.current
    if (!base) return
    const r = base.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const t = e.touches[0]
    let dx = t.clientX - cx, dy = t.clientY - cy
    const max = r.width / 2
    const len = Math.hypot(dx, dy)
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max }
    setKnob({ x: dx, y: dy })
    walkInput.mx = dx / max
    walkInput.mz = -dy / max // pushing up walks forward
  }
  const end = () => { setKnob({ x: 0, y: 0 }); walkInput.mx = 0; walkInput.mz = 0 }
  return (
    <div
      ref={baseRef}
      onTouchStart={update}
      onTouchMove={update}
      onTouchEnd={end}
      onTouchCancel={end}
      className="absolute bottom-6 left-6 z-20 w-28 h-28 rounded-full touch-none select-none"
      style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.25)' }}
      aria-label="Bewegung"
    >
      <div
        className="absolute top-1/2 left-1/2 w-12 h-12 rounded-full"
        style={{ background: 'rgba(255,255,255,0.85)', transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`, transition: knob.x === 0 && knob.y === 0 ? 'transform 0.15s ease' : 'none' }}
      />
    </div>
  )
}

function FloorPlane({ width, height, variant }: {
  width: number; height: number; variant: FloorVariant;
}) {
  const wM = M(width), hM = M(height)
  const mat = useMemo(() => MAT.floorByType(variant), [variant])
  // The plank/tile seams now come from the material's own colour + normal map
  // (real grain, not a faked light-grey grid overlay), so the floor reads as a
  // continuous archviz surface instead of a tiled checkerboard.
  return (
    <group position={[wM / 2, 0, hM / 2]}>
      {/* Main floor — receives shadows; polygonOffset already set on the material */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={mat}>
        <planeGeometry args={[wM, hM]} />
      </mesh>
      {/* Dark base plinth — the dollhouse sits on an anthracite slab, matching
          the shell caps/cladding (reference display-case look). */}
      <mesh position={[0, -0.065, 0]} material={MAT.shellDark()}>
        <boxGeometry args={[wM + 0.24, 0.13, hM + 0.24]} />
      </mesh>
    </group>
  )
}

/**
 * Cove lighting — the reference's signature warm glow line: an emissive LED
 * strip tucked along the top interior edge of every room's walls, tracing the
 * room polygon just below the (missing) ceiling.
 *
 * Strips only. The warm wash that spills onto the walls is a real point light,
 * and every interior point light now comes from `LightRig`'s fixed pool — see
 * that module for why an unbounded per-room light count was the frame budget.
 */
const COVE_H = 232          // cm — just below the 250 cm wall top
const COVE_INSET = 9        // cm — tuck it inside the wall face
function CoveLighting({ rooms }: { rooms: Room[] }) {
  const tier = readTier()
  if (tier === 'off') return null
  const indoor = rooms.filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)

  return (
    <>
      {indoor.map((r) => {
        // Room centroid — used to inset each edge strip toward the interior.
        let cx = 0, cy = 0
        for (const p of r.polygon) { cx += p.x; cy += p.y }
        cx /= r.polygon.length; cy /= r.polygon.length

        const strips: React.ReactNode[] = []
        for (let i = 0; i < r.polygon.length; i++) {
          const p = r.polygon[i]
          const q = r.polygon[(i + 1) % r.polygon.length]
          const dx = q.x - p.x, dy = q.y - p.y
          const len = Math.hypot(dx, dy)
          if (len < 40) continue
          const ux = dx / len, uy = dy / len
          const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2
          // Inward normal (toward centroid) — pick the perpendicular that
          // points to the room interior.
          let nx = -uy, ny = ux
          if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny }
          const sx = mx + nx * COVE_INSET
          const sy = my + ny * COVE_INSET
          const angle = Math.atan2(dy, dx)
          strips.push(
            <mesh key={`cs-${r.id}-${i}`} position={[M(sx), M(COVE_H), M(sy)]} rotation={[0, -angle, 0]}>
              <boxGeometry args={[M(len - 12), 0.022, 0.04]} />
              {/* Tone-mapped and moderate — the reference's cove reads as a calm
                  amber accent line, never a blown-white tube. */}
              <meshStandardMaterial color="#ffd9a4" emissive="#ffab5e" emissiveIntensity={1.35} />
            </mesh>,
          )
        }

        return <group key={`cove-${r.id}`}>{strips}</group>
      })}
    </>
  )
}

/**
 * Recessed ceiling downlight *fixtures* — the small emissive disc that marks the
 * luminaire where the ceiling is visible (walk mode only; in the dollhouse view
 * there is no ceiling to recess them into).
 *
 * The warm pool of light itself is a point light and comes from `LightRig`'s
 * fixed pool, which is what keeps the per-fragment light count bounded.
 */
function RoomDownlights({ rooms, walkMode }: { rooms: Room[]; walkMode: boolean }) {
  const tier = readTier()
  if (tier === 'off' || !walkMode) return null
  const indoor = rooms.filter((r: Room) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)
  return (
    <>
      {indoor.map((r: Room) => {
        let cx = 0, cy = 0
        for (const p of r.polygon) { cx += p.x; cy += p.y }
        cx /= r.polygon.length; cy /= r.polygon.length
        return (
          <mesh key={`dl-${r.id}`} position={[M(cx), M(248), M(cy)]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.05, 20]} />
            <meshStandardMaterial color="#fff2dc" emissive="#ffdcb0" emissiveIntensity={2.2} />
          </mesh>
        )
      })}
    </>
  )
}

/**
 * Procedural night-city panorama — a dark skyline with lit windows, drawn once
 * to a canvas and cached. Used as an unlit backdrop cylinder so the through-
 * window views (and the space around the dollhouse) read as a real apartment
 * at night instead of black void — the reference hero's city-at-night look.
 */
/**
 * Perforated speaker-grille texture — a dark fabric-metal with a fine regular
 * dot grid (the acoustic holes), drawn once and cached. Applied to soundbars /
 * speakers so they read as real acoustic grilles, not flat black boxes.
 */
let _grilleTex: THREE.CanvasTexture | null = null
function speakerGrilleTexture(): THREE.CanvasTexture {
  if (_grilleTex) return _grilleTex
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = S; cv.height = S
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#171719'
  ctx.fillRect(0, 0, S, S)
  const step = 10, r = 2.3
  for (let y = step / 2; y < S; y += step) {
    for (let x = step / 2; x < S; x += step) {
      // slight per-hole brightness jitter so the grille isn't mechanically flat
      const b = 34 + Math.floor(Math.random() * 10)
      ctx.fillStyle = `rgb(${b},${b},${b + 2})`
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  _grilleTex = tex
  return tex
}
/** Cached soundbar grille material (built once, repeat baked for a long bar). */
let _grilleMat: THREE.MeshStandardMaterial | null = null
function sonosGrilleMat(): THREE.MeshStandardMaterial {
  if (_grilleMat) return _grilleMat
  const map = speakerGrilleTexture().clone()
  map.needsUpdate = true
  map.repeat.set(46, 3)
  _grilleMat = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.15, color: '#2a2a2d' })
  return _grilleMat
}
/** Cached Echo-Dot fabric material (acoustic mesh wrap, built once). */
let _echoFabricMat: THREE.MeshStandardMaterial | null = null
function echoFabricMat(): THREE.MeshStandardMaterial {
  if (_echoFabricMat) return _echoFabricMat
  const map = speakerGrilleTexture().clone()
  map.needsUpdate = true
  map.repeat.set(6, 4)
  _echoFabricMat = new THREE.MeshStandardMaterial({ map, color: '#3a3d42', roughness: 0.95, metalness: 0.0 })
  return _echoFabricMat
}

/**
 * Procedural ceramic-tile texture with real grout lines — a grid of glossy
 * off-white tiles separated by recessed grout, drawn once and cached. Used for
 * the kitchen backsplash so walls read as real tiled surfaces (Fugen), not flat
 * panels. Copyright-free (pure canvas).
 */
let _tileTex: THREE.CanvasTexture | null = null
let _tileBump: THREE.CanvasTexture | null = null
function ensureTileTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (_tileTex && _tileBump) return { map: _tileTex, bump: _tileBump }
  const S = 512, tiles = 4, gap = 10
  const cell = S / tiles
  // Colour map
  const cv = document.createElement('canvas'); cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#877f73'; ctx.fillRect(0, 0, S, S)               // grout (visible from distance)
  // Bump map (grout dark = recessed)
  const bv = document.createElement('canvas'); bv.width = bv.height = S
  const bx = bv.getContext('2d')!
  bx.fillStyle = '#000000'; bx.fillRect(0, 0, S, S)                  // grout = low
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const x = tx * cell + gap / 2, y = ty * cell + gap / 2, w = cell - gap
      const shade = 236 + Math.floor(Math.random() * 12)
      ctx.fillStyle = `rgb(${shade},${shade - 2},${shade - 6})`
      ctx.fillRect(x, y, w, w)
      // subtle glossy highlight streak
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(x, y, w, w * 0.32)
      bx.fillStyle = '#ffffff'                                       // tile = high
      bx.fillRect(x, y, w, w)
    }
  }
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    return t
  }
  _tileTex = mk(cv, true)
  _tileBump = mk(bv, false)
  return { map: _tileTex, bump: _tileBump }
}
let _tileMat: THREE.MeshStandardMaterial | null = null
function kitchenTileMat(): THREE.MeshStandardMaterial {
  if (_tileMat) return _tileMat
  const { map, bump } = ensureTileTextures()
  const m = map.clone(); m.needsUpdate = true; m.repeat.set(9, 2)
  const b = bump.clone(); b.needsUpdate = true; b.repeat.set(9, 2)
  _tileMat = new THREE.MeshStandardMaterial({
    map: m, bumpMap: b, bumpScale: 0.004, roughness: 0.35, metalness: 0.0, color: '#f2efe9',
  })
  return _tileMat
}
/** Floor-tile material — large matte porcelain floor tiles with grout, repeat
 *  tuned so tiles read at ~30 cm across the demo floor. */
let _floorTileMat: THREE.MeshStandardMaterial | null = null
function floorTileMat(): THREE.MeshStandardMaterial {
  if (_floorTileMat) return _floorTileMat
  const { map, bump } = ensureTileTextures()
  const m = map.clone(); m.needsUpdate = true; m.repeat.set(7, 5)
  const b = bump.clone(); b.needsUpdate = true; b.repeat.set(7, 5)
  _floorTileMat = new THREE.MeshStandardMaterial({
    map: m, bumpMap: b, bumpScale: 0.003, roughness: 0.42, metalness: 0.0, color: '#e9e6df',
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  })
  return _floorTileMat
}
/** Bathroom tile material — same tiles, repeat tuned for a taller wall panel. */
let _bathTileMat: THREE.MeshStandardMaterial | null = null
function bathTileMat(): THREE.MeshStandardMaterial {
  if (_bathTileMat) return _bathTileMat
  const { map, bump } = ensureTileTextures()
  const m = map.clone(); m.needsUpdate = true; m.repeat.set(5, 6)
  const b = bump.clone(); b.needsUpdate = true; b.repeat.set(5, 6)
  _bathTileMat = new THREE.MeshStandardMaterial({
    map: m, bumpMap: b, bumpScale: 0.004, roughness: 0.3, metalness: 0.0, color: '#eef0ef',
  })
  return _bathTileMat
}

/* ─── Procedural exterior textures ────────────────────────────────────────
 * Canvas-generated, seamless-tiling maps for the neighbourhood + the own-house
 * shell (Klinker brick, Ziegel roof tiles, asphalt, concrete pavers, lawn).
 * One texture each, shared across every mesh, cached module-side. Colour maps
 * are sRGB; bump maps stay linear. */
function _mkTex(cv: HTMLCanvasElement, srgb: boolean, rep: [number, number] = [1, 1]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rep[0], rep[1])
  // Max anisotropic filtering — the renderer clamps to the GPU limit. Keeps
  // floors, walls and roofs crisp at grazing angles instead of blurring out.
  t.anisotropy = 16
  return t
}
// Deterministic PRNG so textures are stable across reloads (no reflow flicker).
function _texRnd(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

let _brickTex: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null
function brickTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (_brickTex) return _brickTex
  const W = 512, H = 512, rows = 13, bh = H / rows, mortar = 3
  const rnd = _texRnd(7)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#5f5148'; cx.fillRect(0, 0, W, H)          // mortar joint
  bx.fillStyle = '#3a3a3a'; bx.fillRect(0, 0, W, H)          // mortar = recessed
  const bw = W / 4
  for (let r = 0; r < rows; r++) {
    const y = r * bh
    const off = (r % 2) * (bw / 2)                            // running bond
    for (let c = -1; c < 5; c++) {
      const x = c * bw + off
      // Klinker reddish-brown with per-brick variation (some darker sinter bricks)
      const base = rnd()
      const rr = 120 + Math.floor(base * 40), gg = 60 + Math.floor(base * 26), bb = 46 + Math.floor(base * 20)
      cx.fillStyle = `rgb(${rr},${gg},${bb})`
      cx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar)
      // subtle top highlight + speckle
      cx.fillStyle = 'rgba(255,236,220,0.05)'
      cx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, (bh - mortar) * 0.4)
      for (let s = 0; s < 5; s++) { cx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`; cx.fillRect(x + mortar + rnd() * (bw - mortar * 2), y + mortar + rnd() * (bh - mortar * 2), 2, 2) }
      bx.fillStyle = `rgb(${205 + Math.floor(base * 40)},${205 + Math.floor(base * 40)},${205 + Math.floor(base * 40)})`
      bx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar)
    }
  }
  _brickTex = { map: _mkTex(cv, true), bump: _mkTex(bv, false) }
  return _brickTex
}

// Vertical timber cladding (Holzverschalung) — warm planks with grain streaks
// and recessed grooves between boards, for the 'board' facade construction.
let _boardTex: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null
function boardTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (_boardTex) return _boardTex
  const W = 512, H = 512, planks = 6, pw = W / planks
  const rnd = _texRnd(23)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#6b4a2c'; cx.fillRect(0, 0, W, H)
  bx.fillStyle = '#8a8a8a'; bx.fillRect(0, 0, W, H)
  for (let p = 0; p < planks; p++) {
    const x = p * pw
    const base = 0.82 + rnd() * 0.3
    const rr = Math.floor(120 * base), gg = Math.floor(82 * base), bb = Math.floor(48 * base)
    cx.fillStyle = `rgb(${rr},${gg},${bb})`
    cx.fillRect(x + 1, 0, pw - 2, H)
    // grain streaks
    for (let g = 0; g < 22; g++) {
      cx.strokeStyle = `rgba(${rr - 30},${gg - 22},${bb - 16},${0.18 + rnd() * 0.22})`
      cx.lineWidth = 0.6 + rnd()
      cx.beginPath()
      const gx = x + 2 + rnd() * (pw - 4)
      cx.moveTo(gx, 0); cx.bezierCurveTo(gx + (rnd() - 0.5) * 6, H / 3, gx + (rnd() - 0.5) * 6, (2 * H) / 3, gx + (rnd() - 0.5) * 4, H)
      cx.stroke()
    }
    // plank body slightly raised, grooves recessed (bump)
    bx.fillStyle = `rgb(${185 + Math.floor(base * 30)},${185 + Math.floor(base * 30)},${185 + Math.floor(base * 30)})`
    bx.fillRect(x + 2, 0, pw - 4, H)
    bx.fillStyle = '#2a2a2a'; bx.fillRect(x, 0, 2, H)
  }
  _boardTex = { map: _mkTex(cv, true), bump: _mkTex(bv, false) }
  return _boardTex
}

let _roofTex: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null
function roofTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (_roofTex) return _roofTex
  const W = 512, H = 512, rows = 16, rh = H / rows
  const rnd = _texRnd(23)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#1c1917'; cx.fillRect(0, 0, W, H)
  bx.fillStyle = '#202020'; bx.fillRect(0, 0, W, H)
  const tw = W / 8
  for (let r = 0; r < rows; r++) {
    const y = r * rh
    const off = (r % 2) * (tw / 2)
    for (let c = -1; c < 9; c++) {
      const x = c * tw + off
      const sh = 34 + Math.floor(rnd() * 18)
      cx.fillStyle = `rgb(${sh},${sh - 4},${sh - 6})`
      cx.fillRect(x + 1, y + 1, tw - 2, rh - 1)
      // rounded pantile highlight along the top of each course
      cx.fillStyle = 'rgba(255,255,255,0.06)'
      cx.fillRect(x + 1, y + 1, tw - 2, rh * 0.34)
      cx.fillStyle = 'rgba(0,0,0,0.4)'
      cx.fillRect(x, y + rh - 2, tw, 2)                       // shadow lip between courses
      bx.fillStyle = `rgb(${150 + Math.floor(rnd() * 40)},${150},${150})`
      bx.fillRect(x + 1, y + 1, tw - 2, rh - 2)
    }
  }
  _roofTex = { map: _mkTex(cv, true), bump: _mkTex(bv, false) }
  return _roofTex
}

let _asphaltTex: THREE.CanvasTexture | null = null
function asphaltTexture(): THREE.CanvasTexture {
  if (_asphaltTex) return _asphaltTex
  const W = 256, H = 256, rnd = _texRnd(41)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#57565a'; cx.fillRect(0, 0, W, H)
  for (let i = 0; i < 9000; i++) {
    const g = rnd()
    cx.fillStyle = g < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.25})` : `rgba(210,210,214,${0.04 + rnd() * 0.14})`
    cx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5)
  }
  _asphaltTex = _mkTex(cv, true)
  return _asphaltTex
}

let _paverTex: { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } | null = null
function paverTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  if (_paverTex) return _paverTex
  const W = 256, H = 256, n = 4, cell = W / n, rnd = _texRnd(59)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#6d685f'; cx.fillRect(0, 0, W, H)          // joint sand
  bx.fillStyle = '#404040'; bx.fillRect(0, 0, W, H)
  for (let ry = 0; ry < n; ry++) for (let rx = 0; rx < n; rx++) {
    const off = (ry % 2) * (cell / 2)
    const x = rx * cell + off, y = ry * cell, g = 150 + Math.floor(rnd() * 26)
    cx.fillStyle = `rgb(${g},${g - 4},${g - 12})`
    cx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3)
    for (let s = 0; s < 12; s++) { cx.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; cx.fillRect(x + rnd() * cell, y + rnd() * cell, 2, 2) }
    bx.fillStyle = '#d0d0d0'; bx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3)
  }
  _paverTex = { map: _mkTex(cv, true), bump: _mkTex(bv, false) }
  return _paverTex
}

let _grassTex: THREE.CanvasTexture | null = null
function grassTexture(): THREE.CanvasTexture {
  if (_grassTex) return _grassTex
  const W = 256, H = 256, rnd = _texRnd(83)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#6a7150'; cx.fillRect(0, 0, W, H)
  // Mowing stripes — faint alternating bands so lawns read manicured.
  const band = W / 8
  for (let b = 0; b < 8; b++) {
    cx.fillStyle = b % 2 === 0 ? 'rgba(255,255,238,0.05)' : 'rgba(10,26,6,0.06)'
    cx.fillRect(b * band, 0, band, H)
  }
  for (let i = 0; i < 14000; i++) {
    const t = rnd()
    const r = 90 + Math.floor(t * 40), g = 108 + Math.floor(t * 46), b = 62 + Math.floor(t * 30)
    cx.fillStyle = `rgba(${r},${g},${b},${0.5})`
    cx.fillRect(rnd() * W, rnd() * H, 1, 1 + rnd() * 3)       // short vertical blades
  }
  _grassTex = _mkTex(cv, true)
  return _grassTex
}

let _cityTex: THREE.CanvasTexture | null = null
function nightCityTexture(): THREE.CanvasTexture {
  if (_cityTex) return _cityTex
  const W = 2048, H = 512
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  // Sky gradient: deep navy at the top → warmer haze at the horizon band.
  const HORIZON = Math.round(H * 0.52)
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#070b16')
  sky.addColorStop(0.7, '#0e1626')
  sky.addColorStop(1, '#20283c')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, HORIZON)
  // Below the horizon: darker ground haze.
  const grd = ctx.createLinearGradient(0, HORIZON, 0, H)
  grd.addColorStop(0, '#161d2c')
  grd.addColorStop(1, '#05080f')
  ctx.fillStyle = grd
  ctx.fillRect(0, HORIZON, W, H - HORIZON)
  // Warm horizon glow band.
  const glow = ctx.createLinearGradient(0, HORIZON - 60, 0, HORIZON + 30)
  glow.addColorStop(0, 'rgba(255,180,120,0)')
  glow.addColorStop(0.6, 'rgba(255,170,110,0.14)')
  glow.addColorStop(1, 'rgba(255,150,90,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, HORIZON - 60, W, 90)
  // Building silhouettes rising from the horizon, with lit windows.
  let seed = 20260704
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let x = 0
  while (x < W) {
    const bw = 40 + Math.floor(rnd() * 120)
    const bh = 60 + Math.floor(rnd() * 230)
    const top = HORIZON - bh
    // Silhouette body — near black with a faint cool tint.
    ctx.fillStyle = `rgb(${8 + Math.floor(rnd() * 8)},${12 + Math.floor(rnd() * 8)},${20 + Math.floor(rnd() * 10)})`
    ctx.fillRect(x, top, bw - 3, bh)
    // Window grid — warm and a few cool lit cells, sparse.
    const cols = Math.max(2, Math.floor(bw / 16))
    const rows = Math.max(3, Math.floor(bh / 20))
    for (let cxk = 0; cxk < cols; cxk++) {
      for (let ry = 0; ry < rows; ry++) {
        if (rnd() > 0.34) continue
        const wx = x + 5 + cxk * ((bw - 10) / cols)
        const wy = top + 6 + ry * ((bh - 10) / rows)
        const warm = rnd() > 0.25
        ctx.fillStyle = warm
          ? `rgba(255,${200 + Math.floor(rnd() * 40)},${140 + Math.floor(rnd() * 60)},${0.55 + rnd() * 0.4})`
          : `rgba(${170 + Math.floor(rnd() * 40)},${205 + Math.floor(rnd() * 40)},255,${0.4 + rnd() * 0.35})`
        ctx.fillRect(wx, wy, 3 + rnd() * 3, 4 + rnd() * 3)
      }
    }
    x += bw
  }
  // Scattered stars in the upper sky.
  for (let i = 0; i < 200; i++) {
    const sx = rnd() * W, sy = rnd() * (HORIZON - 80)
    ctx.fillStyle = `rgba(200,215,255,${0.15 + rnd() * 0.35})`
    ctx.fillRect(sx, sy, 1.5, 1.5)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  _cityTex = tex
  return tex
}

/**
 * City-at-night backdrop — an unlit inward cylinder wrapping the whole scene.
 * Only shown in the evening/night phases (where a black void reads worst).
 * Unlit (MeshBasicMaterial) so the city glows on its own like distant lights.
 */
function CityBackdrop({ span, cx, cz, daylightScale }: { span: number; cx: number; cz: number; daylightScale: number }) {
  const tex = useMemo(() => nightCityTexture(), [])
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const radius = Math.max(span * 2.6, 26)
  const cylH = Math.max(span * 2.2, 22)
  // Distant city glow fades IN as the surroundings darken, instead of snapping
  // on at the dusk border. Full by deep night (scale ≈ 0.07), gone before
  // golden hour (scale ≥ 0.5) — the same continuous exterior factor the rest of
  // the world dims on, so the whole night transition reads as one smooth dissolve.
  const opacity = Math.max(0, Math.min(1, (0.5 - daylightScale) / 0.44))
  useEffect(() => { if (matRef.current) matRef.current.opacity = opacity }, [opacity])
  if (opacity <= 0.001) return null
  return (
    <mesh position={[cx, 2, cz]} rotation={[0, 0, 0]}>
      <cylinderGeometry args={[radius, radius, cylH, 48, 1, true]} />
      <meshBasicMaterial ref={matRef} map={tex} side={THREE.BackSide} fog={false} toneMapped={false} depthWrite={false} transparent opacity={opacity} />
    </mesh>
  )
}

/**
 * Interior-lighting character, chosen by the user. The palettes themselves and
 * the environment map they feed live in `SkyEnvironment`; re-exported here
 * because the toolbar below is what drives them.
 */
export type { EnvPreset } from './SkyEnvironment'
export const ENV_PRESET_LABEL: Record<EnvPreset, string> = {
  studio: 'Studio', warm: 'Warm', cool: 'Kühl', dramatic: 'Dramatisch',
}
/**
 * Frames the whole dollhouse on mount, relative to the plan's size, from a
 * pleasant elevated 3/4 angle (the reference archviz view) — instead of a fixed
 * absolute camera that lands zoomed into a corner on any plan but the original.
 * Runs once per mount so it never fights the user's orbiting.
 */
function CameraFit({ wM, hM, cx, cz }: { wM: number; hM: number; cx: number; cz: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; enabled: boolean; update: () => void } | null
  const fitted = useRef(false)
  // Cinematic intro fly-in: start pulled further back + higher and orbited a
  // touch, then ease into the framed 3/4 look. Reveals the model like a pro
  // archviz tool instead of snapping into place.
  const intro = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; target: THREE.Vector3; t: number } | null>(null)
  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    const span = Math.max(wM, hM)
    const D = span * 1.32
    const horiz = (D * 0.66) / Math.SQRT2
    const target = new THREE.Vector3(cx, 0.2, cz)
    const toPos = new THREE.Vector3(cx + horiz, D * 0.78, cz + horiz)
    // Start: 1.35× further out, higher, and rotated ~18° around the target.
    const ang = Math.atan2(horiz, horiz) + 0.32
    const r = Math.hypot(horiz, horiz) * 1.35
    const fromPos = new THREE.Vector3(cx + Math.cos(ang) * r, D * 1.02, cz + Math.sin(ang) * r)
    camera.position.copy(fromPos)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    if (controls) { controls.target.copy(target); controls.enabled = false; controls.update() }
    intro.current = { fromPos, toPos, target, t: 0 }
  }, [camera, controls, wM, hM, cx, cz])
  useFrame((_, dt) => {
    const a = intro.current
    if (!a) return
    a.t = Math.min(1, a.t + dt / 1.15)
    const e = easeInOutCubic(a.t)
    camera.position.lerpVectors(a.fromPos, a.toPos, e)
    camera.lookAt(a.target)
    if (controls) { controls.target.copy(a.target); controls.update() }
    if (a.t >= 1) { intro.current = null; if (controls) controls.enabled = true }
  })
  return null
}

// ── Cinematic camera presets ──────────────────────────────────────────
export type CamPreset = 'persp' | 'corner' | 'top' | 'front'
const CAM_PRESET_LABEL: Record<CamPreset, string> = {
  persp: 'Perspektive', corner: 'Ecke', top: 'Draufsicht', front: 'Front',
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function presetPose(preset: CamPreset, frame: { cx: number; cz: number; span: number }): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const { cx, cz, span } = frame
  const D = span * 1.32
  const horiz = (D * 0.66) / Math.SQRT2
  const target = new THREE.Vector3(cx, 0.2, cz)
  switch (preset) {
    case 'top':    return { pos: new THREE.Vector3(cx + 0.01, D * 1.4, cz), target }
    // Front stays INSIDE the street gap — D*1.08 parked the camera in the
    // neighbour row across the street (a black frame of backfaces).
    case 'front':  return { pos: new THREE.Vector3(cx, D * 0.85, cz + D * 0.7), target }
    case 'corner': return { pos: new THREE.Vector3(cx - horiz, D * 0.72, cz + horiz), target }
    case 'persp':
    default:       return { pos: new THREE.Vector3(cx + horiz, D * 0.78, cz + horiz), target }
  }
}

function easeInOutQuint(t: number): number {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2
}
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

// ── Cinematic flight system ───────────────────────────────────────────
// Every camera move is a FLIGHT along an eased spline — never a jump. Three
// kinds: a preset pose, a glide INTO a selected room (AAA dolly-in), and the
// Kino-Tour: a product-video style steadicam pass through every room that can
// also be recorded straight to a .webm.
export type FlightReq =
  | { kind: 'preset'; preset: CamPreset; nonce: number }
  | { kind: 'room'; roomId: string; nonce: number }
  | { kind: 'tour'; nonce: number }

interface TourHud { title: HTMLElement | null; bar: HTMLElement | null }

function roomCentroid(r: Room): { x: number; z: number } {
  let x = 0, z = 0
  for (const p of r.polygon) { x += p.x; z += p.y }
  return { x: M(x / r.polygon.length), z: M(z / r.polygon.length) }
}

/** Interior eye-level pose for a room: the camera lands INSIDE the room —
 *  pulled back toward where it came from — looking at the room's heart. */
function roomPose(room: Room, camPos: THREE.Vector3): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const c = roomCentroid(room)
  const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.y)
  const spanR = Math.max(M(Math.max(...xs) - Math.min(...xs)), M(Math.max(...zs) - Math.min(...zs)))
  const dir = new THREE.Vector3(camPos.x - c.x, 0, camPos.z - c.z)
  if (dir.lengthSq() < 1e-4) dir.set(1, 0, 1)
  dir.normalize()
  const back = Math.min(Math.max(spanR * 0.29, 0.7), 2.1)
  return {
    pos: new THREE.Vector3(c.x + dir.x * back, 1.45, c.z + dir.z * back),
    target: new THREE.Vector3(c.x, 0.95, c.z),
  }
}

/** Record the WebGL canvas to a downloadable .webm (product video on demand). */
function startCanvasRecording(canvas: HTMLCanvasElement): { stop: () => void } | null {
  if (typeof MediaRecorder === 'undefined' || !('captureStream' in canvas)) return null
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  if (!mime) return null
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 14_000_000 })
  const chunks: BlobPart[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  rec.onstop = () => {
    const url = URL.createObjectURL(new Blob(chunks, { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = `omega-tour-${Date.now()}.webm`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }
  rec.start(250)
  return { stop: () => { if (rec.state !== 'inactive') rec.stop() } }
}
const CAN_RECORD = typeof window !== 'undefined'
  && typeof MediaRecorder !== 'undefined'
  && typeof HTMLCanvasElement !== 'undefined'
  && 'captureStream' in HTMLCanvasElement.prototype

interface ActiveFlight {
  curve: THREE.CatmullRomCurve3
  tgtFrom: THREE.Vector3
  tgtTo?: THREE.Vector3
  lookAhead?: number
  duration: number
  t: number
  tour: boolean
  restoreFov?: number
}

/**
 * Shared camera-focus channel: the CinematicDirector writes where the story
 * looks and how hard to pull focus; `CinematicFocus` (the DOF driver) reads
 * it each frame. A plain mutable object — no React state at 60 fps.
 */
const cameraFocus = {
  point: new THREE.Vector3(0, 1, 0),
  /** 0 = ambient depth … 1 = full cinematic focus pull (mid-glide). */
  pull: 0,
}

/**
 * Contextual depth of field. At rest the focal plane sits exactly on the
 * orbit target (whatever the user frames is sharp); during a glide the
 * director pulls focus onto the destination and the bokeh swells, then the
 * landing relaxes back — the classic focus pull, never a static blur.
 */
// Foto-Look — swap the renderer tone-map at runtime. AgX (photographic) has a
// gentler highlight roll-off and truer colour than ACES; a one-time material
// recompile applies it. Off by default so the tuned "Brillant" (ACES) look is
// the baseline; the toggle is the opt-in maximum-photorealism path.
// Freezes a fully static subtree's world-matrix updates after first commit —
// the neighbourhood, house shell, terrace court and ghost floors never move,
// so skipping their per-frame matrix work saves real CPU on large scenes.
// Transforms only; materials (e.g. lit windows on phase change) still update.
function Static({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    const g = ref.current
    if (!g) return
    g.updateMatrixWorld(true)
    g.traverse((o) => { o.matrixWorldAutoUpdate = false })
    return () => { g.traverse((o) => { o.matrixWorldAutoUpdate = true }) }
  }, [children])
  return <group ref={ref}>{children}</group>
}

function ToneMapController({ photo }: { photo: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    gl.toneMapping = photo ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping
    gl.toneMappingExposure = photo ? 1.0 : 0.95
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material
      if (Array.isArray(m)) m.forEach((mm) => { mm.needsUpdate = true })
      else if (m) (m as THREE.Material).needsUpdate = true
    })
  }, [gl, scene, photo])
  return null
}

// One row of the Bau-Studio popover — chips (labelled) or colour dots.
function BauRow({ label, options, active, onPick, shape }: {
  label: string
  options: { id: string; label: string; swatch: string }[]
  active: string
  onPick: (id: string) => void
  shape: 'chip' | 'dot'
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-[color:var(--muted)]">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (shape === 'dot' ? (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            title={o.label}
            className={`h-5 w-5 rounded-full border transition-transform ${active === o.id ? 'scale-110 border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]' : 'border-[color:var(--border-strong)] hover:scale-105'}`}
            style={{ background: o.swatch }}
          />
        ) : (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors ${active === o.id ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white' : 'border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: o.swatch }} />{o.label}
          </button>
        )))}
      </div>
    </div>
  )
}

function CinematicFocus({ walkMode }: { walkMode: boolean }) {
  const fx = useRef<DepthOfFieldEffect>(null)
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3 } | null
  useFrame((_, dt) => {
    const eff = fx.current
    if (!eff || !eff.target) return
    const anchor = cameraFocus.pull > 0.02 || !controls?.target ? cameraFocus.point : controls.target
    eff.target.x = THREE.MathUtils.damp(eff.target.x, anchor.x, 7, dt)
    eff.target.y = THREE.MathUtils.damp(eff.target.y, anchor.y, 7, dt)
    eff.target.z = THREE.MathUtils.damp(eff.target.z, anchor.z, 7, dt)
    // Eye-level walking wants uniform sharpness — the bokeh breathes to zero.
    const scale = walkMode ? 0 : 1.2 + cameraFocus.pull * 2.2
    eff.bokehScale = THREE.MathUtils.damp(eff.bokehScale, scale, 5, dt)
  })
  return <DepthOfField ref={fx} target={[0, 1, 0]} focalLength={0.08} bokehScale={1.2} height={480} />
}

/** Flies the orbit camera like a AAA game: eased arcs to presets/rooms and the
 *  full Kino-Tour. Controls are paused during a flight and handed back after;
 *  any tap/drag or Esc cancels and returns control instantly. */
function CinematicDirector({ req, hud, onTourEnd }: {
  req: FlightReq | null
  hud: React.MutableRefObject<TourHud>
  onTourEnd: () => void
}) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; enabled: boolean; update: () => void } | null
  const controlsRef = useRef(controls); controlsRef.current = controls
  const onTourEndRef = useRef(onTourEnd); onTourEndRef.current = onTourEnd
  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo(() => doc?.floors.find((f) => f.id === doc?.activeFloorId), [doc])
  const frame = useMemo(() => {
    const w = M(floor?.extent.width ?? 1000), h = M(floor?.extent.height ?? 800)
    return { cx: w / 2, cz: h / 2, span: Math.max(w, h) }
  }, [floor])
  const flight = useRef<ActiveFlight | null>(null)
  const tourRooms = useRef<Array<{ name: string; x: number; z: number }>>([])
  const lastTitle = useRef('')

  const finish = (cancelled: boolean) => {
    const f = flight.current
    const wasTour = f?.tour
    if (f?.restoreFov !== undefined) {
      const persp = camera as THREE.PerspectiveCamera
      persp.fov = f.restoreFov
      persp.updateProjectionMatrix()
    }
    flight.current = null
    cameraFocus.pull = 0 // release the focus pull; ambient depth takes over
    const c = controlsRef.current
    if (c) { c.enabled = true; c.update() }
    if (wasTour) onTourEndRef.current()
    void cancelled
  }

  useEffect(() => {
    if (!req || !floor) return
    const fromPos = camera.position.clone()
    const fromTgt = controls?.target?.clone() ?? new THREE.Vector3(frame.cx, 0.2, frame.cz)
    if (controls) controls.enabled = false

    if (req.kind === 'tour') {
      // Route: start at the Flur/Eingang, then a nearest-neighbour chain
      // through the indoor rooms; outdoor zones (terrace) close the tour.
      const rooms = floor.rooms.filter((r) => r.polygon.length >= 3)
      const indoor = rooms.filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor')
      const outdoor = rooms.filter((r) => (r.zoneType ?? 'indoor') === 'outdoor')
      const pts = indoor.map((r) => ({ r, ...roomCentroid(r) }))
      if (!pts.length) return
      const startIdx = Math.max(0, pts.findIndex((p) => /flur|eingang|diele/i.test(p.r.name)))
      const route: typeof pts = []
      const left = [...pts]
      let cur = left.splice(startIdx, 1)[0]
      while (cur) {
        route.push(cur)
        if (!left.length) break
        let bi = 0, bd = Infinity
        left.forEach((p, i) => { const d = (p.x - cur.x) ** 2 + (p.z - cur.z) ** 2; if (d < bd) { bd = d; bi = i } })
        cur = left.splice(bi, 1)[0]
      }
      for (const o of outdoor) route.push({ r: o, ...roomCentroid(o) })

      // Waypoints: current pose → high establishing shot → dolphin path (eye
      // height inside each room, lifting over the walls between rooms) → a
      // slow pull-back reveal at the end.
      const est = presetPose('persp', frame)
      const way: THREE.Vector3[] = [fromPos.clone(), est.pos.clone()]
      route.forEach((p, i) => {
        if (i === 0) {
          way.push(new THREE.Vector3(p.x, 4.4, p.z))
        } else {
          const q = route[i - 1]
          way.push(new THREE.Vector3((p.x + q.x) / 2, 3.7, (p.z + q.z) / 2))
        }
        way.push(new THREE.Vector3(p.x, 1.5, p.z))
      })
      way.push(presetPose('corner', frame).pos.clone())
      const curve = new THREE.CatmullRomCurve3(way, false, 'centripetal', 0.5)
      const len = curve.getLength()
      tourRooms.current = route.map((p) => ({ name: p.r.name, x: p.x, z: p.z }))
      lastTitle.current = ''
      // Filmic compression for the walkthrough: a narrower FOV makes each room
      // read larger and more life-size as the steadicam passes through. Restored
      // in finish() (also on cancel/unmount).
      const persp = camera as THREE.PerspectiveCamera
      const prevFov = persp.fov
      persp.fov = 34
      persp.updateProjectionMatrix()
      flight.current = {
        curve,
        tgtFrom: fromTgt,
        lookAhead: Math.max(0.02, 1.1 / len),
        duration: Math.min(70, Math.max(22, len * 1.15)),
        t: 0,
        tour: true,
        restoreFov: prevFov,
      }
      return
    }

    // Single glide — preset pose or room fly-in, along a lifted arc so the
    // camera swoops instead of tracking a straight line.
    const pose = req.kind === 'preset'
      ? presetPose(req.preset, frame)
      : roomPose(floor.rooms.find((r) => r.id === req.roomId) ?? floor.rooms[0], fromPos)
    const dist = fromPos.distanceTo(pose.pos)
    const lift = Math.min(3.2, Math.max(0.25, dist * 0.22))
    const mid = fromPos.clone().lerp(pose.pos, 0.5); mid.y += lift
    const points = dist < 0.4 ? [fromPos, pose.pos] : [fromPos, mid, pose.pos]
    flight.current = {
      curve: new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5),
      tgtFrom: fromTgt,
      tgtTo: pose.target,
      duration: Math.min(3.0, Math.max(1.15, 0.7 + dist * 0.14)),
      t: 0,
      tour: false,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce])

  // A tap/drag on the canvas or Esc hands control straight back.
  useEffect(() => {
    const cancel = () => { if (flight.current) finish(true) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    const el = gl.domElement
    el.addEventListener('pointerdown', cancel)
    window.addEventListener('keydown', key)
    return () => { el.removeEventListener('pointerdown', cancel); window.removeEventListener('keydown', key) }
    // finish is intentionally omitted — listeners attach once per gl surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl])

  // Unmount safety (e.g. switching to walk mode mid-flight): re-enable
  // controls, restore any tour FOV, and close an active tour so the
  // HUD/recorder/FOV never leak.
  useEffect(() => () => {
    const f = flight.current
    if (f?.tour) onTourEndRef.current()
    if (f?.restoreFov !== undefined) {
      const persp = camera as THREE.PerspectiveCamera
      persp.fov = f.restoreFov
      persp.updateProjectionMatrix()
    }
    flight.current = null
    if (controlsRef.current) controlsRef.current.enabled = true
  }, [camera])

  useFrame((_, dt) => {
    const f = flight.current
    if (!f) return
    // Clamp the step: a jank spike (tab switch, shader compile) must stretch
    // the glide, never teleport it — choreography beats wall-clock accuracy.
    f.t = Math.min(1, f.t + Math.min(dt, 0.12) / f.duration)
    if (f.tour) {
      const u = easeInOutSine(f.t)
      const pos = f.curve.getPointAt(Math.min(u, 1))
      const look = f.curve.getPointAt(Math.min(1, u + (f.lookAhead ?? 0.03)))
      look.y = Math.min(look.y, 1.3)
      camera.position.copy(pos)
      camera.lookAt(look)
      if (controls) { controls.target.copy(look); controls.update() }
      // The tour keeps a steady, moderate focus on where the steadicam looks.
      cameraFocus.point.copy(look)
      cameraFocus.pull = 0.55
      // HUD — imperative DOM writes (no React re-renders at 60fps).
      const h = hud.current
      if (h.bar) h.bar.style.width = `${(f.t * 100).toFixed(1)}%`
      if (h.title) {
        let best = '', bd = 25
        for (const r of tourRooms.current) {
          const d = (r.x - pos.x) ** 2 + (r.z - pos.z) ** 2
          if (d < bd) { bd = d; best = r.name }
        }
        if (best !== lastTitle.current) { lastTitle.current = best; h.title.textContent = best }
      }
      if (f.t >= 1) finish(false)
      return
    }
    const e = easeInOutQuint(f.t)
    camera.position.copy(f.curve.getPointAt(e))
    const tgt = new THREE.Vector3().lerpVectors(f.tgtFrom, f.tgtTo ?? f.tgtFrom, e)
    camera.lookAt(tgt)
    if (controls) { controls.target.copy(tgt); controls.update() }
    // Focus pull: strongest mid-glide, relaxed again as the camera lands.
    cameraFocus.point.copy(tgt)
    cameraFocus.pull = Math.sin(Math.PI * f.t)
    if (f.t >= 1) finish(false)
  })
  return null
}

/**
 * Ceilings that FADE with walk mode instead of hard-mounting: entering the
 * apartment breathes the roof in over the head, leaving lets the dollhouse
 * open up softly — an alpha fade, never a cut. Materials are per-room clones
 * so the shared catalog materials never inherit transparency.
 */
function CeilingFade({ rooms, walkMode }: { rooms: Room[]; walkMode: boolean }) {
  const group = useRef<THREE.Group>(null)
  const level = useRef(walkMode ? 1 : 0)
  const items = useMemo(() =>
    rooms
      .filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)
      .map((r) => {
        const shape = new THREE.Shape()
        shape.moveTo(M(r.polygon[0].x), -M(r.polygon[0].y))
        for (let i = 1; i < r.polygon.length; i++) shape.lineTo(M(r.polygon[i].x), -M(r.polygon[i].y))
        shape.closePath()
        const material = matFromCatalog(resolveCeilingMaterial(r), { doubleSide: true }).clone()
        material.transparent = true
        material.opacity = level.current
        return { id: r.id, shape, material }
      }),
  [rooms])
  useEffect(() => () => { for (const it of items) it.material.dispose() }, [items])
  useFrame((_, dt) => {
    const target = walkMode ? 1 : 0
    if (Math.abs(level.current - target) < 0.002 && (level.current === 0 || level.current === 1)) return
    let next = THREE.MathUtils.damp(level.current, target, 5.5, dt)
    if (Math.abs(next - target) < 0.002) next = target
    level.current = next
    const g = group.current
    if (!g) return
    g.visible = next > 0.02
    for (const it of items) {
      it.material.opacity = next
      // Fully solid ceilings leave the transparency pipeline (correct depth).
      it.material.transparent = next < 0.999
    }
  })
  return (
    <group ref={group} visible={level.current > 0.02}>
      {items.map((it) => (
        <mesh key={`ceil-${it.id}`} position={[0, M(250), 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow material={it.material}>
          <shapeGeometry args={[it.shape]} />
        </mesh>
      ))}
    </group>
  )
}

/** Registers a screenshot capture fn on the shared ref. Grabs the composed
 *  (post-processed) frame straight from the preserved drawing buffer. */
function CaptureHelper({ captureRef }: { captureRef: React.MutableRefObject<(() => void) | undefined> }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    captureRef.current = () => {
      try {
        const url = gl.domElement.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = url
        a.download = `omega-atelier-${Date.now()}.png`
        a.click()
      } catch { /* toDataURL can throw on tainted canvases — ignore */ }
    }
    return () => { captureRef.current = undefined }
  }, [gl, captureRef])
  return null
}

// ─────────────────────────────────────────────────────────────────────
// Neubausiedlung — procedural modern new-build neighbourhood around the plan.
// Purely environmental: frames the dollhouse in a suburb, windows glow at
// dusk/night. Deterministic layout; materials disposed on unmount.
// ─────────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function Neighborhood({ wM, hM, cx, cz, phase, daylightScale }: {
  wM: number; hM: number; cx: number; cz: number; phase: DayPhase; daylightScale: number
}) {
  const built = useMemo(() => {
    const lit = phase === 'night' || phase === 'dusk' || phase === 'goldenHour'
    // Detail budget: fine garnish (flower beds, parasols, gutters, fence posts,
    // rear windows …) only on the high quality tier so weak GPUs keep the
    // silhouette-level scene and stay smooth.
    const rich = readTier() === 'high'
    // Night recession — the reference dollhouse floats in near-darkness. The
    // interior lights are shadowless and would keep painting the lawn, so the
    // exterior albedo itself follows the sky (cheaper and more reliable than
    // shadow-mapping every light). Lit windows, sconces and lamps stay warm.
    // The scale is the environment's single continuous exterior-albedo factor
    // (`exteriorLightScale`), so scrubbing the clock dims the surroundings
    // smoothly instead of stepping between per-phase buckets.
    // NOTE: multiplyScalar dims in LINEAR space — perceived brightness ~√K.
    const K = daylightScale
    const dimc = (c: string) => '#' + new THREE.Color(c).multiplyScalar(K).getHexString()
    const S = (c: string, rough = 0.9, metal = 0) => new THREE.MeshStandardMaterial({ color: dimc(c), roughness: rough, metalness: metal })
    // Foliage reads best faceted — flat shading gives crisp low-poly canopies.
    const F = (c: string) => new THREE.MeshStandardMaterial({ color: dimc(c), roughness: 1, flatShading: true })
    const m = {
      lawn:      S('#6f7551', 1),
      lawnFront: S('#69704b', 1),
      road:      S('#8b857a', 0.95),
      curb:      S('#8a4a38', 0.85),
      walk:      S('#9a948a', 0.95),
      dash:      S('#7d776c', 0.9),
      drive:     S('#8f8a80', 0.9),
      // Street polish — painted edge lines, zebra crossings, worn joints and
      // cast-iron drains/manholes that make the asphalt read as a real road.
      edgeLine:  S('#cfc9bb', 0.9),
      zebra:     S('#ddd8ca', 0.9),
      joint:     S('#7f7a70', 0.96),
      drain:     S('#2c2d31', 0.6, 0.45),
      manhole:   S('#3a3b40', 0.6, 0.5),
      mailbox:   S('#2b2c30', 0.5, 0.4),
      soil:      S('#453728', 1),
      roofDark:  new THREE.MeshStandardMaterial({ color: '#232327', roughness: 0.82, metalness: 0.06 }),
      roofTile:  S('#4a3f38', 0.85),
      roofWarm:  S('#33302f', 0.9),
      ridge:     S('#1e1b19', 0.75),
      gravel:    S('#9b968c', 1),
      solar:     new THREE.MeshStandardMaterial({ color: '#101623', roughness: 0.18, metalness: 0.5 }),
      solarFrame: S('#2e3138', 0.5, 0.4),
      dormer:    S('#565760', 0.7, 0.15),
      glassRail: new THREE.MeshPhysicalMaterial({ color: '#dfe4e6', roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.42 }),
      trim:      S('#e9e5dc', 0.9),
      plinth:    S('#3d3e42', 0.92),
      frame:     S('#2c2d31', 0.6, 0.1),
      sill:      S('#d8d3c8', 0.85),
      zinc:      S('#7b7f85', 0.45, 0.6),
      garage:    S('#c6c1b7', 0.7, 0.1),
      door:      S('#2a2b30', 0.55, 0.15),
      canopy:    S('#3a3b40', 0.7),
      rail:      new THREE.MeshStandardMaterial({ color: '#2a2b30', roughness: 0.5, metalness: 0.3 }),
      fence:     S('#e7e3da', 0.85),
      hedge:     F('#41522f'),
      hedgeTop:  F('#4c5e37'),
      chimney:   S('#4a4b50', 0.9),
      chimneyCap: S('#26272b', 0.6, 0.3),
      trunk:     S('#5b4632', 1),
      foliageA:  F('#4f6136'),
      foliageB:  F('#5c7040'),
      foliageC:  F('#647a44'),
      foliageD:  F('#7a6a3e'),
      carGlass:  new THREE.MeshStandardMaterial({ color: '#12151b', roughness: 0.12, metalness: 0.3 }),
      carHead:   S('#dfe6ee', 0.2, 0.6),
      carTail:   S('#6b1418', 0.3, 0.2),
      wheel:     S('#111214', 0.7),
      // Window glass in three night states — mixed lit/dim/dark windows make
      // the estate read inhabited instead of uniformly floodlit.
      glassLit:  new THREE.MeshStandardMaterial({ color: lit ? '#ffe3b0' : '#222b37', roughness: 0.16, metalness: lit ? 0 : 0.25, emissive: new THREE.Color(lit ? '#ffb457' : '#000000'), emissiveIntensity: lit ? 1.3 : 0 }),
      glassDim:  new THREE.MeshStandardMaterial({ color: lit ? '#c8a276' : '#242d3a', roughness: 0.16, metalness: lit ? 0 : 0.25, emissive: new THREE.Color(lit ? '#c97f2e' : '#000000'), emissiveIntensity: lit ? 0.45 : 0 }),
      glassDark: new THREE.MeshStandardMaterial({ color: '#1a212c', roughness: 0.14, metalness: 0.3 }),
      sconce:    new THREE.MeshStandardMaterial({ color: '#2a2b30', emissive: new THREE.Color(lit ? '#ffd489' : '#2e2a1e'), emissiveIntensity: lit ? 2.4 : 0.1, roughness: 0.5 }),
      lamp:      new THREE.MeshStandardMaterial({
        color: '#1f222a', emissive: new THREE.Color(lit ? '#ffd489' : '#33301f'),
        emissiveIntensity: lit ? 2.8 : 0.15, roughness: 0.5,
      }),
      lampPole:  S('#33363c', 0.5, 0.5),
      pot:       S('#3c3d41', 0.85),
      parasol:   S('#cbc4b3', 0.85),
      tramp:     S('#22242a', 0.6),
      trampNet:  new THREE.MeshStandardMaterial({ color: '#3a3d44', roughness: 0.9, transparent: true, opacity: 0.55 }),
    }
    const blossoms = ['#c94f6d', '#8a7fc9', '#e0b64a', '#e8e4da', '#d3703e'].map((c) => S(c, 0.8))
    const binMats = ['#26262b', '#2f4f86', '#5a3f28', '#b39527'].map((c) => S(c, 0.7))
    // ── Detailed procedural textures: Klinker brick, Ziegel roof, asphalt,
    //    concrete pavers, lawn. Cloned per surface so each carries its own
    //    tiling density (clones share the canvas, so this stays cheap). ──
    const extraTex: THREE.Texture[] = []
    const clone = (t: THREE.Texture, rx: number, ry: number) => { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); extraTex.push(c); return c }
    const brick = brickTextures(), roofT = roofTextures(), pav = paverTextures()
    const gsz = Math.max(wM, hM) * 7
    // Lawn — grass map across the whole ground plane
    m.lawn.map = clone(grassTexture(), gsz / 2.2, gsz / 2.2)
    m.lawnFront.map = clone(grassTexture(), 5, 2.4)
    // Roads / sidewalks / driveways
    m.road.map = clone(asphaltTexture(), gsz / 3, 1.2); m.road.color.set(dimc('#ffffff'))
    m.walk.map = clone(pav.map, gsz / 2, 0.7); m.walk.bumpMap = clone(pav.bump, gsz / 2, 0.7); m.walk.bumpScale = 0.006; m.walk.color.set(dimc('#ffffff'))
    m.drive.map = clone(pav.map, 2, 4); m.drive.bumpMap = clone(pav.bump, 2, 4); m.drive.bumpScale = 0.006; m.drive.color.set(dimc('#ffffff'))
    // Roofs — dark pantile Ziegel
    m.roofDark.map = clone(roofT.map, 4, 3); m.roofDark.bumpMap = clone(roofT.bump, 4, 3); m.roofDark.bumpScale = 0.01; m.roofDark.color.set(dimc('#ffffff'))
    m.roofWarm.map = clone(roofT.map, 4, 3); m.roofWarm.color.set(dimc('#b89a86'))
    m.roofTile.map = clone(roofT.map, 4, 3); m.roofTile.color.set(dimc('#c8b2a2'))
    // Red/brown Klinker brick dominant (the real Kolpingstraße new-build), plus
    // one plaster + one grey rendered facade for variety. Klinker faces carry
    // the brick map (tinted for course-to-course variety); plaster/render stay flat.
    const klinker = (tint: string) => { const mm = new THREE.MeshStandardMaterial({ color: dimc(tint), roughness: 0.86, metalness: 0.0 }); mm.map = clone(brick.map, 4, 4); mm.bumpMap = clone(brick.bump, 4, 4); mm.bumpScale = 0.012; return mm }
    const facades: THREE.Material[] = [klinker('#ffffff'), klinker('#e6c8ba'), klinker('#c99a86'), S('#d8d0c2', 0.9), S('#5a5b5f', 0.82, 0.05)]
    const carCols = [S('#20242c', 0.35, 0.5), S('#6b1f22', 0.35, 0.5), S('#2b3a4d', 0.35, 0.5), S('#c9c4bc', 0.4, 0.4)]
    const roofMats = [m.roofDark, m.roofDark, m.roofWarm]
    const allMats: THREE.Material[] = [...Object.values(m), ...facades, ...carCols, ...blossoms, ...binMats]

    const span = Math.max(wM, hM)
    const LP = span + 6
    const roadW = 3.8
    const N = 2
    const groundSize = LP * (2 * N + 3)
    const nodes: React.ReactNode[] = []

    // ── Ground + a few darker lawn patches for variation ──────────────
    nodes.push(
      <mesh key="lawn" position={[cx, -0.132, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.lawn}>
        <planeGeometry args={[groundSize, groundSize]} />
      </mesh>,
    )

    // ── Streets: asphalt + curbs + sidewalks + centre dashes ──────────
    for (let j = -N; j <= N + 1; j++) {
      const z = cz + (j - 0.5) * LP
      const dashes: React.ReactNode[] = []
      for (let d = -Math.floor(groundSize / 3); d <= Math.floor(groundSize / 3); d++) {
        dashes.push(<mesh key={d} position={[cx + d * 3, -0.1245, z]} rotation={[-Math.PI / 2, 0, 0]} material={m.dash}><planeGeometry args={[1.1, 0.12]} /></mesh>)
      }
      // Painted edge lines just inside each kerb — the biggest "real road" cue.
      const edges = [-1, 1].map((s) => (
        <mesh key={`edge${s}`} position={[cx, -0.1244, z + s * (roadW / 2 - 0.14)]} rotation={[-Math.PI / 2, 0, 0]} material={m.edgeLine}><planeGeometry args={[groundSize, 0.1]} /></mesh>
      ))
      // Cast-iron manhole covers dropped into the carriageway at intervals.
      const covers: React.ReactNode[] = []
      if (rich) {
        for (let c = -N; c <= N + 1; c++) {
          covers.push(<mesh key={`mh${c}`} position={[cx + c * LP + LP * 0.18, -0.1242, z + (c % 2 ? 0.6 : -0.6)]} rotation={[-Math.PI / 2, 0, 0]} material={m.manhole}><circleGeometry args={[0.32, 20]} /></mesh>)
        }
      }
      nodes.push(
        <group key={`st-${j}`}>
          <mesh position={[cx, -0.126, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.road}><planeGeometry args={[groundSize, roadW]} /></mesh>
          {dashes}
          {edges}
          {covers}
          {[-1, 1].map((s) => (
            <group key={s}>
              {/* raised curb */}
              <mesh position={[cx, -0.11, z + s * (roadW / 2 + 0.09)]} material={m.curb}><boxGeometry args={[groundSize, 0.06, 0.18]} /></mesh>
              {/* sidewalk */}
              <mesh position={[cx, -0.1255, z + s * (roadW / 2 + 0.75)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.walk}><planeGeometry args={[groundSize, 1.2]} /></mesh>
              {/* recessed gutter drains at the kerb line */}
              {rich && [-1, 0, 1].map((g) => (
                <mesh key={`dr${g}`} position={[cx + g * LP + LP * 0.32, -0.1243, z + s * (roadW / 2 - 0.28)]} rotation={[-Math.PI / 2, 0, 0]} material={m.drain}><planeGeometry args={[0.5, 0.22]} /></mesh>
              ))}
              {/* sidewalk expansion joints — thin recessed lines across the walk */}
              {rich && Array.from({ length: 2 * N + 3 }).map((_, k) => (
                <mesh key={`jt${k}`} position={[cx + (k - N - 1) * LP * 0.9, -0.1252, z + s * (roadW / 2 + 0.75)]} rotation={[-Math.PI / 2, 0, 0]} material={m.joint}><planeGeometry args={[0.05, 1.2]} /></mesh>
              ))}
            </group>
          ))}
        </group>,
      )
    }

    // ── Zebra crossing across the street in front of the plot ──────────
    {
      const zf = cz - 0.5 * LP
      const bars: React.ReactNode[] = []
      for (let b = -3; b <= 3; b++) {
        bars.push(<mesh key={`zb${b}`} position={[cx + b * 0.62, -0.1243, zf]} rotation={[-Math.PI / 2, 0, 0]} material={m.zebra}><planeGeometry args={[0.42, roadW - 0.5]} /></mesh>)
      }
      nodes.push(<group key="crosswalk">{bars}</group>)
    }

    // ── Builders ──────────────────────────────────────────────────────
    // Trees — multi-blob faceted canopies (leafy / conifer / two-tone with a
    // warm accent) plus a branch stub and a deterministic lean, so no two
    // trees read as the same lollipop.
    const tree = (key: string, x: number, z: number, s: number, kind: number) => {
      const sway = (Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1) * 0.08 - 0.04
      return (
        <group key={key} position={[x, -0.13, z]} rotation={[0, x + z, sway]}>
          {kind === 1 ? (
            <>
              <mesh position={[0, 0.5 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.09 * s, 0.13 * s, 1.0 * s, 6]} /></mesh>
              <mesh position={[0, 1.55 * s, 0]} castShadow material={m.foliageB}><coneGeometry args={[1.0 * s, 1.7 * s, 8]} /></mesh>
              <mesh position={[0, 2.6 * s, 0]} castShadow material={m.foliageA}><coneGeometry args={[0.76 * s, 1.5 * s, 8]} /></mesh>
              <mesh position={[0, 3.45 * s, 0]} castShadow material={m.foliageB}><coneGeometry args={[0.5 * s, 1.15 * s, 8]} /></mesh>
            </>
          ) : (
            <>
              <mesh position={[0, 0.85 * s, 0]} castShadow material={m.trunk}><cylinderGeometry args={[0.08 * s, 0.12 * s, 1.7 * s, 7]} /></mesh>
              <mesh position={[0.32 * s, 1.4 * s, 0]} rotation={[0, 0, -0.65]} castShadow material={m.trunk}><cylinderGeometry args={[0.035 * s, 0.055 * s, 0.75 * s, 5]} /></mesh>
              <mesh position={[0, 2.2 * s, 0]} scale={[1, 0.86, 1]} castShadow material={kind === 0 ? m.foliageA : m.foliageC}><icosahedronGeometry args={[1.02 * s, 1]} /></mesh>
              <mesh position={[0.64 * s, 1.9 * s, 0.2 * s]} scale={[1, 0.8, 1]} castShadow material={m.foliageB}><icosahedronGeometry args={[0.6 * s, 1]} /></mesh>
              <mesh position={[-0.52 * s, 1.75 * s, -0.28 * s]} scale={[1, 0.78, 1]} castShadow material={kind === 2 ? m.foliageD : m.foliageC}><icosahedronGeometry args={[0.55 * s, 1]} /></mesh>
              <mesh position={[-0.12 * s, 2.85 * s, 0.3 * s]} castShadow material={m.foliageB}><icosahedronGeometry args={[0.48 * s, 1]} /></mesh>
            </>
          )}
        </group>
      )
    }
    const bush = (key: string, x: number, z: number, s: number, mat: THREE.Material) => (
      <mesh key={key} position={[x, -0.13 + 0.3 * s, z]} scale={[1, 0.72, 1]} castShadow material={mat}><icosahedronGeometry args={[0.45 * s, 1]} /></mesh>
    )

    // Driveway cars — rounded body + glass cabin + light strips + rims.
    const car = (key: string, x: number, z: number, rot: number, body: THREE.Material) => (
      <group key={key} position={[x, -0.13, z]} rotation={[0, rot, 0]}>
        <RoundedBox position={[0, 0.46, 0]} args={[1.84, 0.52, 4.3]} radius={0.14} smoothness={3} castShadow material={body} />
        <RoundedBox position={[0, 0.88, -0.2]} args={[1.66, 0.5, 2.25]} radius={0.12} smoothness={3} castShadow material={body} />
        <RoundedBox position={[0, 0.88, -0.2]} args={[1.68, 0.4, 2.05]} radius={0.1} smoothness={3} material={m.carGlass} />
        {[-1, 1].map((s) => (
          <mesh key={`h${s}`} position={[s * 0.6, 0.54, 2.12]} material={m.carHead}><boxGeometry args={[0.36, 0.1, 0.06]} /></mesh>
        ))}
        <mesh position={[0, 0.56, -2.12]} material={m.carTail}><boxGeometry args={[1.46, 0.08, 0.06]} /></mesh>
        {([[-0.88, 1.32], [0.88, 1.32], [-0.88, -1.32], [0.88, -1.32]] as const).map(([wx, wz], i) => (
          <group key={i} position={[wx, 0.33, wz]} rotation={[0, 0, Math.PI / 2]}>
            <mesh castShadow material={m.wheel}><cylinderGeometry args={[0.33, 0.33, 0.22, 14]} /></mesh>
            <mesh position={[0, -Math.sign(wx) * 0.12, 0]} material={m.zinc}><cylinderGeometry args={[0.19, 0.19, 0.04, 10]} /></mesh>
          </group>
        ))}
      </group>
    )

    // Front-facing window: glass + dark frame + centre mullion + sill + the
    // new-build signature roller-shutter box (Rollladenkasten) above.
    const win = (key: string, x: number, y: number, z: number, w: number, h: number, faceZ: number, gm: THREE.Material) => (
      <group key={key} position={[x, y, z]}>
        <mesh position={[0, 0, faceZ * 0.02]} material={gm}><boxGeometry args={[w, h, 0.05]} /></mesh>
        <mesh position={[0, 0, faceZ * 0.03]} material={m.frame}><boxGeometry args={[w + 0.08, h + 0.08, 0.04]} /></mesh>
        <mesh position={[0, 0, faceZ * 0.05]} material={m.frame}><boxGeometry args={[0.05, h, 0.015]} /></mesh>
        <mesh position={[0, -h / 2 - 0.04, faceZ * 0.06]} material={m.sill}><boxGeometry args={[w + 0.16, 0.06, 0.12]} /></mesh>
        {rich && <mesh position={[0, h / 2 + 0.11, faceZ * 0.05]} material={m.trim}><boxGeometry args={[w + 0.12, 0.16, 0.1]} /></mesh>}
      </group>
    )

    const houseGroup: React.ReactNode[] = []
    for (let i = -N; i <= N; i++) {
      for (let j = -N; j <= N; j++) {
        if (i === 0 && j === 0) continue
        const r = mulberry32((i + 50) * 733 + (j + 50) * 977 + 17)
        const pickGlass = () => { const t = r(); return t < 0.4 ? m.glassLit : t < 0.65 ? m.glassDim : m.glassDark }
        const jx = (r() - 0.5) * 0.9, jz = (r() - 0.5) * 0.9
        const lx = cx + i * LP + jx
        const lz = cz + j * LP + jz
        const faceZ = j % 2 === 0 ? 1 : -1
        const rotY = (r() - 0.5) * 0.14
        const fw = LP * (0.42 + r() * 0.12)
        const fd = LP * (0.4 + r() * 0.12)
        const stories = r() > 0.42 ? 2 : 1
        const bh = stories * 2.7
        const facade = facades[Math.floor(r() * facades.length) % facades.length]
        const roofKind = r()  // <0.12 flat, <0.9 gable, else hip
        const roofMat = roofMats[Math.floor(r() * 3) % 3]
        const hasGarage = r() > 0.4
        const hasChimney = r() > 0.55
        const hasBalcony = stories === 2 && r() > 0.3
        const hasCar = hasGarage && r() > 0.35
        const fence = r() > 0.5
        // Free depth between the house front and the street furniture — keeps
        // paths, beds and fences off the sidewalk on tight plots (previously
        // driveways and fences ran onto the road).
        const pathLen = Math.max(1.2, LP * 0.5 - roadW / 2 - 1.35 - fd / 2)
        const dvLen = Math.max(1.5, LP * 0.5 - roadW / 2 - fd / 2)
        const backGap = LP * 0.5 - roadW / 2 - 1.35 - fd / 2

        const parts: React.ReactNode[] = []
        // body + dark plinth (Sockel) grounding the facade
        parts.push(<mesh key="b" position={[0, bh / 2, 0]} castShadow receiveShadow material={facade}><boxGeometry args={[fw, bh, fd]} /></mesh>)
        parts.push(<mesh key="pl" position={[0, 0.16, 0]} material={m.plinth}><boxGeometry args={[fw + 0.06, 0.32, fd + 0.06]} /></mesh>)
        // roof — mostly steep dark gables (this estate is Klinker + Ziegel)
        if (roofKind < 0.12) {
          // flat roof: slab + gravel bed + rooftop unit
          parts.push(<mesh key="rf" position={[0, bh + 0.09, 0]} castShadow material={roofMat}><boxGeometry args={[fw + 0.24, 0.18, fd + 0.24]} /></mesh>)
          parts.push(<mesh key="rfg" position={[0, bh + 0.185, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.gravel}><planeGeometry args={[fw + 0.06, fd + 0.06]} /></mesh>)
          if (rich) parts.push(<mesh key="rfu" position={[fw * 0.2, bh + 0.37, -fd * 0.15]} castShadow material={m.zinc}><boxGeometry args={[0.7, 0.36, 0.5]} /></mesh>)
        } else if (roofKind < 0.9) {
          const rh = Math.min(fw, fd) * 0.5
          const slope = Math.hypot(fw / 2 + 0.16, rh)
          const ang = Math.atan2(rh, fw / 2 + 0.16)
          parts.push(
            <group key="rg" position={[0, bh, 0]}>
              <mesh position={[-fw / 4, rh / 2, 0]} rotation={[0, 0, ang]} castShadow material={roofMat}><boxGeometry args={[slope, 0.1, fd + 0.5]} /></mesh>
              <mesh position={[fw / 4, rh / 2, 0]} rotation={[0, 0, -ang]} castShadow material={roofMat}><boxGeometry args={[slope, 0.1, fd + 0.5]} /></mesh>
              {/* ridge cap */}
              <mesh position={[0, rh + 0.02, 0]} castShadow material={m.ridge}><boxGeometry args={[0.24, 0.1, fd + 0.55]} /></mesh>
              {/* zinc gutters along both eaves + downspouts to the plinth */}
              {rich && [-1, 1].map((s) => (
                <group key={`gt${s}`}>
                  <mesh position={[s * (fw / 2 + 0.22), 0.03, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.zinc}><cylinderGeometry args={[0.055, 0.055, fd + 0.5, 8]} /></mesh>
                  <mesh position={[s * (fw / 2 + 0.24), -bh / 2 + 0.02, fd * 0.32]} material={m.zinc}><cylinderGeometry args={[0.04, 0.04, bh, 8]} /></mesh>
                </group>
              ))}
              {[-1, 1].map((s) => {
                const sh = new THREE.Shape(); sh.moveTo(-fw / 2, 0); sh.lineTo(fw / 2, 0); sh.lineTo(0, rh); sh.closePath()
                return <mesh key={s} position={[0, 0, (s * fd) / 2]} material={facade}><shapeGeometry args={[sh]} /></mesh>
              })}
              {/* Framed solar array on the front slope */}
              {stories === 2 && (
                <group position={[-fw / 4, rh / 2 + 0.07, faceZ * fd * 0.1]} rotation={[0, 0, ang]}>
                  <mesh castShadow material={m.solarFrame}><boxGeometry args={[slope * 0.74, 0.05, fd * 0.52]} /></mesh>
                  <mesh position={[0, 0.035, 0]} material={m.solar}><boxGeometry args={[slope * 0.7, 0.02, fd * 0.48]} /></mesh>
                </group>
              )}
              {/* Grey metal dormer with a window on the front slope */}
              {stories === 2 && (
                <group position={[fw / 4, rh * 0.42, faceZ * fd * 0.26]}>
                  <mesh castShadow material={m.dormer}><boxGeometry args={[fw * 0.22, 0.95, 0.55]} /></mesh>
                  <mesh position={[0, 0, faceZ * 0.28]} material={pickGlass()}><boxGeometry args={[fw * 0.16, 0.62, 0.05]} /></mesh>
                </group>
              )}
            </group>,
          )
        } else {
          const rh = Math.min(fw, fd) * 0.4
          parts.push(<mesh key="rh" position={[0, bh + rh / 2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow material={roofMat}><coneGeometry args={[Math.hypot(fw, fd) * 0.52, rh, 4]} /></mesh>)
        }
        if (hasChimney) {
          parts.push(<mesh key="ch" position={[fw * 0.25, bh + 0.9, fd * 0.1]} castShadow material={m.chimney}><boxGeometry args={[0.3, 1.1, 0.3]} /></mesh>)
          parts.push(<mesh key="chc" position={[fw * 0.25, bh + 1.47, fd * 0.1]} material={m.chimneyCap}><boxGeometry args={[0.4, 0.06, 0.4]} /></mesh>)
        }
        // windows per storey — front pair + gable side; rich adds a rear window
        for (let s = 0; s < stories; s++) {
          const y = 1.25 + s * 2.7
          parts.push(win(`wf${s}a`, -fw * 0.24, y, faceZ * (fd / 2 + 0.03), fw * 0.28, 1.15, faceZ, pickGlass()))
          parts.push(win(`wf${s}b`, fw * 0.26, y, faceZ * (fd / 2 + 0.03), fw * 0.24, 1.15, faceZ, pickGlass()))
          parts.push(
            <group key={`ws${s}`} position={[fw / 2 + 0.03, y, 0]} rotation={[0, Math.PI / 2, 0]}>
              {win(`wss${s}`, 0, 0, fd * 0.02, fd * 0.3, 1.1, 1, pickGlass())}
            </group>,
          )
          if (rich) parts.push(win(`wb${s}`, fw * 0.12, y, -faceZ * (fd / 2 + 0.03), fw * 0.34, 1.2, -faceZ, pickGlass()))
        }
        // front door — trim reveal, entry step, canopy, warm wall sconce, planter
        const dz = faceZ * (fd / 2)
        parts.push(<mesh key="drf" position={[0, 1.12, dz + faceZ * 0.02]} material={m.trim}><boxGeometry args={[1.2, 2.3, 0.08]} /></mesh>)
        parts.push(<mesh key="dr" position={[0, 1.05, dz + faceZ * 0.06]} castShadow material={m.door}><boxGeometry args={[0.95, 2.1, 0.08]} /></mesh>)
        parts.push(<mesh key="stp" position={[0, 0.05, dz + faceZ * 0.35]} material={m.walk}><boxGeometry args={[1.3, 0.1, 0.55]} /></mesh>)
        parts.push(<mesh key="cn" position={[0, 2.35, dz + faceZ * 0.35]} castShadow material={m.canopy}><boxGeometry args={[1.6, 0.08, 0.75]} /></mesh>)
        parts.push(<mesh key="sc" position={[0.82, 1.95, dz + faceZ * 0.08]} material={m.sconce}><boxGeometry args={[0.09, 0.22, 0.09]} /></mesh>)
        if (rich) {
          parts.push(
            <group key="pot" position={[-0.95, 0, dz + faceZ * 0.5]}>
              <mesh position={[0, 0.22, 0]} castShadow material={m.pot}><cylinderGeometry args={[0.2, 0.16, 0.44, 8]} /></mesh>
              <mesh position={[0, 0.56, 0]} castShadow material={m.hedgeTop}><icosahedronGeometry args={[0.26, 1]} /></mesh>
            </group>,
          )
        }
        // balcony
        if (hasBalcony) {
          parts.push(
            <group key="bal" position={[0, 2.7, faceZ * (fd / 2 + 0.5)]}>
              <mesh castShadow material={m.trim}><boxGeometry args={[fw * 0.55, 0.1, 1.0]} /></mesh>
              {/* Frosted-glass balustrade (front + two returns) */}
              <mesh position={[0, 0.45, faceZ * 0.5]} material={m.glassRail}><boxGeometry args={[fw * 0.55, 0.9, 0.04]} /></mesh>
              {[-1, 1].map((s) => (
                <mesh key={s} position={[s * fw * 0.275, 0.45, 0]} rotation={[0, Math.PI / 2, 0]} material={m.glassRail}><boxGeometry args={[1.0, 0.9, 0.04]} /></mesh>
              ))}
            </group>,
          )
        }
        // garage + sectional-door ribs + driveway (clamped to the road edge) + car
        if (hasGarage) {
          const gx = fw / 2 + 1.6
          const gdz = faceZ * (fd * 0.1 + fd * 0.35 + 0.03)
          parts.push(<mesh key="gb" position={[gx, 1.35, faceZ * (fd * 0.1)]} castShadow receiveShadow material={facade}><boxGeometry args={[3, 2.7, fd * 0.7]} /></mesh>)
          parts.push(<mesh key="gr" position={[gx, 2.75, faceZ * (fd * 0.1)]} castShadow material={roofMat}><boxGeometry args={[3.2, 0.16, fd * 0.7 + 0.2]} /></mesh>)
          parts.push(<mesh key="gd" position={[gx, 1.15, gdz]} material={m.garage}><boxGeometry args={[2.5, 2.1, 0.08]} /></mesh>)
          if (rich) for (const ry of [0.62, 1.15, 1.68]) parts.push(<mesh key={`gl${ry}`} position={[gx, ry, gdz + faceZ * 0.045]} material={m.frame}><boxGeometry args={[2.44, 0.025, 0.02]} /></mesh>)
          parts.push(<mesh key="dv" position={[gx, 0.006, faceZ * (fd / 2 + dvLen / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.drive}><planeGeometry args={[2.8, dvLen]} /></mesh>)
          if (hasCar) parts.push(car('car', gx, faceZ * (fd / 2 + Math.min(2.3, dvLen * 0.45)), (r() - 0.5) * 0.12, carCols[Math.floor(r() * carCols.length) % carCols.length]))
        }
        // manicured striped front lawn + path from door to street
        parts.push(<mesh key="fg" position={[0, 0.003, faceZ * (fd / 2 + pathLen / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.lawnFront}><planeGeometry args={[fw + 2.2, pathLen]} /></mesh>)
        parts.push(<mesh key="pa" position={[0, 0.006, faceZ * (fd / 2 + pathLen / 2)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.walk}><planeGeometry args={[1.2, pathLen]} /></mesh>)
        // flower bed beside the path
        if (rich) {
          const bedSide = r() > 0.5 ? 1 : -1
          const b0 = Math.floor(r() * 5)
          parts.push(
            <group key="bed" position={[bedSide * 1.25, 0, faceZ * (fd / 2 + pathLen * 0.4)]}>
              <mesh position={[0, 0.05, 0]} material={m.soil}><boxGeometry args={[0.7, 0.1, pathLen * 0.55]} /></mesh>
              {[0, 1, 2, 3].map((k) => (
                <mesh key={k} position={[((k % 2) - 0.5) * 0.3, 0.16, ((k / 3) - 0.5) * pathLen * 0.45]} material={blossoms[(b0 + k) % 5]}><sphereGeometry args={[0.075, 6, 5]} /></mesh>
              ))}
            </group>,
          )
        }
        // front boundary: layered hedge or two-rail post fence, gap for the path
        const by = faceZ * (fd / 2 + pathLen * 0.95)
        if (fence) {
          for (const sx of [-1, 1]) {
            if (rich) {
              parts.push(
                <group key={`fn${sx}`} position={[sx * fw * 0.42, 0, by]}>
                  <mesh position={[0, 0.6, 0]} material={m.fence}><boxGeometry args={[fw * 0.5, 0.08, 0.05]} /></mesh>
                  <mesh position={[0, 0.28, 0]} material={m.fence}><boxGeometry args={[fw * 0.5, 0.08, 0.05]} /></mesh>
                  {[-1, 0, 1].map((p) => (
                    <mesh key={p} position={[p * fw * 0.24, 0.36, 0]} castShadow material={m.fence}><boxGeometry args={[0.08, 0.72, 0.08]} /></mesh>
                  ))}
                </group>,
              )
            } else {
              parts.push(<mesh key={`fn${sx}`} position={[sx * fw * 0.42, 0.35, by]} material={m.fence}><boxGeometry args={[fw * 0.5, 0.7, 0.06]} /></mesh>)
            }
          }
        } else {
          for (const sx of [-1, 1]) {
            parts.push(
              <group key={`hg${sx}`} position={[sx * fw * 0.42, 0, by]}>
                <mesh position={[0, 0.3, 0]} castShadow material={m.hedge}><boxGeometry args={[fw * 0.55, 0.6, 0.44]} /></mesh>
                <mesh position={[sx * fw * 0.05, 0.63, 0]} castShadow material={m.hedgeTop}><boxGeometry args={[fw * 0.38, 0.14, 0.34]} /></mesh>
              </group>,
            )
          }
        }
        // garden trees beside the house (previously they sat inside the
        // footprint and were swallowed by the building) + corner bushes
        parts.push(tree('t1', -(fw / 2 + 1.3), -faceZ * fd * 0.18, 0.9 + r() * 0.4, Math.floor(r() * 3)))
        if (r() > 0.5) parts.push(tree('t2', -(fw / 2 + 2.1), faceZ * fd * 0.3, 0.8 + r() * 0.3, Math.floor(r() * 3)))
        if (rich) {
          parts.push(bush('bu1', -fw * 0.46, faceZ * (fd / 2 + 0.7), 0.9 + r() * 0.5, m.hedgeTop))
          parts.push(bush('bu2', fw * 0.42, -faceZ * (fd / 2 + 0.5), 1.1 + r() * 0.6, m.foliageC))
        }
        // back garden — terrace with parasol + table, and/or a trampoline (only
        // where the plot leaves room before the next sidewalk)
        if (rich && backGap > 2.4) {
          if (r() > 0.45) {
            parts.push(
              <group key="patio" position={[fw * 0.15, 0, -faceZ * (fd / 2 + 1.15)]}>
                <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={m.drive}><planeGeometry args={[3.2, 2.1]} /></mesh>
                <mesh position={[0.85, 1.15, 0.25]} material={m.lampPole}><cylinderGeometry args={[0.03, 0.03, 2.3, 6]} /></mesh>
                <mesh position={[0.85, 2.35, 0.25]} castShadow material={m.parasol}><coneGeometry args={[1.1, 0.52, 8]} /></mesh>
                <mesh position={[-0.45, 0.36, -0.2]} material={m.frame}><cylinderGeometry args={[0.045, 0.045, 0.72, 6]} /></mesh>
                <mesh position={[-0.45, 0.75, -0.2]} castShadow material={m.trim}><cylinderGeometry args={[0.46, 0.46, 0.05, 12]} /></mesh>
              </group>,
            )
          }
          if (r() > 0.62) {
            parts.push(
              <group key="tramp" position={[-fw * 0.3, 0, -faceZ * (fd / 2 + 1.2)]}>
                <mesh position={[0, 0.64, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow material={m.tramp}><torusGeometry args={[1.0, 0.07, 8, 20]} /></mesh>
                <mesh position={[0, 0.62, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.trampNet}><circleGeometry args={[0.95, 20]} /></mesh>
                {[0, 1, 2, 3].map((k) => {
                  const a = (k / 4) * Math.PI * 2 + 0.5
                  return <mesh key={k} position={[Math.cos(a) * 0.86, 0.32, Math.sin(a) * 0.86]} material={m.tramp}><cylinderGeometry args={[0.035, 0.035, 0.62, 6]} /></mesh>
                })}
              </group>,
            )
          }
        }
        // Wheelie bins (Mülltonnen) by the kerb — with lids, slightly askew
        if (r() > 0.55) {
          const b0 = Math.floor(r() * 4)
          parts.push(
            <group key="bins" position={[fw * 0.48, 0.4, faceZ * (fd / 2 + pathLen * 0.8)]}>
              {[0, 1].map((bi) => (
                <group key={bi} position={[bi * 0.52, 0, 0]} rotation={[0, (bi - 0.5) * 0.3, 0]}>
                  <mesh castShadow material={binMats[(b0 + bi) % 4]}><boxGeometry args={[0.42, 0.78, 0.5]} /></mesh>
                  <mesh position={[0, 0.42, -0.02]} material={m.frame}><boxGeometry args={[0.44, 0.06, 0.54]} /></mesh>
                </group>
              ))}
            </group>,
          )
        }

        houseGroup.push(<group key={`h-${i}-${j}`} position={[lx, -0.13, lz]} rotation={[0, rotY, 0]}>{parts}</group>)
      }
    }
    nodes.push(...houseGroup)

    // ── Street trees + modern LED light columns along the front sidewalk ─
    for (let k = -N - 1; k <= N + 1; k++) {
      const tx = cx + k * (LP * 0.5)
      const tz = cz - 0.5 * LP + roadW / 2 + 1.35
      nodes.push(tree(`stt-${k}`, tx, tz, 1.15 + ((k + 6) % 3) * 0.16, (k + 3) % 3))
      nodes.push(
        <group key={`lamp-${k}`} position={[tx + LP * 0.25, -0.13, tz]}>
          <mesh position={[0, 0.05, 0]} material={m.lampPole}><cylinderGeometry args={[0.11, 0.14, 0.1, 8]} /></mesh>
          <mesh position={[0, 1.9, 0]} castShadow material={m.lampPole}><cylinderGeometry args={[0.045, 0.06, 3.7, 8]} /></mesh>
          <mesh position={[0, 3.68, 0]} material={m.lamp}><cylinderGeometry args={[0.07, 0.075, 0.14, 8]} /></mesh>
          <mesh position={[0, 3.82, 0]} material={m.lampPole}><cylinderGeometry args={[0.1, 0.055, 0.16, 8]} /></mesh>
        </group>,
      )
      // Kerbside letterbox stand beside every other lamp — a small "lived-in"
      // street detail (anthracite box + slot + red flag on a slim post).
      if (rich && k % 2 === 0) {
        nodes.push(
          <group key={`mbox-${k}`} position={[tx + LP * 0.25 - 0.55, -0.13, tz + 0.15]}>
            <mesh position={[0, 0.55, 0]} castShadow material={m.lampPole}><cylinderGeometry args={[0.035, 0.04, 1.1, 8]} /></mesh>
            <RoundedBox position={[0, 1.16, 0]} args={[0.3, 0.22, 0.4]} radius={0.04} smoothness={3} castShadow material={m.mailbox} />
            <mesh position={[0, 1.16, 0.205]} material={m.frame}><boxGeometry args={[0.2, 0.03, 0.01]} /></mesh>
            <mesh position={[0.17, 1.24, 0.05]} material={m.carTail}><boxGeometry args={[0.02, 0.1, 0.06]} /></mesh>
          </group>,
        )
      }
    }

    // ── Loose meadow trees beyond the last row — soften the estate's edge ─
    if (rich) {
      const rr = mulberry32(4242)
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + rr() * 0.4
        const rad = LP * (N + 1.15) + rr() * LP * 0.3
        const mx = cx + Math.cos(a) * rad, mz = cz + Math.sin(a) * rad
        // keep them off the streets (streets run along x at half-LP offsets)
        const zr = (mz - cz) / LP + 0.5
        if (Math.abs(zr - Math.round(zr)) * LP < 3.4) continue
        nodes.push(tree(`mt-${k}`, mx, mz, 1.25 + rr() * 0.7, Math.floor(rr() * 3)))
      }
    }

    // ── Roadside parked cars — the biggest "lived-in" cue. Cars line the
    // kerbs (length along the road, in the parking lane just inside the curb,
    // scattered beside plots rather than on the driveways) so the street reads
    // used, not staged. Deterministic; high tier only for a smooth silhouette.
    if (rich) {
      const rc = mulberry32(9173)
      for (let jj = -N; jj <= N + 1; jj++) {
        const sz = cz + (jj - 0.5) * LP // this street's centre line
        for (let i = -N - 1; i <= N + 1; i++) {
          if (rc() > 0.4) continue
          const side = rc() > 0.5 ? 1 : -1
          const px = cx + i * LP + (0.28 + rc() * 0.14) * LP * (rc() > 0.5 ? 1 : -1)
          const pz = sz + side * (roadW / 2 - 0.95) // parking lane at the kerb
          const body = carCols[Math.floor(rc() * carCols.length) % carCols.length]
          nodes.push(car(`rc-${jj}-${i}`, px, pz, Math.PI / 2, body))
        }
      }
    }

    return { nodes, allMats, extraTex }
  }, [wM, hM, cx, cz, phase, daylightScale])

  useEffect(() => {
    const mats = built.allMats, texs = built.extraTex
    return () => { mats.forEach((mm) => mm.dispose()); texs.forEach((t) => t.dispose()) }
  }, [built])

  return <Static>{built.nodes}</Static>
}

// ─────────────────────────────────────────────────────────────────────
// Own-house exterior shell — wraps the apartment's indoor footprint in a real
// two-storey Klinker envelope with a pitched Ziegel roof, so the plan can be
// seen as the actual building ("das eigene Haus") instead of an open
// dollhouse. Toggleable; when off the interior stays visible. Materials +
// textures disposed on unmount.
// ─────────────────────────────────────────────────────────────────────
// Bau-Studio — the facade construction, stone/roof colours and roof shape live
// in the pure `houseStyle` domain (src/lib/houseStyle.ts). HouseShell reads its
// hints; the toolbar UI reads its catalogs.

function HouseShell({ rooms, phase, daylightScale, style }: { rooms: Room[]; phase: DayPhase; daylightScale: number; style: HouseStyle }) {
  const built = useMemo(() => {
    const lit = phase === 'night' || phase === 'dusk' || phase === 'goldenHour'
    // Same night recession as the neighbourhood, on the same continuous
    // exterior-albedo scale — dark brick + warm glowing windows is the
    // reference night read; linear-space K, hence the low values.
    const K = daylightScale
    const dimc = (c: string) => '#' + new THREE.Color(c).multiplyScalar(K).getHexString()
    // Indoor bounding box only (exclude the outdoor terrace).
    const indoor = rooms.filter((r) => (r.zoneType ?? 'indoor') !== 'outdoor' && r.polygon.length >= 3)
    if (!indoor.length) return null
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const r of indoor) for (const p of r.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y) }
    const o = 0.06                                             // sit just outside the interior walls
    const bx0 = M(minX) - o, bx1 = M(maxX) + o, bz0 = M(minZ) - o, bz1 = M(maxZ) + o
    const fw = bx1 - bx0, fd = bz1 - bz0
    const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2
    const eaves = 5.5, th = 0.26, oh = 0.45

    const texs: THREE.Texture[] = []
    const clone = (t: THREE.Texture, rx: number, ry: number) => { const c = t.clone(); c.needsUpdate = true; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); texs.push(c); return c }
    const roofT = roofTextures()
    // Facade material from the Bau-Studio choice. `facadeHints` decides whether
    // to carry the brick / board map or render smooth (Putz); the tint is the
    // stone/render colour; stone reuses the brick map greyed and rougher.
    const fh = facadeHints(style.facade)
    const src = fh.map === 'board' ? boardTextures() : brickTextures()
    const klinker = (rx: number, ry: number) => {
      const mm = new THREE.MeshStandardMaterial({ color: dimc(style.facadeTint), roughness: fh.roughness, metalness: fh.metalness })
      if (fh.textured) { mm.map = clone(src.map, rx, ry); mm.bumpMap = clone(src.bump, rx, ry); mm.bumpScale = fh.bumpScale }
      return mm
    }
    const roofMat = new THREE.MeshStandardMaterial({ color: dimc(style.roofTint), roughness: 0.82 }); roofMat.map = clone(roofT.map, Math.max(3, fw / 1.2), 4); roofMat.bumpMap = clone(roofT.bump, Math.max(3, fw / 1.2), 4); roofMat.bumpScale = 0.012
    const mats: THREE.Material[] = [roofMat]
    const M2 = (c: string, rough = 0.8, metal = 0) => { const mm = new THREE.MeshStandardMaterial({ color: dimc(c), roughness: rough, metalness: metal }); mats.push(mm); return mm }
    const plinth = M2('#3a3634', 0.9)
    const frame = M2('#23242a', 0.5, 0.2)
    const sill = M2('#d6d1c6', 0.85)
    const trim = M2('#eae6dd', 0.85)
    const door = M2('#20222a', 0.5, 0.2)
    const glassLit = new THREE.MeshStandardMaterial({ color: lit ? '#ffdda2' : '#20252e', roughness: 0.12, metalness: 0.0, emissive: new THREE.Color(lit ? '#ffb057' : '#000'), emissiveIntensity: lit ? 0.85 : 0 }); mats.push(glassLit)
    const glassDim = new THREE.MeshStandardMaterial({ color: lit ? '#b98f5e' : '#242d3a', roughness: 0.14, metalness: lit ? 0 : 0.2, emissive: new THREE.Color(lit ? '#c9812e' : '#000'), emissiveIntensity: lit ? 0.32 : 0 }); mats.push(glassDim)
    const glassDark = new THREE.MeshStandardMaterial({ color: '#1a212c', roughness: 0.14, metalness: 0.3 }); mats.push(glassDark)
    // face klinker: front/back tile denser horizontally than the sides
    const fWall = klinker(fw / 0.9, eaves / 0.85)
    const sWall = klinker(fd / 0.9, eaves / 0.85)

    const nodes: React.ReactNode[] = []
    // ── Klinker perimeter walls (4 slabs) + a darker base plinth ──
    nodes.push(<mesh key="wf" position={[bcx, eaves / 2, bz1]} castShadow receiveShadow material={fWall}><boxGeometry args={[fw + th, eaves, th]} /></mesh>)
    nodes.push(<mesh key="wb" position={[bcx, eaves / 2, bz0]} castShadow receiveShadow material={fWall}><boxGeometry args={[fw + th, eaves, th]} /></mesh>)
    nodes.push(<mesh key="wl" position={[bx0, eaves / 2, bcz]} castShadow receiveShadow material={sWall}><boxGeometry args={[th, eaves, fd]} /></mesh>)
    nodes.push(<mesh key="wr" position={[bx1, eaves / 2, bcz]} castShadow receiveShadow material={sWall}><boxGeometry args={[th, eaves, fd]} /></mesh>)
    // base plinth
    for (const [k, x, z, w, d] of [['pf', bcx, bz1, fw + th + 0.1, th + 0.1], ['pb', bcx, bz0, fw + th + 0.1, th + 0.1], ['pl', bx0, bcz, th + 0.1, fd], ['pr', bx1, bcz, th + 0.1, fd]] as const) {
      nodes.push(<mesh key={k} position={[x, 0.25, z]} material={plinth}><boxGeometry args={[w, 0.5, d]} /></mesh>)
    }

    // ── Window helper on a facade (normal = ±x or ±z) ──
    const winW = 1.15, winH = 1.3
    const paneStates = [0, 0, 1, 0, 2, 1, 0, 2, 0, 1, 2, 0]
    let paneI = 0
    const addWin = (key: string, x: number, y: number, z: number, along: 'x' | 'z', w = winW, h = winH) => {
      const glass = [glassLit, glassDim, glassDark][paneStates[paneI++ % paneStates.length]]
      // Pane protrudes past the frame slab in the facade-normal direction —
      // otherwise the bigger frame box swallows it and windows render dead.
      const wx = along === 'x' ? w : 0.1, wz = along === 'x' ? 0.1 : w
      nodes.push(
        <group key={key} position={[x, y, z]}>
          <mesh material={glass}><boxGeometry args={[wx, h, wz]} /></mesh>
          {/* Frame is a surround: wider tangentially, THINNER along the facade
              normal — deriving it as glass+0.02 swallowed the pane entirely. */}
          <mesh material={frame}><boxGeometry args={[wx + (along === 'x' ? 0.1 : -0.04), h + 0.1, wz + (along === 'x' ? -0.04 : 0.1)]} /></mesh>
          <mesh position={[0, -h / 2 - 0.05, 0]} material={sill}><boxGeometry args={[wx + (along === 'x' ? 0.2 : 0.14), 0.06, wz + (along === 'x' ? 0.14 : 0.2)]} /></mesh>
        </group>,
      )
    }
    // Storey window rows on front (+z) & back (−z); count from width.
    const cols = Math.max(2, Math.round(fw / 2.0))
    for (let s = 0; s < 2; s++) {
      const y = 1.5 + s * 2.6
      for (let c = 0; c < cols; c++) {
        const x = bx0 + (fw * (c + 0.5)) / cols
        addWin(`fz${s}-${c}`, x, y, bz1 + th / 2 + 0.02, 'x')
        addWin(`bz${s}-${c}`, x, y, bz0 - th / 2 - 0.02, 'x')
      }
    }
    // Side windows (±x); count from depth. East (+x) faces the terrace → wider ground glazing.
    const rowsz = Math.max(2, Math.round(fd / 2.2))
    for (let s = 0; s < 2; s++) {
      const y = 1.5 + s * 2.6
      for (let c = 0; c < rowsz; c++) {
        const z = bz0 + (fd * (c + 0.5)) / rowsz
        const wide = s === 0 ? 1.5 : winW
        addWin(`rx${s}-${c}`, bx1 + th / 2 + 0.02, s === 0 ? 1.35 : y, z, 'z', wide, s === 0 ? 2.0 : winH)
        addWin(`lx${s}-${c}`, bx0 - th / 2 - 0.02, y, z, 'z')
      }
    }
    // Front door on the west facade (the real Wohnungstür side)
    nodes.push(<mesh key="door" position={[bx0 - th / 2 - 0.02, 1.1, bcz]} castShadow material={door}><boxGeometry args={[0.08, 2.2, 1.0]} /></mesh>)
    nodes.push(<mesh key="canopy" position={[bx0 - 0.45, 2.35, bcz]} castShadow material={trim}><boxGeometry args={[0.9, 0.1, 1.6]} /></mesh>)

    // ── Roof — Bau-Studio Dachform (Satteldach · Walmdach · Flachdach) ──
    const rhints = roofHints(style.roof)
    const ridgeAlongX = fw >= fd
    const spanPerp = ridgeAlongX ? fd : fw
    const spanRidge = ridgeAlongX ? fw : fd
    const gableMat = fWall
    const roofGroup: React.ReactNode[] = []

    if (rhints.flat) {
      // Flachdach — a shallow slab with a low parapet + gravel bed on top.
      const zinc = M2('#7b7f85', 0.5, 0.55)
      roofGroup.push(<mesh key="slab" position={[0, 0.1, 0]} castShadow receiveShadow material={roofMat}><boxGeometry args={[spanRidge + oh * 2, 0.2, spanPerp + oh * 2]} /></mesh>)
      roofGroup.push(<mesh key="gravel" position={[0, 0.22, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={M2('#9b968c', 1)}><planeGeometry args={[spanRidge + oh, spanPerp + oh]} /></mesh>)
      for (const [k, x, z, w, d] of [['pa', 0, (spanPerp + oh) / 2, spanRidge + oh * 2, 0.12], ['pb', 0, -(spanPerp + oh) / 2, spanRidge + oh * 2, 0.12], ['pl', (spanRidge + oh) / 2, 0, 0.12, spanPerp + oh * 2], ['pr', -(spanRidge + oh) / 2, 0, 0.12, spanPerp + oh * 2]] as const) {
        roofGroup.push(<mesh key={k} position={[x, 0.34, z]} castShadow material={zinc}><boxGeometry args={[w, 0.36, d]} /></mesh>)
      }
    } else {
      const rh = (spanPerp / 2 + oh) * rhints.pitch
      const slope = Math.hypot(spanPerp / 2 + oh, rh)
      const ang = Math.atan2(rh, spanPerp / 2 + oh)
      // Walmdach: the ridge is pulled in from the ends by the hip inset, so the
      // main slopes become trapezoids and the ends become sloped hips instead
      // of vertical gables. Satteldach keeps a full-length ridge + gable walls.
      const hipInset = style.roof === 'hip' ? Math.min(spanPerp / 2 + oh, (spanRidge + oh * 2) * 0.22) : 0
      const ridgeLen = spanRidge + oh * 2 - 2 * hipInset
      // main slopes (front/back)
      roofGroup.push(<mesh key="s1" position={[0, rh / 2, -(spanPerp / 4 + oh / 2)]} rotation={[-ang, 0, 0]} castShadow receiveShadow material={roofMat}><boxGeometry args={[spanRidge + oh * 2, 0.12, slope]} /></mesh>)
      roofGroup.push(<mesh key="s2" position={[0, rh / 2, (spanPerp / 4 + oh / 2)]} rotation={[ang, 0, 0]} castShadow receiveShadow material={roofMat}><boxGeometry args={[spanRidge + oh * 2, 0.12, slope]} /></mesh>)
      if (style.roof === 'hip') {
        // Two hip end-slopes, tilted inward from each short end to the ridge.
        const hang = Math.atan2(rh, hipInset || 0.001)
        const hslope = Math.hypot(hipInset, rh)
        for (const s of [-1, 1]) {
          roofGroup.push(
            <mesh key={`hip${s}`} position={[s * (spanRidge / 2 + oh - hipInset / 2), rh / 2, 0]} rotation={[0, 0, s * hang]} castShadow receiveShadow material={roofMat}>
              <boxGeometry args={[hslope, 0.12, spanPerp + oh * 2]} />
            </mesh>,
          )
        }
      } else {
        // Satteldach gable triangles close the two ends.
        for (const s of [-1, 1]) {
          const sh = new THREE.Shape(); sh.moveTo(-spanPerp / 2, 0); sh.lineTo(spanPerp / 2, 0); sh.lineTo(0, rh); sh.closePath()
          roofGroup.push(<mesh key={`g${s}`} position={[s * spanRidge / 2, 0, 0]} rotation={[0, s === 1 ? Math.PI / 2 : -Math.PI / 2, 0]} material={gableMat}><shapeGeometry args={[sh]} /></mesh>)
        }
      }
      // ridge cap
      roofGroup.push(<mesh key="ridge" position={[0, rh, 0]} material={roofMat}><boxGeometry args={[ridgeLen, 0.12, 0.2]} /></mesh>)
    }
    nodes.push(
      <group key="roof" position={[bcx, eaves, bcz]} rotation={[0, ridgeAlongX ? 0 : Math.PI / 2, 0]}>{roofGroup}</group>,
    )

    return { nodes, mats, texs }
  }, [rooms, phase, daylightScale, style])

  useEffect(() => {
    if (!built) return
    const { mats, texs } = built
    return () => { mats.forEach((m) => m.dispose()); texs.forEach((t) => t.dispose()) }
  }, [built])

  return built ? <Static>{built.nodes}</Static> : null
}

// Privacy fences around the terrace + a paver parking court beyond them with
// four distinct premium cars (Tesla / Mercedes / Audi / BMW), matching the
// reference exterior. Positions derive from the outdoor terrace room's bounds.
function TerraceParking({ rooms, daylightScale }: { rooms: Room[]; daylightScale: number }) {
  const built = useMemo(() => {
    const terr = rooms.find((r) => r.zoneType === 'outdoor' && r.polygon.length >= 3)
    if (!terr) return null
    const xs = terr.polygon.map((p) => p.x), zs = terr.polygon.map((p) => p.y)
    const x0 = M(Math.min(...xs)), x1 = M(Math.max(...xs))
    const z0 = M(Math.min(...zs)), z1 = M(Math.max(...zs))

    // Same continuous night recession as the neighbourhood — the parking court's
    // albedo follows the sky (no per-phase pop) so interior light spill can't
    // keep it daylight-bright.
    const K = daylightScale
    const dimc = (c: string) => '#' + new THREE.Color(c).multiplyScalar(K).getHexString()
    const mats: THREE.Material[] = []
    const paint = (c: string, metal = 0.62, rough = 0.32) => { const m = new THREE.MeshStandardMaterial({ color: dimc(c), metalness: metal, roughness: rough }); mats.push(m); return m }
    const fenceMat = paint('#2a2b2e', 0.1, 0.85)
    const postMat = paint('#1b1c1f', 0.2, 0.8)
    const paver = paint('#7f7a70', 0.0, 0.96)
    const lineMat = paint('#d6d2c4', 0.0, 0.9)
    const glass = (() => { const m = new THREE.MeshStandardMaterial({ color: '#0b0e14', metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.86 }); mats.push(m); return m })()
    const tire = paint('#111214', 0.1, 0.85)
    const chrome = paint('#c8ccd2', 0.9, 0.2)
    // Parked cars keep their lights OFF — the lenses are just clear/red glass
    // that catches the environment (a lit-up parked car reads as a toy).
    const head = paint('#c8d2da', 0.6, 0.25)
    const tail = paint('#7a1f24', 0.4, 0.35)

    const nodes: React.ReactNode[] = []

    const fence = (key: string, ax: number, az: number, bx: number, bz: number) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
      const slats: React.ReactNode[] = []
      for (let i = 0; i < 7; i++) slats.push(<mesh key={i} position={[0, 0.24 + i * 0.26, 0]} castShadow material={fenceMat}><boxGeometry args={[len, 0.2, 0.04]} /></mesh>)
      return (
        <group key={key} position={[(ax + bx) / 2, 0, (az + bz) / 2]} rotation={[0, Math.atan2(-dz, dx), 0]}>
          {slats}
          <mesh position={[-len / 2, 0.95, 0]} castShadow material={postMat}><boxGeometry args={[0.1, 1.92, 0.1]} /></mesh>
          <mesh position={[len / 2, 0.95, 0]} castShadow material={postMat}><boxGeometry args={[0.1, 1.92, 0.1]} /></mesh>
        </group>
      )
    }
    nodes.push(fence('fe-e', x1, z0 - 0.3, x1, z1 + 0.4))
    nodes.push(fence('fe-s', x0, z1, x1, z1))

    const px0 = x1 + 0.35, px1 = x1 + 5.7, pz0 = z0 - 0.6, pz1 = z0 + 8.2
    nodes.push(<mesh key="pk" position={[(px0 + px1) / 2, -0.128, (pz0 + pz1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={paver}><planeGeometry args={[px1 - px0, pz1 - pz0]} /></mesh>)
    for (let i = 0; i <= 4; i++) {
      const z = pz0 + 0.4 + (i * (pz1 - pz0 - 0.8)) / 4
      nodes.push(<mesh key={`ln${i}`} position={[(px0 + px1) / 2, -0.124, z]} rotation={[-Math.PI / 2, 0, 0]} material={lineMat}><planeGeometry args={[px1 - px0 - 0.6, 0.08]} /></mesh>)
    }

    const car = (key: string, ccx: number, ccz: number, rot: number, sp: { c: string; L: number; W: number; roof: 'fastback' | 'notch' | 'coupe'; rim: string; grille: 'none' | 'wide' | 'kidney'; chromeTrim?: boolean }) => {
      const body = paint(sp.c)
      const rimMat = paint(sp.rim, 0.85, 0.25)
      const wr = 0.34, wb = sp.L * 0.58
      const cabinL = sp.roof === 'coupe' ? sp.L * 0.42 : sp.roof === 'notch' ? sp.L * 0.4 : sp.L * 0.5
      const cabinH = sp.roof === 'coupe' ? 0.34 : 0.42
      const cabinY = sp.roof === 'coupe' ? 0.74 : 0.82
      const cabinZ = sp.roof === 'notch' ? -sp.L * 0.05 : -sp.L * 0.02
      return (
        <group key={key} position={[ccx, -0.13, ccz]} rotation={[0, rot, 0]}>
          <RoundedBox position={[0, 0.44, 0]} args={[sp.W, 0.5, sp.L]} radius={0.16} smoothness={4} castShadow receiveShadow material={body} />
          <mesh position={[0, 0.2, 0]} material={paint('#141519', 0.2, 0.7)}><boxGeometry args={[sp.W + 0.01, 0.16, sp.L * 0.86]} /></mesh>
          <RoundedBox position={[0, cabinY, cabinZ]} args={[sp.W * 0.84, cabinH, cabinL]} radius={0.12} smoothness={4} castShadow material={body} />
          <RoundedBox position={[0, cabinY, cabinZ]} args={[sp.W * 0.85, cabinH - 0.06, cabinL * 0.9]} radius={0.1} smoothness={3} material={glass} />
          <mesh position={[0, cabinY + cabinH / 2 + 0.02, cabinZ]} material={body}><boxGeometry args={[sp.W * 0.78, 0.05, cabinL * 0.78]} /></mesh>
          {[-1, 1].map((s) => (<mesh key={`h${s}`} position={[s * sp.W * 0.31, 0.52, sp.L / 2 - 0.02]} material={head}><boxGeometry args={[sp.W * 0.2, 0.09, 0.04]} /></mesh>))}
          <mesh position={[0, 0.52, -sp.L / 2 + 0.02]} material={tail}><boxGeometry args={[sp.W * 0.8, 0.07, 0.03]} /></mesh>
          {sp.grille !== 'none' && <mesh position={[0, 0.34, sp.L / 2 - 0.01]} material={paint('#0c0d10', 0.4, 0.5)}><boxGeometry args={[sp.grille === 'kidney' ? sp.W * 0.4 : sp.W * 0.58, 0.17, 0.03]} /></mesh>}
          {sp.chromeTrim && <mesh position={[0, 0.43, sp.L / 2 - 0.005]} material={chrome}><boxGeometry args={[sp.W * 0.6, 0.02, 0.02]} /></mesh>}
          {([[-1, 1], [1, 1], [-1, -1], [1, -1]] as const).map(([sx, sz], i) => (
            <group key={`w${i}`} position={[sx * (sp.W / 2 - 0.03), wr, (sz * wb) / 2]} rotation={[0, 0, Math.PI / 2]}>
              <mesh castShadow material={tire}><cylinderGeometry args={[wr, wr, 0.24, 20]} /></mesh>
              <mesh position={[sx * 0.13, 0, 0]} material={rimMat}><cylinderGeometry args={[wr * 0.62, wr * 0.62, 0.05, 16]} /></mesh>
            </group>
          ))}
        </group>
      )
    }
    const ccx = x1 + 2.95
    const specs = [
      { c: '#3a3d42', L: 4.97, W: 1.96, roof: 'fastback' as const, rim: '#cacdd3', grille: 'none' as const },
      { c: '#0e0e12', L: 4.94, W: 1.86, roof: 'notch' as const, rim: '#3a3d42', grille: 'wide' as const, chromeTrim: true },
      { c: '#c4c7cc', L: 4.97, W: 1.9, roof: 'fastback' as const, rim: '#8a8d92', grille: 'wide' as const },
      { c: '#16233f', L: 4.77, W: 1.85, roof: 'coupe' as const, rim: '#2a2d33', grille: 'kidney' as const },
    ]
    specs.forEach((sp, i) => nodes.push(car(`car-${i}`, ccx, pz0 + 1.1 + (i * (pz1 - pz0 - 2.0)) / 3, -Math.PI / 2, sp)))
    return { nodes, mats }
  }, [rooms, daylightScale])

  useEffect(() => {
    if (!built) return
    const mats = built.mats
    return () => mats.forEach((m) => m.dispose())
  }, [built])

  return built ? <Static>{built.nodes}</Static> : null
}

// ─────────────────────────────────────────────────────────────────────
// Etagen-Stack — the exploded multi-storey view. The active floor stays the
// fully rendered dollhouse; every OTHER storey appears as a translucent ghost
// shell (floor slab + walls) floated above / sunk below at its storey offset
// (geometry from lib/floorStack), so the whole house reads at a glance without
// touching the main renderer. Purely additive; materials disposed on unmount.
// ─────────────────────────────────────────────────────────────────────
const GHOST_GAP = 3.6 // m of vertical separation per storey in the exploded view
function GhostFloors({ floors, activeId }: { floors: Floor[]; activeId: string }) {
  const built = useMemo(() => {
    const wallMat = new THREE.MeshStandardMaterial({ color: '#aab0ba', transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.9 })
    const slabMat = new THREE.MeshStandardMaterial({ color: '#c7a24e', transparent: true, opacity: 0.07, depthWrite: false, roughness: 1 })
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#c7a24e', transparent: true, opacity: 0.35 })
    const mats = [wallMat, slabMat, edgeMat]
    const levels = computeFloorStack(floors.map((f) => ({ id: f.id, index: f.index })), activeId, GHOST_GAP)
    const nodes: React.ReactNode[] = []
    for (const lv of levels) {
      if (lv.active) continue
      const fl = floors.find((f) => f.id === lv.id)
      if (!fl) continue
      const w = M(fl.extent.width), h = M(fl.extent.height)
      nodes.push(
        <group key={lv.id} position={[0, lv.yOffset, 0]}>
          {/* floor slab + a hairline gold frame so each storey reads as a tray */}
          <mesh position={[w / 2, 0.01, h / 2]} rotation={[-Math.PI / 2, 0, 0]} material={slabMat}><planeGeometry args={[w, h]} /></mesh>
          {[[w / 2, 0.02, 0.01, w, 0.02], [w / 2, 0.02, h - 0.01, w, 0.02], [0.01, 0.02, h / 2, 0.02, h], [w - 0.01, 0.02, h / 2, 0.02, h]].map(([x, y, z, sx, sz], i) => (
            <mesh key={i} position={[x, y, z]} rotation={[-Math.PI / 2, 0, 0]} material={edgeMat}><planeGeometry args={[sx, sz]} /></mesh>
          ))}
          {/* walls as translucent volumes */}
          {fl.walls.map((wl: Wall) => {
            const ax = M(wl.a.x), az = M(wl.a.y), bx = M(wl.b.x), bz = M(wl.b.y)
            const len = Math.hypot(bx - ax, bz - az)
            if (len < 0.01) return null
            return (
              <mesh
                key={wl.id}
                position={[(ax + bx) / 2, 1.25, (az + bz) / 2]}
                rotation={[0, -Math.atan2(bz - az, bx - ax), 0]}
                material={wallMat}
              >
                <boxGeometry args={[len, 2.5, Math.max(0.06, M(wl.thickness))]} />
              </mesh>
            )
          })}
        </group>,
      )
    }
    return { nodes, mats }
  }, [floors, activeId])

  useEffect(() => {
    const mats = built.mats
    return () => mats.forEach((m) => m.dispose())
  }, [built])

  return <Static>{built.nodes}</Static>
}

/**
 * Per-room floor overrides — a Shape-based slab per room that carries its own
 * material, and a raised wood deck with a low curb for outdoor zones.
 *
 * Memoised on the rooms, because R3F reconstructs an object whenever its `args`
 * change and compares that array element-wise by reference. Building the
 * `THREE.Shape` (and the extrude options object) inline meant every render of
 * the scene re-triangulated every room's floor and re-extruded every terrace —
 * some of the most expensive geometry in the scene — for outlines that only
 * change when the plan does.
 */
function RoomFloors({ rooms }: { rooms: Room[] }) {
  const slabs = useMemo(() => {
    const extrudeOptions = { depth: M(6), bevelEnabled: false }
    return rooms
      .filter((r) => (r.floorMaterialId || r.floorVariant || r.zoneType === 'outdoor') && r.polygon.length >= 3)
      .map((r) => {
        const shape = new THREE.Shape()
        shape.moveTo(M(r.polygon[0].x), -M(r.polygon[0].y))
        for (let i = 1; i < r.polygon.length; i++) {
          shape.lineTo(M(r.polygon[i].x), -M(r.polygon[i].y))
        }
        shape.closePath()
        return {
          id: r.id,
          shape,
          extrudeOptions,
          outdoor: r.zoneType === 'outdoor',
          material: matFromCatalog(resolveFloorMaterial(r)),
        }
      })
  }, [rooms])

  return (
    <>
      {slabs.map((slab) => (slab.outdoor ? (
        <group key={`room-${slab.id}`}>
          {/* Deck slab — extruded wood */}
          <mesh
            position={[0, 0.0, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            receiveShadow
            castShadow
            material={MAT.woodWalnut() as THREE.Material}
          >
            <extrudeGeometry args={[slab.shape, slab.extrudeOptions]} />
          </mesh>
          {/* Top surface board (oak) sitting flush on the deck for plank detail */}
          <mesh
            position={[0, M(6) + 0.001, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            receiveShadow
            material={MAT.woodOak() as THREE.Material}
          >
            <shapeGeometry args={[slab.shape]} />
          </mesh>
        </group>
      ) : (
        <mesh
          key={`room-${slab.id}`}
          position={[0, 0.001, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          receiveShadow
          material={slab.material}
        >
          <shapeGeometry args={[slab.shape]} />
        </mesh>
      )))}
    </>
  )
}

function Scene({ env, floorVariant, wallMaterialId, walkMode, envPreset, showHouse, stackView, houseStyle, residents, onResidentStatus }: {
  env: EnvironmentState; floorVariant: FloorVariant; wallMaterialId: string; walkMode: boolean; envPreset: EnvPreset; showHouse: boolean;
  stackView: boolean; houseStyle: HouseStyle; residents: number; onResidentStatus?: (s: ResidentStatus) => void;
}) {
  const doc = usePlanStore((s) => s.doc)
  const floor = useMemo(() => doc?.floors.find((f) => f.id === doc?.activeFloorId), [doc])

  // Identity token for the on-demand shadow map: a fresh reference whenever
  // anything it depicts changes. `floor` covers every plan edit — the store
  // deep-clones the document, so its identity changes on any mutation — and the
  // rest cover the toggles and the sun. Deliberately conservative: an extra
  // shadow re-render costs a frame, a missed one leaves furniture floating.
  const worldKey = useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      floor, showHouse, stackView, walkMode, floorVariant, wallMaterialId, houseStyle,
      env.sun.direction.x, env.sun.direction.y, env.sun.direction.z,
      env.lighting.sun.intensity, env.sun.aboveHorizon,
    ],
  )

  if (!floor) return null
  const { width, height } = floor.extent
  const wM = M(width), hM = M(height)
  const cx = wM / 2
  const cz = hM / 2
  const wallMaterial = resolveSurfaceMaterialId(wallMaterialId, 'wall')

  return (
    <>
      {/* Environment lighting — ambient + hemisphere come from the environment
          model. The directional key uses the model's sun appearance; its
          position is still chosen geometrically until sun-position math lands. */}
      {/* Conservative warm white-balance on the fill light (the physically correct
          place): nudge sky/ambient ~10% toward warm white for a luxury-interior cast. */}
      {/* Aerial depth — distant houses fade into the sky horizon. Starts well
          beyond the dollhouse so the interior is untouched. */}
      <fog attach="fog" args={[env.sky.horizonColor, Math.max(wM, hM) * 2.4, Math.max(wM, hM) * 7.5]} />
      <hemisphereLight args={[new THREE.Color(env.lighting.hemisphere.skyColor).lerp(new THREE.Color('#ffefd6'), 0.16), env.lighting.hemisphere.groundColor, env.lighting.hemisphere.intensity * 0.72]} />
      {/* Trim the flat uniform fill hard so the directional key, cove strips and
          corner AO shape the walls — the reference's moody falloff instead of a
          washed-out even glow (near-white walls otherwise blow out at eye level). */}
      <ambientLight color={new THREE.Color(env.lighting.ambient.color).lerp(new THREE.Color('#ffecd0'), 0.18)} intensity={env.lighting.ambient.intensity * 0.56} />
      {env.sun.aboveHorizon && <SunLight env={env} wM={wM} hM={hM} cx={cx} cz={cz} />}

      {/* The sun's shadow map is view-independent — orbiting cannot change a
          texel of it — so it is re-rendered on change instead of every frame. */}
      <ShadowController worldKey={worldKey} dynamic={residents > 0} />
      {/* Every interior point light — placed luminaires, recessed downlights and
          cove washes — on one fixed-size pool. Forward rendering shades each
          surface against every enabled light, so the count is the frame budget;
          the rig re-points a constant number of lights at whatever currently
          matters instead of mounting one per fixture. */}
      <LightRig
        rooms={floor.rooms}
        devices={floor.devices}
        mode={doc?.activeModeKey}
        categoryOf={deviceCategoryOf}
      />

      {/* Downlight fixtures — the emissive disc only (walk mode) */}
      <RoomDownlights rooms={floor.rooms} walkMode={walkMode} />

      {/* Cove lighting — the reference's warm perimeter glow strips */}
      <CoveLighting rooms={floor.rooms} />

      {/* Night-city backdrop — visible through windows in evening/night */}
      <CityBackdrop span={Math.max(wM, hM)} cx={cx} cz={cz} daylightScale={env.lighting.exteriorAlbedoScale} />

      {/* Live Digital Twin — same runtime + same room aggregation as the 2D floorplan. */}
      <LiveTwinReflection rooms={floor.rooms} />

      {/* Virtual residents — automatic daily routine; the smart home reacts
          (doors, lights, motion, TV, coffee, blinds). Subtle, opt-in. */}
      {residents > 0 && (
        <VirtualResidents
          floor={floor}
          count={residents}
          night={env.phase === 'night' || env.phase === 'dusk'}
          onStatus={onResidentStatus}
        />
      )}

      {/* Surrounding new-build neighbourhood — environmental context around the plan. */}
      <Neighborhood wM={wM} hM={hM} cx={cx} cz={cz} phase={env.phase} daylightScale={env.lighting.exteriorAlbedoScale} />

      {/* Own-house exterior envelope (Klinker + Ziegel roof) — toggleable so the
          plan can be seen as the real building instead of an open dollhouse. */}
      {showHouse && <HouseShell rooms={floor.rooms} phase={env.phase} daylightScale={env.lighting.exteriorAlbedoScale} style={houseStyle} />}

      {/* Etagen-Stack — ghost shells of the other storeys, exploded vertically */}
      {stackView && !walkMode && doc && doc.floors.length > 1 && (
        <GhostFloors floors={doc.floors} activeId={floor.id} />
      )}

      {/* Terrace privacy fences + parking court with premium cars. */}
      <TerraceParking rooms={floor.rooms} daylightScale={env.lighting.exteriorAlbedoScale} />

      {/* Floor + contact shadows. Position contact shadows just below items, not at the floor itself */}
      <FloorPlane width={width} height={height} variant={floorVariant} />
      {/* Ceilings — visible in walk mode, faded (never hard-cut) on the way
          in and out. An opaque ceiling must not block the dollhouse view. */}
      <CeilingFade rooms={floor.rooms} walkMode={walkMode} />
      {/* v18/v26 — per-room floor overrides via Shape geometry.
          Outdoor zones (terraces) render as a raised wood deck with a low curb. */}
      <RoomFloors rooms={floor.rooms} />
      {/* Soft ground contact under everything standing on the floor.
          This is a second shadow render (scene → depth FBO → two blur passes),
          so like the sun's map it runs on change rather than continuously:
          drei re-arms its `frames` countdown on every re-render of this
          component, and `Scene` re-renders on any plan or toggle change.
          Residents walking are the one case that needs it live. */}
      <ContactShadows
        position={[cx, 0.012, cz]}
        opacity={env.lighting.sun.shadowIntensity}
        scale={Math.max(wM, hM) * 1.4}
        blur={2.4}
        far={2.5}
        frames={residents > 0 ? Infinity : 12}
        resolution={readTier() === 'high' ? 1024 : 512}
      />

      {/* Walls — with corner extensions and pillars for clean joints */}
      {(() => {
        const wallsArr = floor.walls as WallLike[]
        const corners = findCorners(wallsArr)
        // Per-room wall paint: a wall whose midpoint hugs a room's polygon
        // edge takes that room's wall material; unmatched walls (hallway
        // stubs, freestanding) keep the global one. Nearest edge wins, so a
        // partition between two differently painted rooms stays deterministic.
        const segDist = (px: number, py: number, a: Point, b: Point): number => {
          const vx = b.x - a.x, vy = b.y - a.y
          const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy || 1)))
          return Math.hypot(px - (a.x + vx * t), py - (a.y + vy * t))
        }
        const wallCatalogFor = (wall: Wall): Material => {
          const mx = (wall.a.x + wall.b.x) / 2, my = (wall.a.y + wall.b.y) / 2
          let best: string | undefined
          let bestD = wall.thickness / 2 + 12
          for (const r of floor.rooms as Room[]) {
            if (!r.wallMaterialId || r.polygon.length < 3) continue
            for (let i = 0, j = r.polygon.length - 1; i < r.polygon.length; j = i++) {
              const d = segDist(mx, my, r.polygon[j], r.polygon[i])
              if (d < bestD) { bestD = d; best = r.wallMaterialId }
            }
          }
          return best ? resolveSurfaceMaterialId(best, 'wall') : wallMaterial
        }
        return (
          <>
            {wallsArr.map((wall: Wall) => {
              const { extA, extB } = cornerExtensionsFor(wall, wallsArr)
              // Which face points into the room (toward the plan centre)? Local
              // +z maps to plan (-uy, ux); dot with the vector to centre gives the
              // interior sign — used to hang curtains on the inside of a window.
              const dxw = wall.b.x - wall.a.x, dyw = wall.b.y - wall.a.y
              const lw = Math.hypot(dxw, dyw) || 1
              const mxw = (wall.a.x + wall.b.x) / 2, myw = (wall.a.y + wall.b.y) / 2
              const interiorSign = ((-dyw / lw) * (width / 2 - mxw) + (dxw / lw) * (height / 2 - myw)) >= 0 ? 1 : -1
              // Outward normal (plan space, world z = plan y): perpendicular to the
              // wall pointing away from the building centre — drives the camera fade.
              let onx = -dyw / lw, onz = dxw / lw
              if (onx * (mxw - width / 2) + onz * (myw - height / 2) < 0) { onx = -onx; onz = -onz }
              // Only perimeter (exterior) walls auto-fade, and only in orbit mode.
              const canDim = !walkMode && wall.thickness >= 20
              return (
                <Wall3D
                  key={wall.id}
                  id={wall.id}
                  a={wall.a} b={wall.b} thickness={wall.thickness}
                  selected={false}
                  material={wallCatalogFor(wall)}
                  extA={extA} extB={extB}
                  subtype={wall.subtype}
                  openingWidth={wall.openingWidth}
                  openingHeight={wall.openingHeight}
                  openingSill={wall.openingSill}
                  interiorSign={interiorSign}
                  outNx={onx} outNz={onz} dim={canDim}
                />
              )
            })}
            {corners.map((c, i) => (
              <CornerPillar
                key={`corner-${i}`}
                x={c.x} z={c.y} size={c.size}
                height={M(250)}
                material={wallMaterial}
              />
            ))}
          </>
        )
      })()}

      {/* Devices */}
      {floor.devices.map((d: PlacedDevice) => <Device3D key={d.id} d={d} />)}

      {/* Furniture */}
      {floor.furniture.filter((f: PlacedFurniture) => !f.hidden).map((f: PlacedFurniture) => <Furniture3D key={f.id} f={f} />)}

      {/* Image-Blaster assets — wall art & generated objects */}
      {(floor.blasterAssets ?? []).filter((a) => !a.hidden).map((a) => <BlasterAsset3D key={a.id} asset={a} />)}

      {/* Frame the dollhouse to the plan size on entry */}
      {!walkMode && <CameraFit wM={wM} hM={hM} cx={cx} cz={cz} />}

      {/* Camera controls */}
      {walkMode ? (
        <WalkController floor={floor} />
      ) : (
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={1.5}
          maxDistance={42}
          maxPolarAngle={Math.PI / 2.05}
          target={[cx, 0.2, cz]}
          rotateSpeed={0.6}
          zoomSpeed={0.8}
          panSpeed={0.8}
        />
      )}

      {/* Local procedural studio IBL — reflections on metals/glass/gloss,
          offline-first (no CDN HDRI, no Suspense/network dependency). */}
      <SkyEnvironment env={env} preset={envPreset} />
    </>
  )
}

/**
 * Writes the camera's yaw into the compass-needle DOM node every frame
 * (direct style write — no React re-renders). North = the plan's top (-Z).
 */
function CompassTracker({ needle }: { needle: React.RefObject<HTMLDivElement | null> }) {
  const { camera } = useThree()
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const el = needle.current
    if (!el) return
    camera.getWorldDirection(dir)
    const rot = -Math.atan2(dir.x, -dir.z) * (180 / Math.PI)
    el.style.transform = `rotate(${rot}deg)`
  })
  return null
}

function LoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-12 h-12 mx-auto rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" />
        <div className="font-display text-sm text-[color:var(--muted)]">3D-Szene wird vorbereitet…</div>
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]/70">Texturen werden generiert</div>
      </div>
    </div>
  )
}

export function ThreeDView({ onClose, embedded = false, preview = false }: {
  onClose?: () => void
  /** Fills its parent instead of the viewport (editor shell). */
  embedded?: boolean
  /** Bare canvas without toolbars/hints — for dashboard preview cards. */
  preview?: boolean
}) {
  // Default to evening — the archviz-reference mood (warm lit rooms against a
  // dark, receded surrounding) is the product's hero look; daylight stays one
  // slider-drag away.
  // Time-of-day starts at the real current time ("von Grund auf die aktuelle
  // Zeit"), but stays freely settable via the slider / the "Jetzt" button.
  const nowHours = () => { const d = new Date(); return Math.round((d.getHours() + d.getMinutes() / 60) * 4) / 4 }
  const [timeOfDay, setTimeOfDay] = useState(nowHours)
  // Location-true sun: composer-generated plans carry their real-world anchor
  // (doc.geo) — the sun study then runs on the actual latitude instead of the
  // central-European default.
  const geoLat = usePlanStore((s) => s.doc?.geo?.lat)
  const env = useMemo(
    () => deriveEnvironment(geoLat != null ? { timeOfDay, latitudeDeg: geoLat } : { timeOfDay }),
    [timeOfDay, geoLat],
  )
  const [floorVariant, setFloorVariant] = useState<FloorVariant>('walnut')
  const [wallMaterialId, setWallMaterialId] = useState<string>(DEFAULT_WALL_MATERIAL_ID)
  const [walkMode, setWalkMode] = useState(false)
  const [matPanelOpen, setMatPanelOpen] = useState(false)
  const [envPreset, setEnvPreset] = useState<EnvPreset>('studio')
  // Own-house exterior shell — off by default (open dollhouse); on wraps the
  // apartment in its real Klinker building with a Ziegel roof.
  const [showHouse, setShowHouse] = useState(false)
  // Etagen-Stack (exploded multi-storey view) — Pro feature.
  const [stackView, setStackView] = useState(false)
  const { can } = useTier()
  const navigate = useNavigate()
  const canStack = can('floor-stack')
  // Bau-Studio — Max feature; the chosen build persists locally.
  const canFacade = can('facade-studio')
  const [houseStyle, setHouseStyle] = useState<HouseStyle>(() => loadHouseStyle())
  const [studioOpen, setStudioOpen] = useState(false)
  const patchHouseStyle = (p: Partial<HouseStyle>) => setHouseStyle((s) => { const n = { ...s, ...p }; saveHouseStyle(n); return n })
  // Foto-Look — AgX tone mapping is the default (modern archviz: physically
  // correct highlight roll-off). Toggle reverts to the "Brillant" ACES look.
  const [photoLook, setPhotoLook] = useState(true)
  // Virtual residents: 0 = off, then 1 or 2 people walking their daily routine.
  const [residents, setResidents] = useState(0)
  const [residentStatus, setResidentStatus] = useState<ResidentStatus | null>(null)
  const compassNeedleRef = useRef<HTMLDivElement | null>(null)
  // Cinematic camera: every move is an eased AAA-style flight (presets, room
  // fly-ins, and the recordable Kino-Tour). Screenshot capture + fullscreen.
  const [flyReq, setFlyReq] = useState<FlightReq | null>(null)
  const [activePreset, setActivePreset] = useState<CamPreset>('persp')
  const [tourActive, setTourActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const tourHud = useRef<TourHud>({ title: null, bar: null })
  const recorderRef = useRef<{ stop: () => void } | null>(null)
  const captureRef = useRef<(() => void) | undefined>(undefined)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const goPreset = (preset: CamPreset) => {
    setActivePreset(preset)
    setFlyReq((r) => ({ kind: 'preset', preset, nonce: (r?.nonce ?? 0) + 1 }))
  }
  const flyToRoom = (roomId: string) => {
    setFlyReq((r) => ({ kind: 'room', roomId, nonce: (r?.nonce ?? 0) + 1 }))
    // Cinematic beat on the dolly-in: a soft pulse where the glide will land
    // (viewport focus point) + the subtle select tick. No-op when the mode is off.
    const vr = viewportRef.current?.getBoundingClientRect()
    if (vr) cinematicReact(vr.left + vr.width / 2, vr.top + vr.height * 0.42, 'select')
  }
  const startTour = (record: boolean) => {
    if (walkMode) setWalkMode(false)
    if (record) {
      const canvas = viewportRef.current?.querySelector('canvas')
      recorderRef.current = canvas ? startCanvasRecording(canvas) : null
      setRecording(!!recorderRef.current)
    }
    setTourActive(true)
    setFlyReq((r) => ({ kind: 'tour', nonce: (r?.nonce ?? 0) + 1 }))
  }
  const endTour = () => {
    setTourActive(false)
    setRecording(false)
    recorderRef.current?.stop()
    recorderRef.current = null
  }
  // Rooms of the active floor — the fly-to chips under the header.
  const planDoc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  const roomChips = useMemo(() => {
    const fl = planDoc?.floors.find((f) => f.id === planDoc?.activeFloorId)
    return (fl?.rooms ?? []).filter((r) => r.polygon.length >= 3).map((r) => ({ id: r.id, name: r.name }))
  }, [planDoc])

  // Material target: the whole plan or ONE room — every room is individually
  // stylable. Writes go into the document (persisted, undoable, 2D↔3D sync),
  // never into throwaway component state.
  const [matRoom, setMatRoom] = useState<string>('all')
  const matProbe = useMemo(() => {
    const fl = planDoc?.floors.find((f) => f.id === planDoc?.activeFloorId)
    const rooms = fl?.rooms ?? []
    return rooms.find((r) => r.id === matRoom) ?? rooms[0]
  }, [planDoc, matRoom])
  const toggleFullscreen = () => {
    const el = viewportRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }
  // Contact-hardening shadows. This rewrites a global three shader chunk, so it
  // has to run before the canvas below compiles its first material — hence the
  // render phase rather than an effect. The call is idempotent and guarded, and
  // returns false rather than breaking if three's shader ever changes shape.
  // Only on 'high': PCSS costs roughly twice the shadow taps of plain PCF.
  useMemo(() => (readTier() === 'high' ? enablePcssShadows() : false), [])

  // Adaptive resolution: render at up to the device's real pixel ratio (capped
  // at 2 so 3× phones don't melt), which keeps edges crisp on hi-dpi screens
  // instead of the old flat 1.5. PerformanceMonitor then steps it DOWN under
  // load and back UP when headroom returns — a smooth ramp, not the old
  // one-way drop to 1. Material quality is never touched.
  const dprCap = useMemo(() => Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2), [])
  const [dprMax, setDprMax] = useState(() => Math.min(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2), 1.75))
  // v17 — warm the texture cache (IndexedDB or generate) before mounting the 3D Canvas
  const [texturesReady, setTexturesReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    getTexturesAsync().then(() => { if (!cancelled) setTexturesReady(true) })
    return () => { cancelled = true }
  }, [])

  const floorOptions: Array<{ id: FloorVariant; label: string; swatch: string }> = [
    { id: 'walnut',     label: 'Walnuss',      swatch: '#5c3d2a' },
    { id: 'parquet',    label: 'Eiche',        swatch: '#a17246' },
    { id: 'vinylLight', label: 'Vinyl hell',   swatch: '#dac8aa' },
    { id: 'vinylDark',  label: 'Vinyl dunkel', swatch: '#4e3a2c' },
    { id: 'slate',      label: 'Schiefer',     swatch: '#3a3d44' },
    { id: 'tile',       label: 'Fliesen',      swatch: '#e6e3dd' },
  ]
  const wallOptions = materialsForSurface('wall')
  const applyRoomSurface = (surface: 'floor' | 'wall' | 'ceiling', id: string) => {
    updateDoc((d) => {
      const fl = d.floors.find((f) => f.id === d.activeFloorId)
      if (!fl) return
      for (const r of fl.rooms) {
        if (matRoom !== 'all' && r.id !== matRoom) continue
        if (surface === 'floor') r.floorMaterialId = id
        else if (surface === 'wall') r.wallMaterialId = id
        else r.ceilingMaterialId = id
      }
    })
    // "Alle Räume" also retunes the global fallback walls outside any room.
    if (surface === 'wall' && matRoom === 'all') setWallMaterialId(id)
  }

  return (
    <div className={embedded
      ? 'absolute inset-0 bg-[color:var(--bg)] flex flex-col'
      : 'fixed inset-0 z-40 bg-[color:var(--bg)] flex flex-col animate-fade-in'}>
      {/* Header — embedded: the reference's centered strip (2D Plan | 3D
          Ansicht | Walkthrough + time pill + material popover); fullscreen
          keeps the solid toolbar. */}
      {!preview && embedded && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 max-w-[calc(100%-1rem)]">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {/* View segmented control */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
              <button
                onClick={() => useUIStore.getState().setViewMode('2d')}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
              >2D Plan</button>
              <button
                onClick={() => setWalkMode(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${!walkMode ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
              >3D Ansicht</button>
              <button
                onClick={() => setWalkMode(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${walkMode ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
              >Walkthrough</button>
            </div>
            {/* Time-of-day pill */}
            <div
              className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg"
              title="Tageszeit – bewegt Sonne, Licht, Himmel und Schatten"
            >
              {env.sun.aboveHorizon ? <Sun size={14} className="text-[color:var(--accent)]" /> : <Moon size={14} className="text-[color:var(--muted)]" />}
              <input
                type="range" min={0} max={24} step={0.25} value={timeOfDay}
                onChange={(e) => setTimeOfDay(parseFloat(e.target.value))}
                className="w-14 sm:w-20 accent-[color:var(--accent)] cursor-pointer"
                aria-label="Tageszeit"
              />
              <span className="text-[11px] tabular-nums whitespace-nowrap">
                {formatClock(timeOfDay)}<span className="hidden sm:inline"> · {PHASE_LABEL[env.phase]}</span>
              </span>
              <button
                onClick={() => setTimeOfDay(nowHours())}
                className="spring-press rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
                title="Auf aktuelle Uhrzeit zurücksetzen"
              >Jetzt</button>
            </div>
            {/* Material popover toggle */}
            <button
              onClick={() => setMatPanelOpen((o) => !o)}
              className={`flex items-center justify-center h-8 w-8 rounded-xl border shadow-lg backdrop-blur-md transition-colors ${matPanelOpen ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white' : 'border-[color:var(--border)] bg-[color:var(--surface)]/85 text-[color:var(--muted)] hover:text-[color:var(--fg)]'}`}
              title="Boden & Wand Materialien"
            >
              <Palette size={14} />
            </button>
            {/* Kino-Tour — a product-video style camera pass, on demand */}
            {!walkMode && (
              <button
                onClick={() => startTour(false)}
                className="flex items-center justify-center h-8 w-8 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 shadow-lg backdrop-blur-md text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
                title="Kino-Tour — cinematischer Rundflug durch alle Räume"
              >
                <Clapperboard size={14} />
              </button>
            )}
            {!walkMode && CAN_RECORD && (
              <button
                onClick={() => startTour(true)}
                className={`flex items-center justify-center h-8 w-8 rounded-xl border shadow-lg backdrop-blur-md transition-colors ${recording ? 'border-[#e04848] bg-[#e04848] text-white' : 'border-[color:var(--border)] bg-[color:var(--surface)]/85 text-[color:var(--muted)] hover:text-[#e04848]'}`}
                title="Kino-Tour als Video aufnehmen (.webm) — dein Produktvideo auf Knopfdruck"
              >
                <CircleDot size={14} />
              </button>
            )}
          </div>
          {/* Room fly-to chips — select a room and the camera glides inside */}
          {!walkMode && roomChips.length > 0 && (
            <div className="flex items-center gap-0.5 max-w-[94vw] overflow-x-auto px-1 py-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
              {roomChips.map((r) => (
                <button
                  key={r.id}
                  onClick={() => flyToRoom(r.id)}
                  className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
                  title={`In „${r.name}" hineingleiten`}
                >{r.name}</button>
              ))}
            </div>
          )}
          {/* Material popover — room-aware, document-persistent. */}
          {matPanelOpen && (
            <div className="flex flex-col items-center gap-1.5 max-w-[94vw] px-3 py-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/90 backdrop-blur-md shadow-lg animate-fade-in">
              <div className="flex items-center gap-1 flex-wrap justify-center">
                <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted)]">Für</span>
                {[{ id: 'all', name: 'Alle Räume' }, ...roomChips].map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setMatRoom(r.id)}
                    className={`spring-press shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${matRoom === r.id ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'}`}
                  >{r.name}</button>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-center">
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted)]">Boden</span>
              {materialsForSurface('floor').map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => applyRoomSurface('floor', opt.id)}
                  className={`w-6 h-6 rounded border transition-all ${matProbe && resolveFloorMaterial(matProbe).id === opt.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: opt.color }}
                  title={opt.name}
                />
              ))}
              <span className="ml-2 text-[9px] uppercase tracking-wider text-[color:var(--muted)]">Wand</span>
              {wallOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => applyRoomSurface('wall', opt.id)}
                  className={`w-6 h-6 rounded border transition-all ${(matProbe?.wallMaterialId ?? wallMaterialId) === opt.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: opt.color }}
                  title={opt.name}
                />
              ))}
              <span className="ml-2 text-[9px] uppercase tracking-wider text-[color:var(--muted)]">Decke</span>
              {materialsForSurface('ceiling').map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => applyRoomSurface('ceiling', opt.id)}
                  className={`w-6 h-6 rounded border transition-all ${matProbe && resolveCeilingMaterial(matProbe).id === opt.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                  style={{ background: opt.color }}
                  title={opt.name}
                />
              ))}
              <span className="ml-2 text-[9px] uppercase tracking-wider text-[color:var(--muted)]">HDR</span>
              {(Object.keys(ENV_PRESET_LABEL) as EnvPreset[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setEnvPreset(p)}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${envPreset === p ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'}`}
                  title={`Umgebungslicht: ${ENV_PRESET_LABEL[p]}`}
                >
                  {ENV_PRESET_LABEL[p]}
                </button>
              ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!preview && !embedded && (
      <div className={'relative flex items-center justify-between px-5 py-3 border-b border-[color:var(--border)] bg-[color:var(--surface)] gap-3'}>
        {(
        <div className="flex items-center gap-3 min-w-0">
          <Eye size={16} className="text-[color:var(--accent)] shrink-0" />
          <div className="min-w-0">
            <div className="font-display text-lg leading-none">3D Ansicht</div>
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)] mt-0.5">
              Omega Atelier — 2026 premium render
            </div>
          </div>
        </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Floor selector */}
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)]">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted)] mr-1">Boden</span>
            {floorOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFloorVariant(opt.id)}
                className={`w-6 h-6 rounded border transition-all ${floorVariant === opt.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                style={{ background: opt.swatch }}
                title={opt.label}
              />
            ))}
          </div>
          {/* Wall selector */}
          <div className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)]">
            <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted)] mr-1">Wand</span>
            {wallOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setWallMaterialId(opt.id)}
                className={`w-6 h-6 rounded border transition-all ${wallMaterialId === opt.id ? 'border-[color:var(--accent)] scale-110' : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)]'}`}
                style={{ background: opt.color }}
                title={opt.name}
              />
            ))}
          </div>
          <button
            onClick={() => setWalkMode((w) => !w)}
            className={`btn btn-sm ${walkMode ? 'btn-primary' : 'btn-ghost'}`}
            title={walkMode ? 'Walk-Mode beenden' : 'Walk-Mode starten (Klick + Maus, WASD)'}
          >
            <Footprints size={14} />
            <span className="hidden md:inline">{walkMode ? 'Walk an' : 'Walk'}</span>
          </button>
          <div
            className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md border border-[color:var(--border)] bg-[color:var(--bg)]"
            title="Tageszeit – bewegt Sonne, Licht, Himmel und Schatten"
          >
            {env.sun.aboveHorizon ? <Sun size={14} className="text-[color:var(--accent)]" /> : <Moon size={14} className="text-[color:var(--muted)]" />}
            <input
              type="range" min={0} max={24} step={0.25} value={timeOfDay}
              onChange={(e) => setTimeOfDay(parseFloat(e.target.value))}
              className="w-28 accent-[color:var(--accent)] cursor-pointer"
              aria-label="Tageszeit"
            />
            <span className="text-[11px] tabular-nums text-[color:var(--text)] whitespace-nowrap">
              {formatClock(timeOfDay)} · {PHASE_LABEL[env.phase]}
            </span>
            <button
              onClick={() => setTimeOfDay(nowHours())}
              className="spring-press rounded-md px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
              title="Auf aktuelle Uhrzeit zurücksetzen"
            >Jetzt</button>
          </div>
          {onClose && (
            <button onClick={onClose} className="btn btn-ghost btn-icon" title="Schließen (Esc)">
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      )}

      {/* 3D Canvas */}
      <div ref={viewportRef} className="flex-1 relative">
        {!texturesReady && <LoadingFallback />}
        {texturesReady && (
        <Suspense fallback={<LoadingFallback />}>
          <Canvas
            camera={{ position: [6, 6, 8], fov: 38 }}
            shadows="soft"
            dpr={[1, dprMax]}
            gl={{
              antialias: true,
              alpha: false,
              preserveDrawingBuffer: true,
              powerPreference: 'high-performance',
              toneMapping: THREE.AgXToneMapping,
              toneMappingExposure: 1.0,
              outputColorSpace: THREE.SRGBColorSpace,
            }}
            style={{ background: `linear-gradient(180deg, ${env.sky.zenithColor} 0%, ${env.sky.horizonColor} 100%)` }}
          >
            <PerformanceMonitor
              bounds={(rate) => (rate > 90 ? [55, 90] : [48, 60])}
              flipflops={3}
              onDecline={() => setDprMax((d) => Math.max(1, Math.round((d - 0.25) * 100) / 100))}
              onIncline={() => setDprMax((d) => Math.min(dprCap, Math.round((d + 0.25) * 100) / 100))}
              onFallback={() => setDprMax(1)}
            />
            <CompassTracker needle={compassNeedleRef} />
            <CaptureHelper captureRef={captureRef} />
            {!walkMode && <CinematicDirector req={flyReq} hud={tourHud} onTourEnd={endTour} />}
            <ToneMapController photo={photoLook} />
            <Scene env={env} floorVariant={floorVariant} wallMaterialId={wallMaterialId} walkMode={walkMode} envPreset={envPreset} showHouse={showHouse} stackView={stackView} houseStyle={houseStyle} residents={residents} onResidentStatus={setResidentStatus} />
            <RenderFXBoundary>
              {readTier() === 'high' && dprMax > 1 ? (
                /* MSAA 4× resolves geometry edges BEFORE post, then SMAA cleans
                   the shaded/sub-pixel edges — together they kill the jaggies on
                   walls, furniture and the neighbourhood roofs. */
                <EffectComposer multisampling={4}>
                  {/* N8AO — modern high-quality ambient occlusion (contact darkening
                      in corners / under furniture), a big step up from SSAO for the
                      grounded archviz look. Half-res + medium quality stays perf-safe. */}
                  <N8AO
                    aoRadius={0.9}
                    distanceFalloff={1.0}
                    intensity={2.6}
                    quality="medium"
                    halfRes
                    color="#080810"
                  />
                  {/* Contextual DOF — focal plane rides the orbit target; the
                      CinematicDirector pulls focus during glides. */}
                  <CinematicFocus walkMode={walkMode} />
                  <Bloom luminanceThreshold={0.88} intensity={0.24} mipmapBlur radius={0.55} />
                  <HueSaturation saturation={0.08} />
                  <BrightnessContrast contrast={0.05} />
                  <ChromaticAberration offset={CA_OFFSET} radialModulation modulationOffset={0.35} />
                  <Vignette offset={0.3} darkness={0.42} />
                  <SMAA />
                </EffectComposer>
              ) : readTier() !== 'off' && (
                /* Mid tier: MSAA 2× + SMAA so edges are smooth here too (the old
                   pass had NO anti-aliasing → the "pixelig an Ecken" look), plus
                   the cheap contrast/vignette mood shaders. No AO/bloom → still
                   light enough for weaker GPUs. */
                <EffectComposer multisampling={2}>
                  <BrightnessContrast contrast={0.07} brightness={-0.008} />
                  <Vignette offset={0.32} darkness={0.4} />
                  <SMAA />
                </EffectComposer>
              )}
            </RenderFXBoundary>
          </Canvas>
        </Suspense>
        )}

        {/* Kino-Tour HUD — letterbox bars, room title, progress hairline. The
            title/progress nodes are written imperatively by the director. */}
        {tourActive && (
          <div className="pointer-events-none absolute inset-0 z-20 animate-fade-in">
            <div className="absolute top-0 left-0 right-0 h-[7%] bg-black/90" />
            <div className="absolute bottom-0 left-0 right-0 h-[7%] bg-black/90" />
            <div className="absolute bottom-[9%] left-5 sm:left-8 flex flex-col gap-0.5">
              <span className="text-[9px] sm:text-[10px] uppercase tracking-[0.3em] text-[color:var(--accent)]">
                {recording ? '● REC · OMEGA Kino-Tour' : 'OMEGA Kino-Tour'}
              </span>
              <span ref={(el) => { tourHud.current.title = el }} className="font-display text-xl sm:text-3xl text-white drop-shadow-lg" />
            </div>
            <div className="absolute top-[9%] right-5 sm:right-8 text-[9px] sm:text-[10px] uppercase tracking-wider text-white/60">
              Tippen zum Beenden
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
              <div ref={(el) => { tourHud.current.bar = el }} className="h-full bg-[color:var(--accent)]" style={{ width: '0%' }} />
            </div>
          </div>
        )}

        {/* Mobile material picker — collapsed pill-row at the bottom on small
            screens (kept clear of the centered header, which it used to overlap). */}
        {!preview && !tourActive && (
        <div className="md:hidden absolute bottom-16 left-1/2 -translate-x-1/2 z-10 flex flex-nowrap gap-1 px-2 py-1.5 rounded-md surface-elevated max-w-[94vw] overflow-x-auto">
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted)] self-center mr-1 shrink-0">Boden</span>
          {floorOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFloorVariant(opt.id)}
              className={`w-5 h-5 shrink-0 rounded border ${floorVariant === opt.id ? 'border-[color:var(--accent)]' : 'border-[color:var(--border)]'}`}
              style={{ background: opt.swatch }}
              title={opt.label}
            />
          ))}
        </div>
        )}

        {/* Walk-Mode movement joystick (touch devices only) */}
        {walkMode && isCoarsePointer() && <WalkJoystick />}

        {/* Controls hint — adapts to pointer type */}
        {!preview && (
        <div className="absolute bottom-4 left-4 z-10 surface-elevated px-3 py-2 text-xs text-[color:var(--muted)] hidden sm:flex items-center gap-3">
          {walkMode ? (
            isCoarsePointer() ? (
              <>
                <span className="font-mono">Joystick</span> Gehen
                <span className="font-mono">Wischen</span> Umsehen
              </>
            ) : (
              <>
                <span className="font-mono">Klick</span> Maus locken
                <span className="font-mono">WASD</span> Bewegen
                <span className="font-mono">Esc</span> Verlassen
              </>
            )
          ) : (
            <>
              <span className="font-mono">Drag</span> Rotieren
              <span className="font-mono">Scroll</span> Zoom
              <span className="font-mono">Rechtsklick</span> Pan
            </>
          )}
        </div>
        )}

        {/* Quality tip — desktop only (overlaps the toolbar on phones) */}
        {!preview && (
        <div className="absolute top-4 right-4 z-10 surface-elevated px-3 py-2 text-xs text-[color:var(--muted)] hidden md:flex items-center gap-2">
          <Camera size={12} className="text-[color:var(--accent)]" />
          PBR · Texturen · Soft Shadows · ACES
        </div>
        )}

        {/* Virtual-residents status — a quiet live read-out of what the current
            occupant is doing and which smart-home scene it maps to. */}
        {!preview && residents > 0 && residentStatus && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 surface-elevated px-3.5 py-2 text-xs flex items-center gap-2.5 animate-fade-in">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[color:var(--accent)] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--accent)]" />
          </span>
          <span className="text-[color:var(--muted)]">Bewohner</span>
          <span className="text-[color:var(--fg)] font-medium">{residentStatus.room}</span>
          <span className="text-[color:var(--muted)]">·</span>
          <span className="text-[color:var(--fg)]">{residentStatus.activity}</span>
          {residentStatus.scene && (
            <>
              <span className="text-[color:var(--muted)]">→ Szene</span>
              <span className="text-[color:var(--accent)] font-medium">{residentStatus.scene}</span>
            </>
          )}
        </div>
        )}

        {/* Camera preset + capture toolbar — the pro-tool viewport controls
            (Twinmotion/Forma feel). Presets fly the camera smoothly; capture
            grabs the composed frame; fullscreen expands the viewport. */}
        {!preview && (
        <div className="absolute right-2 sm:right-4 top-20 z-10 flex flex-col items-center gap-1 p-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
          {!walkMode && ([
            ['persp', Box], ['corner', Boxes], ['top', LayoutGrid], ['front', Square],
          ] as Array<[CamPreset, typeof Box]>).map(([preset, Icon]) => (
            <button
              key={preset}
              onClick={() => goPreset(preset)}
              title={CAM_PRESET_LABEL[preset]}
              className={`flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                activePreset === preset ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
              }`}
            >
              <Icon size={15} />
            </button>
          ))}
          {!walkMode && (
            <button
              onClick={() => setShowHouse((v) => !v)}
              title={showHouse ? 'Eigenes Haus ausblenden (Puppenhaus)' : 'Eigenes Haus einblenden (Klinker-Außenansicht)'}
              className={`flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                showHouse ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
              }`}
            >
              <Home size={15} />
            </button>
          )}
          {!walkMode && (
            <button
              onClick={() => { if (!canStack) { navigate('/#preise'); return } setStackView((v) => !v) }}
              title={!canStack ? 'Etagen-Stack — ab Pro' : stackView ? 'Etagen-Stack ausblenden' : 'Etagen-Stack: alle Stockwerke übereinander'}
              className={`flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                stackView ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
              }`}
            >
              {canStack ? <Layers size={15} /> : <Lock size={15} />}
            </button>
          )}
          {/* Bau-Studio — construction · stone colour · roof shape · roof colour */}
          {!walkMode && showHouse && (
            <div className="relative">
              <button
                onClick={() => { if (canFacade) setStudioOpen((v) => !v); else navigate('/#preise') }}
                title={canFacade ? 'Bau-Studio: Fassade, Dach & Farben' : 'Bau-Studio — ab Max'}
                className={`flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                  studioOpen ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
                }`}
              >
                {canFacade ? <Palette size={15} /> : <Lock size={15} />}
              </button>
              {canFacade && studioOpen && (
                <div className="absolute right-full top-0 z-30 mr-2 w-56 origin-top-right animate-scale-in space-y-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--glass-bg)] p-3 shadow-xl backdrop-blur-xl">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">Bau-Studio</div>
                  <BauRow label="Bauart" options={FACADE_KINDS} active={houseStyle.facade} onPick={(id) => patchHouseStyle({ facade: id as HouseStyle['facade'] })} shape="chip" />
                  <BauRow label="Steinfarbe" options={STONE_COLORS} active={STONE_COLORS.find((o) => o.swatch === houseStyle.facadeTint)?.id ?? ''} onPick={(id) => patchHouseStyle({ facadeTint: STONE_COLORS.find((o) => o.id === id)!.swatch })} shape="dot" />
                  <BauRow label="Dachform" options={ROOF_KINDS} active={houseStyle.roof} onPick={(id) => patchHouseStyle({ roof: id as HouseStyle['roof'] })} shape="chip" />
                  <BauRow label="Dachfarbe" options={ROOF_COLORS} active={ROOF_COLORS.find((o) => o.swatch === houseStyle.roofTint)?.id ?? ''} onPick={(id) => patchHouseStyle({ roofTint: ROOF_COLORS.find((o) => o.id === id)!.swatch })} shape="dot" />
                  <button onClick={() => patchHouseStyle(DEFAULT_HOUSE_STYLE)} className="w-full rounded-md border border-[color:var(--border)] py-1 text-[11px] text-[color:var(--muted)] transition-colors hover:text-[color:var(--fg)]">Zurücksetzen</button>
                </div>
              )}
            </div>
          )}
          {/* Foto-Look — opt-in AgX tone mapping for maximum photorealism */}
          {!walkMode && (
            <button
              onClick={() => setPhotoLook((v) => !v)}
              title={photoLook ? 'Foto-Look aus (Brillant/ACES)' : 'Foto-Look an (AgX — natürlicher Kontrast)'}
              className={`flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                photoLook ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
              }`}
            >
              <Aperture size={15} />
            </button>
          )}
          {!walkMode && (
            <button
              onClick={() => setResidents((v) => (v + 1) % 3)}
              title={residents === 0 ? 'Virtuelle Bewohner einblenden' : residents === 1 ? 'Zweiten Bewohner hinzufügen' : 'Bewohner ausblenden'}
              className={`relative flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg transition-colors ${
                residents > 0 ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)]'
              }`}
            >
              <Users size={15} />
              {residents > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[color:var(--bg)] text-[8px] font-semibold text-[color:var(--accent)] ring-1 ring-[color:var(--accent)]">
                  {residents}
                </span>
              )}
            </button>
          )}
          {!walkMode && <div className="my-0.5 h-px w-6 bg-[color:var(--border)]" />}
          <button
            onClick={() => captureRef.current?.()}
            title="Screenshot speichern"
            className="flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
          >
            <ImageDown size={15} />
          </button>
          <button
            onClick={toggleFullscreen}
            title="Vollbild"
            className="flex h-9 w-9 md:h-8 md:w-8 items-center justify-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
          >
            <Maximize2 size={15} />
          </button>
        </div>
        )}

        {/* Compass + scale — the reference's right-edge viewport widgets.
            The needle div is rotated imperatively by CompassTracker. */}
        {!preview && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 z-10 hidden sm:flex flex-col items-center gap-2">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
            <div ref={compassNeedleRef} className="flex flex-col items-center will-change-transform">
              <span className="text-[9px] font-semibold leading-none text-[color:var(--accent)]">N</span>
              <svg viewBox="0 0 8 14" className="mt-0.5 h-3.5 w-2">
                <path d="M4 0 L7 8 L4 6.4 L1 8 Z" fill="currentColor" className="text-[color:var(--accent)]" />
                <path d="M4 14 L1 8 L4 7.6 L7 8 Z" fill="currentColor" className="text-[color:var(--muted)]" opacity="0.55" />
              </svg>
            </div>
          </div>
          <div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)]/85 px-1.5 py-0.5 font-mono text-[9px] text-[color:var(--muted)] backdrop-blur-md shadow-lg">
            2.0m
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
