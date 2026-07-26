/**
 * textures.ts — v15 procedural PBR textures.
 *
 * Generates all material textures for the 3D view directly in the browser
 * via the Canvas API. No external image assets are bundled — keeps the JS
 * payload small and lets us tune colours/patterns without uploading files.
 *
 * Textures are created LAZILY on first call to `getTextures()` and then
 * cached for the lifetime of the page. The first call costs ~300-500 ms
 * on a desktop browser (mostly in `heightToNormal` for the parquet); this
 * is hidden behind the 3D-view loading spinner.
 *
 * Each material gets:
 *   - colour map  (sRGB)
 *   - normal map  (linear; derived from a height field via Sobel)
 * where it adds visual value.
 *
 * The `makeTex(canvas, repeat, srgb)` helper wraps a finished canvas into
 * a `THREE.CanvasTexture` with the right colour-space and repeat settings.
 */

import * as THREE from 'three'

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const SIZE = 256          // default texture size
const SIZE_LARGE = 512    // for floor parquet (more plank detail)

function makeCanvas(size = SIZE): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

/** Seeded PRNG (mulberry32) — deterministic textures across reloads. */
function rng(seed: number) {
  let s = seed | 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convert a grayscale height-map canvas into a normal-map canvas via Sobel. */
function heightToNormal(heightCanvas: HTMLCanvasElement, strength = 1.0): HTMLCanvasElement {
  const w = heightCanvas.width, h = heightCanvas.height
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, w, h)
  const out = makeCanvas(w)
  if (out.height !== h) out.height = h
  const dstCtx = out.getContext('2d')!
  const dst = dstCtx.createImageData(w, h)
  const get = (x: number, y: number) => {
    x = ((x % w) + w) % w
    y = ((y % h) + h) % h
    return src.data[(y * w + x) * 4] / 255
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel-light gradient
      const dx = get(x + 1, y) - get(x - 1, y)
      const dy = get(x, y + 1) - get(x, y - 1)
      const nx = -dx * strength
      const ny = -dy * strength
      const nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      const i = (y * w + x) * 4
      dst.data[i    ] = ((nx / len) * 0.5 + 0.5) * 255
      dst.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      dst.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255
      dst.data[i + 3] = 255
    }
  }
  dstCtx.putImageData(dst, 0, 0)
  return out
}

/**
 * Derive a roughness map from an existing height map — for free (no new noise).
 * Raised relief (grain ridges, polished high spots) reads slightly glossier than
 * recesses, so the green channel dips where the surface is high. The map only
 * scales the material's base roughness DOWN (values stay ≤ 1), giving subtle
 * spatial breakup of specular/reflections — "no flat surfaces" — at the cost of
 * one extra texture sample (not per-light, so cheap). `variation` ∈ 0..1 sets
 * the depth of the effect.
 */
function heightToRoughness(heightCanvas: HTMLCanvasElement, variation = 0.2): HTMLCanvasElement {
  const w = heightCanvas.width, h = heightCanvas.height
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, w, h)
  const out = makeCanvas(w)
  if (out.height !== h) out.height = h
  const dstCtx = out.getContext('2d')!
  const dst = dstCtx.createImageData(w, h)
  const k = Math.max(0, Math.min(1, variation))
  for (let p = 0; p < w * h; p++) {
    const height = src.data[p * 4] / 255
    const g = Math.round((1 - k * height) * 255)
    const i = p * 4
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = g
    dst.data[i + 3] = 255
  }
  dstCtx.putImageData(dst, 0, 0)
  return out
}

/** Public helper: wrap a canvas into a THREE.CanvasTexture. */
export function makeTex(
  canvas: HTMLCanvasElement,
  repeat: [number, number] = [1, 1],
  srgb = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat[0], repeat[1])
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  // Anisotropic filtering keeps tiled surfaces (floors/walls) crisp at the
  // grazing angles they are almost always viewed at. three clamps this to the
  // GPU's getMaxAnisotropy() at upload, so 16 is safe on mobile (auto-reduced).
  tex.anisotropy = 16
  tex.needsUpdate = true
  return tex
}

// ─────────────────────────────────────────────────────────────────────
// Wood — colour + height (oak / walnut variations via base palette)
// ─────────────────────────────────────────────────────────────────────

interface WoodPalette { base: string; dark: string; highlight: string }

