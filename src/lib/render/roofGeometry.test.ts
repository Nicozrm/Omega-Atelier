import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { eavesDrop, gableSlope, hipRoofGeometry } from './roofGeometry'

/**
 * A roof is judged by whether it *closes*. These tests therefore ask geometric
 * questions rather than checking numbers against themselves: does every face
 * point up, does the ridge run the right way, and — the one that actually broke
 * — does the covering meet the wall head instead of hovering above it.
 */

function positions(g: THREE.BufferGeometry): THREE.Vector3[] {
  const a = g.getAttribute('position')
  return Array.from({ length: a.count }, (_, i) => new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i)))
}

/** Every triangle's face normal, in winding order. */
function faceNormals(g: THREE.BufferGeometry): THREE.Vector3[] {
  const p = positions(g)
  const out: THREE.Vector3[] = []
  for (let i = 0; i + 2 < p.length; i += 3) {
    const u = p[i + 1].clone().sub(p[i])
    const v = p[i + 2].clone().sub(p[i])
    out.push(u.cross(v).normalize())
  }
  return out
}

describe('hipRoofGeometry', () => {
  it('covers exactly the footprint it is given', () => {
    const g = hipRoofGeometry(12, 8, 2.4)
    g.computeBoundingBox()
    const b = g.boundingBox!
    // The old square-pyramid stand-in got this wrong in both directions at
    // once: hypot(12, 8) · 0.52 · √2 ≈ 10.6 m across a 12 m side and an 8 m one.
    expect(b.min.x).toBeCloseTo(-6, 6)
    expect(b.max.x).toBeCloseTo(6, 6)
    expect(b.min.z).toBeCloseTo(-4, 6)
    expect(b.max.z).toBeCloseTo(4, 6)
    expect(b.max.y).toBeCloseTo(2.4, 6)
  })

  it('runs the ridge along the long axis, |w − d| long', () => {
    const g = hipRoofGeometry(12, 8, 2.4)
    const ridge = positions(g).filter((p) => Math.abs(p.y - 2.4) < 1e-6)
    const xs = ridge.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 6)
    // Nothing off the centre line is at ridge height.
    for (const p of ridge) expect(Math.abs(p.z)).toBeLessThan(1e-6)
  })

  it('turns into a Zeltdach over a square plan, with no degenerate faces', () => {
    const g = hipRoofGeometry(9, 9, 3)
    const normals = faceNormals(g)
    expect(normals).toHaveLength(4)
    // A zero-area triangle yields a NaN normal, which poisons the shading of
    // every vertex it touches — the flicker at the apex this case exists for.
    for (const n of normals) expect(Number.isFinite(n.y)).toBe(true)
  })

  it('winds every face upward, whichever way round the plan is', () => {
    for (const [w, d] of [[12, 8], [8, 12], [9, 9], [20, 6]] as const) {
      for (const n of faceNormals(hipRoofGeometry(w, d, 2))) {
        expect(n.y, `${w}×${d}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps every slope at one pitch — that is what makes it a hip', () => {
    const g = hipRoofGeometry(14, 9, 2.7)
    // atan(rise / half short span): the same angle on the mains and the hips.
    const want = Math.atan2(2.7, 4.5)
    for (const n of faceNormals(g)) {
      expect(Math.acos(Math.min(1, n.y))).toBeCloseTo(want, 5)
    }
  })
})

describe('eavesDrop — why roofs used to hover over their walls', () => {
  it('is the climb of the covering over the overhang', () => {
    expect(eavesDrop(0.45, 0.6)).toBeCloseTo(0.27, 6)
    expect(eavesDrop(0.42, 0.5)).toBeCloseTo(0.21, 6)
  })

  it('is nothing without an overhang or without a pitch', () => {
    expect(eavesDrop(0, 0.6)).toBe(0)
    expect(eavesDrop(0.45, 0)).toBe(0)
    expect(eavesDrop(-1, 0.6)).toBe(0)
  })
})

describe('gableSlope', () => {
  const halfSpan = 4
  const rise = 2.4
  const overhang = 0.45
  const s = gableSlope(halfSpan, rise, overhang)

  it('bears on the wall head — the defect this replaces', () => {
    // Walk the slope from the ridge back toward the wall: at the wall face the
    // covering must be at the wall head (y = 0), not above it.
    const yAt = (x: number) => rise - Math.tan(s.angle) * Math.abs(x)
    expect(yAt(halfSpan)).toBeCloseTo(0, 10)
    // Built from the overhang instead, `atan2(rise, halfSpan + overhang)`, the
    // same point sat this much clear of the masonry.
    const wrong = Math.atan2(rise, halfSpan + overhang)
    expect(rise - Math.tan(wrong) * halfSpan).toBeGreaterThan(0.2)
  })

  it('hangs the eave outside the wall and below it', () => {
    expect(s.eaveX).toBeGreaterThan(halfSpan)
    expect(s.eaveY).toBeLessThan(0)
    // The tip is exactly `overhang` further along the slope than the wall head.
    expect(Math.hypot(s.eaveX - halfSpan, s.eaveY)).toBeCloseTo(overhang, 10)
  })

  it('centres the slab on the rafter, not on a quarter of the span', () => {
    // Ridge end and eave end, derived from the centre and the rotation the
    // renderer applies. Both have to land on the real corners.
    const ridgeX = -s.cx + Math.cos(s.angle) * (s.rafter / 2)
    const ridgeY = s.cy + Math.sin(s.angle) * (s.rafter / 2)
    expect(ridgeX).toBeCloseTo(0, 10)
    expect(ridgeY).toBeCloseTo(rise, 10)

    const eaveX = -s.cx - Math.cos(s.angle) * (s.rafter / 2)
    const eaveY = s.cy - Math.sin(s.angle) * (s.rafter / 2)
    expect(eaveX).toBeCloseTo(-s.eaveX, 10)
    expect(eaveY).toBeCloseTo(s.eaveY, 10)
  })

  it('degrades to a flat slab rather than dividing by zero', () => {
    const flat = gableSlope(4, 0, 0.45)
    expect(flat.angle).toBe(0)
    expect(flat.eaveY).toBeCloseTo(0, 12)
    expect(flat.eaveX).toBeCloseTo(4.45, 10)
  })
})
