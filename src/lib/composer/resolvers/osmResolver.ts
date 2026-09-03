/**
 * osmResolver.ts — aus OSM-Elementen werden Beobachtungen.
 *
 * Der Resolver kennt genau ein Format (OSM-Tags) und genau eine Aufgabe: die
 * Rohdaten in den lokalen Rahmen projizieren und als Attribute mit Herkunft
 * ausgeben. Er trifft **keine** Entscheidung darüber, ob seine Werte gewinnen —
 * das macht die Fusion anhand der Provenienz.
 *
 * Was OSM für ein deutsches Wohngrundstück verlässlich hergibt:
 *
 *   • **Gebäudeumriss** — fast flächendeckend erfasst, oft aus dem Kataster
 *     importiert. Damit ist Phase 2 nicht mehr geraten.
 *   • **`building:levels`** — die Geschosszahl, wo getaggt.
 *   • **`roof:shape`** — die Dachform, wo getaggt. Genau das, was der alte
 *     `roofDetector` gewürfelt hat.
 *   • **Straßen mit Klassifikation** — und damit endlich die Antwort auf die
 *     Frage, an welcher Seite des Grundstücks die Straße liegt. Bisher war das
 *     ein stiller Münzwurf mit 82 % „Süden".
 *   • **Nahversorgung, ÖPNV, Grün, Bahn, Wasser** — die gesamte Phase 5.
 *
 * Was OSM *nicht* hergibt und deshalb Annahme bleibt: Dachneigung, Firsthöhe,
 * Fassadenmaterial in der Regel, und alles im Inneren. Diese Lücken werden
 * markiert, nicht überspielt.
 */

import type {
  BuildingFeature, BuildingPart, GeoPoint, LocalPolygon, PropertyFeature, RoofShape,
} from '../types'
import type { OsmTags, OverpassResult } from '../sources/overpass'
import { toGeo } from '../sources/overpass'
import type { LocalFrame } from '../frame'
import { distanceToPolyline, localDistance, pointInPolygon, polygonToLocal } from '../frame'
import { polygonAreaSqm, polygonCentroid } from '../geo'
import { measured, type Attr, type SourceRef } from '../provenance'

export const OSM_SOURCE: SourceRef = {
  id: 'osm-overpass',
  label: 'OpenStreetMap',
}

function sourceRef(result: OverpassResult): SourceRef {
  return { ...OSM_SOURCE, version: result.timestamp, fetchedAt: new Date().toISOString() }
}

/* ────────────────────────────── Gebäude ─────────────────────────────── */

export interface OsmBuilding {
  osmId: string
  /** Umriss im lokalen Rahmen. */
  footprint: LocalPolygon
  areaSqm: number
  /** Mittelpunkt im lokalen Rahmen. */
  centre: { x: number; y: number }
  tags: OsmTags
  /** Geschosszahl, wo getaggt. */
  levels?: number
  roofShape?: RoofShape
  roofMaterial?: string
  facadeMaterial?: string
  /** Vollständige Adresse, wo getaggt. */
  address?: string
  /** Wie weit der Umriss vom Grundstücksmittelpunkt entfernt liegt. */
  distanceM: number
  /** Ob der Mittelpunkt im gezeichneten Grundstück liegt. */
  insideParcel: boolean
}

/** OSM kennt mehr Dachformen, als der Renderer zeichnen kann. */
const ROOF_SHAPE_MAP: Record<string, RoofShape> = {
  gabled: 'gable',
  'half-hipped': 'gable',
  hipped: 'hip',
  'gambrel': 'gable',
  mansard: 'hip',
  pyramidal: 'hip',
  flat: 'flat',
  skillion: 'pent',
  'shed': 'pent',
  'lean_to': 'pent',
  round: 'hip',
  dome: 'hip',
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : undefined
}

function addressOf(t: OsmTags): string | undefined {
  const street = t['addr:street']
  const nr = t['addr:housenumber']
  if (!street) return undefined
  const city = t['addr:city']
  return [`${street}${nr ? ` ${nr}` : ''}`, city].filter(Boolean).join(', ')
}

