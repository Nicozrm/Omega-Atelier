/**
 * fromOsm.ts — die **echte** Nachbarschaft, im selben Modell wie die erfundene.
 *
 * Das ist die Stelle, an der die beiden Stränge dieses Projekts
 * zusammenlaufen. Sprint 1 hat einen prozeduralen Generator gebaut, der eine
 * plausible Siedlung erzeugt; Slice 2 hat eine Quelle angebunden, die die
 * tatsächliche liefert. Beide münden hier in dieselbe {@link Neighbourhood} —
 * also denselben Renderer, dieselbe Verkehrssimulation, dieselben
 * Straßengraphen.
 *
 * Der Unterschied ist ausschließlich die Herkunft der Daten. Genau so war es im
 * Architekturentwurf gedacht: der Generator ist nicht der Konkurrent der echten
 * Quelle, sondern ihre Annahmeschicht.
 *
 * Praktisch heißt das: fehlt eine Quelle oder deckt sie den Ort nicht ab, zeigt
 * die App weiter eine vollständige Welt statt einer leeren Fläche — nur eben
 * als Annahme gekennzeichnet.
 */

import { cityStyleSpec, pickWeighted, type BoundaryKind, type CityStyle, type RoofForm } from './cityStyle'
import { SeededRng, hashInts } from '@/lib/composer/rng'
import { orientedBounds, rotatePolygon } from '@/lib/composer/geo'
import type { OsmBuilding, OsmPoi, OsmRoad, RoadClass } from '@/lib/composer/resolvers/osmResolver'
import type { HouseLod, HouseSpec, Plot, RidgeDir } from './plots'
import type { Amenity, ParkSpec, StreetFurniture } from './amenities'
import type { StreetKind, StreetNetwork, StreetNode, StreetSegment, Vec2 } from './streetNetwork'
import { buildPedestrians, buildTraffic, buildVehicleRoutes, buildWalkRoutes } from './traffic'
import type { Neighbourhood, WorldDetail } from './index'
import type { AmenityKind } from './cityStyle'

/* ────────────────────────────── Straßen ─────────────────────────────── */

/** Fahrbahnbreite je OSM-Klasse, Meter. Grobe, aber belastbare Richtwerte. */
const ROAD_WIDTH: Record<RoadClass, number> = {
  motorway: 14, primary: 10, secondary: 8.5, tertiary: 7,
  residential: 5.5, living_street: 4.5, service: 3.6, track: 3,
  footway: 1.8, cycleway: 2, path: 1.6, other: 4,
}

/** Welche Klassen einen Gehweg tragen. */
const HAS_SIDEWALK: RoadClass[] = ['primary', 'secondary', 'tertiary', 'residential', 'living_street']

function streetKindOf(k: RoadClass): StreetKind {
  if (k === 'motorway' || k === 'primary' || k === 'secondary' || k === 'tertiary') return 'collector'
  if (k === 'residential' || k === 'living_street') return 'residential'
  return 'lane'
}

/** Knoten werden über gerundete Koordinaten geteilt — so entsteht ein Graph. */
function nodeKey(p: Vec2): string {
  return `${Math.round(p.x * 4)}:${Math.round(p.z * 4)}`
}

/**
 * Aus OSM-Wegen einen Straßengraphen bauen.
 *
 * Jede Stützpunkt-Folge wird in Einzelabschnitte zerlegt; Knoten an
 * identischen Koordinaten werden zusammengeführt, weil OSM an Kreuzungen
 * denselben Punkt teilt. Damit ist der Graph zusammenhängend und der Verkehr
 * aus `traffic.ts` kann darauf routen, ohne von OSM zu wissen.
 */
