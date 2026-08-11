/**
 * lod2.ts — echte Gebäudehöhen und Dachformen aus dem amtlichen 3D-Modell.
 *
 * Bis hierher war die Höhe jedes Gebäudes gerechnet, nicht gemessen: Geschosse
 * aus der Grundfläche geschätzt, Traufhöhe aus den Geschossen hochgerechnet.
 * Bei 692 Nachbargebäuden ohne eine einzige Geschossangabe in OSM ist die
 * gesamte Silhouette einer Straße damit erfunden — der Umriss stimmt, die
 * dritte Dimension nicht.
 *
 * NRW veröffentlicht das LoD2-Gebäudemodell als **OGC API Features**, und das
 * ändert die Lage grundlegend. Der bisherige Plan war eine serverseitige Stufe,
 * weil die LoD2-Kacheln des Landes Einzeldateien von rund 40 MB sind — für eine
 * Firsthöhe im Browser nicht vertretbar. Über diese Schnittstelle sind es
 * **75 kB für 64 Gebäude**. Damit fällt die Serverstufe ersatzlos weg.
 *
 * ## Zwei Eigenheiten der Schnittstelle
 *
 *  1. **Nur CityJSON.** `f=json` beantwortet die Sammlung mit HTTP 400; das
 *     Format heißt `f=cityjson`. Eine GeoJSON-Antwort gibt es nicht.
 *  2. **Die bbox bleibt zweidimensional.** Die Sammlung meldet CRS84h, also
 *     mit Höhe — eine sechswertige bbox wird trotzdem abgelehnt (ebenfalls
 *     400). Vier Werte, wie überall sonst.
 *
 * Beides ist durch Ausprobieren gegen den Dienst festgestellt und nicht
 * dokumentiert; deshalb steht es hier.
 */

import type { GeoPoint } from '../types'
import type { RoofShape } from '../types'
import { isCallerAbort, withDeadline, withinBudget } from './deadline'

export const LOD2_BASE = 'https://ogc-api.nrw.de/3dg/v1'

/**
 * Frist für LoD2 — großzügig, weil der Dienst es sein muss.
 *
 * Gemessen gegen den echten Endpunkt: bei 160 m Radius und `limit=200` kamen
 * 341 Gebäude in 42 s zurück, mit `limit=100` in 55 s; kleinere Limits
 * antworteten mehrfach mit HTTP 502 nach jeweils 61 s. Das ist keine Quelle
 * für den kritischen Pfad einer Analyse, sondern eine Bereicherung, die im
 * Hintergrund eintrifft oder eben nicht.
 *
 * Deshalb auch bewusst kein Platz im Analyse-Assistenten: dort gilt weiter,
 * dass nichts länger als ein paar Sekunden warten darf.
 */
export const LOD2_BUDGET_MS = 70_000

/** Was der Dienst gemessen verkraftet, ohne in 502er zu laufen. */
export const LOD2_RADIUS_M = 160
export const LOD2_LIMIT = 200

/* ─────────────────────────── CityJSON-Rohform ────────────────────────── */

interface CityJson {
  type: string
  version: string
  transform: { scale: [number, number, number]; translate: [number, number, number] }
  vertices: [number, number, number][]
  CityObjects: Record<string, {
    type: string
    attributes?: Record<string, unknown>
    geometry?: { type: string; lod?: string; boundaries?: unknown }[]
  }>
}

/**
 * Dachformen nach dem AdV-Schlüssel „Dachform" aus ALKIS/CityGML.
 *
 * Der Renderer kennt vier Formen; das Kataster unterscheidet über zwanzig.
 * Abgebildet wird auf die nächstliegende — ein Krüppelwalmdach ist im Modell
 * ein Walmdach, ein Mansarddach ein Satteldach. Das ist eine bewusste
 * Vergröberung und keine Näherung an der Datenquelle.
 */
const ROOF_CODE: Record<number, RoofShape> = {
  1000: 'flat', // Flachdach
  2100: 'pent', // Pultdach
  2200: 'pent', // versetztes Pultdach
  3100: 'gable', // Satteldach
  3200: 'hip', // Walmdach
  3300: 'hip', // Krüppelwalmdach
  3400: 'gable', // Mansarddach
  3500: 'hip', // Zeltdach
  3600: 'gable', // Kegeldach
  3700: 'gable', // Kuppeldach
  3800: 'gable', // Sheddach
  3900: 'gable', // Bogendach
  4000: 'gable', // Turmdach
  5000: 'flat', // Mischform
  9999: 'gable', // sonstiges
}

export function roofShapeFromCode(code: number | undefined): RoofShape | undefined {
  if (code === undefined) return undefined
  return ROOF_CODE[code] ?? (code >= 3000 ? 'gable' : 'flat')
}

/* ────────────────────────────── Fachdaten ───────────────────────────── */