/**
 * Alle Gebäude aus der Antwort, projiziert und nach Nähe zum Grundstück
 * sortiert. `insideParcel` markiert die Kandidaten für „das eigene Haus".
 */
export function extractBuildings(
  result: OverpassResult,
  frame: LocalFrame,
  parcel: LocalPolygon | undefined,
): OsmBuilding[] {
  const parcelCentre = parcel && parcel.length >= 3 ? polygonCentroid(parcel) : { x: 0, y: 0 }
  const out: OsmBuilding[] = []

  for (const el of result.elements) {
    const t = el.tags ?? {}
    if (!t.building || !el.geometry || el.geometry.length < 3) continue
    const footprint = polygonToLocal(frame, el.geometry.map(toGeo))
    const areaSqm = polygonAreaSqm(footprint)
    // Gartenhäuser und Mülltonnenboxen sind getaggt, aber kein Wohnhaus.
    if (areaSqm < 6) continue
    const centre = polygonCentroid(footprint)
    const roofRaw = t['roof:shape']
    out.push({
      osmId: `${el.type}/${el.id}`,
      footprint,
      areaSqm: Math.round(areaSqm),
      centre,
      tags: t,
      levels: num(t['building:levels']),
      roofShape: roofRaw ? ROOF_SHAPE_MAP[roofRaw] : undefined,
      roofMaterial: t['roof:material'],
      facadeMaterial: t['building:material'],
      address: addressOf(t),
      distanceM: localDistance(centre, parcelCentre),
      insideParcel: parcel ? pointInPolygon(centre, parcel) : false,
    })
  }

  // Im Grundstück zuerst, danach nach Nähe; bei Gleichstand das größere Gebäude
  // — ein Carport neben dem Haus soll nicht das Haus verdrängen.
  return out.sort((a, b) => {
    if (a.insideParcel !== b.insideParcel) return a.insideParcel ? -1 : 1
    const d = a.distanceM - b.distanceM
    return Math.abs(d) > 3 ? d : b.areaSqm - a.areaSqm
  })
}

/**
 * Das Hauptgebäude bestimmen: das größte im Grundstück, sonst das nächste in
 * Reichweite. `undefined`, wenn nichts erfasst ist — dann bleibt der Generator
 * zuständig und markiert seine Ausgabe als Annahme.
 */
export function pickOwnBuilding(buildings: OsmBuilding[]): OsmBuilding | undefined {
  const inside = buildings.filter((b) => b.insideParcel)
  if (inside.length > 0) {
    return inside.reduce((best, b) => (b.areaSqm > best.areaSqm ? b : best))
  }
  const near = buildings.filter((b) => b.distanceM < 25 && b.areaSqm >= 25)
  return near[0]
}

/**
 * Aus dem OSM-Gebäude ein `BuildingFeature` bauen.
 *
 * Umriss und Fläche sind gemessen. Die Geschosszahl ist gemessen, wo getaggt,
 * sonst aus der Grundfläche geschätzt. Die Traufhöhe bleibt eine Ableitung —
 * OSM kennt sie fast nie, LoD2 wird sie in Slice 3 liefern.
 */
