import { describe, it, expect } from 'vitest'
import { quote, nextChargeDate, prorationCredit, promoApplies, promoDiscountOn, type PromoCode } from './pricing'
import { unitPrice, volumePercent } from './catalog'

const base = {
  tier: 'pro' as const,
  interval: 'monthly' as const,
  currency: 'EUR' as const,
  seats: 1,
  country: 'DE',
  business: false,
}

describe('quote — Grundrechnung', () => {
  it('rechnet Netto, Steuer und Summe für einen deutschen Verbraucher', () => {
    const q = quote(base)
    expect(q.subtotal).toBe(900)
    expect(q.net).toBe(900)
    expect(q.vat.rate).toBe(19)
    expect(q.vatAmount).toBe(171)
    expect(q.total).toBe(1071)
  })

  it('zieht die Steuer erst nach allen Abzügen — nie davor', () => {
    const promo: PromoCode = { code: 'X', label: 'Test', percentOff: 50 }
    const q = quote({ ...base, promo })
    expect(q.net).toBe(450)
    // 19 % auf 450, nicht auf 900
    expect(q.vatAmount).toBe(86)
    expect(q.total).toBe(536)
  })

  it('addiert die angezeigten Zeilen exakt zur angezeigten Summe', () => {
    const promo: PromoCode = { code: 'X', label: 'Test', percentOff: 15 }
    const q = quote({ ...base, seats: 12, interval: 'yearly', promo, country: 'AT' })
    const sum = q.lines.reduce((acc, l) => acc + l.amount, 0)
    expect(sum).toBe(q.total)
  })
})

describe('quote — Steuerlogik', () => {
  it('nimmt den Satz des Kundenlandes, nicht den des Verkäufers', () => {
    expect(quote({ ...base, country: 'HU' }).vat.rate).toBe(27)
    expect(quote({ ...base, country: 'LU' }).vat.rate).toBe(17)
  })

  it('kehrt die Steuerschuld bei gültiger USt-IdNr. aus einem anderen EU-Land um', () => {
    const q = quote({ ...base, country: 'AT', business: true, vatId: 'ATU12345678' })
    expect(q.vat.reverseCharge).toBe(true)
    expect(q.vatAmount).toBe(0)
    expect(q.total).toBe(q.net)
  })

  it('weist einem inländischen Geschäftskunden die Steuer trotzdem aus', () => {
    const q = quote({ ...base, country: 'DE', business: true, vatId: 'DE123456789' })
    expect(q.vat.reverseCharge).toBe(false)
    expect(q.vatAmount).toBe(171)
  })

  it('ignoriert eine USt-IdNr., deren Land nicht zur Adresse passt', () => {
    const q = quote({ ...base, country: 'NL', business: true, vatId: 'ATU12345678' })
    expect(q.vat.reverseCharge).toBe(false)
    expect(q.vat.rate).toBe(21)
  })

  it('stellt ausserhalb der EU nichts in Rechnung', () => {
    const q = quote({ ...base, country: 'US', currency: 'USD' })
    expect(q.vat.rate).toBe(0)
    expect(q.total).toBe(q.net)
  })
})

describe('quote — Mengen und Intervalle', () => {
  it('staffelt den Mengenrabatt', () => {
    expect(volumePercent(4)).toBe(0)
    expect(volumePercent(5)).toBe(5)
    expect(volumePercent(10)).toBe(10)
    expect(volumePercent(25)).toBe(15)
    expect(volumePercent(50)).toBe(20)
    expect(volumePercent(500)).toBe(20)
  })

  it('rechnet den Mengenrabatt auf die Zwischensumme', () => {
    const q = quote({ ...base, seats: 10 })
    expect(q.subtotal).toBe(9000)
    expect(q.volumeDiscount).toBe(900)
    expect(q.net).toBe(8100)
  })

  it('weist beim Jahresabo die Ersparnis gegenüber zwölf Monatsraten aus', () => {
    const q = quote({ ...base, interval: 'yearly' })
    expect(q.net).toBe(9000)
    expect(q.yearlySavings).toBe(unitPrice('pro', 'monthly', 'EUR') * 12 - 9000)
    expect(q.yearlySavings).toBe(1800)
  })

  it('vergleicht die Jahresersparnis mit demselben Mengenrabatt', () => {
    const q = quote({ ...base, interval: 'yearly', seats: 10 })
    // 10 × 9 € × 12 = 1080 €, minus 10 % = 972 €; Jahrespreis 900 € minus 10 % = 810 €
    expect(q.yearlySavings).toBe(97200 - 81000)
  })

  it('zeigt beim Jahresabo den Monatsdurchschnitt', () => {
    const q = quote({ ...base, interval: 'yearly' })
    expect(q.perMonth).toBe(750)
  })

  it('erzwingt mindestens einen Arbeitsplatz', () => {
    expect(quote({ ...base, seats: 0 }).seats).toBe(1)
    expect(quote({ ...base, seats: -4 }).seats).toBe(1)
    expect(quote({ ...base, seats: 2.7 }).seats).toBe(2)
  })
})

