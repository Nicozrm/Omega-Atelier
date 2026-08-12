/**
 * proceduralTextures.ts — the canvas-drawn material library of the outdoor world.
 *
 * Klinker brick, roof pantiles, board cladding, asphalt, concrete pavers, lawn
 * and the distant night-city wrap are all painted once into an offscreen canvas
 * and cached module-wide, then cloned per surface so each one can carry its own
 * tiling density without a second canvas. That keeps a whole estate's worth of
 * material variety at the cost of a handful of textures.
 *
 * Extracted from the 3D view so the plan's own building and the generated
 * neighbourhood draw from exactly the same surfaces — a house across the street
 * is made of the same brick as the one the user is standing in.
 *
 * Every generator is deterministic (see `texRnd`), so a reload never reshuffles
 * a facade.
 */

import * as THREE from 'three'
import { activeProfile } from '@/lib/render/quality'

export function mkTex(cv: HTMLCanvasElement, srgb: boolean, rep: [number, number] = [1, 1]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(rep[0], rep[1])
  // Anisotropic filtering keeps brick, roofs and asphalt crisp at the grazing
  // angles they are almost always seen under. It is not free: each level
  // multiplies texture-fetch bandwidth, and these surfaces cover most of the
  // screen in the dollhouse view.
  //
  // This used to ask for a flat 16 — "the GPU's maximum, whatever it is" — on
  // every device, which is exactly what the render profile exists to prevent.
  // A phone budgeted for 2 was paying eight times that on the largest surfaces
  // in the frame.
  t.anisotropy = activeProfile().anisotropy
  return t
}
// Deterministic PRNG so textures are stable across reloads (no reflow flicker).
export function texRnd(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

/* ══════════════════════ Von Relief zu Material ══════════════════════════
 *
 * Bis hierher hatte jede Oberfläche zwei Kanäle: Farbe und eine Höhenkarte,
 * die als `bumpMap` hing. Das erklärt, warum die Gebäude „zu generisch" und
 * die Straßen „ohne Materialdetail" wirken — und die Ursache liegt nicht in
 * der Farbe, sondern in zwei fehlenden Kanälen.
 *
 * **Erstens: der Glanz war überall gleich.** Jede Klinkerfassade hatte
 * roughness 0.88, jedes Dach 0.85, jede Straße 0.95 — als konstante Zahl über
 * die ganze Fläche. In der Wirklichkeit ist genau das Gegenteil der Fall: die
 * Mörtelfuge ist stumpf und der Klinker daneben leicht glasig, die
 * Ziegelmulde hält Feuchtigkeit und die Wölbung darüber glänzt, der
 * ausgefahrene Asphaltstreifen ist poliert und der Rand rau. Dieser
 * *Unterschied* im Glanz ist es, was eine Fläche als Material lesbar macht.
 * Ohne ihn bleibt selbst eine gute Farbtextur eine bemalte Ebene, egal wie
 * gut das Licht ist.
 *
 * **Zweitens: `bumpMap` ist die schwächere Technik.** three leitet daraus im
 * Fragment-Shader über Bildschirmableitungen (`dFdx`/`dFdy`) eine Normale ab.
 * Das ist billig, aber es rauscht bei flachem Blickwinkel — und flach ist
 * genau der Winkel, unter dem man eine Straße sieht. Eine echte Normalkarte
 * wird stattdessen gefiltert wie jede andere Textur, bleibt also bis zum
 * Horizont ruhig und trägt die Reliefrichtung sauber.
 *
 * Beide Kanäle werden hier aus der Höhenkarte abgeleitet, die es ohnehin schon
 * gibt. Das kostet keine neuen Zeichenroutinen und keine externen Dateien —
 * nur einen Durchlauf über 256² bis 512² Pixel, einmal beim ersten Aufruf.
 */

/** Farbe, Relief und Glanz einer Oberfläche — vollständiges PBR-Material. */
export interface Surface {
  map: THREE.CanvasTexture
  /** Die rohe Höhenkarte. Bleibt erhalten, damit alte Aufrufer nicht brechen. */
  bump: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  roughness: THREE.CanvasTexture
}

/** Graustufen-Helligkeit an einer Stelle, mit Wiederholung an den Rändern. */
function lumaAt(d: Uint8ClampedArray, W: number, H: number, x: number, y: number): number {
  const xi = ((x % W) + W) % W
  const yi = ((y % H) + H) % H
  const i = (yi * W + xi) * 4
  return (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255
}

/**
 * Höhenkarte → Normalkarte (Sobel).
 *
 * Zur Vorzeichenkonvention, weil sie die häufigste stille Verwechslung an
 * dieser Stelle ist: three erwartet OpenGL-Normalkarten, also **+Y nach
 * oben**, und eine `CanvasTexture` wird mit `flipY = true` hochgeladen — die
 * oberste Leinwandzeile wird zu v = 1. Die Leinwand zählt y nach unten, die
 * Textur v nach oben, also ist `dh/dv = −dh/dy` und damit `n.y = +dy`. Wird
 * das verwechselt, kippt das ganze Relief: Fugen wölben sich heraus und
 * Steine liegen vertieft, und zwar so beiläufig, dass es lange niemandem
 * auffällt.
 */
export function normalFromHeight(src: HTMLCanvasElement, strength = 2.2): THREE.CanvasTexture {
  const W = src.width, H = src.height
  const d = src.getContext('2d')!.getImageData(0, 0, W, H).data
  const out = document.createElement('canvas'); out.width = W; out.height = H
  const octx = out.getContext('2d')!
  const img = octx.createImageData(W, H)
  const L = (x: number, y: number) => lumaAt(d, W, H, x, y)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tl = L(x - 1, y - 1), t = L(x, y - 1), tr = L(x + 1, y - 1)
      const l = L(x - 1, y), r = L(x + 1, y)
      const bl = L(x - 1, y + 1), b = L(x, y + 1), br = L(x + 1, y + 1)
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr)
      let nx = -dx * strength, ny = dy * strength
      const len = Math.hypot(nx, ny, 1) || 1
      nx /= len; ny /= len
      const nz = 1 / len
      const i = (y * W + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return mkTex(out, false)
}

export interface RoughOpts {
  /** Glanz der erhabenen Stellen — Steinfläche, Ziegelwölbung, Fahrspur. */
  lo: number
  /** Glanz der vertieften Stellen — Fuge, Mulde, Rand. */
  hi: number
  /** Seed der Verwitterungsflecken. */
  seed: number
  /**
   * Wie stark grossflächige Verwitterung den Glanz zusätzlich verschiebt.
   *
   * Das ist der Teil, der wirklich zählt. Relief allein erzeugt Glanzwechsel
   * im Raster der Steine — regelmäßig, und Regelmäßigkeit liest das Auge als
   * gedruckt. Erst Flecken, die **grösser sind als ein Stein**, machen daraus
   * eine Wand, die seit dreissig Jahren im Wetter steht.
   */
  patches?: number
}

/**
 * Höhenkarte → Rauheitskarte.
 *
 * Zwei überlagerte Anteile: das Relief (vertieft = rauer) und darüber eine
 * grossflächige Verwitterung aus weichen Flecken.
 */
export function roughFromHeight(src: HTMLCanvasElement, o: RoughOpts): THREE.CanvasTexture {
  const W = src.width, H = src.height
  const d = src.getContext('2d')!.getImageData(0, 0, W, H).data
  const rnd = texRnd(o.seed)
  const amp = o.patches ?? 0.18

  // Verwitterung: weiche Flecken, deutlich grösser als ein einzelner Stein.
  // Sie werden gekachelt gezeichnet (neunfach versetzt), damit die Fläche an
  // der Nahtstelle nicht plötzlich sauber wird.
  const pv = document.createElement('canvas'); pv.width = W; pv.height = H
  const px = pv.getContext('2d')!
  px.fillStyle = '#808080'; px.fillRect(0, 0, W, H)
  for (let i = 0; i < 26; i++) {
    const cx = rnd() * W, cy = rnd() * H
    const rad = (0.12 + rnd() * 0.3) * W
    const up = rnd() < 0.5
    for (const [ox, oy] of [[0, 0], [-W, 0], [W, 0], [0, -H], [0, H], [-W, -H], [W, -H], [-W, H], [W, H]]) {
      const g = px.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad)
      g.addColorStop(0, up ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)')
      g.addColorStop(1, 'rgba(128,128,128,0)')
      px.fillStyle = g
      px.beginPath(); px.arc(cx + ox, cy + oy, rad, 0, Math.PI * 2); px.fill()
    }
  }
  const pd = px.getImageData(0, 0, W, H).data

  const out = document.createElement('canvas'); out.width = W; out.height = H
  const octx = out.getContext('2d')!
  const img = octx.createImageData(W, H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      // Vertieft (dunkel in der Höhenkarte) ist rau, erhaben ist glatter.
      const relief = o.lo + (o.hi - o.lo) * (1 - lumaAt(d, W, H, x, y))
      const patch = (pd[i] / 255 - 0.5) * 2 * amp
      const v = Math.max(0.04, Math.min(1, relief + patch)) * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return mkTex(out, false)
}

/** Baut aus Farb- und Höhenleinwand die vollständige Oberfläche. */
function surfaceOf(
  colour: HTMLCanvasElement,
  height: HTMLCanvasElement,
  rough: RoughOpts,
  normalStrength = 2.2,
): Surface {
  return {
    map: mkTex(colour, true),
    bump: mkTex(height, false),
    normal: normalFromHeight(height, normalStrength),
    roughness: roughFromHeight(height, rough),
  }
}

let _brickTex: Surface | null = null
export function brickTextures(): Surface {
  if (_brickTex) return _brickTex
  const W = 512, H = 512, rows = 13, bh = H / rows, mortar = 3
  const rnd = texRnd(7)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#5f5148'; cx.fillRect(0, 0, W, H)          // mortar joint
  bx.fillStyle = '#3a3a3a'; bx.fillRect(0, 0, W, H)          // mortar = recessed
  const bw = W / 4
  for (let r = 0; r < rows; r++) {
    const y = r * bh
    const off = (r % 2) * (bw / 2)                            // running bond
    for (let c = -1; c < 5; c++) {
      const x = c * bw + off
      // Klinker reddish-brown with per-brick variation (some darker sinter bricks)
      const base = rnd()
      const rr = 120 + Math.floor(base * 40), gg = 60 + Math.floor(base * 26), bb = 46 + Math.floor(base * 20)
      cx.fillStyle = `rgb(${rr},${gg},${bb})`
      cx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar)
      // subtle top highlight + speckle
      cx.fillStyle = 'rgba(255,236,220,0.05)'
      cx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, (bh - mortar) * 0.4)
      for (let s = 0; s < 5; s++) { cx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`; cx.fillRect(x + mortar + rnd() * (bw - mortar * 2), y + mortar + rnd() * (bh - mortar * 2), 2, 2) }
      bx.fillStyle = `rgb(${205 + Math.floor(base * 40)},${205 + Math.floor(base * 40)},${205 + Math.floor(base * 40)})`
      bx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar)
    }
  }
  // Klinker: die Mörtelfuge ist stumpf (0.96), der gebrannte Stein deutlich
  // glasiger (0.62). Genau dieser Sprung an jeder Fugenkante ist das, was eine
  // Backsteinwand als Backstein lesbar macht.
  _brickTex = surfaceOf(cv, bv, { lo: 0.62, hi: 0.96, seed: 7, patches: 0.20 }, 2.4)
  return _brickTex
}

// Vertical timber cladding (Holzverschalung) — warm planks with grain streaks
// and recessed grooves between boards, for the 'board' facade construction.
let _boardTex: Surface | null = null
export function boardTextures(): Surface {
  if (_boardTex) return _boardTex
  const W = 512, H = 512, planks = 6, pw = W / planks
  const rnd = texRnd(23)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#6b4a2c'; cx.fillRect(0, 0, W, H)
  bx.fillStyle = '#8a8a8a'; bx.fillRect(0, 0, W, H)
  for (let p = 0; p < planks; p++) {
    const x = p * pw
    const base = 0.82 + rnd() * 0.3
    const rr = Math.floor(120 * base), gg = Math.floor(82 * base), bb = Math.floor(48 * base)
    cx.fillStyle = `rgb(${rr},${gg},${bb})`
    cx.fillRect(x + 1, 0, pw - 2, H)
    // grain streaks
    for (let g = 0; g < 22; g++) {
      cx.strokeStyle = `rgba(${rr - 30},${gg - 22},${bb - 16},${0.18 + rnd() * 0.22})`
      cx.lineWidth = 0.6 + rnd()
      cx.beginPath()
      const gx = x + 2 + rnd() * (pw - 4)
      cx.moveTo(gx, 0); cx.bezierCurveTo(gx + (rnd() - 0.5) * 6, H / 3, gx + (rnd() - 0.5) * 6, (2 * H) / 3, gx + (rnd() - 0.5) * 4, H)
      cx.stroke()
    }
    // plank body slightly raised, grooves recessed (bump)
    bx.fillStyle = `rgb(${185 + Math.floor(base * 30)},${185 + Math.floor(base * 30)},${185 + Math.floor(base * 30)})`
    bx.fillRect(x + 2, 0, pw - 4, H)
    bx.fillStyle = '#2a2a2a'; bx.fillRect(x, 0, 2, H)
  }
  // Holzverschalung: die lasierte Brettfläche zieht noch etwas Glanz (0.72),
  // die Nut dazwischen ist roh und stumpf (0.98).
  _boardTex = surfaceOf(cv, bv, { lo: 0.72, hi: 0.98, seed: 13, patches: 0.14 }, 1.8)
  return _boardTex
}

let _roofTex: Surface | null = null
export function roofTextures(): Surface {
  if (_roofTex) return _roofTex
  const W = 512, H = 512, rows = 16, rh = H / rows
  const rnd = texRnd(23)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  /*
   * Die Ziegel werden **neutral** gezeichnet, nicht dunkel.
   *
   * Hier standen Kachelwerte um 43 von 255 auf fast schwarzem Grund. Das sieht
   * für sich genommen nach einem dunklen Ziegeldach aus — nur ist diese Karte
   * keine Farbe, sondern ein Detail, und three **multipliziert** sie mit der
   * Materialfarbe aus der Regionalpalette. Gerechnet:
   *
   *     Kachel 43        → 0,024 linear
   *     MED-Dach #a4633d → 0,371 linear
   *     Produkt          → 0,009   — praktisch Schwarz
   *
   * Deshalb war jedes Dach der Mittelmeer-Siedlung schwarz statt terrakotta,
   * und auch die dunklen deutschen Dächer landeten bei 0,001 und damit unter
   * jedem realen Dachmaterial. Die Palette hatte faktisch keine Wirkung mehr.
   *
   * Beim Klinker ist dieselbe Falle ausdrücklich behandelt — dort wird die
   * Materialfarbe weiss aufgehellt, damit die Karte die Farbe tragen kann. Am
   * Dach fehlte diese Behandlung, und dadurch multiplizierten sich zwei
   * dunkle Werte.
   *
   * Neutral gezeichnet trägt die Karte die **Struktur** — Kurse, Wölbung,
   * Schattenkante — und die Palette die Farbe. Das ist die Aufgabenteilung,
   * die eine Palette überhaupt erst sinnvoll macht.
   */
  cx.fillStyle = '#6e6a66'; cx.fillRect(0, 0, W, H)          // Fuge zwischen den Ziegeln
  bx.fillStyle = '#202020'; bx.fillRect(0, 0, W, H)
  const tw = W / 8
  for (let r = 0; r < rows; r++) {
    const y = r * rh
    const off = (r % 2) * (tw / 2)
    for (let c = -1; c < 9; c++) {
      const x = c * tw + off
      const sh = 178 + Math.floor(rnd() * 34)
      cx.fillStyle = `rgb(${sh},${sh - 3},${sh - 5})`
      cx.fillRect(x + 1, y + 1, tw - 2, rh - 1)
      // rounded pantile highlight along the top of each course
      cx.fillStyle = 'rgba(255,255,255,0.10)'
      cx.fillRect(x + 1, y + 1, tw - 2, rh * 0.34)
      cx.fillStyle = 'rgba(0,0,0,0.35)'
      cx.fillRect(x, y + rh - 2, tw, 2)                       // shadow lip between courses
      bx.fillStyle = `rgb(${150 + Math.floor(rnd() * 40)},${150},${150})`
      bx.fillRect(x + 1, y + 1, tw - 2, rh - 2)
    }
  }
  // Dachziegel: die Wölbung wird vom Regen blank gewaschen (0.55), in der
  // Mulde zwischen den Kursen sitzen Moos und Schmutz (0.95). Die Flecken sind
  // hier am stärksten — kein Dach altert gleichmässig.
  _roofTex = surfaceOf(cv, bv, { lo: 0.55, hi: 0.95, seed: 23, patches: 0.26 }, 2.6)
  return _roofTex
}

let _asphaltTex: Surface | null = null
/**
 * Asphalt.
 *
 * Vorher war das die einzige Oberfläche der Szene **ganz ohne Relief** — eine
 * Farbtextur mit konstanter Rauheit 0.95. Deshalb las sich jede Straße als
 * graues Band: sie hatte keine Körnung, die das Licht hätte brechen können,
 * und keinen Glanzwechsel, an dem das Auge eine Oberfläche erkennt.
 *
 * Jetzt bekommt sie beides, und zwar so, wie eine Straße wirklich altert: der
 * Splitt gibt die feine Körnung, und darüber liegen die **Fahrspuren** — zwei
 * Bänder, die von Reifen glatt poliert sind, während der Rand rau bleibt. Das
 * ist der Unterschied, den man auf jedem Foto einer Wohnstraße sieht und den
 * kein noch so gutes Licht ersetzt.
 */
export function asphaltSurface(): Surface {
  if (_asphaltTex) return _asphaltTex
  const W = 256, H = 256, rnd = texRnd(41)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#57565a'; cx.fillRect(0, 0, W, H)
  bx.fillStyle = '#8a8a8a'; bx.fillRect(0, 0, W, H)
  for (let i = 0; i < 9000; i++) {
    const g = rnd()
    const x = rnd() * W, y = rnd() * H, w = 1 + rnd() * 1.5, h = 1 + rnd() * 1.5
    cx.fillStyle = g < 0.5 ? `rgba(0,0,0,${0.05 + rnd() * 0.25})` : `rgba(210,210,214,${0.04 + rnd() * 0.14})`
    cx.fillRect(x, y, w, h)
    // Der Splittkorn steht vor, die Bindemittelmulde liegt zurück.
    bx.fillStyle = g < 0.5 ? `rgba(0,0,0,${0.12 + rnd() * 0.2})` : `rgba(255,255,255,${0.1 + rnd() * 0.22})`
    bx.fillRect(x, y, w, h)
  }
  // Fahrspuren: zwei polierte Bänder quer über die Kachel. Sie kommen in die
  // Höhenkarte als leichte Senke — daraus wird beides zugleich, eine flache
  // Mulde in der Normalkarte und ein glatter Streifen in der Rauheitskarte.
  for (const cxr of [0.3, 0.72]) {
    const g = bx.createLinearGradient(0, (cxr - 0.12) * H, 0, (cxr + 0.12) * H)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.42)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    bx.fillStyle = g
    bx.fillRect(0, (cxr - 0.12) * H, W, 0.24 * H)
  }
  // `lo` gilt für die hellen (erhabenen/polierten) Stellen — die Fahrspur.
  _asphaltTex = surfaceOf(cv, bv, { lo: 0.58, hi: 0.98, seed: 41, patches: 0.22 }, 1.4)
  return _asphaltTex
}

/** Rückwärtskompatibel: nur die Farbkarte. */
export function asphaltTexture(): THREE.CanvasTexture {
  return asphaltSurface().map
}

let _paverTex: Surface | null = null
export function paverTextures(): Surface {
  if (_paverTex) return _paverTex
  const W = 256, H = 256, n = 4, cell = W / n, rnd = texRnd(59)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  const bv = document.createElement('canvas'); bv.width = W; bv.height = H
  const bx = bv.getContext('2d')!
  cx.fillStyle = '#6d685f'; cx.fillRect(0, 0, W, H)          // joint sand
  bx.fillStyle = '#404040'; bx.fillRect(0, 0, W, H)
  for (let ry = 0; ry < n; ry++) for (let rx = 0; rx < n; rx++) {
    const off = (ry % 2) * (cell / 2)
    const x = rx * cell + off, y = ry * cell, g = 150 + Math.floor(rnd() * 26)
    cx.fillStyle = `rgb(${g},${g - 4},${g - 12})`
    cx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3)
    for (let s = 0; s < 12; s++) { cx.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; cx.fillRect(x + rnd() * cell, y + rnd() * cell, 2, 2) }
    bx.fillStyle = '#d0d0d0'; bx.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3)
  }
  // Betonstein: die begangene Fläche ist von Schuhsohlen poliert (0.68), der
  // Fugensand daneben bleibt vollständig stumpf (1.0).
  _paverTex = surfaceOf(cv, bv, { lo: 0.68, hi: 1.0, seed: 59, patches: 0.16 }, 2.0)
  return _paverTex
}

let _grassTex: THREE.CanvasTexture | null = null
export function grassTexture(): THREE.CanvasTexture {
  if (_grassTex) return _grassTex
  const W = 256, H = 256, rnd = texRnd(83)
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H
  const cx = cv.getContext('2d')!
  cx.fillStyle = '#6a7150'; cx.fillRect(0, 0, W, H)
  // Mowing stripes — faint alternating bands so lawns read manicured.
  const band = W / 8
  for (let b = 0; b < 8; b++) {
    cx.fillStyle = b % 2 === 0 ? 'rgba(255,255,238,0.05)' : 'rgba(10,26,6,0.06)'
    cx.fillRect(b * band, 0, band, H)
  }
  for (let i = 0; i < 14000; i++) {
    const t = rnd()
    const r = 90 + Math.floor(t * 40), g = 108 + Math.floor(t * 46), b = 62 + Math.floor(t * 30)
    cx.fillStyle = `rgba(${r},${g},${b},${0.5})`
    cx.fillRect(rnd() * W, rnd() * H, 1, 1 + rnd() * 3)       // short vertical blades
  }
  _grassTex = mkTex(cv, true)
  return _grassTex
}

let _cityTex: THREE.CanvasTexture | null = null
export function nightCityTexture(): THREE.CanvasTexture {
  if (_cityTex) return _cityTex
  const W = 2048, H = 512
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!
  // Sky gradient: deep navy at the top → warmer haze at the horizon band.
  const HORIZON = Math.round(H * 0.52)
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#070b16')
  sky.addColorStop(0.7, '#0e1626')
  sky.addColorStop(1, '#20283c')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, HORIZON)
  // Below the horizon: darker ground haze.
  const grd = ctx.createLinearGradient(0, HORIZON, 0, H)
  grd.addColorStop(0, '#161d2c')
  grd.addColorStop(1, '#05080f')
  ctx.fillStyle = grd
  ctx.fillRect(0, HORIZON, W, H - HORIZON)
  // Warm horizon glow band.
  const glow = ctx.createLinearGradient(0, HORIZON - 60, 0, HORIZON + 30)
  glow.addColorStop(0, 'rgba(255,180,120,0)')
  glow.addColorStop(0.6, 'rgba(255,170,110,0.14)')
  glow.addColorStop(1, 'rgba(255,150,90,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, HORIZON - 60, W, 90)
  // Building silhouettes rising from the horizon, with lit windows.
  let seed = 20260704
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let x = 0
  while (x < W) {
    const bw = 40 + Math.floor(rnd() * 120)
    const bh = 60 + Math.floor(rnd() * 230)
    const top = HORIZON - bh
    // Silhouette body — near black with a faint cool tint.
    ctx.fillStyle = `rgb(${8 + Math.floor(rnd() * 8)},${12 + Math.floor(rnd() * 8)},${20 + Math.floor(rnd() * 10)})`
    ctx.fillRect(x, top, bw - 3, bh)
    // Window grid — warm and a few cool lit cells, sparse.
    const cols = Math.max(2, Math.floor(bw / 16))
    const rows = Math.max(3, Math.floor(bh / 20))
    for (let cxk = 0; cxk < cols; cxk++) {
      for (let ry = 0; ry < rows; ry++) {
        if (rnd() > 0.34) continue
        const wx = x + 5 + cxk * ((bw - 10) / cols)
        const wy = top + 6 + ry * ((bh - 10) / rows)
        const warm = rnd() > 0.25
        ctx.fillStyle = warm
          ? `rgba(255,${200 + Math.floor(rnd() * 40)},${140 + Math.floor(rnd() * 60)},${0.55 + rnd() * 0.4})`
          : `rgba(${170 + Math.floor(rnd() * 40)},${205 + Math.floor(rnd() * 40)},255,${0.4 + rnd() * 0.35})`
        ctx.fillRect(wx, wy, 3 + rnd() * 3, 4 + rnd() * 3)
      }
    }
    x += bw
  }
  // Scattered stars in the upper sky.
  for (let i = 0; i < 200; i++) {
    const sx = rnd() * W, sy = rnd() * (HORIZON - 80)
    ctx.fillStyle = `rgba(200,215,255,${0.15 + rnd() * 0.35})`
    ctx.fillRect(sx, sy, 1.5, 1.5)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  _cityTex = tex
  return tex
}

/**
 * Mittlere **lineare** Reflexion einer Leinwand, 0…1 je Kanal.
 *
 * Für die Frage „verschluckt diese Karte die Palettenfarbe, mit der sie
 * multipliziert wird". Linear gemittelt, nicht in Bildwerten: ein Mittel von
 * 128 entspricht 0,22 Reflexion und nicht 0,50, und genau diese Verwechslung
 * lässt eine Karte harmloser aussehen, als sie ist.
 */
export function srgbMean(cv: HTMLCanvasElement): [number, number, number] {
  const ctx = cv.getContext('2d')!
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); g += lin(d[i + 1]); b += lin(d[i + 2]); n++ }
  return [r / n, g / n, b / n]
}
