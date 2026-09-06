import { describe, it, expect } from 'vitest'
import {
  detectCardBrand, formatCardNumber, formatExpiry, formatIban, isEmail, luhn, maskIban,
  validateCardNumber, validateCvc, validateExpiry, validateIban, validatePostalCode,
} from './validation'
import { validateVatId, resolveVat, isEuCountry } from './vat'

describe('isEmail', () => {
  it('nimmt gängige Adressen an', () => {
    for (const ok of ['a@b.de', 'nico.z@omega-atelier.io', 'x+tag@sub.example.co.uk']) {
      expect(isEmail(ok), ok).toBe(true)
    }
  })

  it('weist ab, woran ein Tippfehler wirklich scheitert', () => {
    for (const bad of ['', 'a@b', 'a b@c.de', '@b.de', 'a@.de', 'a@b.', 'zwei@@b.de']) {
      expect(isEmail(bad), bad).toBe(false)
    }
  })
})

describe('Karte', () => {
  it('erkennt die Marke an den ersten Ziffern', () => {
    expect(detectCardBrand('4111').brand).toBe('visa')
    expect(detectCardBrand('5555').brand).toBe('mastercard')
    expect(detectCardBrand('2221').brand).toBe('mastercard')
    expect(detectCardBrand('378282').brand).toBe('amex')
    expect(detectCardBrand('9999').brand).toBe('unknown')
  })

  it('prüft die Luhn-Ziffer', () => {
    expect(luhn('4242424242424242')).toBe(true)
    expect(luhn('4242424242424243')).toBe(false)
    expect(luhn('378282246310005')).toBe(true)
  })

  it('gruppiert nach Marke — Amex 4-6-5', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
  })

  it('begründet, warum eine Nummer nicht stimmt', () => {
    expect(validateCardNumber('4242 4242 4242 4242').valid).toBe(true)
    expect(validateCardNumber('4242 4242 4242 4243').reason).toMatch(/Prüfziffer/)
    expect(validateCardNumber('4242 4242').reason).toMatch(/Stellen/)
  })

  it('verlangt bei American Express vier Stellen Prüfcode', () => {
    const amex = detectCardBrand('378282246310005')
    expect(validateCvc('123', amex).valid).toBe(false)
    expect(validateCvc('1234', amex).valid).toBe(true)
    const visa = detectCardBrand('4242424242424242')
    expect(validateCvc('123', visa).valid).toBe(true)
  })

  it('lässt die Karte bis zum Ende ihres Ablaufmonats gelten', () => {
    const now = new Date(2026, 5, 20) // 20. Juni 2026
    expect(validateExpiry('06/26', now).valid).toBe(true)
    expect(validateExpiry('05/26', now).valid).toBe(false)
    expect(validateExpiry('07/26', now).valid).toBe(true)
  })

  it('weist unmögliche Datumsangaben ab', () => {
    const now = new Date(2026, 0, 1)
    expect(validateExpiry('13/28', now).valid).toBe(false)
    expect(validateExpiry('00/28', now).valid).toBe(false)
    expect(validateExpiry('06/99', now).valid).toBe(false)
    expect(validateExpiry('', now).valid).toBe(false)
  })

  it('nimmt ein eingefügtes Datum ohne Schrägstrich an', () => {
    // Aus der Zwischenablage kommt „0628" — das ist kein Fehler des Kunden.
    expect(validateExpiry('0628', new Date(2026, 0, 1)).valid).toBe(true)
  })

  it('formt das Ablaufdatum beim Tippen', () => {
    expect(formatExpiry('0')).toBe('0')
    expect(formatExpiry('06')).toBe('06')
    expect(formatExpiry('0628')).toBe('06/28')
    expect(formatExpiry('06/2812')).toBe('06/28')
  })
})

describe('IBAN', () => {
  it('nimmt gültige IBANs an', () => {
    for (const ok of ['DE89370400440532013000', 'AT611904300234573201', 'CH9300762011623852957', 'NL91ABNA0417164300']) {
      expect(validateIban(ok).valid, ok).toBe(true)
    }
  })

  it('fängt eine vertauschte Ziffer über die Prüfsumme', () => {
    const check = validateIban('DE89370400440532013001')
    expect(check.valid).toBe(false)
    expect(check.reason).toMatch(/Prüfziffer/)
  })

  it('prüft die Länge des Landes', () => {
    const check = validateIban('DE8937040044053201')
    expect(check.valid).toBe(false)
    expect(check.reason).toMatch(/22 Stellen/)
  })

  it('weist Nicht-SEPA-Länder ab', () => {
    expect(validateIban('US89370400440532013000').reason).toMatch(/kein SEPA-Land/)
  })

  it('ignoriert Leerzeichen und Kleinschreibung', () => {
    expect(validateIban('de89 3704 0044 0532 0130 00').valid).toBe(true)
  })

  it('formatiert und maskiert für die Anzeige', () => {
    expect(formatIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00')
    expect(maskIban('DE89370400440532013000')).toBe('DE89 •••• •••• 3000')
  })
})

describe('Postleitzahl', () => {
  it('prüft die Länder, die wir kennen', () => {
    expect(validatePostalCode('DE', '10115').valid).toBe(true)
    expect(validatePostalCode('DE', '1011').valid).toBe(false)
    expect(validatePostalCode('NL', '1012 AB').valid).toBe(true)
    expect(validatePostalCode('GB', 'SW1A 1AA').valid).toBe(true)
    expect(validatePostalCode('PT', '1000-001').valid).toBe(true)
  })

  it('akzeptiert alles Nicht-Leere in Ländern ohne hinterlegte Regel', () => {
    expect(validatePostalCode('JP', '100-0001').valid).toBe(true)
    expect(validatePostalCode('JP', '').valid).toBe(false)
  })
})

describe('USt-IdNr.', () => {
  it('prüft das Format je Land', () => {
    expect(validateVatId('DE123456789').valid).toBe(true)
    expect(validateVatId('ATU12345678').valid).toBe(true)
    expect(validateVatId('NL123456789B01').valid).toBe(true)
    expect(validateVatId('DE12345678').valid).toBe(false)
    expect(validateVatId('XX123456789').valid).toBe(false)
  })

  it('führt EL und GR auf dasselbe Land zurück', () => {
    expect(validateVatId('EL123456789').country).toBe('GR')
  })

  it('ignoriert Leerzeichen und Punkte', () => {
    expect(validateVatId('de 123.456.789').valid).toBe(true)
  })
})

describe('resolveVat', () => {
  it('kennt die EU', () => {
    expect(isEuCountry('DE')).toBe(true)
    expect(isEuCountry('CH')).toBe(false)
    expect(isEuCountry('GB')).toBe(false)
  })

  it('begründet jede Entscheidung im Klartext', () => {
    expect(resolveVat({ country: 'DE', business: false }).note).toMatch(/Inland/)
    expect(resolveVat({ country: 'CH', business: false }).note).toMatch(/ausserhalb der EU/)
    expect(resolveVat({ country: 'AT', business: true, vatId: 'ATU12345678' }).note).toMatch(/Reverse-Charge/)
  })

  it('gewährt Reverse-Charge nicht ohne USt-IdNr.', () => {
    expect(resolveVat({ country: 'AT', business: true }).reverseCharge).toBe(false)
  })
})
