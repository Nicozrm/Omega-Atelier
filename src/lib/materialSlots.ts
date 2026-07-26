/**
 * materialSlots.ts — v17.
 *
 * Pure data describing the material choices the user can pick from in the
 * PropertyPanel. The 3D view reads the same `key` strings to look up its
 * actual THREE materials (see ThreeDView.tsx > UPHOLSTERY_SLOTS / WOOD_SLOTS).
 *
 * Keep this file small + dependency-free so it can be imported into the
 * main bundle without pulling three.js in.
 */

export interface MaterialSlot {
  /** Unique identifier; written into PlacedFurniture.materialKey */
  key: string
  /** Display name shown in tooltip */
  label: string
  /** CSS color used for the picker swatch */
  swatch: string
}

export const UPHOLSTERY_SLOTS: MaterialSlot[] = [
  { key: 'fabricBeige',  label: 'Stoff Beige',   swatch: '#cdb992' },
  { key: 'fabricGray',   label: 'Stoff Grau',    swatch: '#9b9b96' },
  { key: 'fabricBlue',   label: 'Stoff Blau',    swatch: '#5a7da0' },
  { key: 'leatherBlack', label: 'Leder Schwarz', swatch: '#2a2724' },
]

export const WOOD_SLOTS: MaterialSlot[] = [
  { key: 'oak',    label: 'Eiche',   swatch: '#bb8a59' },
  { key: 'walnut', label: 'Walnuss', swatch: '#7a4d2d' },
]
