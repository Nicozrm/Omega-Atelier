import { describe, it, expect, beforeEach } from 'vitest'
import { hasFeature, resolveTier, storePlanInterest, readPlanInterest, PLANS, FEATURE_TIER, DEV_EMAILS, isAdmin, tierLabel, ADMIN_EMAILS } from './entitlements'

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
  it('gives everyone free without a server claim', () => {
    expect(resolveTier(null)).toBe('free')
    expect(resolveTier('someone@example.com')).toBe('free')
    expect(resolveTier('')).toBe('free')
  })

  it('honours the tier the server claims', () => {
    // Der Anspruch kommt aus `public.current_tier()`, das ausschliesslich
    // `subscriptions` liest — eine Tabelle ohne INSERT-Recht für Clients.
    expect(resolveTier('someone@example.com', 'pro')).toBe('pro')
    expect(resolveTier('someone@example.com', 'max')).toBe('max')
  })

  it('treats "no answer yet" as free, never as paid', () => {
    // `null` heisst „der Server hat noch nichts gesagt". Nach oben aufzulösen
    // hiesse, dass ein Netzfehler bezahlte Funktionen verschenkt.
    expect(resolveTier('someone@example.com', null)).toBe('free')
    expect(resolveTier('someone@example.com', undefined)).toBe('free')
  })

  it('gives the product owner max, in any casing', () => {
    expect(resolveTier(DEV_EMAILS[0])).toBe('max')
    expect(resolveTier(DEV_EMAILS[0].toUpperCase())).toBe('max')
  })

  it('cannot be raised by anything the client can write', () => {
    // The whole point. This used to be the subscription: clicking the Max card
    // wrote `max` to localStorage and the app unlocked the Max feature set —
    // and one console line did the same without ever seeing the pricing page.
    for (const forged of ['max', 'pro', 'platinum', '{"tier":"max"}']) {
      localStorage.setItem('omega.tier', forged)
      expect(resolveTier(null)).toBe('free')
      expect(resolveTier('someone@example.com')).toBe('free')
    }
  })

  it('still ignores localStorage once a server claim exists', () => {
    // Der gespeicherte Klick darf den Server-Anspruch weder heben noch senken.
    localStorage.setItem('omega.tier', 'max')
    expect(resolveTier('someone@example.com', 'pro')).toBe('pro')
    localStorage.setItem('omega.tier', 'free')
    expect(resolveTier('someone@example.com', 'max')).toBe('max')
  })

  it('is not lowered for the owner by a stored choice either', () => {
    storePlanInterest('free')
    expect(resolveTier(DEV_EMAILS[0])).toBe('max')
  })

  it('leaves no paid feature reachable without the owner account', () => {
    // The gate as the app actually asks it, not just the tier string.
    const tier = resolveTier('someone@example.com')
    const paid = (Object.keys(FEATURE_TIER) as (keyof typeof FEATURE_TIER)[])
      .filter((f) => FEATURE_TIER[f] !== 'free')
    expect(paid.length).toBeGreaterThan(0)
    for (const f of paid) expect(hasFeature(tier, f)).toBe(false)
  })
})

describe('plan interest', () => {
  it('remembers what was clicked without granting it', () => {
    storePlanInterest('max')
    expect(readPlanInterest()).toBe('max')
    expect(resolveTier('someone@example.com')).toBe('free')
  })

  it('reports nothing when the visitor never chose, or chose nonsense', () => {
    expect(readPlanInterest()).toBeNull()
    localStorage.setItem('omega.tier', 'platinum')
    expect(readPlanInterest()).toBeNull()
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
