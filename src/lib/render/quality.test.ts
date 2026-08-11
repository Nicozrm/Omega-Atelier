import { describe, it, expect, beforeEach } from 'vitest'
import {
  RENDER_PROFILES,
  RENDER_PROFILE_ORDER,
  UNKNOWN_DEVICE,
  scoreDevice,
  profileForScore,
  activeProfile,
  setRenderProfileChoice,
  renderProfileChoice,
  subscribeRenderProfile,
  __setProfileForTests,
  type DeviceProbe,
} from './quality'

const probe = (p: Partial<DeviceProbe>): DeviceProbe => ({ ...UNKNOWN_DEVICE, webgl2: true, ...p })

describe('scoreDevice', () => {
  it('never promotes a software rasteriser', () => {
    const s = scoreDevice(probe({ renderer: 'angle (google, vulkan swiftshader device)', software: true }))
    expect(profileForScore(s)).toBe('performance')
  })

  it('demotes devices without WebGL2 (no MRT / float targets for SSR + AO)', () => {
    const s = scoreDevice(probe({ webgl2: false, renderer: 'nvidia geforce rtx 4080', maxTextureSize: 16384 }))
    expect(profileForScore(s)).toBe('performance')
  })

  it('places a discrete desktop GPU on ultra', () => {
    const s = scoreDevice(probe({ renderer: 'angle (nvidia, nvidia geforce rtx 4070 direct3d11)', maxTextureSize: 16384, cores: 16, memoryGB: 8 }))
    expect(profileForScore(s)).toBe('ultra')
  })

  it('separates Apple M-series Pro/Max from the base die', () => {
    const pro = scoreDevice(probe({ renderer: 'apple m3 pro', maxTextureSize: 16384, cores: 12 }))
    const base = scoreDevice(probe({ renderer: 'apple m1', maxTextureSize: 16384, cores: 8 }))
    expect(pro).toBeGreaterThan(base)
    expect(profileForScore(pro)).toBe('ultra')
    expect(profileForScore(base)).toBe('high')
  })

  it('puts modern Intel integrated on balanced, legacy integrated below it', () => {
    const xe = profileForScore(scoreDevice(probe({ renderer: 'angle (intel, intel(r) iris(r) xe graphics direct3d11)', maxTextureSize: 16384, cores: 8 })))
    const hd = profileForScore(scoreDevice(probe({ renderer: 'intel(r) hd graphics 520', maxTextureSize: 8192, cores: 4 })))
    expect(xe).toBe('balanced')
    expect(hd).toBe('performance')
  })

  it('applies a thermal penalty to phones so they never land on ultra', () => {
    const phone = scoreDevice(probe({ renderer: 'apple gpu', mobile: true, dpr: 3, maxTextureSize: 16384 }))
    expect(profileForScore(phone)).not.toBe('ultra')
    expect(profileForScore(phone)).not.toBe('high')
  })

  it('a hi-dpi panel scores below the same GPU on a 1× panel', () => {
    const base = { renderer: 'apple m2 max', maxTextureSize: 16384, cores: 12 }
    expect(scoreDevice(probe({ ...base, dpr: 1 }))).toBeGreaterThan(scoreDevice(probe({ ...base, dpr: 2 })))
  })

  it('falls back to structural signals when the renderer string is masked', () => {
    const strong = scoreDevice(probe({ renderer: '', maxTextureSize: 16384, cores: 16, memoryGB: 8 }))
    const weak = scoreDevice(probe({ renderer: '', maxTextureSize: 4096, cores: 2, memoryGB: 2 }))
    expect(strong).toBeGreaterThan(weak)
    expect(profileForScore(weak)).toBe('performance')
  })

  it('keeps every score inside 0…100', () => {
    const cases: DeviceProbe[] = [
      probe({ renderer: 'nvidia geforce rtx 4090', maxTextureSize: 32768, cores: 64, memoryGB: 64 }),
      probe({ renderer: '', maxTextureSize: 1024, cores: 1, memoryGB: 0.5 }),
      probe({ software: true }),
    ]
    for (const c of cases) {
      const s = scoreDevice(c)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
  })

  it('an unmeasurable device scores into the safe floor', () => {
    expect(profileForScore(scoreDevice(UNKNOWN_DEVICE))).toBe('performance')
  })
})

describe('profileForScore', () => {
  it('is monotonic across the whole range', () => {
    const rank = (id: string) => RENDER_PROFILE_ORDER.indexOf(id as never)
    let last = -1
    for (let s = 0; s <= 100; s++) {
      const r = rank(profileForScore(s))
      expect(r).toBeGreaterThanOrEqual(last)
      last = r
    }
  })
})

describe('RENDER_PROFILES', () => {
  it('orders cost monotonically from performance to ultra', () => {
    const ids = RENDER_PROFILE_ORDER
    for (let i = 1; i < ids.length; i++) {
      const lo = RENDER_PROFILES[ids[i - 1]]
      const hi = RENDER_PROFILES[ids[i]]
      expect(hi.dprStill).toBeGreaterThanOrEqual(lo.dprStill)
      expect(hi.shadowMapSize).toBeGreaterThanOrEqual(lo.shadowMapSize)
      expect(hi.iblSize).toBeGreaterThanOrEqual(lo.iblSize)
      expect(hi.maxDynamicLights).toBeGreaterThanOrEqual(lo.maxDynamicLights)
      expect(hi.anisotropy).toBeGreaterThanOrEqual(lo.anisotropy)
    }
  })

  it('always renders motion cheaper than a settled frame', () => {
    for (const p of Object.values(RENDER_PROFILES)) {
      expect(p.dprMotion).toBeLessThanOrEqual(p.dprStill)
      expect(p.dprMotion).toBeGreaterThan(0)
    }
  })

  it('gates the two most expensive passes to the top profiles only', () => {
    expect(RENDER_PROFILES.ultra.ssr).toBe(true)
    expect(RENDER_PROFILES.high.ssr).toBe(false)
    expect(RENDER_PROFILES.balanced.transmission).toBe(false)
    expect(RENDER_PROFILES.performance.ao).toBe('off')
  })

  it('every profile carries its own id and a label', () => {
    for (const [id, p] of Object.entries(RENDER_PROFILES)) {
      expect(p.id).toBe(id)
      expect(p.label.length).toBeGreaterThan(0)
      expect(p.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('profile store', () => {
  beforeEach(() => {
    __setProfileForTests('auto', probe({ renderer: 'apple m1', maxTextureSize: 16384, cores: 8 }))
  })

  it('auto resolves through the probe', () => {
    expect(renderProfileChoice()).toBe('auto')
    expect(activeProfile().id).toBe('high')
  })

  it('an explicit choice overrides the probe', () => {
    setRenderProfileChoice('performance')
    expect(activeProfile().id).toBe('performance')
    setRenderProfileChoice('auto')
    expect(activeProfile().id).toBe('high')
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0
    const off = subscribeRenderProfile(() => { calls++ })
    setRenderProfileChoice('ultra')
    expect(calls).toBe(1)
    setRenderProfileChoice('ultra') // same value → no-op
    expect(calls).toBe(1)
    off()
    setRenderProfileChoice('balanced')
    expect(calls).toBe(1)
  })
})