export function buildingFromOsm(
  b: OsmBuilding,
  result: OverpassResult,
  storeyHeightM = 2.85,
): { feature: BuildingFeature; levels: Attr<number>; roof?: Attr<RoofShape> } {
  const src = sourceRef(result)
  const levels: Attr<number> = b.levels !== undefined
    ? measured(b.levels, src)
    : // Ohne Tag: kleine Grundfläche spricht für einen Bungalow, große für zwei
      // Geschosse. Bewusst grob — es ist eine Ableitung, keine Messung.
      { value: b.areaSqm < 90 ? 1 : 2, provenance: 'inferred', confidence: 0.6 }

  const stories = Math.max(1, Math.round(levels.value))
  const heightM = Math.round((stories * storeyHeightM + 0.4) * 10) / 10

  const parts: BuildingPart[] = [{
    kind: 'main',
    polygon: b.footprint,
    heightM,
    confidence: measured(null, src).confidence,
  }]

  return {
    feature: {
      footprint: b.footprint,
      parts,
      heightM,
      stories,
      areaSqm: b.areaSqm,
      confidence: measured(null, src).confidence,
      provenance: {
        footprint: 'measured',
        stories: levels.provenance,
        // Die Traufhöhe rechnen wir aus der Geschosszahl hoch — OSM kennt sie
        // fast nie. Das ist eine Ableitung und wird als solche geführt.
        height: 'inferred',
      },
    },
    levels,
    roof: b.roofShape ? measured(b.roofShape, src) : undefined,
  }
}

/* ────────────────────────────── Straßen ─────────────────────────────── */

export type RoadClass =
  | 'motorway' | 'primary' | 'secondary' | 'tertiary' | 'residential'
  | 'service' | 'living_street' | 'track' | 'footway' | 'cycleway' | 'path' | 'other'

export interface OsmRoad {
  osmId: string
  path: LocalPolygon
  klass: RoadClass
  name?: string
  lanes?: number
  surface?: string
  maxspeed?: number
  /** Kürzester Abstand zum Grundstücksmittelpunkt. */
  distanceM: number
}

const DRIVEABLE: RoadClass[] = [
  'motorway', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'living_street',
]

function roadClass(t: OsmTags): RoadClass {
  const h = t.highway ?? ''
  if (h.startsWith('motorway')) return 'motorway'
  if (h.startsWith('primary')) return 'primary'
  if (h.startsWith('secondary')) return 'secondary'
  if (h.startsWith('tertiary')) return 'tertiary'
  if (h === 'residential' || h === 'unclassified') return 'residential'
  if (h === 'living_street') return 'living_street'
  if (h === 'service') return 'service'
  if (h === 'track') return 'track'
  if (h === 'footway' || h === 'pedestrian' || h === 'steps') return 'footway'
  if (h === 'cycleway') return 'cycleway'
  if (h === 'path') return 'path'
  return 'other'
}

