/**
 * imagery.ts — woher das Luftbild kommt, und warum nicht von Google.
 *
 * ## Die Rechtslage, kurz
 *
 * Google Maps/Earth zeigen die detailliertesten Bilder, die man an vielen
 * Orten bekommt — nutzen darf man sie hier trotzdem nicht. Die Google Maps
 * Platform Terms binden die Kacheln an Googles **eigene** SDKs und APIs.
 * Verboten ist damit genau das, was diese App tut:
 *
 *   • Kacheln in einen fremden Renderer laden (hier: ein `<canvas>`),
 *   • Inhalte aus den Bildern ableiten und speichern (hier: der Digital Twin),
 *   • Bilder zwischenspeichern oder weiterverarbeiten.
 *
 * Das gilt unabhängig davon, ob man einen API-Schlüssel hat — der Schlüssel
 * erlaubt die Nutzung *innerhalb* der Google-SDKs, nicht außerhalb. Ein
 * kommerzielles Produkt kann darauf nicht aufbauen; das Risiko ist nicht die
 * Abmahnung, sondern die Abschaltung.
 *
 * ## Die bessere Antwort
 *
 * Für Deutschland ist die Frage ohnehin falsch gestellt. Die Landesvermessungen
 * veröffentlichen **amtliche Digitale Orthophotos** als Open Data — in NRW mit
 * 10 cm Bodenauflösung, also **feiner als Googles Satellitenansicht**, unter
 * „Datenlizenz Deutschland – Zero 2.0": jede Nutzung ohne Einschränkungen oder
 * Bedingungen, ohne Schlüssel, ohne Anmeldung, mit offenem CORS.
 *
 * Der eigentliche Gewinn ist aber nicht die Auflösung, sondern die Herkunft:
 * DOP und ALKIS stammen aus derselben Landesvermessung, im selben
 * Bezugssystem, aus derselben Befliegung. Grundstücksgrenze und Luftbild
 * passen deshalb **geometrisch aufeinander** — bei einem globalen
 * Bildmosaik aus fremder Quelle ist das Zufall.
 *
 * ## Wie die Ebenen gestapelt werden
 *
 * Esri World Imagery ist die globale Grundlage und deckt jeden Ort ab. Wo eine
 * amtliche Befliegung existiert, wird sie **darüber** gezeichnet — als PNG mit
 * Transparenz. Außerhalb der tatsächlichen Abdeckung liefert der Dienst leere
 * Kacheln, und die globale Ebene scheint durch. Deshalb muss niemand raten, wo
 * ein Bundesland aufhört: die Landesgrenze zeichnet der Dienst selbst.
 *
 * Neue Länder sind eine Zeile in {@link REGIONAL_DOP} — die Abdeckung steht in
 * den Capabilities des jeweiligen Dienstes und ist hier übernommen, nicht
 * geschätzt.
 */

import type { GeoPoint } from './types'

/* ────────────────────────────── Vertrag ─────────────────────────────── */

export interface ImageryLayer {
  id: string
  /** Für die Oberfläche, z. B. „Geobasis NRW · DOP 10 cm". */
  label: string
  /** Nennung im Kartenbild. */
  attribution: string
  /** Lizenz im Klartext — gehört zur Quelle, nicht in eine Fußnote. */
  licence: string
  /** Bodenauflösung in Metern je Pixel. Kleiner ist besser. */
  groundResolutionM: number
  /** Höchste sinnvolle Zoomstufe dieser Quelle. */
  maxZoom: number
  /** Kantenlänge der abgerufenen Kachel in Pixeln. */
  tilePx: number
  /**
   * Ob diese Ebene Lücken haben kann. Regionale Befliegungen enden an der
   * Landesgrenze und liefern dort transparente Kacheln; die globale Grundlage
   * kann das nicht. Wer Lücken hat, muss geprüft werden, bevor er sich als
   * Quelle ausgibt — siehe {@link imageryStack}.
   */
  partial: boolean
  tileUrl(z: number, x: number, y: number): string
}

/* ─────────────────────────── Globale Grundlage ──────────────────────── */

export const ESRI_ATTRIBUTION = 'Bilder © Esri · Maxar · Earthstar Geographics'

