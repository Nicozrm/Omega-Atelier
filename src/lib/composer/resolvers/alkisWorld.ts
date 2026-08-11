/**
 * alkisWorld.ts — die Nachbarschaft aus dem Kataster statt aus OpenStreetMap.
 *
 * Bisher standen in der 3D-Nachbarschaft nur die Gebäude, die jemand in OSM
 * eingetragen hat. In gut erfassten Städten ist das viel, in einem Wohngebiet
 * wie Borghorst ist es lückenhaft: die Straße bekommt Löcher, wo niemand
 * gemappt hat, und die Löcher sehen aus wie Wiese.
 *
 * ALKIS kennt dagegen **jeden** Baukörper — es ist das amtliche
 * Liegenschaftskataster, nicht eine Freiwilligenerfassung. Für einen Digital
 * Twin ist das der Unterschied zwischen „ungefähr diese Gegend" und „diese
 * Gegend".
 *
 * Was OSM trotzdem besser kann, bleibt bei OSM: **Straßenverläufe** (das
 * Kataster kennt nur Verkehrs*flächen*, keine Achsen), Punkte von Interesse
 * und die Geschosszahl, wo sie gepflegt ist. Diese Datei führt beides
 * zusammen — Umriss vom Kataster, Aufbau von OSM.
 */

import { geoToLocal } from '../geo'
import { polygonAreaSqm } from '../geo'
import type { LocalPolygon } from '../types'
import type { LocalFrame } from '../frame'
import { pointInPolygon, polygonToLocal } from '../frame'
import type { CadastreBuilding } from './alkisResolver'
import type { OsmBuilding } from './osmResolver'

/**
 * Ein Katastergebäude in der Form, die der Weltgenerator erwartet.
 *
 * Bewusst dieselbe Schnittstelle wie ein OSM-Gebäude: `neighbourhoodFromOsm`
 * bleibt damit unverändert und weiß gar nicht, woher die Umrisse kommen. Die
 * Herkunft steht in der ID und ist dadurch überall nachvollziehbar, ohne dass
 * eine zweite Codebahn entsteht.
 */
export type WorldBuilding = OsmBuilding

/** Kleinstes Bauwerk, das noch in die Nachbarschaft gehört. */
const MIN_AREA_SQM = 6

/**
 * Wie nah sich Mittelpunkte sein müssen, damit ein OSM-Gebäude und ein
 * Katastergebäude als dasselbe Haus gelten.
 *
 * 6 m ist kein Sicherheitsabstand, sondern eine Aussage über die Daten: die
 * beiden Erfassungen weichen im Umriss um wenige Meter ab, aber Nachbarhäuser
 * stehen in einem Wohngebiet weiter auseinander. Größer gewählt würde die
 * Geschosszahl des Nachbarn übernommen.
 */
const MATCH_RADIUS_M = 6

function centroidOf(poly: LocalPolygon): { x: number; y: number } {
  let x = 0, y = 0
  for (const p of poly) { x += p.x; y += p.y }
  return { x: x / poly.length, y: y / poly.length }
}

/**
 * Übersetzt Katastergebäude in Weltgebäude und reichert sie mit dem an, was
 * nur OSM weiß.
 *
 * @param reference Mittelpunkt, auf den die lokalen Meter bezogen werden.
 */
export function worldBuildingsFromCadastre(
  cadastre: CadastreBuilding[],
  frame: LocalFrame,
  osm: OsmBuilding[] = [],
  /** Bezugspunkt für `distanceM` — der Plan-Mittelpunkt in lokalen Metern. */
  reference: { x: number; y: number } = { x: 0, y: 0 },
): WorldBuilding[] {
  const out: WorldBuilding[] = []

  for (const [i, b] of cadastre.entries()) {
    const footprint = polygonToLocal(frame, b.ring)
    if (footprint.length < 3) continue
    const areaSqm = Math.round(polygonAreaSqm(b.ring.map((p) => geoToLocal(b.ring[0], p))))
    if (areaSqm < MIN_AREA_SQM) continue
    const centre = centroidOf(footprint)

    // Das nächstgelegene OSM-Gebäude — nur, um Geschosse und Dachform zu
    // erben. Der Umriss bleibt in jedem Fall der amtliche.
    let best: OsmBuilding | undefined
    let bestD = MATCH_RADIUS_M
    for (const o of osm) {
      const d = Math.hypot(o.centre.x - centre.x, o.centre.y - centre.y)
      if (d < bestD) { bestD = d; best = o }
    }

    out.push({
      // Die Herkunft steckt in der ID. Wichtig auch fürs Aussortieren des
      // eigenen Hauses, das über dieselbe Kennung läuft.
      osmId: `alkis/${i}`,
      footprint,
      areaSqm,
      centre,
      tags: best?.tags ?? {},
      levels: best?.levels,
      roofShape: best?.roofShape,
      roofMaterial: best?.roofMaterial,
      facadeMaterial: best?.facadeMaterial,
      address: best?.address,
      distanceM: Math.round(Math.hypot(centre.x - reference.x, centre.y - reference.y) * 10) / 10,
      // Ob ein Nachbargebäude im gezeichneten Grundstück liegt, ist für die
      // Nachbarschaft ohne Belang — die Frage stellt sich nur bei der Analyse
      // des eigenen Hauses, und die läuft über `structuresOnParcel`.
      insideParcel: false,
    })
  }

  return out
}

