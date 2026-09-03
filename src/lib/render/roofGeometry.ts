/**
 * roofGeometry.ts — Dachflächen als echte Geometrie.
 *
 * Ein Dach aus gedrehten Quadern funktioniert genau so lange, wie es zwei
 * Flächen hat. Sobald vier Flächen an einem First zusammenlaufen, beschreibt
 * kein Quader mehr die Fläche, die dort tatsächlich liegt: die Hauptflächen
 * eines Walmdachs sind **Trapeze**, die Walme **Dreiecke**, und beide enden an
 * einer schrägen Gratlinie, die ein achsenparalleler Quader nicht kennt.
 *
 * Deshalb liegt die Walmfläche hier als Dreiecksliste vor — geteilt zwischen der
 * Nachbarschaft und dem eigenen Haus, damit es nur eine Stelle gibt, an der die
 * Wicklung stimmen muss.
 */

import * as THREE from 'three'

/**
 * Ein echtes Walmdach.
 *
 * Hier stand einmal `coneGeometry(hypot(W, D) * 0.52, rise, 4)` — ein
 * vierseitiger Kegel, also eine **Vierkantpyramide**, um 45° gedreht. Das ist
 * ein Zeltdach, und ein Zeltdach gibt es nur über einem quadratischen Grundriss.
 * Über einem Rechteck ist es in beide Richtungen zugleich falsch: der
 * Umkreisradius wird aus der Diagonale gebildet, die Grundkante der Pyramide
 * misst also `hypot(W, D) · 0,52 · √2`. Auf einem 12 × 8 m Haus sind das
 * 10,6 × 10,6 m — über der langen Seite fehlen 1,4 m Dach, über der kurzen ragt
 * es 1,3 m je Seite hinaus. Beides sieht man sofort, und beides betraf jedes
 * Walmdachhaus der Nachbarschaft.
 *
 * Ein echtes Walmdach hat bei gleicher Neigung ringsum einen **First**: zwei
 * trapezförmige Hauptflächen über den langen Seiten und zwei dreieckige Walme
 * an den Enden. Der First läuft über die längere Achse und ist genau
 * `|W − D|` lang — bei quadratischem Grundriss wird er null, und dann ist es
 * tatsächlich ein Zeltdach. Der Sonderfall ergibt sich also von selbst, statt
 * der Normalfall zu sein.
 *
 * Die Wicklung wird nicht von Hand abgezählt, sondern je Dreieck geprüft: alle
 * Dachflächen zeigen nach oben, also ist `normal.y > 0` das Kriterium. Das ist
 * kürzer als vier Fälle durchzudenken und lässt sich nicht falsch abschreiben.
 */