/** Slippy-Tile-URL für Esri World Imagery (Reihenfolge z/y/x!). */
export function esriTileUrl(z: number, x: number, y: number): string {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
}

export const esriImagery: ImageryLayer = {
  id: 'esri-world-imagery',
  label: 'Esri World Imagery',
  attribution: ESRI_ATTRIBUTION,
  licence: 'Esri-Nutzungsbedingungen — Anzeige mit Nennung erlaubt',
  // Weltweit sehr unterschiedlich; 0,3 m ist der typische Wert in Mitteleuropa
  // und dient hier nur dem Vergleich mit den amtlichen Ebenen.
  groundResolutionM: 0.3,
  maxZoom: 19,
  tilePx: 256,
  partial: false,
  tileUrl: esriTileUrl,
}

/* ──────────────────────── Amtliche Orthophotos ──────────────────────── */

/** Geografische Abdeckung, wie der Dienst sie selbst angibt. */
export interface LatLngBounds { south: number; north: number; west: number; east: number }

export interface RegionalDop {
  id: string
  label: string
  attribution: string
  licence: string
  groundResolutionM: number
  maxZoom: number
  /** WMS-Endpunkt ohne Query. */
  base: string
  /** Name der RGB-Ebene im Dienst. */
  layer: string
  /**
   * `EX_GeographicBoundingBox` aus den Capabilities. Das ist die rechteckige
   * Hülle eines unregelmäßigen Landesgebiets — sie überlappt an den Ecken mit
   * Nachbarländern und ist deshalb bewusst nur ein **Vorfilter**, keine
   * Abdeckungsaussage. Die echte Grenze liefert der Dienst als Transparenz.
   */
  bounds: LatLngBounds
}

/**
 * Amtliche Befliegungen, jeweils geprüft: Dienst erreichbar, CORS offen,
 * Testkachel geliefert. Alle unter dl-de/zero-2.0.
 */
export const REGIONAL_DOP: RegionalDop[] = [
  {
    id: 'nw-dop',
    label: 'Geobasis NRW · DOP 10 cm',
    attribution: 'Luftbild © Geobasis NRW (dl-de/zero-2.0)',
    licence: 'Datenlizenz Deutschland – Zero 2.0',
    groundResolutionM: 0.1,
    maxZoom: 20,
    base: 'https://www.wms.nrw.de/geobasis/wms_nw_dop',
    layer: 'nw_dop_rgb',
    bounds: { south: 50.0578, north: 52.7998, west: 5.5933, east: 9.7416 },
  },
  {
    id: 'ni-dop20',
    label: 'LGLN Niedersachsen · DOP 20 cm',
    attribution: 'Luftbild © LGLN Niedersachsen (dl-de/zero-2.0)',
    licence: 'Datenlizenz Deutschland – Zero 2.0',
    groundResolutionM: 0.2,
    maxZoom: 20,
    base: 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms',
    layer: 'ni_dop20',
    bounds: { south: 51.1531, north: 54.1481, west: 6.5058, east: 11.7540 },
  },
  {
    id: 'sn-dop20',
    label: 'GeoSN Sachsen · DOP 20 cm',
    attribution: 'Luftbild © GeoSN (dl-de/zero-2.0)',
    licence: 'Datenlizenz Deutschland – Zero 2.0',
    groundResolutionM: 0.2,
    maxZoom: 20,
    base: 'https://geodienste.sachsen.de/wms_geosn_dop-rgb/guest',
    layer: 'sn_dop_020',
    bounds: { south: 50.1506, north: 51.7209, west: 11.7889, east: 15.0869 },
  },
]

/* ──────────────────────────── Kachel-Mathematik ─────────────────────── */

/** Halber Umfang der Web-Mercator-Ebene in Metern. */
const MERC_R = 20037508.342789244

/**
 * Die Grenzen einer Slippy-Kachel in EPSG:3857.
 *
 * WMS 1.3.0 dreht die Achsen nach der CRS-Definition um — bei EPSG:4326 also
 * `lat,lon`. EPSG:3857 ist als Ost/Nord definiert und bleibt deshalb bei
 * `minx,miny,maxx,maxy`. Genau deshalb wird hier in 3857 angefragt und nicht
 * in 4326: keine Achsenfalle, und es ist ohnehin das Raster der Kacheln.
 */