export function networkFromRoads(roads: OsmRoad[], centre: Vec2, radiusM: number): StreetNetwork {
  const nodes = new Map<string, StreetNode>()
  const segments: StreetSegment[] = []
  let maxDist = 0

  const nodeFor = (p: Vec2): StreetNode => {
    const key = nodeKey(p)
    let n = nodes.get(key)
    if (!n) {
      n = { id: key, at: p, edges: [], roundabout: false, crossing: false }
      nodes.set(key, n)
    }
    return n
  }

  for (const road of roads) {
    // Fußwege im Nahbereich sind Gehwege, keine eigene Straße — sie werden
    // ohnehin als Bürgersteig neben der Fahrbahn gezeichnet.
    if (road.klass === 'footway' || road.klass === 'path') continue
    const pts: Vec2[] = road.path.map((p) => ({ x: p.x, z: p.y }))
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const len = Math.hypot(dx, dz)
      if (len < 0.5) continue
      const dist = Math.min(
        Math.hypot(a.x - centre.x, a.z - centre.z),
        Math.hypot(b.x - centre.x, b.z - centre.z),
      )
      if (dist > radiusM) continue
      maxDist = Math.max(maxDist, dist)
      const from = nodeFor(a)
      const to = nodeFor(b)
      const id = `${road.osmId}#${i}`
      const kind = streetKindOf(road.klass)
      segments.push({
        id, from: from.id, to: to.id, a, b, kind,
        widthM: ROAD_WIDTH[road.klass] ?? 4,
        sidewalkM: HAS_SIDEWALK.includes(road.klass) ? 1.7 : 0,
        dir: { x: dx / len, z: dz / len },
        lengthM: len,
        // Für die Ausrichtung der Fahrbahn genügt die dominante Achse.
        horizontal: Math.abs(dx) >= Math.abs(dz),
      })
      from.edges.push(id)
      to.edges.push(id)
    }
  }

  return {
    nodes,
    segments,
    // Echte Straßen bilden keine rechteckigen Blöcke — die Blockliste bleibt
    // leer, und die Grundstücksaufteilung entfällt, weil die Gebäude direkt
    // aus der Quelle kommen.
    blocks: [],
    extentM: Math.max(60, maxDist),
    centre,
  }
}

/* ────────────────────────────── Gebäude ─────────────────────────────── */

/** Unterhalb dieser Füllung gilt ein Umriss als zu verwinkelt für ein Steildach. */
const PITCHED_ROOF_FILL = 0.82

/**
 * Aus einem erfassten Gebäude einen {@link HouseSpec} bauen.
 *
 * Der Umriss bleibt der echte; Breite, Tiefe und Drehung kommen aus dem
 * Minimalflächen-Rechteck und dienen nur noch dem Dach und der Platzierung von
 * Anbauten. Alles, was OSM nicht kennt — Zaun, Mülltonnen, Gartenmöbel —
 * bleibt eine deterministische Annahme aus dem Gebäude-Seed, damit die Szene
 * bewohnt wirkt, ohne etwas zu behaupten.
 */
