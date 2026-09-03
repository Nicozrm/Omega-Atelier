import { describe, it, expect } from 'vitest'
import { deriveEnvironment } from '@/lib/environment'
import {
  ADAPTATION, MIN_EXPOSURE, MAX_EXPOSURE, referenceLuminance,
  adaptExposure, displayedLuminance, exposureFor, exposureForLuminance, sceneKeyLuminance,
} from './exposure'

const at = (hour: number, weather: 'clear' | 'cloudy' | 'overcast' = 'clear') =>
  deriveEnvironment({ timeOfDay: hour, weather })

describe('scene key luminance', () => {
  it('rises from night to noon', () => {
    const night = sceneKeyLuminance(at(1))
    const dawn = sceneKeyLuminance(at(7))
    const noon = sceneKeyLuminance(at(13))
    expect(night).toBeLessThan(dawn)
    expect(dawn).toBeLessThan(noon)
  })

  it('is lower indoors during the day — a wall sees the sun through glazing', () => {
    expect(sceneKeyLuminance(at(13), { walkMode: true }))
      .toBeLessThan(sceneKeyLuminance(at(13)))
  })

  it('is higher indoors at night — the fixtures are the light source', () => {
    expect(sceneKeyLuminance(at(1), { walkMode: true }))
      .toBeGreaterThan(sceneKeyLuminance(at(1)))
  })

  it('never reaches zero, so the exposure ratio stays meaningful', () => {
    for (let h = 0; h < 24; h += 0.5) {
      expect(sceneKeyLuminance(at(h))).toBeGreaterThan(0)
      expect(sceneKeyLuminance(at(h), { walkMode: true })).toBeGreaterThan(0)
    }
  })

  it('drops under cloud cover', () => {
    expect(sceneKeyLuminance(at(13, 'overcast'))).toBeLessThan(sceneKeyLuminance(at(13, 'clear')))
  })
})

