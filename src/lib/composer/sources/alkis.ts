/**
 * alkis.ts — das amtliche Liegenschaftskataster (ALKIS) als Quelle.
 *
 * Nordrhein-Westfalen veröffentlicht ALKIS als **OGC API Features**: eine
 * bbox-abfragbare GeoJSON-Schnittstelle ohne Schlüssel, ohne Anmeldung, mit
 * dl-de/zero-2.0. Das liefert genau die drei Dinge, die der Pipeline bisher am
 * meisten gefehlt haben:
 *
 *   • **Flurstücke** — die vermessene Grundstücksgrenze samt amtlicher Fläche,
 *     Gemarkung, Flur und Flurstücksnummer. Damit wird Phase 1 zum ersten Mal
 *     eine Messung statt einer Zeichnung.
 *   • **Gebäude und Bauwerke** — Umrisse aus dem Kataster, mit Nutzungsart
 *     (Wohnhaus, Garage, Überdachung …). Genauer als OSM und mit einer
 *     Semantik, die OSM in dieser Form nicht kennt.
 *   • **Nutzung** — was die Fläche tatsächlich ist: Wohnbaufläche, Garten,
 *     Straßenverkehr, Gehölz, Wasser. Das ist Phase 3 und 4 in amtlicher
 *     Qualität.
 *
 * Warum das hier steht und nicht LoD2: die LoD2-Kacheln des Landes sind
 * Einzeldateien von rund 40 MB. Für eine einzige Firsthöhe wäre das im Browser
 * nicht vertretbar — LoD2 braucht die serverseitige Stufe. ALKIS liefert
 * dagegen pro Abfrage wenige Kilobyte und lässt sich sofort anbinden.
 *
 * Wie bei Overpass ist der Transport injizierbar und der Cache-Schlüssel
 * geografisch.
 */

import type { GeoPoint } from '../types'
import { SOURCE_BUDGET_MS, withDeadline, withinBudget } from './deadline'

/* ────────────────────────────── Rohdaten ────────────────────────────── */

/**
 * GeoJSON aus einer OGC API Features. Koordinaten sind CRS84, also
 * **[lon, lat]** — dieselbe Falle wie bei Overpass, deshalb wieder ein eigener
 * Typ und genau eine Umrechnungsstelle.
 */
export type LonLat = [number, number]

export interface AlkisFeature<P = Record<string, unknown>> {
  type: 'Feature'
  id?: string
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString'
    coordinates: unknown
  } | null
  properties: P
}

export interface AlkisCollection<P = Record<string, unknown>> {
  features: AlkisFeature<P>[]
  numberMatched?: number
  numberReturned?: number
}

/** Die einzige Stelle, an der aus CRS84-Koordinaten App-Koordinaten werden. */
export function toGeo(p: LonLat): GeoPoint {
  return { lat: p[1], lng: p[0] }
}

/** Äußerer Ring eines (Multi-)Polygons — Löcher interessieren hier nicht. */
export function outerRing(geometry: AlkisFeature['geometry']): GeoPoint[] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as LonLat[][]
    return (rings[0] ?? []).map(toGeo)
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as LonLat[][][]
    // Bei mehrteiligen Flurstücken zählt der größte Teil.
    let best: LonLat[] = []
    for (const poly of polys) {
      const ring = poly[0] ?? []
      if (ring.length > best.length) best = ring
    }
    return best.map(toGeo)
  }
  return []
}

/* ────────────────────────────── Fachdaten ───────────────────────────── */

export interface ParcelProps {
  objid: string
  /** Amtliche Fläche in m². */
  flaeche: number
  gemarkung: string
  flur: string
  /** Flurstücksnummer (Zähler). */
  flstnrzae: string
  /** Nenner, wo vorhanden. */
  flstnrnen?: string
  gemeinde: string
  kreis: string
  /** Lagebezeichnung, meist der Straßenname. */
  lagebeztxt?: string
  /** Datenstand. */
  aktualit?: string
}

export interface CadastreBuildingProps {
  /** Nutzungsart im Klartext, z. B. „Wohnhaus". */
  gebnutzbez?: string
  /** Funktion, z. B. „Garage", „Überdachung". */
  funktion?: string
  aktualit?: string
}

export interface LandUseProps {
  /** Nutzungsart, z. B. „Wohnbaufläche", „Straßenverkehr", „Gehölz". */
  nutzart?: string
  bez?: string
  name?: string
}

/* ────────────────────────────── Transport ───────────────────────────── */

export interface AlkisTransport {
  items<P>(collection: string, bbox: string, limit: number, signal?: AbortSignal): Promise<AlkisCollection<P>>
}

export const ALKIS_BASE = 'https://ogc-api.nrw.de/lika/v1'

export class HttpAlkisTransport implements AlkisTransport {
  constructor(
    private readonly base = ALKIS_BASE,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs: number = SOURCE_BUDGET_MS.alkis,
  ) {}

