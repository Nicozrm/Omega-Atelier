import { describe, it, expect } from 'vitest'
import type { PlacedFurniture, Room } from '@/types'
import { collectInteriorSources } from './LightRig'

const noDevices = [] as never[]
const sizeOf = () => [200, 100] as const

const furniture = (over: Partial<PlacedFurniture> & { id: string; furnitureId: string }): PlacedFurniture => ({
  position: { x: 0, y: 0 },
  rotation: 0,
  ...over,
}) as PlacedFurniture

const room = (id: string): Room => ({
  id,
  name: id,
  polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
} as Room)

describe('collectInteriorSources — furniture fixtures', () => {
  it('emits the pendant above a table at the table centre', () => {
    const sources = collectInteriorSources(
      [], noDevices,
      [furniture({ id: 'f1', furnitureId: 'table-dining', position: { x: 300, y: 500 } })],
      undefined, () => undefined, sizeOf,
    )
    expect(sources).toHaveLength(1)
    const [x, y, z] = sources[0].position
    expect(x).toBeCloseTo(3, 6)
    expect(z).toBeCloseTo(5, 6)
    expect(y).toBeCloseTo(1.55, 6)
  })

  it('rotates an offset fixture into world space with its furniture', () => {
    // The kitchen strip sits at local -z. Rotating the unit 90° about Y must
    // swing that offset onto the world +x axis, not leave it pointing at -z.
    const at = (deg: number) => collectInteriorSources(
      [], noDevices,
      [furniture({ id: 'k', furnitureId: 'kitchen-run', position: { x: 1000, y: 1000 }, rotation: deg })],
      undefined, () => undefined, sizeOf,
    )[0].position

    const hM = 1 // sizeOf → [200, 100] cm
    const localZ = -hM / 2 + 0.42

    const [x0, , z0] = at(0)
    expect(x0).toBeCloseTo(10, 6)
    expect(z0).toBeCloseTo(10 + localZ, 6)

    const [x90, , z90] = at(90)
    expect(x90).toBeCloseTo(10 + localZ, 6)
    expect(z90).toBeCloseTo(10, 6)

    // A full turn must return exactly where it started.
    const [x360, , z360] = at(360)
    expect(x360).toBeCloseTo(x0, 6)
    expect(z360).toBeCloseTo(z0, 6)
  })

  it('honours a per-item size override over the catalogue default', () => {
    const [, , z] = collectInteriorSources(
      [], noDevices,
      [furniture({ id: 'k', furnitureId: 'kitchen-run', size: [200, 300] })],
      undefined, () => undefined, sizeOf,
    )[0].position
    // hM = 3 m → local z = -1.5 + 0.42
    expect(z).toBeCloseTo(-1.5 + 0.42, 6)
  })

  it('skips hidden furniture', () => {
    const sources = collectInteriorSources(
      [], noDevices,
      [furniture({ id: 'f1', furnitureId: 'table-dining', hidden: true })],
      undefined, () => undefined, sizeOf,
    )
    expect(sources).toHaveLength(0)
  })

  it('ignores furniture that carries no fixture', () => {
    const sources = collectInteriorSources(
      [], noDevices,
      [furniture({ id: 'f1', furnitureId: 'sofa-corner' })],
      undefined, () => undefined, sizeOf,
    )
    expect(sources).toHaveLength(0)
  })

  it('ranks fixtures above the ambient architectural light they compete with', () => {
    const sources = collectInteriorSources(
      [room('r1')], noDevices,
      [furniture({ id: 'f1', furnitureId: 'table-dining', position: { x: 200, y: 200 } })],
      undefined, () => undefined, sizeOf,
    )
    const fixture = sources.find((s) => s.key.startsWith('fixture:'))!
    const downlight = sources.find((s) => s.key.startsWith('down:'))!
    const cove = sources.find((s) => s.key.startsWith('cove:'))!
    expect(fixture.priority).toBeGreaterThan(downlight.priority)
    expect(downlight.priority).toBeGreaterThan(cove.priority)
  })

  it('gives every source a unique key, so slots cannot collide', () => {
    const sources = collectInteriorSources(
      [room('r1'), room('r2')], noDevices,
      [
        furniture({ id: 'f1', furnitureId: 'table-dining' }),
        furniture({ id: 'f2', furnitureId: 'kitchen-run' }),
        furniture({ id: 'f3', furnitureId: 'tv-sideboard' }),
      ],
      undefined, () => undefined, sizeOf,
    )
    const keys = sources.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(sources.filter((s) => s.key.startsWith('fixture:'))).toHaveLength(3)
  })
})
