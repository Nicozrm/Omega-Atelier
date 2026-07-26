import type { PlanDocument, Floor, Wall } from '@/types'
import { uuid } from '@/lib/utils'
import { OMEGA_MODES, DEFAULT_FLOOR_EXTENT } from '@/lib/constants'

/** Build rectangular walls around a given extent. */
function rectWalls(w: number, h: number, thickness = 24): Wall[] {
  return [
    { id: uuid(), a: { x: 0, y: 0 }, b: { x: w, y: 0 }, thickness },
    { id: uuid(), a: { x: w, y: 0 }, b: { x: w, y: h }, thickness },
    { id: uuid(), a: { x: w, y: h }, b: { x: 0, y: h }, thickness },
    { id: uuid(), a: { x: 0, y: h }, b: { x: 0, y: 0 }, thickness },
  ]
}

function blankFloor(name: string, index = 0): Floor {
  return {
    id: uuid(),
    name,
    index,
    walls: rectWalls(DEFAULT_FLOOR_EXTENT.width, DEFAULT_FLOOR_EXTENT.height),
    rooms: [],
    devices: [],
    furniture: [],
    labels: [],
    layers: { walls: true, furniture: true, devices: true, labels: true },
    extent: DEFAULT_FLOOR_EXTENT,
  }
}

/** Build a fresh PlanDocument (used for new plans and as base for templates). */
export function createBlankPlan(title = 'Unbenannter Plan'): PlanDocument {
  const floor = blankFloor('Erdgeschoss', 0)
  return {
    schemaVersion: 2,
    id: uuid(),
    title,
    floors: [floor],
    activeFloorId: floor.id,
    activeModeKey: 'auto',
    modes: OMEGA_MODES,
    settings: {
      unit: 'cm',
      gridSize: 50,
      snap: true,
      snapStep: 10,
      showGrid: true,
      theme: 'dark',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export interface TemplateDescriptor {
  id: string
  name: string
  subtitle: string
  tags: string[]
  build: () => PlanDocument
}

/**
 * A curated set of starter templates. These are scaffolding — walls only —
 * so users can immediately drop devices & furniture. Can be extended later
 * with preset devices/furniture for each template.
 */
export const TEMPLATES: TemplateDescriptor[] = [
  {
    id: 'studio',
    name: 'Studio',
    subtitle: '1 Raum · 32 m²',
    tags: ['klein', 'offen'],
    build: () => {
      const p = createBlankPlan('Studio Apartment')
      p.floors[0].name = 'Studio'
      p.floors[0].extent = { width: 800, height: 400 }
      p.floors[0].walls = rectWalls(800, 400)
      return p
    },
  },
  {
    id: 'apartment-2',
    name: '2-Zimmer-Wohnung',
    subtitle: '2 Räume · 65 m²',
    tags: ['mittel', 'city'],
    build: () => {
      const p = createBlankPlan('2-Zimmer-Wohnung')
      p.floors[0].extent = { width: 1100, height: 600 }
      p.floors[0].walls = [
        ...rectWalls(1100, 600),
        { id: uuid(), a: { x: 650, y: 0 }, b: { x: 650, y: 600 }, thickness: 14 },
      ]
      return p
    },
  },
  {
    id: 'apartment-3',
    name: '3-Zimmer-Wohnung',
    subtitle: '3 Räume · 85 m²',
    tags: ['familie'],
    build: () => {
      const p = createBlankPlan('3-Zimmer-Wohnung')
      p.floors[0].extent = { width: 1300, height: 700 }
      p.floors[0].walls = [
        ...rectWalls(1300, 700),
        { id: uuid(), a: { x: 600, y: 0 }, b: { x: 600, y: 700 }, thickness: 14 },
        { id: uuid(), a: { x: 600, y: 400 }, b: { x: 1300, y: 400 }, thickness: 14 },
      ]
      return p
    },
  },
  {
    id: 'loft',
    name: 'Loft',
    subtitle: 'Offener Grundriss · 120 m²',
    tags: ['loft', 'offen'],
    build: () => {
      const p = createBlankPlan('Loft')
      p.floors[0].extent = { width: 1500, height: 800 }
      p.floors[0].walls = rectWalls(1500, 800, 28)
      return p
    },
  },
  {
    id: 'penthouse',
    name: 'Penthouse',
    subtitle: '4 Räume · Dachterrasse',
    tags: ['luxus'],
    build: () => {
      const p = createBlankPlan('Penthouse')
      const main = p.floors[0]
      main.name = 'Hauptetage'
      main.extent = { width: 1800, height: 1000 }
      main.walls = [
        ...rectWalls(1800, 1000, 28),
        { id: uuid(), a: { x: 900, y: 0 }, b: { x: 900, y: 600 }, thickness: 14 },
        { id: uuid(), a: { x: 900, y: 600 }, b: { x: 1800, y: 600 }, thickness: 14 },
      ]
      const roof: Floor = {
        ...blankFloor('Dachterrasse', 1),
        extent: { width: 1800, height: 1000 },
        walls: rectWalls(1800, 1000, 14),
      }
      p.floors.push(roof)
      return p
    },
  },
  {
    id: 'house-family',
    name: 'Einfamilienhaus',
    subtitle: '2 Etagen · Garten',
    tags: ['haus', 'familie'],
    build: () => {
      const p = createBlankPlan('Einfamilienhaus')
      p.floors[0].name = 'Erdgeschoss'
      p.floors[0].extent = { width: 1400, height: 1000 }
      p.floors[0].walls = rectWalls(1400, 1000, 28)
      const upper = blankFloor('1. OG', 1)
      upper.extent = { width: 1400, height: 1000 }
      upper.walls = rectWalls(1400, 1000, 28)
      p.floors.push(upper)
      return p
    },
  },
]
