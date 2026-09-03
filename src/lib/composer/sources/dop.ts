/**
 * dop.ts — das amtliche Luftbild als Bodentextur.
 *
 * Bis hierher war der Boden der 3D-Szene erfunden: eine Rasentextur, über die
 * der Generator Straßen und Wege gezeichnet hat. Plausibel, aber eben nicht
 * *dieser* Ort. Für einen Digital Twin ist das die letzte große Lücke — man
 * erkennt sein Zuhause nicht am Haus allein, sondern an der Einfahrt, dem
 * Pflaster, der Hecke, dem Nachbargrundstück.
 *
 * Nordrhein-Westfalen liefert genau das mit **10 cm** Bodenauflösung unter
 * dl-de/zero-2.0 (siehe `imagery.ts` für die Lizenzlage und warum es nicht
 * Google ist). Dieses Modul holt daraus einen einzelnen, exakt
 * georeferenzierten Ausschnitt, der als Textur auf die Grundebene passt.
 *
 * ## Die Falle: Web-Mercator misst keine Meter
 *
 * Der Dienst rechnet in EPSG:3857. Dort sind Distanzen um `1/cos(φ)` gestreckt
 * — auf 52° Nord also um rund **62 %**. Wer eine 200-m-Bodenkante anfordert und
 * dafür 200 Mercator-Meter einsetzt, bekommt einen Ausschnitt von nur 123 m
 * Bodenkante zurück und legt ihn dann über 200 m Szene. Das Ergebnis sieht auf
 * den ersten Blick richtig aus — ein Luftbild eben — und ist um 62 % verzerrt.
 * Häuser stünden neben ihren Umrissen, die Einfahrt läge im Vorgarten.
 *
 * Deshalb wird hier genau einmal umgerechnet, in {@link mercatorHalfSpan}, und
 * nirgends sonst.
 */

import type { GeoPoint } from '../types'
import { regionalDopsAt, type RegionalDop } from '../imagery'

/** Halber Umfang der Web-Mercator-Ebene in Metern. */
const MERC_R = 20037508.342789244

/** Ein Punkt in Web-Mercator-Metern. */
export interface MercatorPoint { x: number; y: number }

export function toMercator(at: GeoPoint): MercatorPoint {
  return {
    x: (at.lng * MERC_R) / 180,
    y: (Math.log(Math.tan(((90 + at.lat) * Math.PI) / 360)) / (Math.PI / 180)) * MERC_R / 180,
  }
}

/**
 * Wie viele **Mercator**-Meter entsprechen einer halben Kante von `groundM`
 * echten Bodenmetern auf dieser Breite?
 *
 * Das ist die einzige Stelle, an der die Streckung des Mercator-Systems
 * auftaucht. Sie hier zu vergessen ist der Fehler, der ein perfekt aussehendes,
 * aber um 62 % falsches Luftbild erzeugt.
 */
export function mercatorHalfSpan(groundM: number, lat: number): number {
  return groundM / 2 / Math.cos((lat * Math.PI) / 180)
}

/**
 * Obergrenze der Dienste für WIDTH/HEIGHT. NRW meldet 5000 in seinen
 * Capabilities; darüber antwortet ein WMS mit einem Fehler-XML und **HTTP
 * 200**, also mit etwas, das wie ein Bild aussieht, bis man den Content-Type
 * prüft.
 */
export const MAX_WMS_PX = 4096

export interface OrthophotoRequest {
  at: GeoPoint
  /** Kantenlänge des gewünschten Ausschnitts in echten Bodenmetern. */
  groundSizeM: number
  /** Gewünschte Kantenlänge in Pixeln. Wird auf {@link MAX_WMS_PX} gedeckelt. */
  pixels?: number
}

export interface Orthophoto {
  url: string
  source: RegionalDop
  /** Tatsächlich abgedeckte Bodenkante in Metern. */
  groundSizeM: number
  pixels: number
  /** Zentimeter je Pixel — zum Vergleich mit der nativen Auflösung. */
  cmPerPixel: number
}

/**
 * Baut die GetMap-Anfrage für einen quadratischen Ausschnitt um `at`.
 *
 * Nordausgerichtet und quadratisch, weil die Grundebene der Szene genau das
 * ist: eine achsparallele Fläche um den Plan-Mittelpunkt. Die Drehung des
 * Grundstücks steckt im Plan, nicht im Boden.
 */
