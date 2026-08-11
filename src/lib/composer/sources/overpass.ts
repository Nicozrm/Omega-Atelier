/**
 * overpass.ts — die OpenStreetMap-Quelle.
 *
 * Die erste echte Datenquelle der Pipeline. Sie liefert das, was für ein
 * Wohngrundstück in Deutschland fast immer erfasst ist: den Gebäudeumriss, oft
 * Geschosszahl und Dachform, die Straßen ringsum mit ihrer Klassifikation, und
 * die gesamte Nahversorgung — Supermarkt, Bäckerei, Apotheke, Haltestellen,
 * Spielplätze, Parks, Bahn, Wasser.
 *
 * Drei Entwurfsentscheidungen, die hier tragen:
 *
 * **Transport ist injizierbar.** Genau wie bei den Ökosystem-Connectors
 * (`HaTransport`, `MqttTransport`) kennt die Quelle kein `fetch`. Damit läuft
 * sie im Browser direkt gegen Overpass, später gegen eine Supabase Edge
 * Function, und im Test gegen eine Fixture — ohne dass eine Zeile Fachlogik
 * davon weiß.
 *
 * **Spiegel und Wiederholung gehören in die Quelle.** Overpass ist ein
 * kostenloser, überlasteter öffentlicher Dienst; 504 und 429 sind der
 * Normalfall, nicht die Ausnahme. Eine Analyse darf daran nicht scheitern.
 *
 * **Der Cache-Schlüssel ist geografisch, nicht sitzungsbezogen.** Zwei
 * Nachbarn, die ihr Haus analysieren, fragen dieselbe Zelle ab und teilen sich
 * die Antwort. Bei Millionen Grundstücken ist das der Unterschied zwischen
 * tragfähig und unbezahlbar — und es ist der Grund, warum der Schlüssel schon
 * jetzt so aussieht, obwohl der Cache vorerst nur im Browser lebt.
 */

import type { GeoPoint } from '../types'
import { isCallerAbort, SOURCE_BUDGET_MS, withDeadline, withinBudget } from './deadline'

/* ────────────────────────────── Rohdaten ────────────────────────────── */

export interface OsmTags {
  [key: string]: string | undefined
}

/**
 * Overpass spricht `lon`, die App spricht `lng`. Der Unterschied ist genau ein
 * Buchstabe und deshalb die verlässlichste Fehlerquelle beim Anbinden: ein
 * `GeoPoint` an dieser Stelle wäre stillschweigend `undefined` in der Länge und
 * hätte die gesamte Projektion zu NaN gemacht, ohne eine Zeile zu werfen.
 * Deshalb hat das Fremdformat einen eigenen Typ, und die Umrechnung passiert an
 * genau einer Stelle ({@link toGeo}).
 */
export interface OsmLatLon {
  lat: number
  lon: number
}

export interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  tags?: OsmTags
  /** Bei `out geom` mitgelieferte Stützpunkte (ways). */
  geometry?: OsmLatLon[]
  /** Bei Knoten. */
  lat?: number
  lon?: number
}

/** Die einzige Stelle, an der aus Overpass-Koordinaten App-Koordinaten werden. */
export function toGeo(p: OsmLatLon): GeoPoint {
  return { lat: p.lat, lng: p.lon }
}

export interface OverpassResult {
  elements: OsmElement[]
  /** Datenstand der Quelle — wandert in die `SourceRef`. */
  timestamp?: string
}

/* ────────────────────────────── Transport ───────────────────────────── */

export interface OverpassTransport {
  /** Führt eine Overpass-QL-Abfrage aus. Wirft nur, wenn alle Versuche scheitern. */
  query(ql: string, signal?: AbortSignal): Promise<OverpassResult>
}

/** Öffentliche Spiegel, in der Reihenfolge der Bevorzugung. */
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export interface HttpOverpassOptions {
  mirrors?: string[]
  /** Gesamtzahl der Versuche über alle Spiegel hinweg. */
  attempts?: number
  timeoutMs?: number
  fetchFn?: typeof fetch
}

/**
 * HTTP-Transport gegen die öffentlichen Overpass-Spiegel.
 *
 * Overpass verlangt einen aussagekräftigen User-Agent (ohne kommt 406 zurück)
 * und antwortet unter Last mit 504 — beides wird hier behandelt, mit
 * wachsender Wartezeit und Wechsel des Spiegels bei jedem Versuch.
 */