export function hipRoofGeometry(w: number, d: number, rise: number): THREE.BufferGeometry {
  const alongX = w >= d
  const ridgeLen = Math.abs(w - d)
  const hw = w / 2, hd = d / 2

  // Traufecken, im Uhrzeigersinn von vorne links.
  const c: [number, number, number][] = [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
  ]
  const r1: [number, number, number] = alongX ? [-ridgeLen / 2, rise, 0] : [0, rise, -ridgeLen / 2]
  const r2: [number, number, number] = alongX ? [ridgeLen / 2, rise, 0] : [0, rise, ridgeLen / 2]

  /*
   * Quadratischer Grundriss: der First fällt auf einen Punkt zusammen, und aus
   * dem Walmdach wird ein Zeltdach. Ohne diesen Fall blieben zwei der sechs
   * Dreiecke mit **null Fläche** stehen — sie haben keine Normale,
   * `computeVertexNormals` bekommt einen Nullvektor, und die angrenzenden Ecken
   * erben eine kaputte Schattierung. Unsichtbar im Standbild, sichtbar als
   * Flackern an der Dachspitze, sobald sich das Licht bewegt.
   */
  const tris: [number, number, number][][] = ridgeLen < 1e-6
    ? [[c[0], c[1], r1], [c[1], c[2], r1], [c[2], c[3], r1], [c[3], c[0], r1]]
    : alongX
    ? [
      [c[0], c[1], r2], [c[0], r2, r1],   // Hauptfläche vorne
      [c[2], c[3], r1], [c[2], r1, r2],   // Hauptfläche hinten
      [c[3], c[0], r1],                    // Walm links
      [c[1], c[2], r2],                    // Walm rechts
    ]
    : [
      [c[1], c[2], r2], [c[1], r2, r1],   // Hauptfläche rechts
      [c[3], c[0], r1], [c[3], r1, r2],   // Hauptfläche links
      [c[0], c[1], r1],                    // Walm vorne
      [c[2], c[3], r2],                    // Walm hinten
    ]

  const pos: number[] = []
  for (const t of tris) {
    const [a, b, e] = t
    const ux = b[0] - a[0], uz = b[2] - a[2]
    const vx = e[0] - a[0], vz = e[2] - a[2]
    // Flächennormale zeigt bei richtiger Wicklung nach oben.
    const ny = uz * vx - ux * vz
    const ordered = ny > 0 ? t : [a, e, b]
    for (const p of ordered) pos.push(p[0], p[1], p[2])
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/**
 * Wo die Dachfläche über der Traufe steht, und warum das der Punkt ist, an dem
 * ein Dach „unvollständig" aussieht.
 *
 * Eine geneigte Fläche, die am **Überstand** auf Traufhöhe endet, liegt an der
 * *Wand* bereits `überstand · Neigung` höher — bei 45 cm Überstand und 0,6
 * Neigung sind das 27 cm. Genau so viel Luft klaffte ringsum zwischen Mauerkrone
 * und Dachunterseite: ein umlaufender Schlitz, durch den man von aussen unter
 * das Dach und ins Haus sah, an jedem Giebel-, Walm- und Pultdach zugleich.
 *
 * Richtig ist die umgekehrte Reihenfolge: die Sparren liegen **auf der
 * Mauerkrone** auf, und der Überstand hängt darunter hinaus. Diese Funktion
 * liefert den Betrag, um den die Dachkonstruktion dafür abzusenken ist.
 *
 * @param overhangM waagerechter Dachüberstand in Metern
 * @param pitch     Neigung als Verhältnis Höhe/Länge (Tangens)
 */
export function eavesDrop(overhangM: number, pitch: number): number {
  if (!(overhangM > 0) || !(pitch > 0)) return 0
  return overhangM * pitch
}

/** Wo eine Satteldachfläche liegt. Alle Werte relativ zur Mauerkrone (y = 0). */
export interface GableSlope {
  /** Neigungswinkel in Radiant. */
  angle: number
  /** Sparrenlänge einschliesslich Überstand, längs der Dachfläche. */
  rafter: number
  /** Mittelpunkt der Dachfläche, für die Seite mit negativem x zu spiegeln. */
  cx: number
  cy: number
  /** Traufkante — der äusserste, tiefste Punkt der Fläche. */
  eaveX: number
  eaveY: number
}

/**
 * Lage einer Satteldachfläche über einer Wand.
 *
 * An vier Stellen wurde dieselbe Rechnung von Hand geschrieben, und an allen
 * vier stand dasselbe Paar Fehler:
 *
 *  1. **Der Winkel kam vom Überstand**, nicht von der Mauerkrone. Die Fläche
 *     berührte die Traufhöhe erst an der Spitze des Überstands und lag an der
 *     Wand entsprechend höher — ein umlaufender offener Schlitz von 15 bis
 *     40 cm zwischen Mauerkrone und Dach, durch den man ins Haus sah. Das ist
 *     der Grund, aus dem „die Dächer alle unvollständig" aussahen.
 *  2. **Die Fläche war falsch zentriert**: gesetzt auf `spannweite / 4` statt auf
 *     die halbe Sparrenlänge, also um den halben Überstand verschoben. Innen
 *     stand sie über den First hinaus, aussen fehlte sie an der Traufe.
 *
 * Beides verschwindet, wenn man die Fläche dort aufsetzt, wo sie in Wirklichkeit
 * aufliegt: der Sparren liegt **auf der Mauerkrone** (`halfSpanM`, y = 0), läuft
 * zum First (x = 0, y = `riseM`) und hängt am anderen Ende um `overhangM` über
 * die Wand hinaus — nach aussen *und nach unten*.
 */
export function gableSlope(halfSpanM: number, riseM: number, overhangM: number): GableSlope {
  const angle = Math.atan2(riseM, Math.max(1e-6, halfSpanM))
  const rafter = Math.hypot(halfSpanM, riseM) + Math.max(0, overhangM)
  return {
    angle,
    rafter,
    cx: (Math.cos(angle) * rafter) / 2,
    cy: riseM - (Math.sin(angle) * rafter) / 2,
    eaveX: halfSpanM + Math.max(0, overhangM) * Math.cos(angle),
    eaveY: -Math.max(0, overhangM) * Math.sin(angle),
  }
}
