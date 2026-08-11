/**
 * useNeighbourhood — welche Welt die 3D-Ansicht zeigt.
 *
 * Die Regel ist einfach und folgt dem Architekturentwurf: **gemessen schlägt
 * angenommen, aber angenommen schlägt leer.**
 *
 *   • Der Plan kennt keinen Ort → der prozedurale Generator liefert eine
 *     plausible Siedlung. Genau wie bisher.
 *   • Der Plan kennt seinen Ort → OSM wird abgerufen und die **echte**
 *     Nachbarschaft gebaut. Bis die Antwort da ist, steht die erzeugte Welt;
 *     der Wechsel ist ein einzelnes Re-Render, kein Ladebildschirm.
 *   • Der Abruf scheitert oder der Ort ist nicht erfasst → die erzeugte Welt
 *     bleibt stehen.
 *
 * Der Nutzer sieht also nie eine leere Fläche, und die Ansicht weiß jederzeit,
 * was sie zeigt (`source`), damit die Oberfläche es benennen kann.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  generateNeighbourhood, neighbourhoodFromOsm, seedForPlan,
  type CityStyle, type Neighbourhood, type WorldDetail,
} from '@/lib/world'
import { worldOsmSource } from '@/lib/composer/sources/overpass'
import { worldAlkisSource, WORLD_LIMITS } from '@/lib/composer/sources/alkis'
import { extractCadastreBuildings, extractParcels, parcelAtPoint } from '@/lib/composer/resolvers/alkisResolver'
import { applyLod2, withoutOwnParcel, withoutOwnWithin, worldBuildingsFromCadastre } from '@/lib/composer/resolvers/alkisWorld'
import { lod2Source } from '@/lib/composer/sources/lod2'
import { extractBuildings, extractPois, extractRoads, pickOwnBuilding } from '@/lib/composer/resolvers/osmResolver'
import { plainFrame, polygonToLocal } from '@/lib/composer/frame'
import type { PlanGeo } from '@/types'

export type WorldSource = 'generated' | 'osm'

/**
 * Radius der Katasterabfrage für die Nachbarschaft. Passt zum weiten
 * OSM-Radius (`WORLD_RADII.buildingM`), damit beide Quellen dasselbe Gebiet
 * beschreiben — sonst endete die Bebauung mitten in der Straße.
 */
const WORLD_ALKIS_RADIUS_M = 240

export interface NeighbourhoodResult {
  world: Neighbourhood
  source: WorldSource
  /** Läuft gerade ein Abruf? Für einen dezenten Hinweis in der Oberfläche. */
  loading: boolean
}

export interface UseNeighbourhoodInput {
  planId: string
  geo?: PlanGeo
  style: CityStyle
  detail: WorldDetail
  /** Mittelpunkt des Plans in Weltmetern. */
  centre: { x: number; z: number }
  widthM: number
  depthM: number
  /** Abschaltbar, damit die Ansicht auch offline berechenbar bleibt. */
  enabled?: boolean
}