export function houseFromOsmBuilding(
  b: OsmBuilding,
  style: CityStyle,
  lodInput: { centre: Vec2; fullM: number; simpleM: number },
): HouseSpec {
  const spec = cityStyleSpec(style)
  const seed = hashInts(Math.round(b.centre.x * 10), Math.round(b.centre.y * 10), 0x4f534d42)
  const rng = new SeededRng(seed)

  const centre: Vec2 = { x: b.centre.x, z: b.centre.y }
  const ob = orientedBounds(b.footprint)
  // Der Umriss wird in die Achsen des Gebäudes gedreht, weil die Renderer-
  // Gruppe genau diese Drehung wieder anwendet (`plot.rotationY = -ob.angle`).
  // Ungedreht gespeichert stünde jedes Haus doppelt verdreht in der Szene.
  const centred = b.footprint.map((p) => ({ x: p.x - b.centre.x, y: p.y - b.centre.y }))
  const aligned = rotatePolygon(centred, -ob.angle)
  const local = aligned.map((p) => ({ x: p.x, z: p.y }))
  const fill = ob.areaSqm > 0 ? Math.min(1, b.areaSqm / ob.areaSqm) : 1

  const stories = b.levels !== undefined
    ? Math.max(1, Math.round(b.levels))
    : b.areaSqm < 90 ? 1 : 2
  const heightM = stories * spec.building.storeyHeightM

  // Dachform: getaggt gewinnt. Ohne Tag entscheidet die Region — und bei einem
  // verwinkelten Umriss wird flach gebaut, weil ein First dort nur falsch
  // liegen kann.
  const roof: RoofForm = b.roofShape
    ?? (fill < PITCHED_ROOF_FILL ? 'flat' : pickWeighted<RoofForm>(spec.building.roofWeights, rng.next()))

  const distanceM = Math.hypot(centre.x - lodInput.centre.x, centre.z - lodInput.centre.z)
  const lod: HouseLod = distanceM <= lodInput.fullM ? 'full'
    : distanceM <= lodInput.simpleM ? 'simple' : 'massing'

  const widthM = ob.widthM
  const depthM = ob.depthM
  // Das „Grundstück" ist hier keine Vermessung, sondern nur der Platzhalter,
  // den der Renderer für Vorgarten und Einfriedung braucht.
  const plot: Plot = {
    id: b.osmId,
    blockId: 'osm',
    centre,
    widthM: widthM + 6,
    depthM: depthM + 10,
    frontage: 'south',
    rotationY: -ob.angle,
    frontSign: 1,
    use: 'house',
    corner: false,
    seed,
  }

  /*
   * Firstrichtung aus dem vermessenen Umriss.
   *
   * Hier muss nichts gewürfelt werden: ein Satteldach läuft mit dem First über
   * die **lange** Seite des Baukörpers. Das ist keine Stilvorliebe, sondern
   * Statik — die Sparren spannen über die kurze Achse. Der Umriss aus dem
   * Kataster kennt beide Achsen, also ist die Firstrichtung an einem
   * vermessenen Gebäude eine abgeleitete Größe und keine Annahme.
   *
   * `eaves` heißt hier: der First läuft entlang x, also über die Breite. Das
   * gilt, wenn die Breite die lange Seite ist.
   */
  const ridge: RidgeDir = widthM >= depthM ? 'eaves' : 'gable'

  return {
    plot,
    lod,
    distanceM,
    centre,
    footprint: local,
    ridge,
    bays: Math.max(2, Math.min(4, Math.round(widthM / 2.8))),
    doorBay: hashInts(seed, 0x646f6f72) % Math.max(2, Math.min(4, Math.round(widthM / 2.8))),
    // Kein erfundener Anbau: der Umriss **ist** hier schon der echte Baukörper,
    // Winkel und Vorsprünge inbegriffen. Etwas danebenzustellen hiesse, eine
    // Messung mit einer Erfindung zu übermalen.

    footprintFill: Math.round(fill * 100) / 100,
    frontYardM: 3,
    backYardM: 4,
    widthM,
    depthM,
    stories,
    heightM,
    roof,
    roofPitchDeg: roof === 'flat' ? 2 : roof === 'pent' ? 14 : 38,
    facadeIndex: rng.int(0, spec.palette.facades.length - 1),
    roofIndex: rng.int(0, spec.palette.roofs.length - 1),
    chimney: rng.bool(spec.building.chimneyRatio),
    solar: roof !== 'flat' && rng.bool(spec.building.solarRatio),
    balcony: false,
    dormer: false,
    attached: 'none',
    garage: 'none',
    garageOffsetM: 0,
    driveLengthM: 0,
    parkedCar: false,
    carColorIndex: rng.int(0, 5),
    boundary: pickWeighted<BoundaryKind>(spec.vegetation.boundaryWeights, rng.next()),
    bins: 0,
    letterbox: false,
    bikeRack: false,
    trees: [],
    garden: [],
    windowSeed: hashInts(seed, 0x57494e),
  }
}