export function orthophotoUrl(dop: RegionalDop, req: OrthophotoRequest): Orthophoto {
  const px = Math.min(Math.max(256, Math.round(req.pixels ?? 2048)), MAX_WMS_PX)
  const c = toMercator(req.at)
  const half = mercatorHalfSpan(req.groundSizeM, req.at.lat)
  const bbox = [c.x - half, c.y - half, c.x + half, c.y + half].join(',')
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: dop.layer,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: bbox,
    WIDTH: String(px),
    HEIGHT: String(px),
    // JPEG statt PNG: der Boden ist flächendeckend, Transparenz braucht es
    // hier nicht, und ein 2048er PNG wäre ein Vielfaches an Bytes.
    FORMAT: 'image/jpeg',
  })
  return {
    url: `${dop.base}?${q.toString()}`,
    source: dop,
    groundSizeM: req.groundSizeM,
    pixels: px,
    cmPerPixel: Math.round(((req.groundSizeM / px) * 100) * 10) / 10,
  }
}

/**
 * Alle in Frage kommenden Luftbilder, **feinste zuerst**.
 *
 * Bewusst eine Liste und keine einzelne Antwort. Die gemeldeten Hüllen der
 * Dienste sind Rechtecke über unregelmäßigen Landesgebieten und überlappen an
 * den Ecken: Hannover liegt innerhalb der von NRW gemeldeten Hülle, und wer
 * einfach die feinste Auflösung nimmt, bestellt dort ein 10-cm-Bild aus NRW —
 * und bekommt eine leere Kachel, während die zuständige niedersächsische
 * Befliegung nie gefragt wird. Bei den Kartenkacheln löst ein transparenter
 * Stapel das Problem; ein einzelnes Bodenbild kann nicht durchscheinen, also
 * muss hier geprüft werden.
 */
export function orthophotoCandidates(req: OrthophotoRequest): Orthophoto[] {
  return regionalDopsAt(req.at).reverse().map((dop) => orthophotoUrl(dop, req))
}

/**
 * Winziger Abzug desselben Ausschnitts, mit Transparenz. Außerhalb der
 * Befliegung ist er vollständig durchsichtig — das ist die verlässliche
 * Auskunft darüber, ob ein Dienst diesen Ort wirklich abdeckt. Ein paar
 * Kilobyte je Kandidat, einmal pro Szene.
 */
export function coverageProbeUrl(photo: Orthophoto, at: GeoPoint, px = 32): string {
  const c = toMercator(at)
  const half = mercatorHalfSpan(photo.groundSizeM, at.lat)
  const q = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    LAYERS: photo.source.layer, STYLES: '', CRS: 'EPSG:3857',
    BBOX: [c.x - half, c.y - half, c.x + half, c.y + half].join(','),
    WIDTH: String(px), HEIGHT: String(px),
    FORMAT: 'image/png', TRANSPARENT: 'TRUE',
  })
  return `${photo.source.base}?${q.toString()}`
}

/**
 * Lädt den Ausschnitt als Bild. Wirft nie — ein fehlendes Luftbild ist ein
 * fehlendes Luftbild, kein Grund, die Szene scheitern zu lassen.
 *
 * `crossOrigin` ist Pflicht: ohne das Attribut ist die Textur in WebGL
 * „tainted" und three verweigert sie. Die Dienste senden die passenden
 * CORS-Kopfzeilen (geprüft in `verify:imagery`).
 */
export function loadOrthophoto(photo: Orthophoto, signal?: AbortSignal): Promise<HTMLImageElement | undefined> {
  return loadImage(photo.url, signal)
}

function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(undefined)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let settled = false
    const done = (v: HTMLImageElement | undefined) => {
      if (settled) return
      settled = true
      img.onload = img.onerror = null
      resolve(v)
    }
    img.onload = () => done(img)
    img.onerror = () => done(undefined)
    signal?.addEventListener('abort', () => { img.src = ''; done(undefined) }, { once: true })
    img.src = url
  })
}

/**
 * Ist das geladene Bild ein Luftbild — oder eine leere Fläche?
 *
 * Der Deckungsabzug wird als PNG mit Transparenz geholt und ist außerhalb der
 * Befliegung durchsichtig. Das **große** Bild kommt dagegen als JPEG, und JPEG
 * kennt keine Transparenz: der Dienst füllt fehlende Bereiche dort schlicht
 * mit Weiß — bei HTTP 200 und Content-Type `image/jpeg`. Auf dem Boden der
 * Szene liegt dann eine strahlend weiße Platte, die aussieht wie ein
 * Renderfehler und keiner ist.
 *
 * Ein echtes Luftbild ist niemals einfarbig. Deshalb entscheidet hier die
 * Streuung: ein Bild ohne nennenswerte Varianz trägt keine Information und
 * wird verworfen, damit der erzeugte Boden stehen bleibt.
 */
