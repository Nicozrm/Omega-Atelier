import { describe, it, expect, beforeEach } from 'vitest'
import { hasFeature, resolveTier, storeTier, PLANS, FEATURE_TIER, DEV_EMAILS, isAdmin, tierLabel, ADMIN_EMAILS } from './entitlements'

beforeEach(() => localStorage.clear())

describe('hasFeature', () => {
  it('free unlocks the basics but not the pro/max features', () => {
    expect(hasFeature('free', 'editor-2d')).toBe(true)
    expect(hasFeature('free', 'view-3d')).toBe(true)
    expect(hasFeature('free', 'living-home')).toBe(false)
    expect(hasFeature('free', 'live-connectors')).toBe(false)
  })
  it('pro unlocks pro but not max', () => {
    expect(hasFeature('pro', 'soundscape')).toBe(true)
    expect(hasFeature('pro', 'radio-mesh')).toBe(true)
    expect(hasFeature('pro', 'image-blaster')).toBe(false)
  })
  it('max unlocks everything', () => {
    for (const f of Object.keys(FEATURE_TIER) as (keyof typeof FEATURE_TIER)[]) {
      expect(hasFeature('max', f)).toBe(true)
    }
  })
})

describe('resolveTier', () => {
  it('defaults to free', () => {
    expect(resolveTier(null)).toBe('free')
  })
  it('reads a stored choice', () => {
    storeTier('pro')
    expect(resolveTier(null)).toBe('pro')
  })
  it('developers always resolve to max, regardless of the stored plan', () => {
    storeTier('free')
    expect(resolveTier(DEV_EMAILS[0])).toBe('max')
    expect(resolveTier(DEV_EMAILS[0].toUpperCase())).toBe('max')
  })
  it('ignores garbage in storage', () => {
    localStorage.setItem('omega.tier', 'platinum')
    expect(resolveTier(null)).toBe('free')
  })
})

describe('PLANS', () => {
  it('ships exactly free, pro and max — ordered by price', () => {
    expect(PLANS.map((p) => p.tier)).toEqual(['free', 'pro', 'max'])
    expect(PLANS[0].price).toBe(0)
    expect(PLANS[1].price).toBeLessThan(PLANS[2].price)
  })
})

describe('isAdmin', () => {
  it('recognises admin accounts case-insensitively', () => {
    expect(isAdmin(ADMIN_EMAILS[0])).toBe(true)
    expect(isAdmin(ADMIN_EMAILS[0].toUpperCase())).toBe(true)
  })
  it('is false for everyone else and for missing emails', () => {
    expect(isAdmin('someone@example.com')).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })
})

describe('tierLabel', () => {
  it('maps each tier to its plan name', () => {
    expect(tierLabel('free')).toBe('Free')
    expect(tierLabel('pro')).toBe('Pro')
    expect(tierLabel('max')).toBe('Max')
  })
})