/* ────────────────────────────── Nahversorgung ───────────────────────── */

const POI_TO_AMENITY: Partial<Record<OsmPoi['category'], AmenityKind>> = {
  supermarket: 'supermarket',
  bakery: 'bakery',
  pharmacy: 'pharmacy',
  cafe: 'cafe',
  fuel: 'fuel',
  busStop: 'busStop',
  playground: 'playground',
  park: 'park',
  school: 'school',
  kindergarten: 'school',
}

const POI_LABEL: Partial<Record<AmenityKind, string>> = {
  supermarket: 'MARKT', bakery: 'BÄCKEREI', pharmacy: 'APOTHEKE', cafe: 'CAFÉ',
  fuel: 'TANKSTELLE', school: 'SCHULE', kiosk: 'KIOSK',
}

/**
 * Erfasste Einrichtungen als Baukörper. OSM liefert für die meisten nur einen
 * Punkt, keine Grundfläche — die Baukörpergröße ist deshalb eine Konvention je
 * Kategorie, die Position dagegen die echte.
 */
export function amenitiesFromPois(pois: OsmPoi[], maxDistanceM: number): Amenity[] {
  const out: Amenity[] = []
  const seen = new Set<string>()
  for (const p of pois) {
    if (p.distanceM > maxDistanceM) continue
    const kind = POI_TO_AMENITY[p.category]
    // Nur Gebäude-artige Einrichtungen bekommen einen Baukörper; Haltestellen
    // und Spielplätze zeichnet der Renderer als Möblierung bzw. Grünfläche.
    if (!kind || kind === 'busStop' || kind === 'playground' || kind === 'park') continue
    // Je Kategorie genügt die nächstgelegene — die Ladenzeile eines Ortskerns
    // würde sonst als Dutzend identischer Baukörper erscheinen.
    if (seen.has(kind)) continue
    seen.add(kind)
    const big = kind === 'supermarket' || kind === 'school'
    out.push({
      id: p.osmId,
      kind,
      at: { x: p.at.x, z: p.at.y },
      rotationY: 0,
      widthM: big ? 28 : 8,
      depthM: big ? 20 : 7,
      heightM: big ? 6.2 : 4.2,
      label: p.name?.toUpperCase().slice(0, 16) ?? POI_LABEL[kind] ?? '',
    })
  }
  return out
}

/** Haltestellen und Laternen aus der Quelle als Straßenmöblierung. */
export function furnitureFromPois(pois: OsmPoi[], maxDistanceM: number): StreetFurniture[] {
  const out: StreetFurniture[] = []
  for (const p of pois) {
    if (p.distanceM > maxDistanceM) continue
    if (p.category !== 'busStop') continue
    out.push({ kind: 'busStop', at: { x: p.at.x, z: p.at.y }, rotationY: 0, label: p.name })
  }
  return out
}

/** Erfasste Spielplätze und Parks als Grünfläche. */
export function parkFromPois(pois: OsmPoi[], maxDistanceM: number): ParkSpec | undefined {
  const green = pois.find(
    (p) => (p.category === 'park' || p.category === 'playground') && p.distanceM <= maxDistanceM,
  )
  if (!green) return undefined
  const cx = green.at.x
  const cz = green.at.y
  const half = green.category === 'park' ? 26 : 12
  const rng = new SeededRng(hashInts(Math.round(cx), Math.round(cz), 0x4f50524b))
  const trees: ParkSpec['trees'] = []
  for (let i = 0; i < (green.category === 'park' ? 12 : 4); i++) {
    trees.push({
      at: { x: cx + rng.range(-half + 2, half - 2), z: cz + rng.range(-half + 2, half - 2) },
      scale: rng.range(1.0, 1.8),
    })
  }
  return {
    minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half,
    path: [{ x: cx - half, z: cz }, { x: cx, z: cz + half * 0.3 }, { x: cx + half, z: cz }],
    playground: green.category === 'playground'
      ? {
        at: { x: cx, z: cz }, radiusM: 8,
        items: [
          { kind: 'swing', at: { x: -2.6, z: -1.4 }, rotationY: 0 },
          { kind: 'slide', at: { x: 2.2, z: -1.8 }, rotationY: 0 },
          { kind: 'sandpit', at: { x: 0.4, z: 2.2 }, rotationY: 0 },
          { kind: 'bench', at: { x: 0, z: -3.6 }, rotationY: 0 },
        ],
      }
      : undefined,
    trees,
    benches: [{ at: { x: cx, z: cz + half * 0.3 }, rotationY: 0 }],
  }
}