function drawWoodColor(palette: WoodPalette, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)

  // Base
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Long undulating grain bands (vertical)
  for (let x = 0; x < SIZE; x++) {
    const n = Math.sin(x * 0.05 + r() * 6) * 4 + Math.sin(x * 0.013 + r() * 6) * 12
    const stripe = (Math.sin((x + n) * 0.22) * 0.5 + 0.5)
    ctx.fillStyle = `rgba(0,0,0,${(stripe * 0.32).toFixed(3)})`
    ctx.fillRect(x, 0, 1, SIZE)
  }

  // Fine grain lines, slightly curved
  ctx.lineWidth = 0.6
  for (let i = 0; i < 240; i++) {
    const x = r() * SIZE
    const len = SIZE * (0.5 + r() * 0.6)
    const yStart = -10 + r() * 20
    ctx.strokeStyle = `rgba(40,28,16,${(0.05 + r() * 0.18).toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(x + (r() - 0.5) * 4, yStart)
    ctx.bezierCurveTo(
      x + (r() - 0.5) * 8, SIZE * 0.3,
      x + (r() - 0.5) * 8, SIZE * 0.7,
      x + (r() - 0.5) * 4, yStart + len,
    )
    ctx.stroke()
  }

  // Occasional knots
  for (let i = 0; i < 5; i++) {
    if (r() > 0.55) continue
    const kx = r() * SIZE
    const ky = r() * SIZE
    const kr = 4 + r() * 8
    const g1 = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 1.5)
    g1.addColorStop(0, 'rgba(40,20,10,0.85)')
    g1.addColorStop(1, 'rgba(40,20,10,0)')
    ctx.fillStyle = g1
    ctx.beginPath()
    ctx.ellipse(kx, ky, kr, kr * 0.6, r() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
    const g2 = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 0.5)
    g2.addColorStop(0, 'rgba(20,10,5,0.95)')
    g2.addColorStop(1, 'rgba(20,10,5,0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.ellipse(kx, ky, kr * 0.45, kr * 0.25, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Subtle warm highlights
  for (let i = 0; i < 30; i++) {
    const x = r() * SIZE
    const y = r() * SIZE
    ctx.fillStyle = palette.highlight
    ctx.globalAlpha = 0.04 + r() * 0.06
    ctx.fillRect(x, y - 1, 30, 2)
  }
  ctx.globalAlpha = 1

  return c
}

function drawWoodHeight(seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let x = 0; x < SIZE; x++) {
    const n = Math.sin(x * 0.05 + r() * 6) * 4 + Math.sin(x * 0.013 + r() * 6) * 12
    const stripe = (Math.sin((x + n) * 0.22) * 0.5 + 0.5)
    const v = Math.round(128 + stripe * 70 - 35)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(x, 0, 1, SIZE)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Fabric (sofa upholstery) — woven cross-hatch
// ─────────────────────────────────────────────────────────────────────

function drawFabric(color: string, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)

  // Diagonal weave hashes
  ctx.lineWidth = 0.7
  for (let i = 0; i < SIZE * 4; i++) {
    const x = r() * SIZE
    const y = r() * SIZE
    const dark = r() < 0.5
    ctx.strokeStyle = dark
      ? `rgba(0,0,0,${(0.15 + r() * 0.20).toFixed(3)})`
      : `rgba(255,255,255,${(0.10 + r() * 0.15).toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + 3, y + 3)
    ctx.stroke()
  }
  // Subtle dust speckles
  for (let i = 0; i < 1200; i++) {
    const x = r() * SIZE, y = r() * SIZE
    ctx.fillStyle = `rgba(0,0,0,${(r() * 0.07).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

function drawFabricHeight(seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < (SIZE * SIZE) / 6; i++) {
    const x = r() * SIZE, y = r() * SIZE
    ctx.fillStyle = `rgba(255,255,255,${(0.3 + r() * 0.4).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Linen / bedding — soft horizontal/vertical lines
// ─────────────────────────────────────────────────────────────────────

function drawLinen(color: string, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.lineWidth = 0.5
  for (let i = 0; i < SIZE * 1.5; i++) {
    const y = r() * SIZE
    ctx.strokeStyle = `rgba(0,0,0,${(r() * 0.08).toFixed(3)})`
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y); ctx.stroke()
  }
  for (let i = 0; i < SIZE * 1.5; i++) {
    const x = r() * SIZE
    ctx.strokeStyle = `rgba(0,0,0,${(r() * 0.06).toFixed(3)})`
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIZE); ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Marble — cloudy with veins
// ─────────────────────────────────────────────────────────────────────

function drawMarble(seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#f1ece2'
  ctx.fillRect(0, 0, SIZE, SIZE)
  // Cloudy variation
  for (let i = 0; i < 80; i++) {
    const x = r() * SIZE, y = r() * SIZE
    const rad = 30 + r() * 80
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, `rgba(180,170,150,${(r() * 0.10).toFixed(3)})`)
    g.addColorStop(1, 'rgba(180,170,150,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  // Veins
  for (let v = 0; v < 6; v++) {
    ctx.lineWidth = 0.5 + r() * 1.0
    ctx.strokeStyle = `rgba(60,50,40,${(0.18 + r() * 0.18).toFixed(3)})`
    ctx.beginPath()
    let x = r() * SIZE, y = r() * SIZE
    ctx.moveTo(x, y)
    for (let s = 0; s < 30; s++) {
      x += (r() - 0.5) * 30
      y += (r() - 0.5) * 30
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Brushed metal (anisotropic vertical streaks)
// ─────────────────────────────────────────────────────────────────────

function drawBrushedMetal(color: string, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.lineWidth = 0.5
  for (let i = 0; i < SIZE * 6; i++) {
    const x = r() * SIZE
    const dark = r() < 0.5
    ctx.strokeStyle = dark
      ? `rgba(0,0,0,${(0.04 + r() * 0.10).toFixed(3)})`
      : `rgba(255,255,255,${(0.04 + r() * 0.12).toFixed(3)})`
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIZE); ctx.stroke()
  }
  return c
}

function drawBrushedMetalHeight(seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < SIZE * 6; i++) {
    const x = r() * SIZE
    const v = Math.round(100 + r() * 80)
    ctx.strokeStyle = `rgba(${v},${v},${v},0.6)`
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIZE); ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Parquet floor — staggered planks with grain
// ─────────────────────────────────────────────────────────────────────

const PLANK_H = 64
const PLANK_SEGS = [80, 140, 90, 120, 100, 130, 70, 110]

// Plank base tones. Oak = the original warm light parquet; walnut = a deeper,
// richer brown that reads like the reference archviz floors. Only the colour map
// changes between them — the plank normal/roughness (height-derived) is shared.
interface PlankTone { r: number; g: number; b: number }
const PLANK_OAK: PlankTone = { r: 150, g: 105, b: 70 }
const PLANK_WALNUT: PlankTone = { r: 92, g: 61, b: 42 }

function drawParquet(seed: number, tone: PlankTone = PLANK_OAK): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  let segIdx = 0
  for (let row = 0; row < SIZE_LARGE / PLANK_H; row++) {
    let x = -((row * 47) % 200)
    while (x < SIZE_LARGE) {
      const segW = PLANK_SEGS[segIdx % PLANK_SEGS.length]
      segIdx++
      // Plank base colour with random shading. Vary LIGHTNESS only (one delta
      // applied to every channel) so planks stay the same wood hue — independent
      // per-channel jitter used to swing planks toward red or olive (a quilt).
      const dl = 1 + (r() - 0.5) * 0.20
      const bR = Math.round(tone.r * dl)
      const bG = Math.round(tone.g * dl)
      const bB = Math.round(tone.b * dl)
      ctx.fillStyle = `rgb(${bR},${bG},${bB})`
      ctx.fillRect(x, row * PLANK_H, segW, PLANK_H)
      // Wood grain inside plank
      for (let i = 0; i < segW * 0.6; i++) {
        const gx = x + r() * segW
        const gy = row * PLANK_H + r() * PLANK_H
        const gl = 8 + r() * 30
        ctx.strokeStyle = `rgba(40,25,15,${(0.04 + r() * 0.10).toFixed(3)})`
        ctx.lineWidth = 0.7
        ctx.beginPath()
        ctx.moveTo(gx, gy)
        ctx.lineTo(gx + gl + r() * 8, gy + (r() - 0.5) * 1.5)
        ctx.stroke()
      }
      // Plank borders
      ctx.strokeStyle = 'rgba(30,18,10,0.55)'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, row * PLANK_H + 0.5, segW - 1, PLANK_H - 1)
      // Top-edge highlight
      ctx.strokeStyle = 'rgba(255,240,210,0.10)'
      ctx.beginPath()
      ctx.moveTo(x + 1, row * PLANK_H + 1)
      ctx.lineTo(x + segW - 1, row * PLANK_H + 1)
      ctx.stroke()
      x += segW
    }
  }
  return c
}

function drawParquetHeight(): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  let segIdx = 0
  for (let row = 0; row < SIZE_LARGE / PLANK_H; row++) {
    let x = -((row * 47) % 200)
    while (x < SIZE_LARGE) {
      const segW = PLANK_SEGS[segIdx % PLANK_SEGS.length]
      segIdx++
      ctx.strokeStyle = '#404040'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 0.5, row * PLANK_H + 0.5, segW - 1, PLANK_H - 1)
      x += segW
    }
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Rug — wool dots (legacy basic)
// ─────────────────────────────────────────────────────────────────────

function drawRug(color: string, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < (SIZE * SIZE) / 5; i++) {
    const x = r() * SIZE, y = r() * SIZE
    const dark = r() < 0.5
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`
      : `rgba(255,240,200,${(r() * 0.15).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  for (let i = 0; i < SIZE * 4; i++) {
    const x = r() * SIZE, y = r() * SIZE
    ctx.fillStyle = `rgba(0,0,0,${(0.04 + r() * 0.08).toFixed(3)})`
    ctx.fillRect(x, y, 2, 1)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Premium wool rug — directional fibers, color variation, soft border
// (used in v16 to replace the old flat rug + fix flickering)
// ─────────────────────────────────────────────────────────────────────

interface RugPalette { base: string; dark: string; highlight: string; accent: string }

function drawRugWoolColor(palette: RugPalette, seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = palette.base
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  // Soft cloud variation underneath
  for (let i = 0; i < 80; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const rad = 60 + r() * 120
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    const useDark = r() < 0.5
    g.addColorStop(0, useDark
      ? `rgba(0,0,0,${(0.04 + r() * 0.06).toFixed(3)})`
      : `rgba(255,255,255,${(0.03 + r() * 0.05).toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  // Directional fiber strokes — short oriented dashes
  ctx.lineCap = 'round'
  for (let i = 0; i < SIZE_LARGE * 12; i++) {
    const x = r() * SIZE_LARGE
    const y = r() * SIZE_LARGE
    const len = 2 + r() * 4
    const ang = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.4
    const dx = Math.cos(ang) * len
    const dy = Math.sin(ang) * len
    const dark = r() < 0.55
    ctx.strokeStyle = dark
      ? `rgba(0,0,0,${(0.10 + r() * 0.18).toFixed(3)})`
      : `rgba(255,250,235,${(0.05 + r() * 0.12).toFixed(3)})`
    ctx.lineWidth = 0.6 + r() * 0.4
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy)
    ctx.stroke()
  }
  // Sparse accent fiber sparkles
  for (let i = 0; i < 200; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.fillStyle = palette.accent
    ctx.globalAlpha = 0.15 + r() * 0.20
    ctx.fillRect(x, y, 1, 1)
  }
  ctx.globalAlpha = 1
  return c
}

function drawRugWoolHeight(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#7c7c7c'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  // High-frequency fiber bumps
  for (let i = 0; i < SIZE_LARGE * 14; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const len = 2 + r() * 4
    const ang = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.4
    ctx.strokeStyle = `rgba(255,255,255,${(0.20 + r() * 0.40).toFixed(3)})`
    ctx.lineWidth = 1
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }
  // Random tufts
  for (let i = 0; i < 1500; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`
    ctx.fillRect(x, y, 2, 2)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Vinyl plank — modern wide-plank vinyl (light + dark variants)
// ─────────────────────────────────────────────────────────────────────

interface VinylPalette {
  baseR: number; baseG: number; baseB: number
  variation: number       // ± per channel
  grainDarkAlpha: number
  highlight: string
  border: string
}

function drawVinylPlank(palette: VinylPalette, seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  // Vinyl planks are wider than parquet → fewer rows but longer planks
  const rowH = 96
  // Per-row plank widths
  const widths = [240, 320, 280, 360, 220, 300]
  let segIdx = 0
  for (let row = 0; row < SIZE_LARGE / rowH; row++) {
    let x = -((row * 73) % 220)
    while (x < SIZE_LARGE) {
      const w = widths[segIdx % widths.length]
      segIdx++
      // Color variation per plank
      // Per-plank variation as a single LUMINANCE delta (same on R/G/B), so
      // planks differ in brightness, not hue — independent channel shifts looked
      // like a pastel "rainbow floor", which reads cheap/dated.
      const dl = (r() - 0.5) * 2 * palette.variation
      const cr = Math.max(0, Math.min(255, palette.baseR + dl | 0))
      const cg = Math.max(0, Math.min(255, palette.baseG + dl | 0))
      const cb = Math.max(0, Math.min(255, palette.baseB + dl | 0))
      // Subtle vertical gradient on each plank for depth
      const grad = ctx.createLinearGradient(0, row * rowH, 0, (row + 1) * rowH)
      grad.addColorStop(0,   `rgba(${Math.min(255, cr + 12)},${Math.min(255, cg + 12)},${Math.min(255, cb + 12)},1)`)
      grad.addColorStop(0.5, `rgb(${cr},${cg},${cb})`)
      grad.addColorStop(1,   `rgba(${Math.max(0, cr - 8)},${Math.max(0, cg - 8)},${Math.max(0, cb - 8)},1)`)
      ctx.fillStyle = grad
      ctx.fillRect(x, row * rowH, w, rowH)
      // Long fine grain lines (vinyl emulates wood)
      for (let i = 0; i < w * 0.25; i++) {
        const gx = x + r() * w
        const gy = row * rowH + r() * rowH
        const gl = 30 + r() * 80
        ctx.strokeStyle = `rgba(30,20,10,${(palette.grainDarkAlpha * (0.4 + r() * 0.6)).toFixed(3)})`
        ctx.lineWidth = 0.5 + r() * 0.4
        ctx.beginPath()
        ctx.moveTo(gx, gy)
        ctx.lineTo(gx + gl + r() * 20, gy + (r() - 0.5) * 1.0)
        ctx.stroke()
      }
      // Plank edge — subtle, NOT a hard black line (modern vinyl has tight seams)
      ctx.strokeStyle = palette.border
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(x + w, row * rowH)
      ctx.lineTo(x + w, (row + 1) * rowH)
      ctx.stroke()
      // Top-edge highlight
      ctx.strokeStyle = palette.highlight
      ctx.lineWidth = 0.6
      ctx.beginPath()
      ctx.moveTo(x, row * rowH + 0.5)
      ctx.lineTo(x + w, row * rowH + 0.5)
      ctx.stroke()
      x += w
    }
    // Row-dividing line — also subtle
    ctx.strokeStyle = palette.border
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0, (row + 1) * rowH)
    ctx.lineTo(SIZE_LARGE, (row + 1) * rowH)
    ctx.stroke()
  }
  return c
}

function drawVinylPlankHeight(): HTMLCanvasElement {
  // Very low-relief height map — vinyl is essentially flat. Just thin seams.
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  const rowH = 96
  const widths = [240, 320, 280, 360, 220, 300]
  let segIdx = 0
  for (let row = 0; row < SIZE_LARGE / rowH; row++) {
    let x = -((row * 73) % 220)
    while (x < SIZE_LARGE) {
      const w = widths[segIdx % widths.length]
      segIdx++
      ctx.strokeStyle = '#646464'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + w, row * rowH); ctx.lineTo(x + w, (row + 1) * rowH); ctx.stroke()
      x += w
    }
    ctx.strokeStyle = '#646464'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(0, (row + 1) * rowH); ctx.lineTo(SIZE_LARGE, (row + 1) * rowH); ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Slate tile — dark hexagonal/rectangular slate for bathrooms
// ─────────────────────────────────────────────────────────────────────

function drawSlateTile(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  // Dark slate base with subtle warm/cool variation
  ctx.fillStyle = '#3a3d44'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  // Cloud variation
  for (let i = 0; i < 90; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const rad = 40 + r() * 100
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    const cool = r() < 0.5
    g.addColorStop(0, cool
      ? `rgba(70,80,95,${(0.10 + r() * 0.15).toFixed(3)})`
      : `rgba(95,80,70,${(0.10 + r() * 0.15).toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  // Tile grid — large 128px tiles in a 4×4 grid with grout lines
  const tile = 128
  const grout = 3
  for (let row = 0; row < SIZE_LARGE / tile; row++) {
    for (let col = 0; col < SIZE_LARGE / tile; col++) {
      const x = col * tile, y = row * tile
      // Per-tile subtle color shift
      ctx.fillStyle = `rgba(0,0,0,${(r() * 0.10).toFixed(3)})`
      ctx.fillRect(x + grout, y + grout, tile - grout * 2, tile - grout * 2)
      // Some tiles get tiny mineral specks
      if (r() < 0.6) {
        for (let i = 0; i < 12; i++) {
          ctx.fillStyle = `rgba(255,255,255,${(0.10 + r() * 0.20).toFixed(3)})`
          ctx.fillRect(x + grout + r() * (tile - grout * 2), y + grout + r() * (tile - grout * 2), 1, 1)
        }
      }
    }
  }
  // Grout — dark recessed lines
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  for (let i = 0; i <= SIZE_LARGE / tile; i++) {
    ctx.fillRect(i * tile - grout / 2, 0, grout, SIZE_LARGE)
    ctx.fillRect(0, i * tile - grout / 2, SIZE_LARGE, grout)
  }
  // Slight per-tile veins
  ctx.lineWidth = 0.5
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${(0.04 + r() * 0.06).toFixed(3)})`
    ctx.beginPath()
    let x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.moveTo(x, y)
    for (let s = 0; s < 12; s++) {
      x += (r() - 0.5) * 24
      y += (r() - 0.5) * 24
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

function drawSlateTileHeight(): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#a0a0a0'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  const tile = 128
  const grout = 3
  ctx.fillStyle = '#404040'
  for (let i = 0; i <= SIZE_LARGE / tile; i++) {
    ctx.fillRect(i * tile - grout / 2, 0, grout, SIZE_LARGE)
    ctx.fillRect(0, i * tile - grout / 2, SIZE_LARGE, grout)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Concrete wall — modern microcement / polished concrete
// ─────────────────────────────────────────────────────────────────────

function drawConcrete(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#b8b4ad'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  // Layered cloud variation — broad
  for (let i = 0; i < 90; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const rad = 80 + r() * 200
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, r() < 0.5
      ? `rgba(0,0,0,${(0.04 + r() * 0.07).toFixed(3)})`
      : `rgba(255,255,255,${(0.04 + r() * 0.07).toFixed(3)})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  // Aggregate specks (tiny stones in the mix)
  for (let i = 0; i < 5000; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const dark = r() < 0.6
    ctx.fillStyle = dark
      ? `rgba(0,0,0,${(0.05 + r() * 0.20).toFixed(3)})`
      : `rgba(255,255,255,${(0.04 + r() * 0.10).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  // Subtle hairline cracks
  ctx.lineWidth = 0.4
  for (let v = 0; v < 4; v++) {
    ctx.strokeStyle = `rgba(0,0,0,${(0.10 + r() * 0.10).toFixed(3)})`
    ctx.beginPath()
    let x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.moveTo(x, y)
    for (let s = 0; s < 30; s++) {
      x += (r() - 0.5) * 30
      y += (r() - 0.5) * 30
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Modern wallpaper — fine vertical stripe with soft texture
// ─────────────────────────────────────────────────────────────────────

function drawWallpaper(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  // Warm off-white base
  ctx.fillStyle = '#f0eadc'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  // Vertical stripe pattern — alternating widths
  const stripeW = 12
  for (let x = 0; x < SIZE_LARGE; x += stripeW) {
    const isBand = (Math.floor(x / stripeW) % 2) === 0
    if (isBand) {
      ctx.fillStyle = 'rgba(190,165,110,0.08)'
      ctx.fillRect(x, 0, stripeW, SIZE_LARGE)
    }
  }
  // Linen-like cross weave on top
  ctx.lineWidth = 0.4
  for (let i = 0; i < SIZE_LARGE * 6; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.strokeStyle = r() < 0.5
      ? `rgba(0,0,0,${(0.04 + r() * 0.08).toFixed(3)})`
      : `rgba(255,255,255,${(0.04 + r() * 0.08).toFixed(3)})`
    ctx.beginPath()
    if (r() < 0.5) { ctx.moveTo(x, y); ctx.lineTo(x + 4, y) }
    else           { ctx.moveTo(x, y); ctx.lineTo(x, y + 4) }
    ctx.stroke()
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Better wall plaster (replaces flat one) — adds subtle bump
// ─────────────────────────────────────────────────────────────────────

function drawPlasterTextured(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#f3ede0'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  for (let i = 0; i < 120; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const rad = 40 + r() * 140
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, `rgba(140,115,80,${(r() * 0.04).toFixed(3)})`)
    g.addColorStop(1, 'rgba(140,115,80,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  for (let i = 0; i < 8000; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    ctx.fillStyle = r() < 0.5
      ? `rgba(0,0,0,${(r() * 0.04).toFixed(3)})`
      : `rgba(255,255,255,${(r() * 0.06).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

function drawPlasterHeight(seed: number): HTMLCanvasElement {
  const c = makeCanvas(SIZE_LARGE)
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, SIZE_LARGE, SIZE_LARGE)
  for (let i = 0; i < 8000; i++) {
    const x = r() * SIZE_LARGE, y = r() * SIZE_LARGE
    const v = Math.round(120 + (r() - 0.5) * 100)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Wall plaster — soft cloudy with speckles
// ─────────────────────────────────────────────────────────────────────

function drawWallPlaster(seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = '#f5efe1'
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 60; i++) {
    const x = r() * SIZE, y = r() * SIZE
    const rad = 30 + r() * 80
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
    g.addColorStop(0, `rgba(120,100,70,${(r() * 0.05).toFixed(3)})`)
    g.addColorStop(1, 'rgba(120,100,70,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
  }
  for (let i = 0; i < 1500; i++) {
    const x = r() * SIZE, y = r() * SIZE
    ctx.fillStyle = r() < 0.5
      ? `rgba(0,0,0,${(r() * 0.03).toFixed(3)})`
      : `rgba(255,255,255,${(r() * 0.06).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Matte plastic — for white appliances etc.
// ─────────────────────────────────────────────────────────────────────

function drawMattePlastic(color: string, seed: number): HTMLCanvasElement {
  const c = makeCanvas()
  const ctx = c.getContext('2d')!
  const r = rng(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, SIZE, SIZE)
  for (let i = 0; i < 1500; i++) {
    const x = r() * SIZE, y = r() * SIZE
    ctx.fillStyle = r() < 0.5
      ? `rgba(0,0,0,${(r() * 0.04).toFixed(3)})`
      : `rgba(255,255,255,${(r() * 0.06).toFixed(3)})`
    ctx.fillRect(x, y, 1, 1)
  }
  return c
}

// ─────────────────────────────────────────────────────────────────────
// Public — lazy-load all textures on first call
// ─────────────────────────────────────────────────────────────────────

export interface TextureBundle {
  // Wood
  woodOakC: HTMLCanvasElement
  woodOakN: HTMLCanvasElement
  woodWalnutC: HTMLCanvasElement
  woodWalnutN: HTMLCanvasElement
  // Fabric
  fabricBeigeC: HTMLCanvasElement
  fabricBeigeN: HTMLCanvasElement
  fabricGrayC: HTMLCanvasElement
  fabricGrayN: HTMLCanvasElement
  fabricBlueC: HTMLCanvasElement
  fabricBlueN: HTMLCanvasElement
  leatherBlackC: HTMLCanvasElement
  leatherBlackN: HTMLCanvasElement
  // Linen
  linenWhiteC: HTMLCanvasElement
  linenWhiteN: HTMLCanvasElement
  beddingC: HTMLCanvasElement
  beddingN: HTMLCanvasElement
  // Marble
  marbleC: HTMLCanvasElement
  marbleR: HTMLCanvasElement
  // Metal
  steelC: HTMLCanvasElement
  steelN: HTMLCanvasElement
  steelR: HTMLCanvasElement
  brassC: HTMLCanvasElement
  brassN: HTMLCanvasElement
  brassR: HTMLCanvasElement
  // Parquet
  parquetC: HTMLCanvasElement
  parquetN: HTMLCanvasElement
  // Walnut parquet — deeper archviz-grade floor (reuses parquet normal/roughness)
  parquetWalnutC: HTMLCanvasElement
  // Rug (legacy basic)
  rugC: HTMLCanvasElement
  // v16 — premium rug
  rugWoolC: HTMLCanvasElement
  rugWoolN: HTMLCanvasElement
  // Wall (legacy)
  wallC: HTMLCanvasElement
  // v16 — improved walls
  plasterC: HTMLCanvasElement
  plasterN: HTMLCanvasElement
  concreteC: HTMLCanvasElement
  concreteN: HTMLCanvasElement
  concreteR: HTMLCanvasElement
  wallpaperC: HTMLCanvasElement
  wallpaperN: HTMLCanvasElement
  wallpaperR: HTMLCanvasElement
  // v16 — modern floors
  vinylLightC: HTMLCanvasElement
  vinylLightN: HTMLCanvasElement
  vinylDarkC: HTMLCanvasElement
  vinylDarkN: HTMLCanvasElement
  slateC: HTMLCanvasElement
  slateN: HTMLCanvasElement
  // Plastic
  matteWhiteC: HTMLCanvasElement
  matteBlackC: HTMLCanvasElement
  // Roughness maps (derived from height) for the hero surfaces — micro-detail
  // breakup of specular/reflection. Linear data, sampled once per fragment.
  parquetR: HTMLCanvasElement
  woodOakR: HTMLCanvasElement
  woodWalnutR: HTMLCanvasElement
  plasterR: HTMLCanvasElement
  slateR: HTMLCanvasElement
  vinylLightR: HTMLCanvasElement
  vinylDarkR: HTMLCanvasElement
}

let _bundle: TextureBundle | null = null

// ─────────────────────────────────────────────────────────────────────
// IndexedDB cache — eliminates the 300-500 ms first-open cost on
// subsequent opens. We store each canvas as a PNG blob and rebuild on
// the next load.
//
// CACHE_VERSION is bumped whenever any generator changes; this triggers
// a full regeneration on the next load.
// ─────────────────────────────────────────────────────────────────────

const DB_NAME = 'omega-textures'
const DB_STORE = 'tex'
const CACHE_VERSION = 26

function openDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try { req = indexedDB.open(DB_NAME, 1) } catch { return resolve(null) }
    req.onerror = () => resolve(null)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      try { req.result.createObjectStore(DB_STORE) } catch { /* ignore */ }
    }
  })
}

async function dbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly')
      const r = tx.objectStore(DB_STORE).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror   = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

async function dbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite')
      tx.objectStore(DB_STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => resolve()
    } catch { resolve() }
  })
}

/** Convert canvas → PNG blob (async). */
function canvasToBlob(c: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      c.toBlob((b) => resolve(b), 'image/png')
    } catch { resolve(null) }
  })
}

/** Decode blob into a fresh canvas of identical dimensions. */
async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0)
    return c
  } catch {
    return null
  }
}

/** Try to populate `_bundle` from IndexedDB. Returns true on success. */
async function tryLoadFromCache(): Promise<boolean> {
  const db = await openDB()
  if (!db) return false
  const meta = await dbGet(db, '__meta__') as { version?: number } | undefined
  if (!meta || meta.version !== CACHE_VERSION) {
    db.close()
    return false
  }
  const keys: (keyof TextureBundle)[] = [
    'woodOakC', 'woodOakN', 'woodWalnutC', 'woodWalnutN',
    'fabricBeigeC', 'fabricBeigeN', 'fabricGrayC', 'fabricGrayN', 'fabricBlueC', 'fabricBlueN',
    'leatherBlackC', 'leatherBlackN',
    'linenWhiteC', 'linenWhiteN', 'beddingC', 'beddingN',
    'marbleC', 'marbleR',
    'steelC', 'steelN', 'steelR', 'brassC', 'brassN', 'brassR',
    'parquetC', 'parquetN', 'parquetWalnutC',
    'rugC',
    'rugWoolC', 'rugWoolN',
    'wallC',
    'plasterC', 'plasterN',
    'concreteC', 'concreteN', 'concreteR', 'wallpaperC', 'wallpaperN', 'wallpaperR',
    'vinylLightC', 'vinylLightN',
    'vinylDarkC', 'vinylDarkN',
    'slateC', 'slateN',
    'matteWhiteC', 'matteBlackC',
    'parquetR', 'woodOakR', 'woodWalnutR', 'plasterR', 'slateR', 'vinylLightR', 'vinylDarkR',
  ]
  const partial: Partial<TextureBundle> = {}
  for (const k of keys) {
    const blob = await dbGet(db, k) as Blob | undefined
    if (!(blob instanceof Blob)) { db.close(); return false }
    const cv = await blobToCanvas(blob)
    if (!cv) { db.close(); return false }
    (partial as Record<string, HTMLCanvasElement>)[k] = cv
  }
  db.close()
  _bundle = partial as TextureBundle
  return true
}

/** Store the freshly generated bundle into IndexedDB (best-effort, non-blocking). */
async function saveToCache(bundle: TextureBundle): Promise<void> {
  const db = await openDB()
  if (!db) return
  const keys = Object.keys(bundle) as (keyof TextureBundle)[]
  for (const k of keys) {
    const blob = await canvasToBlob(bundle[k])
    if (blob) await dbPut(db, k, blob)
  }
  await dbPut(db, '__meta__', { version: CACHE_VERSION })
  db.close()
}

/**
 * Async variant of `getTextures()`. Tries to fetch from IndexedDB cache
 * first; falls back to procedural generation. Subsequent calls are
 * synchronous via the in-memory `_bundle`.
 */
export async function getTexturesAsync(): Promise<TextureBundle> {
  if (_bundle) return _bundle
  const ok = await tryLoadFromCache()
  if (ok && _bundle) return _bundle
  const fresh = getTextures()  // synchronous generation
  // Fire-and-forget cache write; failures are silently tolerated.
  saveToCache(fresh).catch(() => {})
  return fresh
}

export function getTextures(): TextureBundle {
  if (_bundle) return _bundle
  if (typeof document === 'undefined') {
    throw new Error('getTextures() called in non-browser environment')
  }

  const woodOakC     = drawWoodColor({ base: '#b6a181', dark: '#6e5c46', highlight: '#dccbb0' }, 1)
  const woodOakH     = drawWoodHeight(1)
  const woodOakN     = heightToNormal(woodOakH, 0.6)

  const woodWalnutC  = drawWoodColor({ base: '#564439', dark: '#2a211b', highlight: '#7a6450' }, 3)
  const woodWalnutH  = drawWoodHeight(3)
  const woodWalnutN  = heightToNormal(woodWalnutH, 0.6)

  const fabricBeigeC = drawFabric('#cdb992', 7)
  const fabricBeigeH = drawFabricHeight(7)
  const fabricBeigeN = heightToNormal(fabricBeigeH, 0.5)

  const fabricGrayC  = drawFabric('#9b9b96', 9)
  const fabricGrayN  = heightToNormal(fabricGrayC, 0.4)
  const fabricBlueC  = drawFabric('#5a7da0', 71)
  const fabricBlueN  = heightToNormal(fabricBlueC, 0.4)
  // Leather: same fabric generator with a darker palette + tighter weave look
  const leatherBlackC = drawFabric('#2a2724', 73)
  const leatherBlackN = heightToNormal(leatherBlackC, 0.5)

  const linenWhiteC  = drawLinen('#ffffff', 11)
  const linenWhiteN  = heightToNormal(linenWhiteC, 0.4)
  const beddingC     = drawLinen('#e8dfca', 12)
  const beddingN     = heightToNormal(beddingC, 0.4)

  const marbleC      = drawMarble(13)
  const marbleR      = heightToRoughness(marbleC, 0.18)

  const steelC       = drawBrushedMetal('#bdbcb6', 17)
  const steelH       = drawBrushedMetalHeight(17)
  const steelN       = heightToNormal(steelH, 0.4)
  // Brushed metal lives on varying roughness along the grain — derive it from
  // the brushing height so the streaks read as real anisotropic metal.
  const steelR       = heightToRoughness(steelH, 0.3)

  const brassC       = drawBrushedMetal('#d4b063', 19)
  const brassH       = drawBrushedMetalHeight(19)
  const brassN       = heightToNormal(brassH, 0.4)
  const brassR       = heightToRoughness(brassH, 0.3)

  const parquetC       = drawParquet(23)
  const parquetWalnutC = drawParquet(23, PLANK_WALNUT)
  const parquetH       = drawParquetHeight()
  const parquetN       = heightToNormal(parquetH, 1.5)

  // Legacy rug
  const rugC         = drawRug('#9a8052', 29)

  // Premium wool rug — used by default in v16
  const rugWoolC     = drawRugWoolColor(
    { base: '#9a9082', dark: '#4a4439', highlight: '#c3bcad', accent: '#6f685c' },
    41,
  )
  const rugWoolH     = drawRugWoolHeight(41)
  const rugWoolN     = heightToNormal(rugWoolH, 1.2)

  // Wall — keep legacy, add textured plaster + concrete + wallpaper
  const wallC        = drawWallPlaster(31)
  const plasterC     = drawPlasterTextured(43)
  const plasterH     = drawPlasterHeight(43)
  const plasterN     = heightToNormal(plasterH, 0.7)
  const concreteC    = drawConcrete(47)
  // Concrete/wallpaper had no relief — derive a normal + roughness from the
  // colour canvas (its luminance tracks the surface structure), de-flattening
  // these large wall surfaces for free (no new noise).
  const concreteN    = heightToNormal(concreteC, 0.6)
  const concreteR    = heightToRoughness(concreteC, 0.2)
  const wallpaperC   = drawWallpaper(53)
  const wallpaperN   = heightToNormal(wallpaperC, 0.4)
  const wallpaperR   = heightToRoughness(wallpaperC, 0.14)

  // Modern floors
  const vinylLightC  = drawVinylPlank(
    { baseR: 218, baseG: 200, baseB: 170, variation: 14, grainDarkAlpha: 0.15,
      highlight: 'rgba(255,250,240,0.20)', border: 'rgba(120,95,60,0.35)' },
    61,
  )
  const vinylLightH  = drawVinylPlankHeight()
  const vinylLightN  = heightToNormal(vinylLightH, 0.4)
  const vinylDarkC   = drawVinylPlank(
    { baseR: 78, baseG: 58, baseB: 44, variation: 10, grainDarkAlpha: 0.40,
      highlight: 'rgba(170,140,100,0.10)', border: 'rgba(20,12,8,0.6)' },
    63,
  )
  const vinylDarkH   = drawVinylPlankHeight()
  const vinylDarkN   = heightToNormal(vinylDarkH, 0.4)

  const slateC       = drawSlateTile(67)
  const slateH       = drawSlateTileHeight()
  const slateN       = heightToNormal(slateH, 1.1)

  const matteWhiteC  = drawMattePlastic('#f5f0e6', 37)
  const matteBlackC  = drawMattePlastic('#1a1a1d', 39)

  // Roughness maps from the existing height fields (free micro-detail).
  const parquetR     = heightToRoughness(parquetH, 0.22)
  const woodOakR     = heightToRoughness(woodOakH, 0.18)
  const woodWalnutR  = heightToRoughness(woodWalnutH, 0.18)
  const plasterR     = heightToRoughness(plasterH, 0.16)
  const slateR       = heightToRoughness(slateH, 0.28)
  const vinylLightR  = heightToRoughness(vinylLightH, 0.16)
  const vinylDarkR   = heightToRoughness(vinylDarkH, 0.16)

  _bundle = {
    woodOakC, woodOakN,
    woodWalnutC, woodWalnutN,
    fabricBeigeC, fabricBeigeN,
    fabricGrayC, fabricGrayN,
    fabricBlueC, fabricBlueN,
    leatherBlackC, leatherBlackN,
    linenWhiteC, linenWhiteN, beddingC, beddingN,
    marbleC, marbleR,
    steelC, steelN, steelR,
    brassC, brassN, brassR,
    parquetC, parquetN, parquetWalnutC,
    rugC,
    rugWoolC, rugWoolN,
    wallC,
    plasterC, plasterN,
    concreteC, concreteN, concreteR, wallpaperC, wallpaperN, wallpaperR,
    vinylLightC, vinylLightN,
    vinylDarkC, vinylDarkN,
    slateC, slateN,
    matteWhiteC, matteBlackC,
    parquetR, woodOakR, woodWalnutR, plasterR, slateR, vinylLightR, vinylDarkR,
  }
  return _bundle
}
