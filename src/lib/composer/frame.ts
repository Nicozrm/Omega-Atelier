/**
 * frame.ts — der lokale metrische Bezugsrahmen der Analyse.
 *
 * Sobald mehr als eine Quelle beteiligt ist, braucht die Pipeline **einen**
 * Rahmen, in den alles projiziert wird: das gezeichnete Grundstück, die
 * OSM-Gebäude, später LoD2-Dächer und das Höhenraster. Ohne ihn würde jede
 * Quelle ihre eigene Projektion mitbringen und die Ergebnisse ließen sich nicht
 * überlagern.
 *
 * Der Rahmen ist bewusst der des **Grundstücks**, nicht der von Norden:
 *
 *   1. Ursprung ist die Nordwest-Ecke des Grundstücks.
 *   2. Gedreht in die Grundstücksachsen (Minimalflächen-Rechteck).
 *   3. Verschoben, sodass die Bounding-Box bei (0, 0) beginnt.
 *
 * Damit rechnet die gesamte Pipeline in „längs der Straße / in die Tiefe" —
 * genau der Denkweise, in der Gebäude platziert, Einfahrten gezogen und Gärten
 * aufgeteilt werden. Und der Editor bekommt einen Plan, der gerade im Blatt
 * liegt, statt schief im Norden zu hängen.
 *
 * Reine Geometrie: kein Renderer, keine Quelle, kein React.
 */

import type { GeoPoint, LocalPoint, LocalPolygon } from './types'
import { geoToLocal, localToGeo } from './geo'

export interface LocalFrame {
  /** Geografischer Ankerpunkt — die Nordwest-Ecke. */
  origin: GeoPoint
  /** Drehung, die nach der Projektion angewandt wird (Radiant). */
  rotationRad: number
  /** Verschiebung nach der Drehung, damit die Bounding-Box bei (0,0) liegt. */
  offset: LocalPoint
}

/** Rahmen ohne Drehung und Verschiebung — der Rückfall ohne gezeichnetes Grundstück. */
export function plainFrame(origin: GeoPoint): LocalFrame {
  return { origin, rotationRad: 0, offset: { x: 0, y: 0 } }
}

function rotate(p: LocalPoint, rad: number): LocalPoint {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

/** Geo → lokal, inklusive Drehung und Verschiebung des Rahmens. */
export function toLocal(frame: LocalFrame, p: GeoPoint): LocalPoint {
  const raw = geoToLocal(frame.origin, p)
  const rot = rotate(raw, frame.rotationRad)
  return { x: rot.x + frame.offset.x, y: rot.y + frame.offset.y }
}

/** Die Umkehrung — damit erkannte Objekte wieder georeferenziert werden können. */
export function toGeoPoint(frame: LocalFrame, p: LocalPoint): GeoPoint {
  const un = { x: p.x - frame.offset.x, y: p.y - frame.offset.y }
  const rot = rotate(un, -frame.rotationRad)
  return localToGeo(frame.origin, rot)
}

export function polygonToLocal(frame: LocalFrame, ring: GeoPoint[]): LocalPolygon {
  return ring.map((p) => toLocal(frame, p))
}

/** Abstand zweier lokaler Punkte, Meter. */
export function localDistance(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Punkt-in-Polygon (Ray-Casting). Wird gebraucht, um aus mehreren
 * OSM-Gebäuden dasjenige zu wählen, das im gezeichneten Grundstück liegt.
 */
export function pointInPolygon(p: LocalPoint, poly: LocalPolygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const intersects = a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

/** Kürzester Abstand eines Punktes zu einem Polygonzug, Meter. */
export function distanceToPolyline(p: LocalPoint, line: LocalPolygon): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return localDistance(p, line[0])
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    if (d < best) best = d
  }
  return best
}