  async items<P>(collection: string, bbox: string, limit: number, signal?: AbortSignal): Promise<AlkisCollection<P>> {
    const url = `${this.base}/collections/${collection}/items?bbox=${bbox}&limit=${limit}&f=json`
    const res = await this.fetchFn(url, {
      headers: { Accept: 'application/geo+json,application/json' },
      // Frist UND Aufrufer-Abbruch — nie das eine statt des anderen.
      signal: withDeadline(signal, this.timeoutMs),
    })
    if (!res.ok) throw new Error(`ALKIS ${res.status} (${collection})`)
    return (await res.json()) as AlkisCollection<P>
  }
}

/* ────────────────────────────── Quelle ──────────────────────────────── */

export interface AlkisSite {
  parcels: AlkisFeature<ParcelProps>[]
  buildings: AlkisFeature<CadastreBuildingProps>[]
  landUse: AlkisFeature<LandUseProps>[]
  /** Datenstand der Quelle, aus dem ersten Flurstück übernommen. */
  version?: string
  /**
   * Welche Ebenen der Dienst abgeschnitten hat, weil mehr Objekte in der Box
   * lagen als das Limit zuließ.
   *
   * Leer ist der Normalfall und die Voraussetzung dafür, dass „unter diesem
   * Punkt liegt kein Flurstück" tatsächlich heißt, dass dort keins liegt — und
   * nicht bloß, dass es nicht auf der Seite stand. Steht hier etwas drin, ist
   * jede negative Aussage über die Umgebung wertlos.
   */
  truncated: string[]
}

export interface AlkisCache {
  get(key: string): { site: AlkisSite; storedAt: number } | undefined
  set(key: string, v: { site: AlkisSite; storedAt: number }): void
}

class MemoryAlkisCache implements AlkisCache {
  private readonly map = new Map<string, { site: AlkisSite; storedAt: number }>()
  get(k: string) { return this.map.get(k) }
  set(k: string, v: { site: AlkisSite; storedAt: number }) { this.map.set(k, v) }
}

/** Kataster ändert sich in Monaten, nicht Stunden. */
export const ALKIS_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Eine Bounding-Box um den Punkt. ALKIS deckt nur NRW ab — außerhalb liefert
 * die Schnittstelle schlicht nichts, und die Pipeline fällt zurück. Genau so
 * soll eine regionale Quelle sich verhalten: keine Sonderbehandlung, kein
 * Fehler, nur weniger Beobachtungen.
 */
export function bboxAround(at: GeoPoint, radiusM: number): string {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((at.lat * Math.PI) / 180))
  return [
    (at.lng - dLng).toFixed(6), (at.lat - dLat).toFixed(6),
    (at.lng + dLng).toFixed(6), (at.lat + dLat).toFixed(6),
  ].join(',')
}

/**
 * Wie viele Objekte je Ebene abgefragt werden. Eine OGC API Features liefert
 * ohne `limit` nur eine Handvoll und schneidet stillschweigend ab — die Zahl
 * ist also kein Detail, sondern entscheidet, ob die Nachbarschaft vollständig
 * ist.
 */
export interface AlkisLimits { parcels: number; buildings: number; landUse: number }

/**
 * Enge Abfrage um ein Grundstück.
 *
 * Die Zahlen waren einmal 60 / 120 / 60 — „ein paar Nachbarn genügen". Gegen
 * den echten Dienst gemessen ist das zu knapp: eine 180-m-Box um die
 * Kolpingstr. 9 enthält **87 Flurstücke**. Es kamen also 60 zurück und 27
 * fielen weg. Eine OGC API Features sortiert nicht räumlich, sondern liefert
 * die Seite in Speicherreihenfolge; welche 27 fehlen, ist damit Zufall — und
 * mit rund 31 % Wahrscheinlichkeit ist das eigene Flurstück dabei.
 *
 * Der Ausfall wäre dabei vollkommen lautlos: HTTP 200, gültiges GeoJSON, nur
 * findet `parcelAtPoint` nichts, und die Analyse fällt auf das erzeugte Raster
 * zurück, als gäbe es kein Kataster. Genau die Art Fehler, die diese Pipeline
 * nicht haben darf.
 *
 * Mehr zu holen kostet fast nichts: dieselbe Abfrage mit `limit=250`
 * antwortete in 1,27 s statt 1,44 s, bei 109 kB statt 66 kB. Der Dienst zahlt
 * für die räumliche Auswahl, nicht für die Zeilen.
 */
export const SITE_LIMITS: AlkisLimits = { parcels: 250, buildings: 400, landUse: 150 }

/**
 * Weite Abfrage für die 3D-Nachbarschaft. Eine Bounding-Box von rund 450 m
 * Kantenlänge enthält in einem Wohngebiet mehrere hundert Baukörper; mit den
 * 120 aus `SITE_LIMITS` bliebe die halbe Straße unbebaut, ohne dass ein Fehler
 * auftritt.
 */
