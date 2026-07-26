import { describe, it, expect } from 'vitest'
import { OfflineMapProvider, defaultMapProvider, spanForZoom, snapDistanceMeters } from './mapProvider'
import { parcelAt } from './world'

const BERLIN = { lat: 52.52, lng: 13.405 }
const VIEW = { center: BERLIN, zoom: 18 }

describe('spanForZoom', () => {
  it('covers less ground as zoom increases', () => {
    expect(spanForZoom(16)).toBeGreaterThan(spanForZoom(19))
  })
  it('stays within the clamped planning range', () => {
    expect(spanForZoom(1)).toBeLessThanOrEqual(600)
    expect(spanForZoom(30)).toBeGreaterThanOrEqual(40)
  })
})

describe('OfflineMapProvider', () => {
  const provider = new OfflineMapProvider()

  it('is an offline provider', () => {
    expect(provider.online).toBe(false)
    expect(defaultMapProvider.online).toBe(false)
  })

  it('geocodes via the offline gazetteer', async () => {
    const results = await provider.geocode('Hamburg')
    expect(results[0].label).toBe('Hamburg')
  })

  it('captures a deterministic image snapped to the tapped parcel', () => {
    const img1 = provider.capture(BERLIN, VIEW)
    const img2 = provider.capture(BERLIN, VIEW)
    expect(img1.seed).toBe(img2.seed)
    expect(img1.seed).toBe(parcelAt(BERLIN).seed)
    expect(img1.provider).toBe('offline')
    expect(img1.spanMeters).toBeCloseTo(spanForZoom(18), 6)
    expect(img1.metersPerPixel).toBeGreaterThan(0)
  })

  it('snaps the image centre to the parcel centre, near the tap', () => {
    const img = provider.capture(BERLIN, VIEW)
    expect(img.center).toEqual(parcelAt(BERLIN).center)
    expect(snapDistanceMeters(BERLIN, img)).toBeLessThan(60)
  })

  it('reverse-geocodes to a stable parcel label', async () => {
    const label = await provider.reverseGeocode(BERLIN)
    expect(label).toMatch(/Grundstück/)
  })
})