/* ────────────────────────────── Zusammenbau ─────────────────────────── */

export interface OsmWorldInput {
  style: CityStyle
  detail: WorldDetail
  /** Mittelpunkt des eigenen Plans im lokalen Rahmen. */
  centre: Vec2
  buildings: OsmBuilding[]
  roads: OsmRoad[]
  pois: OsmPoi[]
  /** Das eigene Gebäude — wird ausgelassen, der Plan zeichnet es selbst. */
  ownId?: string
  seed: number
}

const BUDGET: Record<WorldDetail, { radiusM: number; fullM: number; simpleM: number; routes: number; walks: number; traffic: number; people: number }> = {
  low: { radiusM: 120, fullM: 45, simpleM: 90, routes: 4, walks: 4, traffic: 0.7, people: 0.6 },
  medium: { radiusM: 200, fullM: 70, simpleM: 150, routes: 7, walks: 8, traffic: 1.0, people: 0.9 },
  high: { radiusM: 280, fullM: 105, simpleM: 210, routes: 11, walks: 14, traffic: 1.3, people: 1.2 },
}

/**
 * Die echte Nachbarschaft im Modell der erzeugten. Ab hier weiß nichts mehr,
 * woher die Daten kamen — Renderer und Verkehr behandeln beide gleich.
 */
export function neighbourhoodFromOsm(input: OsmWorldInput): Neighbourhood {
  const budget = BUDGET[input.detail] ?? BUDGET.medium
  const network = networkFromRoads(input.roads, input.centre, budget.radiusM)

  const lodInput = { centre: input.centre, fullM: budget.fullM, simpleM: budget.simpleM }
  const houses = input.buildings
    .filter((b) => b.osmId !== input.ownId)
    .filter((b) => Math.hypot(b.centre.x - input.centre.x, b.centre.y - input.centre.z) <= budget.radiusM)
    .map((b) => houseFromOsmBuilding(b, input.style, lodInput))

  const amenities = amenitiesFromPois(input.pois, budget.radiusM)
  const park = parkFromPois(input.pois, budget.radiusM)
  const furniture = furnitureFromPois(input.pois, budget.radiusM)

  const vehicleRoutes = buildVehicleRoutes(network, budget.routes, input.seed)
  const walkRoutes = buildWalkRoutes(network, budget.walks, input.seed)

  return {
    style: input.style,
    seed: input.seed,
    network,
    plots: houses.map((h) => h.plot),
    houses,
    amenities,
    park,
    furniture,
    vehicleRoutes,
    walkRoutes,
    vehicles: buildTraffic(vehicleRoutes.length, input.seed, budget.traffic),
    people: buildPedestrians(walkRoutes.length, input.seed, budget.people),
    extentM: network.extentM,
  }
}

/** Kennzahlen für die Oberfläche — was die Quelle tatsächlich hergab. */
export function osmWorldStats(world: Neighbourhood): {
  houses: number; segments: number; amenities: number; hasPark: boolean
} {
  return {
    houses: world.houses.length,
    segments: world.network.segments.length,
    amenities: world.amenities.length,
    hasPark: !!world.park,
  }
}
