/**
 * provenance.ts — woher ein Wert stammt, und wie viel er deshalb wert ist.
 *
 * Das ist die tragende Idee der Composer-Architektur. Bisher war jedem Wert im
 * erkannten Modell anzusehen *was* er ist, aber nicht *woher* er kommt — eine
 * amtlich vermessene Firsthöhe und eine gewürfelte Dachneigung sahen im
 * Datenmodell identisch aus, und die angezeigte Konfidenz bewertete beide
 * gleich. Für ein kommerzielles Produkt ist das nicht tragbar: die Oberfläche
 * verspricht Vermessung, wo geraten wurde.
 *
 * Hier trägt deshalb jedes Attribut seine Herkunft mit sich. Daraus folgt
 * dreierlei, ohne dass eine weitere Zeile nötig wäre:
 *
 *   • Die Konfidenz wird **abgeleitet** statt geschätzt (siehe `confidenceOf`).
 *   • Die Oberfläche kann ehrlich sein: „amtlich vermessen" neben „geschätzt".
 *   • Ein Generator wird legitim — eine erfundene Nachbarschaft ist keine
 *     Täuschung mehr, sobald sie als `assumed` gekennzeichnet ist.
 *
 * Reine Daten, keine Abhängigkeiten. Bewusst renderer- und UI-frei.
 */

/** Woher ein Wert stammt. Die Reihenfolge ist auch die Rangfolge. */
export type Provenance =
  /** Aus einer autoritativen Quelle übernommen (LoD2, ALKIS, DGM1). */
  | 'measured'
  /** Aus Rohdaten abgeleitet, die wir selbst ausgewertet haben (Luftbild). */
  | 'observed'
  /** Modelliert aus Beobachtungen (Dachneigung aus Schattenlänge). */
  | 'inferred'
  /** Regionale Annahme, weil nichts beobachtbar war. */
  | 'assumed'
  /** Vom Nutzer gesetzt oder gezeichnet — schlägt alles andere. */
  | 'user'

/** Welche Quelle, in welcher Fassung, wann abgerufen. */
export interface SourceRef {
  /** Stabile Kennung, z. B. 'alkis-nrw', 'osm-overpass', 'user-polygon'. */
  id: string
  /** Anzeigename für die Oberfläche. */
  label: string
  /** Datenstand der Quelle, sofern bekannt. */
  version?: string
  /** ISO-Zeitstempel des Abrufs. */
  fetchedAt?: string
}

/** Ein Wert mit Herkunft. Der Baustein des gesamten erkannten Modells. */
export interface Attr<T> {
  value: T
  provenance: Provenance
  /** 0…1, abgeleitet aus Herkunft und Quellgenauigkeit — nie frei gewählt. */
  confidence: number
  source?: SourceRef
}

/**
 * Rangfolge bei der Fusion: gewinnt, wer weiter oben steht. Der Nutzer schlägt
 * die Vermessung, weil er weiß, was ihm gehört — die Katastergrenze kann
 * veraltet sein, seine Zeichnung ist es nie.
 */
const RANK: Record<Provenance, number> = {
  user: 5,
  measured: 4,
  observed: 3,
  inferred: 2,
  assumed: 1,
}

/**
 * Grundvertrauen je Herkunft. Ein Resolver darf nur *nach unten* korrigieren
 * (über `certainty`), nie nach oben — sonst wäre die Skala wieder frei erfunden.
 */
const BASE_CONFIDENCE: Record<Provenance, number> = {
  user: 1.0,
  measured: 0.96,
  observed: 0.78,
  inferred: 0.6,
  assumed: 0.35,
}

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  user: 'von dir gesetzt',
  measured: 'amtlich vermessen',
  observed: 'aus Luftbild erkannt',
  inferred: 'aus Beobachtung abgeleitet',
  assumed: 'geschätzt',
}

/** Kurzform für enge Stellen in der Oberfläche. */
export const PROVENANCE_SHORT: Record<Provenance, string> = {
  user: 'gesetzt',
  measured: 'vermessen',
  observed: 'erkannt',
  inferred: 'abgeleitet',
  assumed: 'geschätzt',
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0)

