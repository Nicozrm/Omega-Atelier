/**
 * world — the Living World generator.
 *
 * One call, {@link generateNeighbourhood}, turns a plan's footprint and a
 * regional style into a complete, deterministic description of the place the
 * building stands in: a connected street graph, blocks, plots, the houses on
 * them, a local centre with a supermarket and its car park, a park with a
 * playground, street furniture, and the routes vehicles and people move along.
 *
 * The result is plain data. Nothing here imports THREE or React, so the same
 * world can drive the 3D renderer today and shadow studies, noise maps or a
 * mini-map tomorrow without any of them re-deriving the layout.
 */

import { cityStyleSpec, type CityStyle } from './cityStyle'
import { hashInts } from '@/lib/composer/rng'
import {
  buildStreetNetwork, type Block, type StreetNetwork, type Vec2,
} from './streetNetwork'
import { houseForPlot, subdividePlots, type HouseSpec, type Plot, type PlotUse } from './plots'
import {
  assignBlockUse, buildCentre, buildPark, streetFurniture,
  type Amenity, type ParkSpec, type StreetFurniture,
} from './amenities'
import {
  buildPedestrians, buildTraffic, buildVehicleRoutes, buildWalkRoutes,
  type Person, type Route, type Vehicle,
} from './traffic'

export * from './cityStyle'
export * from './streetNetwork'
export * from './plots'
export * from './amenities'
export * from './traffic'
export * from './fromOsm'

/** How much of the living layer to generate — scales with the render tier. */
export type WorldDetail = 'low' | 'medium' | 'high'

export interface WorldInput {
  style: CityStyle
  /** The plan's centre in world metres. */
  centre: Vec2
  /** The plan's extent in metres. */
  widthM: number
  depthM: number
  detail: WorldDetail
  /** Stable seed — derive it from the plan id so a plan keeps its world. */
  seed: number
}

export interface Neighbourhood {
  style: CityStyle
  seed: number
  network: StreetNetwork
  plots: Plot[]
  houses: HouseSpec[]
  amenities: Amenity[]
  park?: ParkSpec
  furniture: StreetFurniture[]
  vehicleRoutes: Route[]
  walkRoutes: Route[]
  vehicles: Vehicle[]
  people: Person[]
  /** Half-extent of the ground plane the renderer should lay down. */
  extentM: number
}

interface DetailBudget {
  rings: number
  vehicleRoutes: number
  walkRoutes: number
  traffic: number
  people: number
  /** Radius within which houses carry full trim. */
  fullM: number
  /** Radius within which houses keep windows and roof detail. */
  simpleM: number
  /** Street furniture beyond this distance is dropped — it is sub-pixel there. */
  furnitureM: number
}

const DETAIL: Record<WorldDetail, DetailBudget> = {
  low: { rings: 1, vehicleRoutes: 4, walkRoutes: 4, traffic: 0.7, people: 0.6, fullM: 45, simpleM: 90, furnitureM: 110 },
  medium: { rings: 2, vehicleRoutes: 7, walkRoutes: 8, traffic: 1.0, people: 0.9, fullM: 70, simpleM: 150, furnitureM: 170 },
  high: { rings: 2, vehicleRoutes: 11, walkRoutes: 14, traffic: 1.3, people: 1.2, fullM: 105, simpleM: 210, furnitureM: 240 },
}

export function generateNeighbourhood(input: WorldInput): Neighbourhood {
  const budget = DETAIL[input.detail] ?? DETAIL.medium
  const seed = input.seed >>> 0
  const network = buildStreetNetwork({
    style: input.style, centre: input.centre, rings: budget.rings, seed,
  })

  const blockUse: Map<string, PlotUse> = assignBlockUse(network, input.style, seed)

  const plots = subdividePlots(
    {
      style: input.style, network, seed,
      ownHalfW: input.widthM / 2, ownHalfD: input.depthM / 2,
    },
    blockUse,
  )

  const lodInput = { centre: input.centre, fullM: budget.fullM, simpleM: budget.simpleM }
  const houses = plots
    .filter((p) => p.use === 'house')
    .map((p) => houseForPlot(p, input.style, lodInput))

  const amenityBlock = findBlock(network, blockUse, 'amenity')
  const greenBlock = findBlock(network, blockUse, 'green')
  const amenities = amenityBlock ? buildCentre(amenityBlock, input.style, seed) : []
  const park = greenBlock ? buildPark(greenBlock, input.style, seed) : undefined

  // Street furniture is dense by nature (a lamp every 26 m on every segment);
  // past the furniture radius it is smaller than a pixel, so it never gets built.
  const furniture = streetFurniture(network, input.style, seed).filter(
    (f) => Math.hypot(f.at.x - input.centre.x, f.at.z - input.centre.z) <= budget.furnitureM,
  )

  const vehicleRoutes = buildVehicleRoutes(network, budget.vehicleRoutes, seed)
  const walkRoutes = buildWalkRoutes(network, budget.walkRoutes, seed)
  const vehicles = buildTraffic(vehicleRoutes.length, seed, budget.traffic)
  const people = buildPedestrians(walkRoutes.length, seed, budget.people)

  return {
    style: input.style, seed, network, plots, houses, amenities, park, furniture,
    vehicleRoutes, walkRoutes, vehicles, people,
    extentM: network.extentM,
  }
}

function findBlock(
  network: StreetNetwork,
  use: Map<string, PlotUse>,
  want: PlotUse,
): Block | undefined {
  for (const [id, u] of use) if (u === want) return network.blocks.find((b) => b.id === id)
  return undefined
}

/** Stable seed for a plan — same plan, same neighbourhood, every session. */
export function seedForPlan(planId: string, style: CityStyle): number {
  let h = 0x811c9dc5
  for (let i = 0; i < planId.length; i++) {
    h ^= planId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return hashInts(h >>> 0, style.charCodeAt(0))
}

/** Latitude the environment model should use for a region. */
export function latitudeForStyle(style: CityStyle): number {
  return cityStyleSpec(style).latitudeDeg
}
