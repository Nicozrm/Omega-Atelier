import { describe, it, expect } from 'vitest'
import {
  CHECKOUT_STEPS, canJumpTo, emptyForm, firstIncompleteStep, isStepComplete,
  needsRecurring, nextStep, prevStep, progressPercent, trialAvailable, validateStep,
  type CheckoutForm,
} from './checkout'
import { findMethod } from './methods'
import { buildIntent } from './session'
import { quote } from './pricing'

const NOW = new Date(2026, 5, 1)

/** Ein Formular, das bis einschliesslich Adresse ausgefüllt ist. */
function filled(over: Partial<CheckoutForm> = {}): CheckoutForm {
  return emptyForm({
    tier: 'pro',
    interval: 'yearly',
    email: 'nico@example.de',
    fullName: 'Nico Zimmermann',
    street: 'Musterweg 12',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    ...over,
  })
}

describe('Schritt „Tarif"', () => {
  it('lässt Free nicht durch die Kasse', () => {
    expect(validateStep('plan', filled({ tier: 'free' }), NOW).tier).toBeTruthy()
  })

  it('begrenzt die Selbstbedienung nach oben', () => {
    expect(validateStep('plan', filled({ seats: 250 }), NOW).seats).toBeUndefined()
    expect(validateStep('plan', filled({ seats: 251 }), NOW).seats).toMatch(/Vertrieb/)
  })
})

describe('Schritt „Kontakt"', () => {
  it('ist mit vollständiger Adresse fertig', () => {
    expect(isStepComplete('account', filled(), NOW)).toBe(true)
  })

  it('benennt jedes fehlende Feld einzeln', () => {
    const errors = validateStep('account', emptyForm(), NOW)
    expect(Object.keys(errors).sort()).toEqual(['city', 'email', 'fullName', 'postalCode', 'street'])
  })

  it('prüft die Postleitzahl gegen das gewählte Land', () => {
    expect(validateStep('account', filled({ country: 'NL', postalCode: '10115' }), NOW).postalCode).toBeTruthy()
    expect(validateStep('account', filled({ country: 'NL', postalCode: '1012 AB' }), NOW).postalCode).toBeUndefined()
  })

  it('verlangt einen Firmennamen, sobald es geschäftlich wird', () => {
    expect(validateStep('account', filled({ business: true }), NOW).company).toBeTruthy()
  })

  it('lässt die USt-IdNr. weg — aber nicht falsch', () => {
    const ok = filled({ business: true, company: 'Omega GmbH' })
    expect(validateStep('account', ok, NOW).vatId).toBeUndefined()
    expect(validateStep('account', { ...ok, vatId: 'DE12' }, NOW).vatId).toBeTruthy()
  })

  it('meldet eine USt-IdNr., die nicht zum Adressland passt', () => {
    const form = filled({ business: true, company: 'Omega GmbH', country: 'AT', postalCode: '1010', vatId: 'DE123456789' })
    expect(validateStep('account', form, NOW).vatId).toMatch(/gehört zu DE/)
  })
})

describe('Schritt „Zahlung"', () => {
  it('verlangt eine Auswahl', () => {
    expect(validateStep('payment', filled(), NOW).methodId).toBeTruthy()
  })

  it('braucht bei Redirect-Verfahren kein weiteres Feld', () => {
    expect(isStepComplete('payment', filled({ methodId: 'paypal' }), NOW)).toBe(true)
  })

  it('prüft die Kartenfelder einzeln', () => {
    const form = filled({
      methodId: 'card',
      card: { number: '4242 4242 4242 4242', expiry: '06/28', cvc: '123', holder: 'Nico Zimmermann' },
    })
    expect(isStepComplete('payment', form, NOW)).toBe(true)

    const bad = { ...form, card: { ...form.card, number: '4242 4242 4242 4243' } }
    expect(validateStep('payment', bad, NOW)['card.number']).toBeTruthy()
    expect(validateStep('payment', bad, NOW)['card.cvc']).toBeUndefined()
  })

  it('verlangt für SEPA IBAN, Inhaber und Mandat', () => {
    const form = filled({
      methodId: 'sepa-debit',
      sepa: { iban: 'DE89 3704 0044 0532 0130 00', holder: 'Nico Zimmermann', mandate: false },
    })
    expect(validateStep('payment', form, NOW)['sepa.mandate']).toBeTruthy()
    expect(isStepComplete('payment', { ...form, sepa: { ...form.sepa, mandate: true } }, NOW)).toBe(true)
  })
})

