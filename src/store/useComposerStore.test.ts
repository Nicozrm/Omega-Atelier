import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useComposerStore, COMPOSER_ZOOM } from './useComposerStore'
import { coercePlan } from '@/lib/planSchema'

const S = () => useComposerStore.getState()
const BERLIN = { lat: 52.52, lng: 13.405 }

beforeEach(() => {
  S().openComposer() // resets to initial + open
})

afterEach(() => {
  S().closeComposer()
})

describe('useComposerStore — location', () => {
  it('opens on step 1 with a clean slate', () => {
    expect(S().open).toBe(true)
    expect(S().step).toBe(1)
    expect(S().result).toBeNull()
    expect(S().status).toBe('idle')
  })

  it('searches the offline gazetteer', async () => {
    S().setQuery('Hamburg')
    await S().search()
    expect(S().results[0].label).toBe('Hamburg')
    expect(S().searching).toBe(false)
  })

  it('clears results for an empty query', async () => {
    S().setQuery('   ')
    await S().search()
    expect(S().results).toEqual([])
  })

  it('chooseResult centres the map and advances to step 2', () => {
    S().chooseResult({ label: 'X', point: BERLIN, source: 'gazetteer', confidence: 0.9 })
    expect(S().view).toEqual({ center: BERLIN, zoom: COMPOSER_ZOOM })
    expect(S().step).toBe(2)
  })
})

describe('useComposerStore — geolocation', () => {
  const original = navigator.geolocation

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { value: original, configurable: true })
  })

  it('records an error when a location cannot be read', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err(new Error('denied')) },
    })
    await S().locateMe()
    expect(S().locationError).toBeTruthy()
    expect(S().locating).toBe(false)
  })

  it('advances to step 2 with a pin on success', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 48.1, longitude: 11.6 } }),
      },
    })
    await S().locateMe()
    expect(S().step).toBe(2)
    expect(S().pin).toEqual({ lat: 48.1, lng: 11.6 })
  })
})

describe('useComposerStore — polygon', () => {
  it('collects and clears drawn polygon points', () => {
    S().toggleDrawPolygon()
    expect(S().drawingPolygon).toBe(true)
    S().addPolygonPoint(BERLIN)
    S().addPolygonPoint({ lat: 52.521, lng: 13.406 })
    expect(S().polygon).toHaveLength(2)
    S().clearPolygon()
    expect(S().polygon).toHaveLength(0)
  })
})

describe('useComposerStore — analysis', () => {
  it('runs the analysis to a finished, editable project', async () => {
    S().setView({ center: BERLIN, zoom: 18 })
    S().setPin(BERLIN)
    await S().startAnalysis({ phaseDelayMs: 0 })
    expect(S().status).toBe('done')
    expect(S().step).toBe(4)
    expect(S().progress?.phase).toBe('project')
    expect(S().completedPhases).toHaveLength(8)
    const project = S().consumeProject()
    expect(project).not.toBeNull()
    expect(coercePlan(project)).not.toBeNull()
  })

  it('errors clearly when no view is chosen', async () => {
    // fresh store without a view
    S().reset()
    await S().startAnalysis({ phaseDelayMs: 0 })
    expect(S().status).toBe('error')
    expect(S().error).toBeTruthy()
  })

  it('can be canceled mid-run', async () => {
    S().setView({ center: BERLIN, zoom: 18 })
    S().setPin(BERLIN)
    const p = S().startAnalysis({ phaseDelayMs: 400 })
    S().cancelAnalysis()
    await p
    expect(S().status).toBe('canceled')
  })

  it('retry re-runs a fresh analysis', async () => {
    S().setView({ center: BERLIN, zoom: 18 })
    S().setPin(BERLIN)
    await S().startAnalysis({ phaseDelayMs: 0 })
    const firstSeed = S().result?.scene.meta.seed
    await S().retryAnalysis({ phaseDelayMs: 0 })
    expect(S().status).toBe('done')
    expect(S().result?.scene.meta.seed).toBe(firstSeed)
  })
})