export interface Lod2Building {
  id: string
  /** Gemessene Gebäudehöhe in Metern (First über Gelände). */
  heightM: number
  roofShape?: RoofShape
  /** Rohcode, für Nachvollziehbarkeit. */
  roofCode?: number
  /** Schwerpunkt in Länge/Breite — für die Zuordnung zum Katasterumriss. */
  at: GeoPoint
  /** Datenstand. */
  updated?: string
}

/**
 * Rechnet CityJSON in eine flache Liste um.
 *
 * Die Koordinaten stehen als **ganze Zahlen** in `vertices` und werden erst
 * über `transform` zu Länge/Breite/Höhe — ohne diesen Schritt liegt jedes
 * Gebäude bei etwa (0, 0). Der Schwerpunkt genügt hier: die Umrisse kommen
 * aus dem Kataster, aus LoD2 werden nur Höhe und Dachform übernommen.
 */
export function parseCityJson(doc: CityJson): Lod2Building[] {
  const { scale, translate } = doc.transform
  const out: Lod2Building[] = []

  // Welche Ecken zu welchem Objekt gehören, steckt tief verschachtelt in
  // `boundaries`. Da nur der Schwerpunkt gebraucht wird, werden die Indizes
  // flach eingesammelt statt die Flächenstruktur nachzubauen.
  const collect = (b: unknown, into: number[]): void => {
    if (typeof b === 'number') { into.push(b); return }
    if (Array.isArray(b)) for (const x of b) collect(x, into)
  }

  for (const [id, obj] of Object.entries(doc.CityObjects ?? {})) {
    const a = obj.attributes ?? {}
    const h = Number(a.measuredHeight)
    if (!Number.isFinite(h) || h <= 0) continue

    const idx: number[] = []
    for (const g of obj.geometry ?? []) collect(g.boundaries, idx)
    if (idx.length === 0) continue

    let sx = 0, sy = 0, n = 0
    for (const i of idx) {
      const v = doc.vertices[i]
      if (!v) continue
      sx += v[0]; sy += v[1]; n++
    }
    if (n === 0) continue

    const roofCode = Number(a.roofType)
    out.push({
      id,
      heightM: Math.round(h * 100) / 100,
      roofCode: Number.isFinite(roofCode) ? roofCode : undefined,
      roofShape: roofShapeFromCode(Number.isFinite(roofCode) ? roofCode : undefined),
      at: {
        lng: (sx / n) * scale[0] + translate[0],
        lat: (sy / n) * scale[1] + translate[1],
      },
      updated: typeof a.creationDate === 'string' ? a.creationDate : undefined,
    })
  }
  return out
}

/* ────────────────────────────── Transport ───────────────────────────── */

export interface Lod2Transport {
  items(bbox: string, limit: number, signal?: AbortSignal): Promise<CityJson>
}

export class HttpLod2Transport implements Lod2Transport {
  constructor(
    private readonly base = LOD2_BASE,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly timeoutMs = LOD2_BUDGET_MS,
  ) {}

  async items(bbox: string, limit: number, signal?: AbortSignal): Promise<CityJson> {
    // `f=cityjson`, nicht `f=json` — letzteres beantwortet der Dienst mit 400.
    const url = `${this.base}/collections/building/items`
      + `?bbox=${encodeURIComponent(bbox)}&limit=${limit}&f=cityjson`
    const res = await this.fetchFn(url, { signal: withDeadline(signal, this.timeoutMs) })
    if (!res.ok) throw new Error(`LoD2 ${res.status}`)
    return (await res.json()) as CityJson
  }
}

/* ────────────────────────────── Quelle ──────────────────────────────── */

export function bbox2d(at: GeoPoint, radiusM: number): string {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((at.lat * Math.PI) / 180))
  return [
    (at.lng - dLng).toFixed(6), (at.lat - dLat).toFixed(6),
    (at.lng + dLng).toFixed(6), (at.lat + dLat).toFixed(6),
  ].join(',')
}

export class Lod2Source {
  private readonly cache = new Map<string, Lod2Building[]>()

  constructor(private readonly transport: Lod2Transport = new HttpLod2Transport()) {}

  /**
   * Höhen und Dachformen im Umkreis. Wirft nie: außerhalb NRW oder bei Ausfall
   * kommt eine leere Liste, und die Höhen bleiben abgeleitet.
   */
  async fetchAround(at: GeoPoint, radiusM = LOD2_RADIUS_M, limit = LOD2_LIMIT, signal?: AbortSignal): Promise<Lod2Building[]> {
    const bbox = bbox2d(at, radiusM)
    const key = `${bbox}/${limit}`
    const hit = this.cache.get(key)
    if (hit) return hit

    return withinBudget(async (deadline) => {
      try {
        const doc = await this.transport.items(bbox, limit, deadline)
        const list = parseCityJson(doc)
        this.cache.set(key, list)
        return list
      } catch (err) {
        if (isCallerAbort(signal)) throw err
        return []
      }
    }, [], LOD2_BUDGET_MS, signal)
  }
}

export const lod2Source = new Lod2Source()