export class HttpOverpassTransport implements OverpassTransport {
  private readonly mirrors: string[]
  private readonly attempts: number
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(opts: HttpOverpassOptions = {}) {
    this.mirrors = opts.mirrors ?? OVERPASS_MIRRORS
    this.attempts = Math.max(1, opts.attempts ?? 2)
    this.timeoutMs = opts.timeoutMs ?? SOURCE_BUDGET_MS.overpass
    this.fetchFn = opts.fetchFn ?? ((...args) => fetch(...args))
  }

  async query(ql: string, signal?: AbortSignal): Promise<OverpassResult> {
    let lastError: unknown
    for (let i = 0; i < this.attempts; i++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const url = this.mirrors[i % this.mirrors.length]
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Ohne aussagekräftigen Agent antwortet Overpass mit 406.
            'User-Agent': 'OmegaAtelier/2.0 (+https://omega-atelier.vercel.app)',
          },
          body: new URLSearchParams({ data: ql }),
          // Frist UND Aufrufer-Abbruch — nie das eine statt des anderen.
          signal: withDeadline(signal, this.timeoutMs),
        })
        if (!res.ok) {
          lastError = new Error(`Overpass ${res.status} (${url})`)
        } else {
          const json = (await res.json()) as { elements?: OsmElement[]; osm3s?: { timestamp_osm_base?: string } }
          return { elements: json.elements ?? [], timestamp: json.osm3s?.timestamp_osm_base }
        }
      } catch (err) {
        // Nur ein Abbruch des Aufrufers wird durchgereicht; ein Fristablauf ist
        // ein gewöhnlicher Fehlschlag, damit der Rückfall greifen kann.
        if (isCallerAbort(signal)) throw err
        lastError = err
      }
      if (isCallerAbort(signal)) throw new DOMException('aborted', 'AbortError')
      // Zurückhaltung wächst mit jedem Fehlversuch — der Dienst ist kostenlos.
      await sleep(400 * 2 ** i)
    }
    throw lastError instanceof Error ? lastError : new Error('Overpass nicht erreichbar')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/* ────────────────────────────── Abfrage ─────────────────────────────── */

export interface SiteQueryRadii {
  /** Gebäude — nur das unmittelbare Umfeld des Grundstücks. */
  buildingM: number
  /** Straßen und Wege — der Straßenzug. */
  roadM: number
  /** Nahversorgung, ÖPNV, Grünflächen. */
  contextM: number
}

/**
 * Zwei Radien, zwei Zwecke — und bewusst **nicht** eine gemeinsame Abfrage.
 *
 * Ursprünglich teilten sich Analyse und 3D-Nachbarschaft eine große Abfrage,
 * um Cache und Ratenlimit zu schonen. Gemessen kostet die große Fassung 8,5 s,
 * die kleine 2,1 s — und die große lag damit im Wizard auf dem kritischen Pfad,
 * wo jede Sekunde als Stillstand wahrgenommen wird.
 *
 * Die Analyse braucht nur das unmittelbare Umfeld. Die Nachbarschaft braucht
 * den ganzen Straßenzug, wird aber erst in der 3D-Ansicht gebraucht, läuft dort
 * im Hintergrund und hat einen sichtbaren Rückfall. Sie darf also langsam sein.
 */
export const DEFAULT_RADII: SiteQueryRadii = { buildingM: 60, roadM: 180, contextM: 400 }

/** Der weite Radius für die 3D-Nachbarschaft — abseits des kritischen Pfads. */
export const WORLD_RADII: SiteQueryRadii = { buildingM: 220, roadM: 260, contextM: 550 }

/**
 * Die Standortabfrage: alles, was die Phasen 1–5 aus OSM beziehen können, in
 * **einer** Anfrage. Getrennte Anfragen pro Phase wären lesbarer, würden aber
 * das Ratenlimit eines kostenlosen Dienstes fünffach belasten.
 */
