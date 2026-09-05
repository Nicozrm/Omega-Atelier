import { describe, it, expect } from 'vitest'
import {
  PAYMENT_METHODS, availableMethods, findMethod, groupedMethods, methodVerdict,
  offeredMethods, suggestMethod, type MethodContext,
} from './methods'

const ctx = (over: Partial<MethodContext> = {}): MethodContext => ({
  country: 'DE',
  currency: 'EUR',
  amount: 10_71,
  recurring: true,
  business: false,
  capabilities: { applePay: false, googlePay: false },
  ...over,
})

describe('Katalog', () => {
  it('hat eindeutige IDs', () => {
    const ids = PAYMENT_METHODS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gibt jeder Methode einen Satz, der erklärt, was passiert', () => {
    for (const m of PAYMENT_METHODS) {
      expect(m.blurb.length, m.id).toBeGreaterThan(20)
      expect(m.currencies.length, m.id).toBeGreaterThan(0)
    }
  })

  it('verlangt für jedes Zusatzformular eine passende Methode', () => {
    for (const m of PAYMENT_METHODS) {
      if (m.form === 'card') expect(m.recurring, m.id).toBe(true)
      if (m.businessOnly) expect(m.form, m.id).toBe('invoice')
    }
  })
})

describe('methodVerdict', () => {
  it('blendet Wallets ohne Gerätefähigkeit ganz aus', () => {
    const apple = findMethod('apple-pay')!
    const v = methodVerdict(apple, ctx())
    expect(v.available).toBe(false)
    expect(v.available === false && v.hide).toBe(true)
  })

  it('zeigt Apple Pay, sobald das Gerät es kann', () => {
    const apple = findMethod('apple-pay')!
    expect(methodVerdict(apple, ctx({ capabilities: { applePay: true, googlePay: false } })).available).toBe(true)
  })

  it('blendet landesgebundene Verfahren ausserhalb ihres Landes aus', () => {
    const ideal = findMethod('ideal')!
    const de = methodVerdict(ideal, ctx({ recurring: false }))
    expect(de.available).toBe(false)
    expect(de.available === false && de.hide).toBe(true)
    expect(methodVerdict(ideal, ctx({ country: 'NL', recurring: false })).available).toBe(true)
  })

  it('sperrt einmalige Verfahren im Monatsabo — sichtbar und begründet', () => {
    const ideal = findMethod('ideal')!
    const v = methodVerdict(ideal, ctx({ country: 'NL', recurring: true }))
    expect(v.available).toBe(false)
    expect(v.available === false && v.hide).toBeFalsy()
    expect(v.available === false && v.reason).toMatch(/Jahresabo/)
  })

  it('gibt dieselbe Methode im Jahresabo frei', () => {
    const ideal = findMethod('ideal')!
    expect(methodVerdict(ideal, ctx({ country: 'NL', recurring: false })).available).toBe(true)
  })

  it('hält Rechnung Geschäftskunden vor — sichtbar, damit man weiss, wie', () => {
    const invoice = findMethod('invoice')!
    const v = methodVerdict(invoice, ctx({ recurring: false, amount: 900_00 }))
    expect(v.available).toBe(false)
    expect(v.available === false && v.reason).toMatch(/Firmenname/)
    expect(methodVerdict(invoice, ctx({ recurring: false, business: true, amount: 900_00 })).available).toBe(true)
  })

  it('achtet auf Mindest- und Höchstbeträge', () => {
    const invoice = findMethod('invoice')!
    const tooSmall = methodVerdict(invoice, ctx({ recurring: false, business: true, amount: 1000 }))
    expect(tooSmall.available).toBe(false)
    expect(tooSmall.available === false && tooSmall.reason).toMatch(/Bestellwert/)

    const klarna = findMethod('klarna')!
    const tooBig = methodVerdict(klarna, ctx({ recurring: false, amount: 200_000 }))
    expect(tooBig.available).toBe(false)
  })

  it('blendet Methoden aus, die die Währung nicht können', () => {
    const twint = findMethod('twint')!
    const v = methodVerdict(twint, ctx({ country: 'CH', currency: 'EUR', recurring: false }))
    expect(v.available).toBe(false)
    expect(v.available === false && v.hide).toBe(true)
  })
})

describe('Angebot und Reihenfolge', () => {
  it('bietet einem deutschen Monatsabo die abbuchungsfähigen Verfahren', () => {
    const ids = availableMethods(ctx()).map((m) => m.id)
    expect(ids).toContain('card')
    expect(ids).toContain('sepa-debit')
    expect(ids).toContain('paypal')
    expect(ids).not.toContain('ideal')
    expect(ids).not.toContain('crypto')
  })

  it('öffnet das Jahresabo für einmalige Verfahren', () => {
    const ids = availableMethods(ctx({ recurring: false, amount: 107_10 })).map((m) => m.id)
    expect(ids).toContain('klarna')
    expect(ids).toContain('crypto')
    expect(ids).toContain('bank-transfer')
  })

  it('sortiert verfügbare Methoden vor gesperrte', () => {
    const offers = offeredMethods(ctx())
    const firstBlocked = offers.findIndex((o) => !o.verdict.available)
    if (firstBlocked >= 0) {
      expect(offers.slice(firstBlocked).every((o) => !o.verdict.available)).toBe(true)
    }
  })

  it('schlägt zuerst eine Wallet vor, sonst die Karte', () => {
    expect(suggestMethod(ctx())?.id).toBe('paypal')
    expect(suggestMethod(ctx({ capabilities: { applePay: true, googlePay: false } }))?.id).toBe('apple-pay')
  })

  it('gruppiert und lässt leere Gruppen weg', () => {
    const groups = groupedMethods(ctx())
    expect(groups.length).toBeGreaterThan(2)
    expect(groups.every((g) => g.offers.length > 0)).toBe(true)
    expect(groups[0].group).toBe('wallet')
  })

  it('findet für die Schweiz TWINT im Jahresabo', () => {
    const ids = availableMethods(ctx({ country: 'CH', currency: 'CHF', recurring: false, amount: 95_00 })).map((m) => m.id)
    expect(ids).toContain('twint')
    expect(ids).not.toContain('ideal')
  })
})