function hasDetail(img: HTMLImageElement): boolean {
  try {
    const n = 48
    const cv = document.createElement('canvas')
    cv.width = cv.height = n
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return true
    ctx.drawImage(img, 0, 0, n, n)
    const { data } = ctx.getImageData(0, 0, n, n)
    let sum = 0, sumSq = 0, count = 0
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
      sum += l; sumSq += l * l; count++
    }
    const mean = sum / count
    const sd = Math.sqrt(Math.max(0, sumSq / count - mean * mean))
    // Gemessen liegt die Standardabweichung eines Wohngebiets bei 30 bis 60.
    // Unter 6 ist die Fläche praktisch einfarbig.
    return sd >= 6
  } catch {
    return true // nicht auslesbar — dann lieber zeigen als verwerfen
  }
}

/** Hat der Abzug überhaupt Inhalt, oder ist er das transparente Nichts? */
function probeHasPixels(img: HTMLImageElement): boolean {
  try {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 16
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    if (!ctx) return true
    ctx.drawImage(img, 0, 0, 16, 16)
    const { data } = ctx.getImageData(0, 0, 16, 16)
    let opaque = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++
    // Ein Rand darf durchsichtig sein; erst überwiegende Deckung zählt als
    // „dieser Dienst ist hier zuständig".
    return opaque / (data.length / 4) > 0.6
  } catch {
    return true // Auslesen verweigert — im Zweifel zeigen
  }
}

/**
 * Das Luftbild für einen Ort: der feinste Dienst, der dort **tatsächlich**
 * Pixel liefert. `undefined`, wo keiner zuständig ist — dann bleibt der
 * erzeugte Boden stehen. Wie überall in dieser Pipeline ist Fehlen kein Fehler.
 */
/**
 * Ergebnis eines Luftbildabrufs — Erfolg **oder** ein benennbarer Grund.
 *
 * Bewusst kein `undefined` für den Fehlschlag. Ein fehlendes Luftbild sieht in
 * der Szene aus wie erzeugter Rasen, und das ist ein völlig plausibler
 * Anblick; ohne mitgelieferten Grund lässt sich von außen nicht sagen, ob der
 * Ort keine Befliegung hat, der Dienst streikt oder die Anfrage falsch war.
 * Der Grund gehört deshalb in die Oberfläche, nicht nur in die Konsole — auf
 * einem Telefon gibt es keine Konsole.
 */
export type OrthophotoResult =
  | { ok: true; photo: Orthophoto; image: HTMLImageElement }
  | { ok: false; reason: string }

export async function resolveOrthophoto(
  req: OrthophotoRequest,
  signal?: AbortSignal,
): Promise<OrthophotoResult> {
  const candidates = orthophotoCandidates(req)
  if (candidates.length === 0) {
    return fail(req, 'kein amtliches Luftbild für diesen Ort')
  }
  let last = 'unbekannt'
  for (const photo of candidates) {
    const probe = await loadImage(coverageProbeUrl(photo, req.at), signal)
    if (signal?.aborted) return { ok: false, reason: 'abgebrochen' }
    if (!probe) { last = `${photo.source.id}: Abzug blockiert (CORS/Dienst)`; continue }
    if (!probeHasPixels(probe)) { last = `${photo.source.id}: hier keine Befliegung`; continue }
    const image = await loadOrthophoto(photo, signal)
    if (!image) { last = `${photo.source.id}: Bild nicht ladbar (${photo.pixels} px)`; continue }
    if (!hasDetail(image)) { last = `${photo.source.id}: Bild einfarbig (Dienst lieferte leere Fläche)`; continue }
    return { ok: true, photo, image }
  }
  return fail(req, last)
}

/**
 * Warum kein Luftbild zustande kam.
 *
 * Ein stiller Fehlschlag ist hier besonders teuer: die Szene sieht danach
 * einfach nach erzeugtem Rasen aus, und das ist ein völlig plausibler Anblick.
 * Ohne diese Meldung lässt sich von außen nicht unterscheiden, ob der Ort
 * keine Befliegung hat, der Dienst streikt oder die Anfrage zu groß war.
 */
function fail(req: OrthophotoRequest, reason: string): { ok: false; reason: string } {
  const w = globalThis as unknown as Record<string, unknown>
  w.__OMEGA_GROUND__ = {
    ergebnis: 'kein Luftbild',
    grund: reason,
    ort: `${req.at.lat.toFixed(5)}, ${req.at.lng.toFixed(5)}`,
    bodenkanteM: req.groundSizeM,
    pixel: req.pixels,
  }
  if (typeof console !== 'undefined') {
    console.info('%cOMEGA Boden%c kein Luftbild — ' + reason,
      'font-weight:600;color:#C7A24E', 'color:inherit')
  }
  return { ok: false, reason }
}