export function buildSiteQuery(at: GeoPoint, radii: SiteQueryRadii = DEFAULT_RADII): string {
  const lat = at.lat.toFixed(6)
  const lng = at.lng.toFixed(6)
  const { buildingM: b, roadM: r, contextM: c } = radii
  return `[out:json][timeout:45];
(
  way(around:${b},${lat},${lng})["building"];
  relation(around:${b},${lat},${lng})["building"];
  way(around:${r},${lat},${lng})["highway"];
  way(around:${c},${lat},${lng})["landuse"];
  way(around:${c},${lat},${lng})["leisure"~"^(park|playground|garden|pitch|sports_centre)$"];
  way(around:${c},${lat},${lng})["natural"~"^(water|wood|scrub)$"];
  way(around:${c},${lat},${lng})["waterway"];
  way(around:${c},${lat},${lng})["railway"];
  node(around:${c},${lat},${lng})["amenity"];
  node(around:${c},${lat},${lng})["shop"];
  node(around:${c},${lat},${lng})["highway"="bus_stop"];
  node(around:${c},${lat},${lng})["public_transport"="platform"];
  node(around:${r},${lat},${lng})["natural"="tree"];
  node(around:${r},${lat},${lng})["highway"="street_lamp"];
);
out tags geom;`
}

/* ────────────────────────────── Cache ───────────────────────────────── */

/**
 * Geografischer Cache-Schlüssel. Auf ~2 Nachkommastellen gerundet entspricht
 * eine Zelle grob 1 km — ein ganzer Straßenzug teilt sich damit eine Antwort.
 * Die Quantisierung ist Teil des Schlüssels, damit ein späterer Wechsel auf
 * H3 oder Quadkeys alte Einträge sauber verfallen lässt.
 */
export function cellKey(at: GeoPoint, radii: SiteQueryRadii = DEFAULT_RADII): string {
  const q = (v: number) => (Math.round(v * 100) / 100).toFixed(2)
  return `osm/v1/${q(at.lat)},${q(at.lng)}/${radii.buildingM}-${radii.roadM}-${radii.contextM}`
}

export interface CacheEntry {
  result: OverpassResult
  storedAt: number
}

export interface SiteCache {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
}

/** Prozessweiter Cache — überlebt den Wizard, nicht den Reload. */
export class MemorySiteCache implements SiteCache {
  private readonly map = new Map<string, CacheEntry>()
  get(key: string) { return this.map.get(key) }
  set(key: string, entry: CacheEntry) { this.map.set(key, entry) }
}

/** Wie lange eine Antwort gilt. OSM ändert sich langsam; ein Tag ist reichlich. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Die Quelle, wie die Pipeline sie sieht: eine Abfrage pro Standort, gecacht,
 * ausfallsicher. Wirft nie — ein Ausfall liefert `undefined`, und die Pipeline
 * fällt auf ihre Annahmen zurück, statt die Analyse abzubrechen.
 */
export class OsmSource {
  constructor(
    private readonly transport: OverpassTransport = new HttpOverpassTransport(),
    private readonly cache: SiteCache = new MemorySiteCache(),
    private readonly radii: SiteQueryRadii = DEFAULT_RADII,
    /** Frist. Auf dem kritischen Pfad knapp, im Hintergrund großzügig. */
    private readonly budgetMs: number = SOURCE_BUDGET_MS.overpass,
  ) {}

  async fetchSite(at: GeoPoint, signal?: AbortSignal): Promise<OverpassResult | undefined> {
    const key = cellKey(at, this.radii)
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.storedAt < CACHE_TTL_MS) return hit.result

    // Die Frist liegt hier, nicht im Transport: sie muss unabhängig davon
    // gelten, wer die Anfrage tatsächlich ausführt. Abgelaufener Cache ist
    // dabei der bessere Rückfall als gar nichts.
    return withinBudget(
      async (deadline) => {
        const result = await this.transport.query(buildSiteQuery(at, this.radii), deadline)
        this.cache.set(key, { result, storedAt: Date.now() })
        return result as OverpassResult | undefined
      },
      hit?.result,
      this.budgetMs,
      signal,
    )
  }
}

/** Die Instanz für die Analyse: enger Radius, knappe Frist. */
export const osmSource = new OsmSource()

/**
 * Die Instanz für die 3D-Nachbarschaft: weiter Radius, großzügige Frist.
 * Eigener Cache-Eintrag, weil der Schlüssel die Radien enthält.
 */
export const worldOsmSource = new OsmSource(
  new HttpOverpassTransport({ timeoutMs: SOURCE_BUDGET_MS.overpassWorld }),
  new MemorySiteCache(),
  WORLD_RADII,
  SOURCE_BUDGET_MS.overpassWorld,
)