/**
 * Entfernt alles, was auf dem **eigenen** Flurstück steht.
 *
 * Der Plan zeichnet das eigene Grundstück selbst — Haus, Garage, Schuppen.
 * Bliebe das Kataster daneben stehen, stünde jedes davon zweimal, minimal
 * versetzt. In einer 3D-Ansicht fällt genau das sofort als Fehler auf.
 *
 * Ein erster Entwurf hat dafür schlicht den nächstgelegenen Umriss
 * aussortiert. Gemessen an der Kolpingstr. 9 war das falsch: dem Anker am
 * nächsten liegt die **Garagenzeile** (76 m², 13 m), nicht das Wohnhaus
 * (116 m²). Es wäre also die Garage verschwunden und das Haus doppelt
 * dagestanden — der Fehler wäre größer gewesen als das Problem.
 *
 * Deshalb entscheidet nicht die Entfernung, sondern die Grundstücksgrenze:
 * jeder Baukörper, dessen Mittelpunkt im eigenen Flurstück liegt, gehört dem
 * Plan und nicht der Nachbarschaft.
 */
export function withoutOwnParcel(
  buildings: WorldBuilding[],
  parcelOutline: LocalPolygon,
): WorldBuilding[] {
  if (parcelOutline.length < 3) return buildings
  return buildings.filter((b) => !pointInPolygon(b.centre, parcelOutline))
}

/**
 * Rückfall ohne bekannte Grundstücksgrenze: alles innerhalb eines Radius um
 * den Plan-Mittelpunkt. Gröber als {@link withoutOwnParcel} und nur dafür da,
 * dass ohne Kataster-Flurstück nicht plötzlich Häuser doppelt stehen.
 */
export function withoutOwnWithin(
  buildings: WorldBuilding[],
  at: { x: number; y: number },
  radiusM: number,
): WorldBuilding[] {
  return buildings.filter((b) => Math.hypot(b.centre.x - at.x, b.centre.y - at.y) > radiusM)
}


/* ─────────────────────── Höhen und Dachformen (LoD2) ─────────────────── */

/**
 * Wie hoch ein Dach über der Traufe aufragt, je Form.
 *
 * LoD2 liefert `measuredHeight` als **First**höhe — die Spitze, nicht die
 * Traufe. Der Weltgenerator rechnet dagegen in Geschossen und setzt das Dach
 * obendrauf. Wer die Firsthöhe direkt in Geschosse umrechnet, baut jedes
 * Satteldachhaus rund ein Geschoss zu hoch, und die ganze Straße wächst.
 *
 * Die Werte sind der übliche Bereich für Wohngebäude: ein Satteldach mit 8 m
 * Spannweite und 40° Neigung ragt rund 3,3 m auf, ein flach geneigtes Pultdach
 * gut einen Meter, ein Flachdach gar nicht.
 */
const ROOF_RISE_M: Record<string, number> = {
  flat: 0.25, pent: 1.2, gable: 3.0, hip: 2.6,
}

/**
 * Überträgt gemessene Höhe und Dachform auf die Katastergebäude.
 *
 * Zugeordnet wird über die Lage: LoD2 und ALKIS teilen sich denselben
 * Gebäudegrundriss aus dem Liegenschaftskataster, die Schwerpunkte liegen also
 * dicht beieinander. 8 m Suchradius deckt die Abweichung durch
 * Gebäudeteil-Zerlegung ab — LoD2 zerlegt ein Haus in `BuildingPart`s, deren
 * Schwerpunkte vom Gesamtschwerpunkt abweichen —, bleibt aber unter dem
 * typischen Abstand zweier Nachbarhäuser.
 */
export function applyLod2(
  buildings: WorldBuilding[],
  lod2: { at: { lat: number; lng: number }; heightM: number; roofShape?: string }[],
  frame: LocalFrame,
  storeyHeightM = 2.85,
  radiusM = 8,
): { buildings: WorldBuilding[]; matched: number } {
  if (lod2.length === 0) return { buildings, matched: 0 }

  // Einmal in den lokalen Rahmen bringen; danach ist die Zuordnung reine
  // Rechnung in Metern.
  const pts = lod2.map((l) => ({ ...l, local: polygonToLocal(frame, [l.at])[0] }))

  let matched = 0
  const out = buildings.map((b) => {
    let best: typeof pts[number] | undefined
    let bestD = radiusM
    for (const l of pts) {
      const d = Math.hypot(l.local.x - b.centre.x, l.local.y - b.centre.y)
      if (d < bestD) { bestD = d; best = l }
    }
    if (!best) return b
    matched++

    const shape = (best.roofShape ?? b.roofShape) as WorldBuilding['roofShape']
    const rise = ROOF_RISE_M[shape ?? 'gable'] ?? 3.0
    // Traufhöhe = Firsthöhe minus Dachaufbau, nie unter einem Geschoss.
    const eaves = Math.max(storeyHeightM, best.heightM - rise)
    return {
      ...b,
      // Der Generator rechnet in Geschossen; die Rundung ist der Preis dafür,
      // dass der bestehende Pfad unverändert bleibt.
      levels: Math.max(1, Math.round(eaves / storeyHeightM)),
      roofShape: shape,
    }
  })
  return { buildings: out, matched }
}
