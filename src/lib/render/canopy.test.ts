import { describe, it, expect, afterEach } from 'vitest'
import * as THREE from 'three'
import { canopyGeometry, deformCanopy, disposeCanopyPool, CANOPY_VARIANTS } from './canopy'

/**
 * Was hier geprüft wird, ist nicht „sieht gut aus" — das kann kein Unit-Test.
 * Geprüft wird das, was die Form überhaupt erst von einer Kugel unterscheidet
 * und woran sie still scheitern könnte: dass die Ecken tatsächlich verschoben
 * sind, dass die Verschiebung zusammenhängt statt zu rauschen, dass sie
 * deterministisch ist (sonst flimmert der Baum beim Neuaufbau der Szene), und
 * dass der Pool geteilt wird statt pro Baum zu allozieren.
 */

const radii = (g: THREE.BufferGeometry): number[] => {
  const pos = g.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  const out: number[] = []
  for (let i = 0; i < pos.count; i++) out.push(v.fromBufferAttribute(pos, i).length())
  return out
}

afterEach(() => { disposeCanopyPool() })

describe('deformCanopy', () => {
  it('macht aus der Kugel eine unregelmässige Form', () => {
    const g = new THREE.IcosahedronGeometry(1, 2)
    expect(Math.max(...radii(g)) - Math.min(...radii(g))).toBeLessThan(1e-6) // vorher: Kugel
    deformCanopy(g, 1)
    const r = radii(g)
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(0.15)
  })

  it('hält die Form zusammen — keine Stacheln, kein Zusammenfallen', () => {
    const g = new THREE.IcosahedronGeometry(1, 2)
    deformCanopy(g, 3)
    const r = radii(g)
    // Die Unterseite wird bewusst eingezogen (bis 0.78), nach aussen begrenzt
    // die Amplitude. Nichts darf durch den Mittelpunkt klappen.
    expect(Math.min(...r)).toBeGreaterThan(0.45)
    expect(Math.max(...r)).toBeLessThan(1.45)
  })

  it('verschiebt benachbarte Ecken ähnlich — Büschel, nicht Rauschen', () => {
    const g = new THREE.IcosahedronGeometry(1, 2)
    deformCanopy(g, 5)
    const pos = g.attributes.position as THREE.BufferAttribute
    const a = new THREE.Vector3(), b = new THREE.Vector3()
    // Für jede Ecke die nächstgelegene andere suchen und die Radiusdifferenz
    // mit der über zufällige Paare vergleichen.
    let nearSum = 0, nearN = 0
    for (let i = 0; i < pos.count; i += 7) {
      a.fromBufferAttribute(pos, i)
      let bestD = Infinity, bestR = 0
      for (let j = 0; j < pos.count; j += 3) {
        if (j === i) continue
        b.fromBufferAttribute(pos, j)
        const d = a.distanceTo(b)
        if (d > 1e-6 && d < bestD) { bestD = d; bestR = b.length() }
      }
      nearSum += Math.abs(a.length() - bestR); nearN++
    }
    const r = radii(g)
    let farSum = 0
    for (let i = 0; i < 200; i++) farSum += Math.abs(r[(i * 37) % r.length] - r[(i * 91) % r.length])
    expect(nearSum / nearN).toBeLessThan(farSum / 200)
  })

  it('richtet die Normalen auf die neue Form aus', () => {
    const g = new THREE.IcosahedronGeometry(1, 2)
    const before = (g.attributes.normal as THREE.BufferAttribute).array.slice(0, 30)
    deformCanopy(g, 2)
    const after = (g.attributes.normal as THREE.BufferAttribute).array.slice(0, 30)
    expect(Array.from(after)).not.toEqual(Array.from(before))
  })

  it('ist deterministisch — derselbe Seed, dieselbe Form', () => {
    const a = new THREE.IcosahedronGeometry(1, 2); deformCanopy(a, 9)
    const b = new THREE.IcosahedronGeometry(1, 2); deformCanopy(b, 9)
    expect(radii(a)).toEqual(radii(b))
  })

  it('trennt die Seeds — verschiedene Seeds, verschiedene Formen', () => {
    const a = new THREE.IcosahedronGeometry(1, 2); deformCanopy(a, 1)
    const b = new THREE.IcosahedronGeometry(1, 2); deformCanopy(b, 2)
    expect(radii(a)).not.toEqual(radii(b))
  })
})

describe('canopyGeometry-Pool', () => {
  it('teilt die Geometrie statt pro Baum zu allozieren', () => {
    expect(canopyGeometry(3)).toBe(canopyGeometry(3))
    expect(canopyGeometry(3)).toBe(canopyGeometry(3 + CANOPY_VARIANTS))
  })

  it('liefert mehrere unterscheidbare Formen', () => {
    const seen = new Set<THREE.BufferGeometry>()
    for (let i = 0; i < CANOPY_VARIANTS; i++) seen.add(canopyGeometry(i))
    expect(seen.size).toBe(CANOPY_VARIANTS)
  })

  it('faltet jede Zahl in den Pool — auch negative und gebrochene', () => {
    for (const v of [-5, -0.4, 0, 7.6, 1e6]) {
      expect(() => canopyGeometry(v)).not.toThrow()
      expect(canopyGeometry(v)).toBeInstanceOf(THREE.BufferGeometry)
    }
  })

  it('baut nach dispose neu auf', () => {
    const first = canopyGeometry(0)
    disposeCanopyPool()
    expect(canopyGeometry(0)).not.toBe(first)
  })
})