export function useNeighbourhood(input: UseNeighbourhoodInput): NeighbourhoodResult {
  const { planId, geo, style, detail, centre, widthM, depthM, enabled = true } = input

  // Die erzeugte Welt ist immer da — sie kostet nichts und ist der Rückfall.
  const generated = useMemo(
    () => generateNeighbourhood({
      style, centre, widthM, depthM, detail, seed: seedForPlan(planId, style),
    }),
    // `centre` is a fresh object every render; its two numbers are the actual
    // dependency. Listing the object would regenerate the whole neighbourhood
    // on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [style, centre.x, centre.z, widthM, depthM, detail, planId],
  )

  const [osmWorld, setOsmWorld] = useState<Neighbourhood | null>(null)
  const [loading, setLoading] = useState(false)
  // Verhindert, dass eine spät eintreffende Antwort eine neuere überschreibt.
  const runRef = useRef(0)

  useEffect(() => {
    setOsmWorld(null)
    if (!enabled || !geo) return
    const run = ++runRef.current
    const ac = new AbortController()
    setLoading(true)

    void (async () => {
      try {
        const at = { lat: geo.lat, lng: geo.lng }
        // Beide Quellen parallel. Sie beantworten verschiedene Fragen und
        // dürfen sich nicht gegenseitig aufhalten: OSM kennt die
        // Straßen*achsen*, das Kataster kennt **jedes** Gebäude. Nacheinander
        // addierten sich nur ihre Wartezeiten.
        //
        // Das Kataster darf ausfallen, ohne die Nachbarschaft zu verhindern —
        // außerhalb von NRW gibt es dort schlicht nichts.
        const [result, alkisSite, lod2] = await Promise.all([
          worldOsmSource.fetchSite(at, ac.signal),
          worldAlkisSource
            .fetchSite(at, WORLD_ALKIS_RADIUS_M, ac.signal, WORLD_LIMITS)
            .catch(() => undefined),
          // LoD2 braucht gemessen 40 bis 55 Sekunden und läuft regelmäßig in
          // 502er. Es darf die Nachbarschaft deshalb nicht aufhalten: die Welt
          // entsteht ohne, und die Höhen kommen nach, wenn sie kommen.
          lod2Source.fetchAround(at, undefined, undefined, ac.signal).catch(() => []),
        ])
        if (run !== runRef.current) return
        // Früher stand hier `if (!result) return`. Das war ein Kopplungsfehler:
        // fällt Overpass aus — und es fällt regelmäßig aus —, wurde die ganze
        // Nachbarschaft verworfen, obwohl das Kataster längst geantwortet
        // hatte. Gemessen sind das 694 vermessene Gebäude, die zugunsten einer
        // erfundenen Siedlung weggeworfen wurden.
        if (!result && !alkisSite) return

        // Der Rahmen ist hier bewusst nordausgerichtet und im Plan-Mittelpunkt
        // verankert: die 3D-Szene rechnet in Weltmetern um den Plan herum, und
        // die Drehung des Grundstücks steckt bereits im Plan selbst.
        const frame = plainFrame(at)
        const reference = { x: 0, y: 0 }
        const osmBuildings = result ? extractBuildings(result, frame, undefined) : []
        const roads = result ? extractRoads(result, frame, reference) : []
        const pois = result ? extractPois(result, frame, reference) : []

        // Umriss vom Kataster, Aufbau von OSM.
        //
        // OSM erfasst Gebäude freiwillig und daher lückenhaft; in einem
        // Wohngebiet fehlen regelmäßig ganze Straßenzüge, und die Lücken sehen
        // in der 3D-Ansicht aus wie Wiese. ALKIS kennt jeden Baukörper. Was
        // OSM besser weiß — Geschosszahl, Dachform, Material — wird über die
        // Lage zugeordnet und übernommen.
        const cadastre = alkisSite ? extractCadastreBuildings(alkisSite) : []
        let fromCadastre = cadastre.length > 0
          ? worldBuildingsFromCadastre(cadastre, frame, osmBuildings, reference)
          : []

        // Das eigene Grundstück gehört dem Plan, nicht der Nachbarschaft.
        // Sonst stünde jeder Baukörper zweimal — einmal gezeichnet, einmal aus
        // dem Kataster, minimal versetzt. Maßgeblich ist die Flurstücksgrenze,
        // nicht die Entfernung: an der Kolpingstr. 9 liegt die Garagenzeile
        // näher am Anker als das Wohnhaus.
        if (fromCadastre.length > 0 && alkisSite) {
          const own = parcelAtPoint(at, extractParcels(alkisSite))
          fromCadastre = own
            ? withoutOwnParcel(fromCadastre, polygonToLocal(frame, own.ring))
            : withoutOwnWithin(fromCadastre, reference, 12)
        }

        // Gemessene Höhen und Dachformen aus LoD2 auflegen.
        if (fromCadastre.length > 0 && lod2.length > 0) {
          const applied = applyLod2(fromCadastre, lod2, frame)
          fromCadastre = applied.buildings
          console.info(
            `%cOMEGA Höhen%c ${applied.matched} von ${fromCadastre.length} Gebäuden vermessen (LoD2)`,
            'font-weight:600;color:#C7A24E', 'color:inherit',
          )
        }

        const buildings = fromCadastre.length > osmBuildings.length ? fromCadastre : osmBuildings
        if (buildings.length === 0 && roads.length === 0) return

        // Die Quelle liefert Meter relativ zum Anker; die Szene erwartet sie
        // relativ zum Plan-Mittelpunkt.
        const shift = (p: { x: number; y: number }) => ({ x: p.x + centre.x, y: p.y + centre.z })
        const shifted = buildings.map((b) => ({
          ...b,
          footprint: b.footprint.map(shift),
          centre: shift(b.centre),
        }))
        const shiftedRoads = roads.map((r) => ({ ...r, path: r.path.map(shift) }))
        const shiftedPois = pois.map((p) => ({ ...p, at: shift(p.at) }))

        const world = neighbourhoodFromOsm({
          style, detail,
          centre,
          buildings: shifted,
          roads: shiftedRoads,
          pois: shiftedPois,
          // Beim Katasterweg ist das eigene Grundstück bereits herausgefiltert;
          // OSM braucht die Kennung weiterhin.
          ownId: buildings === fromCadastre ? undefined : pickOwnBuilding(buildings)?.osmId,
          seed: seedForPlan(planId, style),
        })
        // Ohne Straßen und ohne Häuser wäre die echte Welt ärmer als die
        // erzeugte — dann lieber bei der Annahme bleiben.
        // Ohne Häuser **und** ohne Straßen wäre die echte Welt ärmer als die
        // erzeugte. Mit echten Häusern und ohne Straßen ist sie es nicht: der
        // Luftbild-Boden zeigt die Straßen ohnehin, und vermessene Gebäude
        // schlagen erfundene.
        if (world.houses.length === 0 && world.network.segments.length === 0) return
        if (run === runRef.current) setOsmWorld(world)
      } catch {
        /* Ausfall ist vorgesehen — die erzeugte Welt bleibt stehen. */
      } finally {
        if (run === runRef.current) setLoading(false)
      }
    })()

    return () => { ac.abort() }
    // `geo` and `centre` are compared by their coordinates, not by identity:
    // a new object carrying the same place must not re-issue the cadastre and
    // OSM queries this effect fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, geo?.lat, geo?.lng, style, detail, centre.x, centre.z, planId])

  return {
    world: osmWorld ?? generated,
    source: osmWorld ? 'osm' : 'generated',
    loading,
  }
}