describe('Schritt „Prüfen"', () => {
  it('verlangt AGB und die Zustimmung zur sofortigen Ausführung', () => {
    const form = filled({ methodId: 'paypal' })
    const errors = validateStep('review', form, NOW)
    expect(errors.acceptTerms).toBeTruthy()
    expect(errors.acceptImmediateStart).toBeTruthy()
    expect(isStepComplete('review', { ...form, acceptTerms: true, acceptImmediateStart: true }, NOW)).toBe(true)
  })
})

describe('Navigation', () => {
  it('zeigt auf den ersten unfertigen Schritt', () => {
    expect(firstIncompleteStep(emptyForm(), NOW)).toBe('account')
    expect(firstIncompleteStep(filled(), NOW)).toBe('payment')
  })

  it('erlaubt zurück immer, vorwärts nur bei fertigen Schritten', () => {
    const form = filled()
    expect(canJumpTo('plan', 'payment', form, NOW)).toBe(true)
    expect(canJumpTo('payment', 'account', form, NOW)).toBe(true)
    expect(canJumpTo('review', 'account', form, NOW)).toBe(false)
  })

  it('kennt Anfang und Ende', () => {
    expect(prevStep('plan')).toBeNull()
    expect(nextStep('review')).toBeNull()
    expect(nextStep('plan')).toBe('account')
    expect(progressPercent(CHECKOUT_STEPS[0])).toBe(0)
    expect(progressPercent('review')).toBe(100)
  })

  it('braucht nur beim Monatsabo eine wiederkehrende Abbuchung', () => {
    expect(needsRecurring({ interval: 'monthly' })).toBe(true)
    expect(needsRecurring({ interval: 'yearly' })).toBe(false)
  })

  it('bietet eine Testphase nur bei abbuchungsfähigen Verfahren', () => {
    expect(trialAvailable(findMethod('card'))).toBe(true)
    expect(trialAvailable(findMethod('bank-transfer'))).toBe(false)
    expect(trialAvailable(null)).toBe(false)
  })
})

describe('buildIntent — die Kartennummer verlässt den Browser nicht', () => {
  const PAN = '4242424242424242'
  const form = filled({
    methodId: 'card',
    card: { number: '4242 4242 4242 4242', expiry: '06/28', cvc: '123', holder: 'Nico Zimmermann' },
    acceptTerms: true,
    acceptImmediateStart: true,
  })
  const priced = quote({
    tier: 'pro', interval: 'yearly', currency: 'EUR', seats: 1, country: 'DE', business: false,
  })
  const intent = buildIntent(form, priced, { returnUrl: 'https://x/ok', cancelUrl: 'https://x/back' })
  const payload = JSON.stringify(intent)

  it('enthält weder PAN noch Prüfcode', () => {
    expect(payload).not.toContain(PAN)
    expect(payload).not.toContain('4242 4242')
    expect(intent.card).toBeDefined()
    expect(JSON.stringify(intent.card)).not.toContain('123')
  })

  it('nimmt genau Marke, letzte vier Stellen und Ablauf mit', () => {
    expect(intent.card).toEqual({ brand: 'visa', last4: '4242', expMonth: 6, expYear: 2028 })
  })

  it('schickt die erwarteten Summen zum Abgleich mit', () => {
    expect(intent.expected.total).toBe(priced.total)
    expect(intent.expected.vatRate).toBe(19)
  })

  it('normalisiert E-Mail, Land und USt-IdNr.', () => {
    const biz = buildIntent(
      filled({
        methodId: 'paypal', business: true, company: 'Omega GmbH', vatId: 'de 123.456.789',
        email: '  Nico@Example.DE ', country: 'de',
      }),
      priced,
      { returnUrl: 'https://x/ok', cancelUrl: 'https://x/back' },
    )
    expect(biz.customer.email).toBe('nico@example.de')
    expect(biz.customer.vatId).toBe('DE123456789')
    expect(biz.address.country).toBe('DE')
  })

  it('nimmt die IBAN mit — das SEPA-Mandat liegt beim Händler', () => {
    const sepa = buildIntent(
      filled({
        methodId: 'sepa-debit',
        sepa: { iban: 'DE89 3704 0044 0532 0130 00', holder: 'Nico Zimmermann', mandate: true },
      }),
      priced,
      { returnUrl: 'https://x/ok', cancelUrl: 'https://x/back' },
    )
    expect(sepa.sepa?.iban).toBe('DE89370400440532013000')
    expect(sepa.card).toBeUndefined()
  })

  it('vergibt für jede Bestellung einen eigenen Idempotenzschlüssel', () => {
    const a = buildIntent(form, priced, { returnUrl: 'x', cancelUrl: 'y' })
    const b = buildIntent(form, priced, { returnUrl: 'x', cancelUrl: 'y' })
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
  })
})
