import { describe, it, expect } from 'vitest'
import { parcelAt, parcelFromCell, parcelsInBounds, LOT_WIDTH_M, LOT_DEPTH_M } from './world'
import { haversineMeters, offsetGeo } from './geo'

const BERLIN = { lat: 52.52, lng: 13.405 }

describe('parcelAt', () => {
  it('is deterministic for a given point', () => {
    const a = parcelAt(BERLIN)
    const b = parcelAt(BERLIN)
    expect(a).toEqual(b)
  })

  it('returns the same parcel for two points inside the same lot', () => {
    const a = parcelAt(BERLIN)
    // Nudge a couple of metres — still inside the ~26×34m lot.
    const nudged = offsetGeo(BERLIN, 2, 2)
    const b = parcelAt(nudged)
    expect(b.cell).toEqual(a.cell)
    expect(b.seed).toBe(a.seed)
  })

  it('returns a different parcel a hundred metres away', () => {
    const a = parcelAt(BERLIN)
    const far = offsetGeo(BERLIN, 200, 200)
    const b = parcelAt(far)
    expect(b.cell).not.toEqual(a.cell)
  })

  it('produces a plausible lot size and an interior centre', () => {
    const p = parcelAt(BERLIN)
    expect(p.widthM).toBeGreaterThan(LOT_WIDTH_M * 0.8)
    expect(p.widthM).toBeLessThan(LOT_WIDTH_M * 1.3)
    expect(p.depthM).toBeGreaterThan(LOT_DEPTH_M * 0.8)
    expect(p.depthM).toBeLessThan(LOT_DEPTH_M * 1.3)
    // Centre sits south-east of the NW origin.
    expect(p.center.lat).toBeLessThan(p.origin.lat)
    expect(p.center.lng).toBeGreaterThan(p.origin.lng)
  })
})

describe('parcelFromCell', () => {
  it('is stable per cell', () => {
    expect(parcelFromCell(10, 20, 52).seed).toBe(parcelFromCell(10, 20, 52).seed)
  })
  it('marks roughly one in eight lots as unbuilt', () => {
    let unbuilt = 0
    for (let gx = 0; gx < 40; gx++) {
      for (let gy = 0; gy < 40; gy++) {
        if (!parcelFromCell(gx, gy, 52).built) unbuilt++
      }
    }
    const ratio = unbuilt / 1600
    expect(ratio).toBeGreaterThan(0.03)
    expect(ratio).toBeLessThan(0.25)
  })
})

describe('parcelsInBounds', () => {
  it('enumerates parcels covering a small box and respects the limit', () => {
    const sw = offsetGeo(BERLIN, -80, -80)
    const ne = offsetGeo(BERLIN, 80, 80)
    const parcels = parcelsInBounds(sw, ne, BERLIN.lat)
    expect(parcels.length).toBeGreaterThan(1)
    const limited = parcelsInBounds(sw, ne, BERLIN.lat, 3)
    expect(limited.length).toBeLessThanOrEqual(3)
  })

  it('includes the parcel that contains the centre', () => {
    const sw = offsetGeo(BERLIN, -80, -80)
    const ne = offsetGeo(BERLIN, 80, 80)
    const center = parcelAt(BERLIN)
    const parcels = parcelsInBounds(sw, ne, BERLIN.lat)
    expect(parcels.some((p) => p.cell.gx === center.cell.gx && p.cell.gy === center.cell.gy)).toBe(true)
  })

  it('all enumerated parcels lie near the requested box', () => {
    const sw = offsetGeo(BERLIN, -60, -60)
    const ne = offsetGeo(BERLIN, 60, 60)
    const parcels = parcelsInBounds(sw, ne, BERLIN.lat)
    for (const p of parcels) {
      expect(haversineMeters(p.center, BERLIN)).toBeLessThan(400)
    }
  })
})
