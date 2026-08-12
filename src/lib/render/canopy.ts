/**
 * render/canopy.ts — Baumkronen, die keine Kugeln sind.
 *
 * Eine Krone war bisher `icosahedronGeometry(r, 1)`: ein Ikosaeder mit einer
 * Unterteilung, 80 Flächen, dazu `flatShading`. Das ergibt einen facettierten
 * Ball, und drei davon nebeneinander ergeben einen Baum aus Bällen. Genau das
 * ist der Spielzeug-Eindruck — und er lässt sich nicht wegbeleuchten, weil er
 * nicht an der Schattierung hängt, sondern an der **Silhouette**.
 *
 * Was eine Krone auf Entfernung als Laub lesbar macht, ist ihr Umriss: eine
 * echte Krone ist keine konvexe Hülle, sondern ausgefranst. Licht fällt in
 * Lücken, Äste tragen Büschel unterschiedlich weit nach aussen, der Rand ist
 * gezackt. Ein Ball hat davon nichts, egal wie fein er unterteilt ist — mehr
 * Unterteilung macht ihn nur zu einem *runderen* Ball.
 *
 * Deshalb werden die Ecken hier mit Wertrauschen nach aussen und innen
 * verschoben. Zwei Oktaven: eine grobe für die Hauptbüschel, eine feine für den
 * gezackten Rand. Das kostet keine zusätzliche Zeichenroutine und keine Textur,
 * nur einmalige Rechenzeit beim Bauen.
 *
 * ## Warum ein Pool und nicht eine Geometrie pro Baum
 *
 * Ein Vorort hat dreistellig viele Bäume. Eine eigene Geometrie pro Baum wären
 * dreistellig viele Buffer, dreistellig viele Uploads und dieselbe Anzahl
 * Objekte, die beim Weltwechsel wieder freigegeben werden müssten. Das Auge
 * unterscheidet aber keine zweihundert Kronenformen — es merkt nur, *ob*
 * Variation da ist. Acht Formen reichen dafür, und weil sie auf Einheitsradius
 * gebaut sind, skaliert jeder Baum sie auf seine eigene Grösse: gleiche
 * Geometrie, verschiedene Erscheinung.
 *
 * Reine Geometrie-Erzeugung, kein React, keine Materialien — testbar, und der
 * Rest der Szene kann sie ebenso benutzen.
 */

import * as THREE from 'three'

/** Anzahl unterscheidbarer Kronenformen. */
export const CANOPY_VARIANTS = 8

/**
 * Deterministisches Wertrauschen auf der Kugel.
 *
 * Gehasht wird die *Richtung* der Ecke, nicht ihr Index: benachbarte Ecken
 * liegen damit im Rauschfeld auch benachbart, und die Verschiebung wird zu
 * zusammenhängenden Büscheln statt zu einzelnen ausgerissenen Zacken. Ein
 * Hash über den Index würde jede Ecke unabhängig versetzen — das sieht aus wie
 * Rauschen, nicht wie Laub.
 */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 93.989) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Verschiebt jede Ecke entlang ihrer Normalen.
 *
 * `amount` ist der Anteil des Radius, um den die Krone maximal schwankt. 0.28
 * ist der Punkt, an dem der Umriss deutlich unregelmässig wird, ohne dass die
 * Form ihren Zusammenhalt verliert — darüber zerfällt die Krone in Stacheln.
 */
export function deformCanopy(geometry: THREE.BufferGeometry, seed: number, amount = 0.28): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const len = v.length() || 1
    const n = v.clone().divideScalar(len)
    // Grobe Oktave: die Hauptbüschel. Feine Oktave: der gefranste Rand.
    const coarse = valueNoise(n.x * 1.7, n.y * 1.7, n.z * 1.7, seed) - 0.5
    const fine = valueNoise(n.x * 5.3, n.y * 5.3, n.z * 5.3, seed + 11) - 0.5
    const d = 1 + (coarse * 2 * 0.72 + fine * 2 * 0.28) * amount
    // Die Krone sitzt auf einem Stamm: unten wird sie eingezogen, damit sie
    // nicht als Ball auf einem Stock steht, sondern sich zum Ansatz verjüngt.
    const underside = n.y < 0 ? 1 + n.y * 0.22 : 1
    v.copy(n).multiplyScalar(len * d * underside)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  // Ohne das behielte jede Fläche die Normale der ungestörten Kugel und das
  // Licht liefe über eine Form, die es nicht mehr gibt.
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
}

let pool: THREE.BufferGeometry[] | null = null

/**
 * Eine Kronenform aus dem Pool, auf Einheitsradius. Der Aufrufer skaliert.
 *
 * `variant` darf jede Zahl sein — auch negative oder gebrochene aus einem Hash;
 * sie wird in den Pool gefaltet.
 */
export function canopyGeometry(variant: number): THREE.BufferGeometry {
  if (!pool) {
    pool = Array.from({ length: CANOPY_VARIANTS }, (_, i) => {
      // Unterteilung 2 statt 1: 320 Flächen. Das ist die Auflösung, unterhalb
      // derer das Rauschen nichts zu verschieben hat — bei 80 Flächen sind die
      // Ecken so weit auseinander, dass jede Störung als Beule erscheint.
      const g = new THREE.IcosahedronGeometry(1, 2)
      deformCanopy(g, i + 1)
      return g
    })
  }
  const i = Math.abs(Math.round(variant)) % CANOPY_VARIANTS
  return pool[i]
}

/** Gibt den Pool frei (Weltwechsel, Profilwechsel, Tests). */
export function disposeCanopyPool(): void {
  if (!pool) return
  for (const g of pool) g.dispose()
  pool = null
}