export const WORLD_LIMITS: AlkisLimits = { parcels: 400, buildings: 900, landUse: 250 }

export class AlkisSource {
  constructor(
    private readonly transport: AlkisTransport = new HttpAlkisTransport(),
    private readonly cache: AlkisCache = new MemoryAlkisCache(),
    /**
     * Eigene Frist je Einsatzzweck.
     *
     * Die enge Analyse-Abfrage muss in Sekunden antworten — dort wartet ein
     * Mensch. Die weite Nachbarschaftsabfrage holt mit `WORLD_LIMITS` bis zu
     * 900 Gebäude und braucht entsprechend länger; mit der Analyse-Frist von
     * 7 s lief sie regelmäßig ins Leere und die Nachbarschaft blieb erfunden,
     * ohne dass etwas fehlschlug.
     */
    private readonly budgetMs: number = SOURCE_BUDGET_MS.alkis as number,
  ) {}

  /**
   * Liefert Flurstücke, Katastergebäude und Nutzungsflächen im Umkreis.
   * Wirft nie: außerhalb NRW oder bei Ausfall kommt `undefined` zurück.
   */
  async fetchSite(
    at: GeoPoint,
    radiusM = 90,
    signal?: AbortSignal,
    limits: AlkisLimits = SITE_LIMITS,
  ): Promise<AlkisSite | undefined> {
    const bbox = bboxAround(at, radiusM)
    // Die Grenzen gehören in den Schlüssel: dieselbe Bounding-Box mit einem
    // höheren Limit ist eine **andere** Antwort. Ohne das würde die enge
    // Analyse-Abfrage der weiten Nachbarschaftsabfrage ihre abgeschnittene
    // Fassung aus dem Cache unterschieben — und die Nachbarhäuser fehlten,
    // ohne dass irgendetwas fehlschlägt.
    const key = `alkis/v1/${bbox}/${limits.parcels}-${limits.buildings}-${limits.landUse}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.storedAt < ALKIS_TTL_MS) return hit.site

    // Frist auf Quellen-Ebene, damit sie unabhängig vom Transport gilt.
    return withinBudget(async (deadline) => {
      // Die drei Ebenen parallel — es sind unabhängige Sammlungen, und die
      // Schnittstelle verträgt das problemlos.
      const [parcels, buildings, landUse] = await Promise.all([
        this.transport.items<ParcelProps>('flurstueck', bbox, limits.parcels, deadline),
        this.transport.items<CadastreBuildingProps>('gebaeude_bauwerk', bbox, limits.buildings, deadline),
        this.transport.items<LandUseProps>('nutzung', bbox, limits.landUse, deadline),
      ])
      // Abschneiden erkennen, nicht hoffen, dass es nicht passiert. Die
      // Schnittstelle meldet mit `numberMatched`, wie viele Objekte in der Box
      // liegen, und mit `numberReturned`, wie viele davon auf der Seite stehen.
      // Weichen sie ab, fehlt etwas — und zwar in einer Reihenfolge, die
      // niemand kennt.
      const cut = (name: string, c: AlkisCollection<unknown>): string | undefined => {
        const got = c.numberReturned ?? c.features?.length ?? 0
        const total = c.numberMatched
        return total !== undefined && got < total ? `${name} ${got}/${total}` : undefined
      }
      const truncated = [
        cut('Flurstücke', parcels),
        cut('Gebäude', buildings),
        cut('Nutzung', landUse),
      ].filter((s): s is string => s !== undefined)
      if (truncated.length > 0) {
        // Sichtbar, weil die Folge unsichtbar ist: die Analyse läuft weiter und
        // sieht vollständig aus.
        console.warn(`OMEGA Kataster: Antwort abgeschnitten — ${truncated.join(', ')}`)
      }

      const site: AlkisSite = {
        parcels: parcels.features ?? [],
        buildings: buildings.features ?? [],
        landUse: landUse.features ?? [],
        version: (parcels.features?.[0]?.properties as ParcelProps | undefined)?.aktualit,
        truncated,
      }
      if (site.parcels.length === 0 && site.buildings.length === 0) return undefined
      this.cache.set(key, { site, storedAt: Date.now() })
      return site as AlkisSite | undefined
    }, hit?.site, this.budgetMs, signal)
  }
}

export const alkisSource = new AlkisSource()

/**
 * Eigene Instanz für die 3D-Nachbarschaft. Getrennter Cache, weil der
 * Schlüssel die Grenzen enthält — und getrennt auch deshalb, weil diese
 * Abfrage im Hintergrund läuft und warten darf, während die Analyse es nicht
 * darf.
 */
export const worldAlkisSource = new AlkisSource(
  new HttpAlkisTransport(undefined, undefined, 30_000),
  new MemoryAlkisCache(),
  30_000,
)
