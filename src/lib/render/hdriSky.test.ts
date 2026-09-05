import { describe, it, expect } from 'vitest'
import { deriveEnvironment } from '@/lib/environment'
import {
  HDRI_SKIES, selectHdriSky, solarBearing, wrapAngle, hdriRotationY, hdriExposure, hdriUrl,
  type HdriSkyKey,
} from './hdriSky'

const at = (hour: number, weather?: 'clear' | 'cloudy' | 'overcast') =>
  deriveEnvironment({ timeOfDay: hour, weather })

describe('HDRI_SKIES', () => {
  it('measures a definite sun in the clear skies and none in the overcast one', () => {
    // This is what makes alignment meaningful, so it is worth pinning: the
    // clear day and evening maps have a sun, the overcast one does not.
    expect(HDRI_SKIES.day.concentration).toBeGreaterThan(0.9)
    expect(HDRI_SKIES.evening.concentration).toBeGreaterThan(0.9)
    expect(HDRI_SKIES.overcast.concentration).toBeLessThan(0.45)
  })

  it('ranks brightness the way the sky actually behaves', () => {
    const l = (k: HdriSkyKey) => HDRI_SKIES[k].meanLuminance
    expect(l('day')).toBeGreaterThan(l('overcast'))
    expect(l('overcast')).toBeGreaterThan(l('evening'))
    expect(l('evening')).toBeGreaterThan(l('night'))
  })

  it('keeps every measured azimuth a real bearing', () => {
    for (const sky of Object.values(HDRI_SKIES)) {
      expect(Number.isFinite(sky.sunAzimuth)).toBe(true)
      expect(Math.abs(sky.sunAzimuth)).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })
})

describe('selectHdriSky', () => {
  it('follows the day round', () => {
    expect(selectHdriSky(at(12))).toBe('day')
    expect(selectHdriSky(at(1))).toBe('night')
    expect(selectHdriSky(at(23))).toBe('night')
  })

  it('uses the evening sky through twilight, where the sun is low but present', () => {
    // Around sunrise/sunset the analytic model puts the sun a few degrees up;
    // the clear midday map would look wrong there.
    const dusk = selectHdriSky(at(18.5))
    expect(['evening', 'night']).toContain(dusk)
  })

  it('lets weather beat elevation — an overcast noon has no sun to align', () => {
    expect(selectHdriSky(at(12, 'overcast'))).toBe('overcast')
    expect(selectHdriSky(at(12, 'clear'))).toBe('day')
  })

  it('still goes dark at night however cloudy it is', () => {
    expect(selectHdriSky(at(1, 'overcast'))).toBe('night')
  })

  it('always names a sky that exists', () => {
    for (let h = 0; h <= 24; h += 0.25) {
      for (const w of ['clear', 'cloudy', 'overcast'] as const) {
        expect(HDRI_SKIES[selectHdriSky(at(h, w))]).toBeDefined()
      }
    }
  })
})

describe('wrapAngle', () => {
  it('keeps a rotation the short way round', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 9)
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 9)
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 9)
    expect(wrapAngle(Math.PI * 4 + 0.3)).toBeCloseTo(0.3, 9)
  })

  it('never exceeds half a turn', () => {
    for (let a = -20; a <= 20; a += 0.37) {
      expect(Math.abs(wrapAngle(a))).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })
})

describe('hdriRotationY', () => {
  it('lands the captured sun on the computed solar bearing', () => {
    // The property the whole feature rests on: after rotating, the sky's sun
    // and the shadow-casting light must point the same way.
    //
    // The dome is seen from inside, which inverts the mapping — measured in
    // WebGL, applying +90° moves the sun to −90° — so the rotation *subtracts*
    // here. Written the other way round the scene is lit from one side and
    // shadowed from the other.
    for (const hour of [8, 10, 12, 15, 17]) {
      const env = at(hour)
      const sky = HDRI_SKIES[selectHdriSky(env)]
      const landed = wrapAngle(sky.sunAzimuth - hdriRotationY(sky, env))
      expect(landed).toBeCloseTo(wrapAngle(solarBearing(env)), 6)
    }
  })

  it('leaves a diffuse sky alone — there is no sun to align', () => {
    expect(hdriRotationY(HDRI_SKIES.overcast, at(12, 'overcast'))).toBe(0)
  })

  it('turns as the sun moves across the day', () => {
    const morning = hdriRotationY(HDRI_SKIES.day, at(9))
    const afternoon = hdriRotationY(HDRI_SKIES.day, at(16))
    expect(morning).not.toBeCloseTo(afternoon, 2)
  })

  it('returns a finite rotation for every hour and weather', () => {
    for (let h = 0; h <= 24; h += 0.5) {
      for (const w of ['clear', 'cloudy', 'overcast'] as const) {
        const env = at(h, w)
        const r = hdriRotationY(HDRI_SKIES[selectHdriSky(env)], env)
        expect(Number.isFinite(r)).toBe(true)
        expect(Math.abs(r)).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })
})

describe('hdriExposure', () => {
  it('normalises every sky to a common level', () => {
    for (const sky of Object.values(HDRI_SKIES)) {
      const normalised = sky.meanLuminance * hdriExposure(sky)
      expect(normalised).toBeCloseTo(HDRI_SKIES.day.meanLuminance, 6)
    }
  })

  it('is identity for the reference sky', () => {
    expect(hdriExposure(HDRI_SKIES.day)).toBeCloseTo(1, 9)
  })

  it('never returns a scale that would black out or blow up the scene', () => {
    for (const bad of [0, -1, Number.NaN, Infinity]) {
      const sky = { ...HDRI_SKIES.day, meanLuminance: bad }
      expect(hdriExposure(sky)).toBe(1)
    }
    expect(hdriExposure(HDRI_SKIES.day, 0)).toBe(1)
  })
})

describe('hdriUrl', () => {
  it('points at the shipped file', () => {
    expect(hdriUrl(HDRI_SKIES.evening)).toContain('hdri/evening.hdr')
  })
})