export function tileBounds3857(z: number, x: number, y: number): string {
  const size = (2 * MERC_R) / 2 ** z
  const minX = -MERC_R + x * size
  const maxY = MERC_R - y * size
  return `${minX},${maxY - size},${minX + size},${maxY}`
}

/**
 * Kacheln werden mit 512 px abgerufen, obwohl das Kachelraster 256 px breit
 * ist. Bei z19 deckt eine Kachel rund 47 Bodenmeter ab — mit 256 px wären das
 * 18 cm je Pixel und die Hälfte der amtlichen Auflösung wäre weggeworfen,
 * bevor das Bild überhaupt ankommt. 512 px trifft die native Auflösung.
 */
export const WMS_TILE_PX = 512

export function dopTileUrl(dop: RegionalDop, z: number, x: number, y: number): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: dop.layer,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: tileBounds3857(z, x, y),
    WIDTH: String(WMS_TILE_PX),
    HEIGHT: String(WMS_TILE_PX),
    // PNG statt JPEG: nur so gibt es Transparenz, und nur mit Transparenz
    // kann die globale Ebene außerhalb der Befliegung durchscheinen.
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  })
  return `${dop.base}?${q.toString()}`
}

export function toLayer(dop: RegionalDop): ImageryLayer {
  return {
    id: dop.id,
    label: dop.label,
    attribution: dop.attribution,
    licence: dop.licence,
    groundResolutionM: dop.groundResolutionM,
    maxZoom: dop.maxZoom,
    tilePx: WMS_TILE_PX,
    partial: true,
    tileUrl: (z, x, y) => dopTileUrl(dop, z, x, y),
  }
}

/* ──────────────────────────── Auswahl ───────────────────────────────── */

export function withinBounds(at: GeoPoint, b: LatLngBounds): boolean {
  return at.lat >= b.south && at.lat <= b.north && at.lng >= b.west && at.lng <= b.east
}

/**
 * Alle amtlichen Ebenen, deren Hülle den Ort enthält — **gröbste zuerst**.
 *
 * Das „alle" ist der Kern. Ein erster Entwurf hat die feinste Hülle gewählt
 * und dabei verloren: Hannover liegt innerhalb der von NRW gemeldeten Hülle
 * (die reicht bis 9,74° Ost), also gewann die 10-cm-Ebene — und lieferte für
 * Niedersachsen leere Kacheln, während die tatsächlich zuständige 20-cm-Ebene
 * gar nicht erst abgefragt wurde. Ein Rechteck kann eine Landesgrenze nicht
 * beschreiben; jeder Versuch, die Hüllen enger zu ziehen, scheitert an der
 * ersten diagonalen Grenze.
 *
 * Deshalb entscheidet nicht mehr die Hülle, sondern das Bild selbst: alle
 * Kandidaten werden gestapelt, und wo eine Ebene nichts hat, ist sie
 * transparent und die darunter scheint durch. Die Grenze zeichnet der Dienst.
 */
export function regionalDopsAt(at: GeoPoint): RegionalDop[] {
  return REGIONAL_DOP
    .filter((dop) => withinBounds(at, dop.bounds))
    .sort((a, b) => b.groundResolutionM - a.groundResolutionM)
}

/**
 * Der Bildstapel für einen Ort, von unten nach oben. Immer mindestens die
 * globale Ebene — die Karte bleibt überall benutzbar, sie wird nur dort
 * schärfer, wo es amtliche Bilder gibt.
 */
export function imageryStack(at: GeoPoint): ImageryLayer[] {
  return [esriImagery, ...regionalDopsAt(at).map(toLayer)]
}

/**
 * Welche Ebene die Oberfläche nennen darf.
 *
 * `covered` sagt, welche Ebenen an dieser Stelle wirklich Pixel geliefert
 * haben — beobachtet, nicht angenommen. Ohne diese Beobachtung bleibt es bei
 * der globalen Ebene: lieber untertrieben als eine Quelle behauptet, die man
 * gar nicht sieht.
 */
export function topLayer(stack: ImageryLayer[], covered?: ReadonlySet<string>): ImageryLayer {
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i]
    if (!layer.partial || covered?.has(layer.id)) return layer
  }
  return esriImagery
}
