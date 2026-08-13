import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROPS, propMaterialRole, propUrl, type PropId } from './propRegistry'

/**
 * The props have to agree with three things: the files on disk, the build
 * manifest, and the space the placement logic reserves for them. The last one
 * is the subtle one — a rebuilt car that grew 40 cm would still load, still
 * render, and quietly overhang the bay it was parked in.
 */

const ROOT = resolve(__dirname, '..', '..')
const modelPath = (file: string) => resolve(ROOT, 'public', 'models', 'props', `${file}.glb`)

interface PropRecord {
  triangles: number
  materials: number
  size: [number, number, number]
  height: number
  bytes: number
}
const manifest: Record<string, PropRecord> = JSON.parse(
  readFileSync(resolve(ROOT, 'tools', 'blender', 'props.json'), 'utf8'),
).props

const entries = Object.entries(PROPS) as [PropId, (typeof PROPS)[PropId]][]

describe('every registered prop resolves to a built model', () => {
  it.each(entries)('%s', (_id, def) => {
    expect(existsSync(modelPath(def.file))).toBe(true)
    expect(manifest[def.file]).toBeDefined()
  })

  it.each(entries)('%s declares the size the build measured', (_id, def) => {
    // Props are placed at life size, so drift here is a lamp a head too tall.
    for (let axis = 0; axis < 3; axis++) {
      expect(def.size[axis], 'xyz'[axis]).toBeCloseTo(manifest[def.file].size[axis], 3)
    }
  })

  it('leaves no built model unused', () => {
    const referenced = new Set(Object.values(PROPS).map((d) => `${d.file}.glb`))
    expect(readdirSync(resolve(ROOT, 'public', 'models', 'props')).sort())
      .toEqual([...referenced].sort())
  })

  it('keeps every prop inside the budget it is paid for', () => {
    // A street places hundreds of these and `Static` merges them, so a triangle
    // here is a triangle a few hundred times over.
    for (const [file, record] of Object.entries(manifest)) {
      expect(record.triangles, `${file} is too dense`).toBeLessThanOrEqual(1400)
      expect(record.materials, `${file} has too many materials`).toBeLessThanOrEqual(4)
      expect(record.bytes, `${file} is oversized`).toBeLessThan(64 * 1024)
      expect(statSync(modelPath(file)).size).toBe(record.bytes)
    }
  })
})

describe('sizes the placement logic depends on', () => {
  it('parks a car inside its bay', () => {
    // `PARKING_BAY_M` in lib/world/amenities is 6 m — a car plus room to open
    // a door. A model longer than that overhangs the next car.
    expect(PROPS.car.size[1]).toBeLessThan(6)
    // …and inside a lane, so it does not stand on the centre line.
    expect(PROPS.car.size[0]).toBeLessThan(2.2)
  })

  it('keeps the lamp above head height and the bin below it', () => {
    expect(PROPS['lamp-post'].size[2]).toBeGreaterThan(3.5)
    expect(PROPS['litter-bin'].size[2]).toBeLessThan(1.2)
    expect(PROPS.bench.size[2]).toBeLessThan(1.2)
  })

  it('reaches the lamp arm out along the front axis, not sideways', () => {
    // Front is −Y, which the exporter turns into glTF +z; the placement code
    // rotates every prop the same way on that assumption. An arm built along X
    // would need a per-asset quarter turn, so the shape is pinned here: the
    // column is slim across (x) and long along the arm (y).
    const [x, y] = PROPS['lamp-post'].size
    expect(y).toBeGreaterThan(0.9)
    expect(x).toBeLessThan(0.4)
  })
})

describe('material roles — the scene tints the prop, not the file', () => {
  it('routes the palette names the models actually carry', () => {
    expect(propMaterialRole('car_body')).toBe('body')
    expect(propMaterialRole('car_glass')).toBe('glass')
    expect(propMaterialRole('lamp_lens')).toBe('lens')
    expect(propMaterialRole('steel')).toBe('metal')
    expect(propMaterialRole('oak')).toBe('wood')
    expect(propMaterialRole('soft_black')).toBe('dark')
  })

  it('survives the suffix a glTF exporter adds to a duplicate name', () => {
    expect(propMaterialRole('car_body.001')).toBe('body')
    expect(propMaterialRole('Steel.014')).toBe('metal')
  })

  it('falls back to dark rather than to glass', () => {
    // The safe default: an anthracite mesh is a mesh, a glass one is a hole.
    expect(propMaterialRole('')).toBe('dark')
    expect(propMaterialRole('something_new')).toBe('dark')
  })

  it('reads car_glass as glass even though it also contains a body word', () => {
    // Order matters in the matcher; this pins it.
    expect(propMaterialRole('car_glass')).not.toBe('body')
  })
})

describe('propUrl', () => {
  it('points into the props model folder', () => {
    expect(propUrl('bench')).toContain('models/props/bench.glb')
  })
})