export function extractRoads(
  result: OverpassResult,
  frame: LocalFrame,
  reference: { x: number; y: number },
): OsmRoad[] {
  const out: OsmRoad[] = []
  for (const el of result.elements) {
    const t = el.tags ?? {}
    if (!t.highway || !el.geometry || el.geometry.length < 2) continue
    const path = polygonToLocal(frame, el.geometry.map(toGeo))
    out.push({
      osmId: `${el.type}/${el.id}`,
      path,
      klass: roadClass(t),
      name: t.name,
      lanes: num(t.lanes),
      surface: t.surface,
      maxspeed: num(t.maxspeed),
      distanceM: distanceToPolyline(reference, path),
    })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

/**
 * An welcher Seite des Grundstücks liegt die Straße?
 *
 * Das war bisher ein Münzwurf (`rng.next() < 0.82 ? 'south' : …`) und schlug
 * durch die gesamte Pipeline durch: Hausausrichtung, Einfahrt, Vorgarten,
 * Haustür. Jetzt wird die nächste befahrbare Straße gesucht und geprüft, an
 * welcher Kante des Grundstücksrechtecks sie entlangläuft.
 *
 * Der lokale Rahmen ist der des Grundstücks (x längs, y in die Tiefe), also
 * genügt der Vergleich der Abstände zu den vier Kanten.
 */
export function streetSideFromRoads(
  roads: OsmRoad[],
  property: Pick<PropertyFeature, 'widthM' | 'depthM'>,
): { side: PropertyFeature['streetSide']; road: OsmRoad } | undefined {
  const drivable = roads.filter((r) => DRIVEABLE.includes(r.klass))
  const road = drivable[0]
  // Weiter als 60 m weg ist es nicht mehr *die* Straße des Grundstücks.
  if (!road || road.distanceM > 60) return undefined

  const { widthM: W, depthM: D } = property
  // Repräsentativer Punkt der Straße: der dem Grundstück nächste Stützpunkt.
  const centre = { x: W / 2, y: D / 2 }
  let nearest = road.path[0]
  let best = Infinity
  for (const p of road.path) {
    const d = localDistance(p, centre)
    if (d < best) { best = d; nearest = p }
  }

  const toNorth = Math.abs(nearest.y - 0)
  const toSouth = Math.abs(nearest.y - D)
  const toWest = Math.abs(nearest.x - 0)
  const toEast = Math.abs(nearest.x - W)
  const min = Math.min(toNorth, toSouth, toWest, toEast)
  const side: PropertyFeature['streetSide'] =
    min === toSouth ? 'south' : min === toNorth ? 'north' : min === toWest ? 'west' : 'east'
  return { side, road }
}

/* ────────────────────────────── Umfeld ──────────────────────────────── */

export type PoiCategory =
  | 'supermarket' | 'bakery' | 'pharmacy' | 'cafe' | 'restaurant' | 'school'
  | 'kindergarten' | 'fuel' | 'busStop' | 'playground' | 'park' | 'shop' | 'other'

export interface OsmPoi {
  osmId: string
  category: PoiCategory
  name?: string
  at: { x: number; y: number }
  distanceM: number
}

function poiCategory(t: OsmTags): PoiCategory | undefined {
  if (t.highway === 'bus_stop' || t.public_transport === 'platform') return 'busStop'
  if (t.shop === 'supermarket' || t.shop === 'convenience') return 'supermarket'
  if (t.shop === 'bakery') return 'bakery'
  if (t.amenity === 'pharmacy' || t.shop === 'chemist') return 'pharmacy'
  if (t.amenity === 'cafe') return 'cafe'
  if (t.amenity === 'restaurant' || t.amenity === 'fast_food') return 'restaurant'
  if (t.amenity === 'school') return 'school'
  if (t.amenity === 'kindergarten') return 'kindergarten'
  if (t.amenity === 'fuel') return 'fuel'
  if (t.leisure === 'playground') return 'playground'
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park'
  if (t.shop) return 'shop'
  return undefined
}

export function extractPois(
  result: OverpassResult,
  frame: LocalFrame,
  reference: { x: number; y: number },
): OsmPoi[] {
  const out: OsmPoi[] = []
  for (const el of result.elements) {
    const t = el.tags ?? {}
    const category = poiCategory(t)
    if (!category) continue
    const geo: GeoPoint | undefined =
      el.lat !== undefined && el.lon !== undefined
        ? { lat: el.lat, lng: el.lon }
        : el.geometry && el.geometry.length > 0
          ? toGeo(el.geometry[Math.floor(el.geometry.length / 2)])
          : undefined
    if (!geo) continue
    const at = polygonToLocal(frame, [geo])[0]
    out.push({
      osmId: `${el.type}/${el.id}`,
      category,
      name: t.name,
      at,
      distanceM: localDistance(at, reference),
    })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

/** Was die Zusammenfassung über das Umfeld sagen kann. */
export interface NeighbourhoodSummary {
  roadName?: string
  /** Fußweg-Entfernung (Luftlinie) zur jeweils nächsten Einrichtung, Meter. */
  nearest: Partial<Record<PoiCategory, { name?: string; distanceM: number }>>
  buildingCount: number
}

export function summariseNeighbourhood(
  buildings: OsmBuilding[],
  roads: OsmRoad[],
  pois: OsmPoi[],
): NeighbourhoodSummary {
  const nearest: NeighbourhoodSummary['nearest'] = {}
  for (const p of pois) {
    if (nearest[p.category]) continue
    nearest[p.category] = { name: p.name, distanceM: Math.round(p.distanceM) }
  }
  const named = roads.find((r) => r.name && DRIVEABLE.includes(r.klass))
  return { roadName: named?.name, nearest, buildingCount: buildings.length }
}