describe('exposure', () => {
  it('opens up for a dark scene and stops down for a bright one', () => {
    expect(exposureForLuminance(referenceLuminance() * 0.1)).toBeGreaterThan(1)
    expect(exposureForLuminance(referenceLuminance() * 4)).toBeLessThan(1)
  })

  it('leaves a clear midday exterior exactly as it was', () => {
    // The condition every material and the tone curve were authored under.
    // Adding exposure control must not restyle it.
    expect(exposureFor(at(12))).toBeCloseTo(1, 5)
    expect(exposureForLuminance(referenceLuminance())).toBeCloseTo(1, 5)
  })

  it('never engages a clamp anywhere in the model\'s own range', () => {
    // A clamp that fires in normal use would flatten the day cycle at that end.
    for (const weather of ['clear', 'cloudy', 'overcast'] as const) {
      for (let h = 0; h < 24; h += 0.25) {
        for (const walkMode of [false, true]) {
          const e = exposureFor(at(h, weather), { walkMode })
          expect(e).toBeGreaterThan(MIN_EXPOSURE)
          expect(e).toBeLessThan(MAX_EXPOSURE)
        }
      }
    }
  })

  it('lifts a lamp-lit night by roughly a stop, not by four', () => {
    const night = exposureFor(at(1), { walkMode: true })
    expect(night).toBeGreaterThan(1.2)
    expect(night).toBeLessThan(1.8)
  })

  it('stays inside its clamps for every hour, weather and viewpoint', () => {
    for (const weather of ['clear', 'cloudy', 'overcast'] as const) {
      for (let h = 0; h < 24; h += 0.25) {
        for (const walkMode of [false, true]) {
          const e = exposureFor(at(h, weather), { walkMode })
          expect(e).toBeGreaterThanOrEqual(MIN_EXPOSURE)
          expect(e).toBeLessThanOrEqual(MAX_EXPOSURE)
        }
      }
    }
  })

  /**
   * The property the whole design rests on: adaptation is partial, so the
   * displayed image must still get brighter as the world does. Full
   * normalisation would make midnight and noon identical.
   */
  it('never renders a darker scene brighter than a lighter one', () => {
    let previous = -Infinity
    for (let l = 0.05; l <= 20; l *= 1.05) {
      const shown = displayedLuminance(l)
      expect(shown).toBeGreaterThan(previous)
      previous = shown
    }
  })

  it('keeps night visibly darker than day after adaptation', () => {
    const night = at(1)
    const noon = at(13)
    const shownNight = sceneKeyLuminance(night) * exposureFor(night)
    const shownNoon = sceneKeyLuminance(noon) * exposureFor(noon)
    expect(shownNight).toBeLessThan(shownNoon)
    // …but the gap is compressed rather than left at the raw ratio, which is
    // what keeps both ends off the tone curve's shoulder and toe.
    const raw = sceneKeyLuminance(noon) / sceneKeyLuminance(night)
    expect(shownNoon / shownNight).toBeLessThan(raw)
  })

  it('compresses by exactly the adaptation exponent', () => {
    // displayed = L^(1−a) · Lref^a — the algebra the doc comment claims.
    const l = 1.2 // inside the unclamped band
    expect(displayedLuminance(l)).toBeCloseTo(
      Math.pow(l, 1 - ADAPTATION) * Math.pow(referenceLuminance(), ADAPTATION), 6,
    )
  })

  it('moves continuously across the day — no step at a phase border', () => {
    /*
     * Three simulated minutes per step. The measured peak is 0.032, at sunset
     * on a clear exterior, and it is the environment model's own light ramp
     * rather than a discontinuity of ours: reading the sun's intensity without
     * `horizonRamp` put 0.089 here as it stepped off zero at dawn — visible as
     * a flicker while dragging the time slider. What remains is additionally
     * smoothed by `adaptExposure` at runtime.
     */
    for (const weather of ['clear', 'cloudy', 'overcast'] as const) {
      for (const walkMode of [false, true]) {
        let previous = exposureFor(at(0, weather), { walkMode })
        for (let h = 0.05; h <= 24; h += 0.05) {
          const next = exposureFor(at(h, weather), { walkMode })
          expect(Math.abs(next - previous)).toBeLessThan(0.04)
          previous = next
        }
      }
    }
  })

  it('survives a nonsense luminance instead of producing NaN', () => {
    expect(exposureForLuminance(0)).toBeLessThanOrEqual(MAX_EXPOSURE)
    expect(exposureForLuminance(-5)).toBeLessThanOrEqual(MAX_EXPOSURE)
    expect(Number.isFinite(exposureForLuminance(Number.NaN))).toBe(true)
  })
})

describe('adaptation over time', () => {
  it('approaches the target without overshooting', () => {
    let e = 1
    for (let i = 0; i < 200; i++) e = adaptExposure(e, 2, 1 / 60)
    expect(e).toBeGreaterThan(1.9)
    expect(e).toBeLessThanOrEqual(2)
  })

  it('stops down faster than it opens up, like every real auto-exposure', () => {
    // Compared as a fraction of the gap each closes in the same 100 ms.
    const openingUp = (adaptExposure(1, 2, 0.1) - 1) / (2 - 1)
    const stoppingDown = (1 - adaptExposure(1, 0, 0.1)) / (1 - 0)
    expect(stoppingDown).toBeGreaterThan(openingUp)
  })

  it('is frame-rate independent', () => {
    let fast = 1
    for (let i = 0; i < 120; i++) fast = adaptExposure(fast, 2, 1 / 120)
    let slow = 1
    for (let i = 0; i < 30; i++) slow = adaptExposure(slow, 2, 1 / 30)
    expect(Math.abs(fast - slow)).toBeLessThan(0.02)
  })

  it('snaps to the target from an uninitialised exposure', () => {
    expect(adaptExposure(0, 1.4, 1 / 60)).toBe(1.4)
    expect(adaptExposure(Number.NaN, 1.4, 1 / 60)).toBe(1.4)
  })

  it('ignores a zero or negative frame time', () => {
    expect(adaptExposure(1.2, 2, 0)).toBe(1.2)
    expect(adaptExposure(1.2, 2, -1)).toBe(1.2)
  })

  it('clamps a stalled frame so a backgrounded tab does not cut', () => {
    // A 5-second delta must not jump straight to the target.
    expect(adaptExposure(1, 2.5, 5)).toBeLessThan(2.5)
  })
})