/**
 * Baue ein Attribut. `certainty` (0…1, Standard 1) dämpft das Grundvertrauen
 * der Herkunft — etwa wenn eine Quelle zwar amtlich, aber veraltet ist.
 */
export function attr<T>(
  value: T,
  provenance: Provenance,
  opts: { certainty?: number; source?: SourceRef } = {},
): Attr<T> {
  return {
    value,
    provenance,
    confidence: clamp01(BASE_CONFIDENCE[provenance] * clamp01(opts.certainty ?? 1)),
    ...(opts.source ? { source: opts.source } : {}),
  }
}

export const measured = <T>(v: T, source?: SourceRef, certainty?: number): Attr<T> =>
  attr(v, 'measured', { source, certainty })
export const observed = <T>(v: T, source?: SourceRef, certainty?: number): Attr<T> =>
  attr(v, 'observed', { source, certainty })
export const inferred = <T>(v: T, certainty?: number): Attr<T> =>
  attr(v, 'inferred', { certainty })
export const assumed = <T>(v: T, certainty?: number): Attr<T> =>
  attr(v, 'assumed', { certainty })
export const fromUser = <T>(v: T, source?: SourceRef): Attr<T> =>
  attr(v, 'user', { source })

/** Nackter Wert, wenn die Herkunft an der Aufrufstelle nicht interessiert. */
export function valueOf<T>(a: Attr<T>): T {
  return a.value
}

/**
 * Fusion: aus mehreren Beobachtungen desselben Attributs die beste wählen.
 * Zuerst nach Rang, bei Gleichstand nach Konfidenz. Leere Liste ⇒ `undefined`,
 * damit der Aufrufer bewusst einen `assumed`-Rückfall setzen muss.
 */
export function pickBest<T>(candidates: Attr<T>[]): Attr<T> | undefined {
  let best: Attr<T> | undefined
  for (const c of candidates) {
    if (!best) { best = c; continue }
    const dr = RANK[c.provenance] - RANK[best.provenance]
    if (dr > 0 || (dr === 0 && c.confidence > best.confidence)) best = c
  }
  return best
}

/**
 * Gewichteter Gesamtwert über mehrere Attribute — das, was die Oberfläche als
 * „Gesamtkonfidenz" zeigt. Anders als bisher steckt hier keine Schätzung mehr
 * drin: der Wert ist vollständig durch die Herkunft der Einzelwerte bestimmt.
 */
export function aggregateConfidence(
  entries: { attr: Pick<Attr<unknown>, 'confidence'>; weight: number }[],
): number {
  let sum = 0
  let wsum = 0
  for (const e of entries) {
    if (e.weight <= 0) continue
    sum += clamp01(e.attr.confidence) * e.weight
    wsum += e.weight
  }
  return wsum > 0 ? Math.round((sum / wsum) * 100) / 100 : 0
}

/** Der schwächste Punkt einer Gruppe — was der Nutzer zuerst prüfen sollte. */
export function weakest<T extends { confidence: number }>(
  entries: Record<string, T>,
): { key: string; entry: T } | undefined {
  let out: { key: string; entry: T } | undefined
  for (const [key, entry] of Object.entries(entries)) {
    if (!out || entry.confidence < out.entry.confidence) out = { key, entry }
  }
  return out
}

/** Prozentdarstellung, wie sie die Oberfläche zeigt. */
export function formatConfidence(v: number): string {
  return `${Math.round(clamp01(v) * 100)} %`
}

/** Die Quelle, die für ein selbst gezeichnetes Grundstück steht. */
export const USER_POLYGON_SOURCE: SourceRef = {
  id: 'user-polygon',
  label: 'Von dir eingezeichnet',
}

/** Die Quelle, unter der der prozedurale Generator seine Annahmen liefert. */
export const GENERATOR_SOURCE: SourceRef = {
  id: 'omega-generator',
  label: 'Omega Annahmemodell',
}
