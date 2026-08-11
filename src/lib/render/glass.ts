import * as THREE from 'three'
import { activeProfile } from '@/lib/render/quality'

/**
 * render/glass.ts — the glass family.
 *
 * Glass is the material a render is judged on. It is also the one most often
 * faked: a bluish transparent plane with `opacity: 0.25` reads as a *hole* in
 * the wall, not as a pane, because everything that makes real glass legible is
 * missing — the surface reflection that grows toward grazing angles, the slight
 * bend of what is behind it, the colour the body of the material adds over
 * distance, and the way the edge goes bright where the pane is thickest.
 *
 * These materials are physically parameterised instead:
 *
 *  - **`ior`** — refractive index. Soda-lime window glass is 1.52; acrylic is
 *    1.49; the number drives both the refraction and, through Fresnel, how
 *    reflective the surface becomes at an angle. It is the single most
 *    important glass parameter and the one usually left at its default.
 *  - **`transmission` + `thickness`** — light passing *through* the body rather
 *    than a blend against the framebuffer, so what is behind a pane is actually
 *    displaced, and a thicker pane displaces it more.
 *  - **`attenuationColor` + `attenuationDistance`** — Beer-Lambert absorption.
 *    This is why real float glass is faintly green when you look along an edge
 *    and clear when you look through the face; smoked and bronze glass are the
 *    same model with a stronger, warmer absorption.
 *  - **`roughness`** — one number takes the family from window (0.02) through
 *    satin partition to shower screen (0.3+). Frosted glass is not a different
 *    material, it is the same one with a rough surface.
 *  - **`dispersion`** — the refractive index varies with wavelength, so a thick
 *    edge splits white into a faint spectrum. Costs an extra sample set, so it
 *    is gated to the top profile.
 *  - **`iridescence`** — thin-film interference for coated architectural glass.
 *
 * On profiles without `transmission` the whole family degrades to tuned
 * transparent dielectrics that keep the right hue, gloss and Fresnel response —
 * the look softens, it does not break.
 */

export type GlassKind =
  /** Standard window glazing — faintly green, near-mirror surface. */
  | 'clear'
  /** Low-iron ("extra clear") architectural glazing — no green cast. */
  | 'lowIron'
  /** Shower screens, partitions, the glassmorphic panels. */
  | 'frosted'
  /** Smoked/grey glass: tabletops, dividers, appliance doors. */
  | 'smoked'
  /** Bronze-tinted solar-control glazing. */
  | 'bronze'
  /** Coated, thin-film iridescent glass — decorative accents. */
  | 'iridescent'

interface GlassSpec {
  color: string
  roughness: number
  ior: number
  thickness: number
  attenuationColor: string
  attenuationDistance: number
  /** Surface reflectivity multiplier (0…1 → F0 0…8 %). */
  specularIntensity: number
  transmission: number
  iridescence?: number
  iridescenceIOR?: number
  iridescenceThicknessRange?: [number, number]
  /** Opacity used on the non-transmission fallback path. */
  fallbackOpacity: number
}

const SPECS: Record<GlassKind, GlassSpec> = {
  clear: {
    color: '#ffffff',
    roughness: 0.02,
    ior: 1.52,
    thickness: 0.012,
    // The classic float-glass green — visible at the edges, invisible face-on.
    attenuationColor: '#cfe6dc',
    attenuationDistance: 1.6,
    specularIntensity: 1,
    transmission: 1,
    fallbackOpacity: 0.22,
  },
  lowIron: {
    color: '#ffffff',
    roughness: 0.015,
    ior: 1.52,
    thickness: 0.012,
    attenuationColor: '#eef6f4',
    attenuationDistance: 4,
    specularIntensity: 1,
    transmission: 1,
    fallbackOpacity: 0.18,
  },
  frosted: {
    color: '#f2f6f9',
    // Etched acid finish: the surface scatters, the body stays clear.
    roughness: 0.34,
    ior: 1.5,
    thickness: 0.02,
    attenuationColor: '#dceaf0',
    attenuationDistance: 0.9,
    specularIntensity: 0.9,
    transmission: 0.96,
    fallbackOpacity: 0.42,
  },
  smoked: {
    color: '#e8eaee',
    roughness: 0.05,
    ior: 1.52,
    thickness: 0.02,
    attenuationColor: '#3b4048',
    attenuationDistance: 0.55,
    specularIntensity: 1,
    transmission: 0.92,
    fallbackOpacity: 0.55,
  },
  bronze: {
    color: '#f6ece1',
    roughness: 0.045,
    ior: 1.52,
    thickness: 0.018,
    attenuationColor: '#7a5a3a',
    attenuationDistance: 0.8,
    specularIntensity: 1,
    transmission: 0.94,
    fallbackOpacity: 0.48,
  },
  iridescent: {
    color: '#ffffff',
    roughness: 0.06,
    ior: 1.5,
    thickness: 0.014,
    attenuationColor: '#e3eef2',
    attenuationDistance: 2.2,
    specularIntensity: 1,
    transmission: 0.97,
    iridescence: 1,
    iridescenceIOR: 1.34,
    iridescenceThicknessRange: [180, 520],
    fallbackOpacity: 0.3,
  },
}

const cache = new Map<string, THREE.Material>()

/**
 * A shared glass material. Instances are cached per kind *and* per profile, so
 * switching quality rebuilds the family rather than leaving the old shader
 * programs in place.
 */
export function glassMaterial(kind: GlassKind = 'clear'): THREE.Material {
  const profile = activeProfile()
  const key = `${kind}:${profile.id}`
  const hit = cache.get(key)
  if (hit) return hit

  const s = SPECS[kind]
  let mat: THREE.Material

  if (profile.transmission) {
    const physical = new THREE.MeshPhysicalMaterial({
      color: s.color,
      metalness: 0,
      roughness: s.roughness,
      transmission: s.transmission,
      thickness: s.thickness,
      ior: s.ior,
      specularIntensity: s.specularIntensity,
      attenuationColor: s.attenuationColor,
      attenuationDistance: s.attenuationDistance,
      envMapIntensity: 1.25,
      transparent: true,
      // Refractive glass writes no depth: the transmission pass needs whatever
      // is behind the pane to already be in the frame buffer.
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    if (profile.dispersion) physical.dispersion = 0.4
    if (s.iridescence) {
      physical.iridescence = s.iridescence
      physical.iridescenceIOR = s.iridescenceIOR ?? 1.3
      physical.iridescenceThicknessRange = s.iridescenceThicknessRange ?? [100, 400]
    }
    mat = physical
  } else {
    // No transmission budget: a plain transparent dielectric. Fresnel still
    // comes from the environment map, so panes keep their angular sheen and
    // never read as flat holes.
    mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(s.color).lerp(new THREE.Color(s.attenuationColor), 0.35),
      metalness: 0,
      roughness: Math.max(0.03, s.roughness),
      transparent: true,
      opacity: s.fallbackOpacity,
      depthWrite: false,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    })
  }

  mat.name = `glass:${kind}`
  cache.set(key, mat)
  return mat
}

/** Drop every cached glass material — called when the render profile changes. */
export function disposeGlassMaterials(): void {
  for (const m of cache.values()) m.dispose()
  cache.clear()
}