describe('quote — Gutschein, Guthaben, Testphase', () => {
  it('lässt einen Gutschein nur für das passende Intervall gelten', () => {
    const promo: PromoCode = { code: 'Y', label: 'Nur Jahr', percentOff: 20, interval: 'yearly' }
    expect(quote({ ...base, promo }).promoDiscount).toBe(0)
    expect(quote({ ...base, interval: 'yearly', promo }).promoDiscount).toBe(1800)
  })

  it('deckelt einen festen Nachlass auf den Rechnungsbetrag', () => {
    const promo: PromoCode = { code: 'Z', label: 'Gross', amountOff: 999_00, currency: 'EUR' }
    const q = quote({ ...base, promo })
    expect(q.promoDiscount).toBe(900)
    expect(q.net).toBe(0)
    expect(q.total).toBe(0)
  })

  it('verrechnet Guthaben nach dem Gutschein und nie über den Betrag hinaus', () => {
    const q = quote({ ...base, credit: 100_00 })
    expect(q.creditApplied).toBe(900)
    expect(q.net).toBe(0)
  })

  it('setzt bei Testphase den heute fälligen Betrag auf null, nicht die Summe', () => {
    const q = quote({ ...base, trialDays: 14 })
    expect(q.total).toBe(1071)
    expect(q.dueToday).toBe(0)
    expect(q.trialDays).toBe(14)
  })
})

describe('promoApplies / promoDiscountOn', () => {
  it('prüft Tarif, Intervall und Währung', () => {
    const promo: PromoCode = { code: 'A', label: 'Max only', percentOff: 10, tiers: ['max'] }
    expect(promoApplies(promo, { tier: 'pro', interval: 'monthly', currency: 'EUR' })).toBe(false)
    expect(promoApplies(promo, { tier: 'max', interval: 'monthly', currency: 'EUR' })).toBe(true)
  })

  it('rechnet nie unter null', () => {
    expect(promoDiscountOn({ code: 'B', label: '', amountOff: 5000 }, 1000)).toBe(1000)
    expect(promoDiscountOn({ code: 'C', label: '', percentOff: -50 }, 1000)).toBe(0)
  })
})

describe('nextChargeDate', () => {
  it('legt die nächste Abbuchung einen Monat später', () => {
    expect(nextChargeDate(new Date(2026, 0, 15), 'monthly')).toEqual(new Date(2026, 1, 15))
  })

  it('kappt den Monatssprung statt über den Monatsletzten zu rollen', () => {
    // 31.01. + 1 Monat wäre der 03.03. — erwartet ist der 28.02.
    expect(nextChargeDate(new Date(2026, 0, 31), 'monthly')).toEqual(new Date(2026, 1, 28))
  })

  it('legt das Jahresabo ein Jahr weiter', () => {
    expect(nextChargeDate(new Date(2026, 5, 1), 'yearly')).toEqual(new Date(2027, 5, 1))
  })

  it('rechnet während einer Testphase ab dem Testende', () => {
    expect(nextChargeDate(new Date(2026, 0, 1), 'yearly', 14)).toEqual(new Date(2026, 0, 15))
  })
})

describe('prorationCredit', () => {
  it('schreibt nur die verbleibenden Tage gut, abgerundet', () => {
    expect(prorationCredit(1200, 30, 10)).toBe(400)
    expect(prorationCredit(1000, 30, 10)).toBe(333)
  })

  it('bleibt zwischen null und dem gezahlten Betrag', () => {
    expect(prorationCredit(1200, 30, 0)).toBe(0)
    expect(prorationCredit(1200, 30, 99)).toBe(1200)
    expect(prorationCredit(1200, 0, 10)).toBe(0)
  })
})
