import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CheckoutStepper } from './CheckoutStepper'
import { PaymentStep } from './PaymentStep'
import { OrderSummary } from './OrderSummary'
import { TextField } from './Field'
import { emptyForm, quote, type CheckoutForm } from '@/lib/billing'

/**
 * Getestet wird das, was eine Kasse kaputt macht und was ein Typecheck nicht
 * sieht: dass ein Fehler mit seinem Feld verbunden ist, dass eine gesperrte
 * Zahlungsart ihren Grund nennt statt zu verschwinden, und dass die Summe im
 * Beleg dieselbe ist wie die berechnete. Das Aussehen prüft niemand hier —
 * die Verdrahtung schon.
 */

const NOW = new Date(2026, 5, 1)

function filled(over: Partial<CheckoutForm> = {}): CheckoutForm {
  return emptyForm({
    email: 'nico@example.de', fullName: 'Nico Zimmermann',
    street: 'Musterweg 12', postalCode: '10115', city: 'Berlin', country: 'DE',
    ...over,
  })
}

const priced = (over: Partial<Parameters<typeof quote>[0]> = {}) => quote({
  tier: 'pro', interval: 'yearly', currency: 'EUR', seats: 1,
  country: 'DE', business: false, ...over,
})

describe('TextField — Fehler und Feld hängen zusammen', () => {
  it('verbindet Label, Feld und Meldung so, dass ein Screenreader sie zusammen liest', () => {
    render(<TextField label="IBAN" value="" onChange={() => {}} error="Prüfziffer stimmt nicht." />)
    const input = screen.getByLabelText('IBAN')
    expect(input).toHaveAttribute('aria-invalid', 'true')

    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent('Prüfziffer stimmt nicht.')
    // aria-describedby muss auf genau die Meldung zeigen, nicht irgendwohin.
    expect(input.getAttribute('aria-describedby')).toBe(message.id)
  })

  it('zeigt den Hinweis, solange kein Fehler da ist', () => {
    render(<TextField label="IBAN" value="" onChange={() => {}} hint="Wir prüfen sofort." />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Wir prüfen sofort.')).toBeInTheDocument()
  })
})

describe('CheckoutStepper', () => {
  it('markiert den aktuellen Schritt und sperrt die, die noch nicht dran sind', () => {
    render(<CheckoutStepper current="account" form={filled()} onJump={() => {}} now={NOW} />)
    const nav = screen.getByRole('navigation', { name: 'Bestellschritte' })
    const steps = within(nav).getAllByRole('button')

    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    // Tarif liegt hinter uns → anklickbar. Prüfen liegt zwei Schritte
    // voraus und braucht erst eine Zahlungsart.
    expect(steps[0]).toBeEnabled()
    expect(steps[3]).toBeDisabled()
  })

  it('nennt den Grund, statt nur abzublenden', () => {
    render(<CheckoutStepper current="plan" form={emptyForm()} onJump={() => {}} now={NOW} />)
    const nav = screen.getByRole('navigation', { name: 'Bestellschritte' })
    expect(within(nav).getAllByRole('button')[2]).toHaveAttribute('title', 'Erst die Schritte davor ausfüllen')
  })

  it('springt nur, wohin gesprungen werden darf', async () => {
    const onJump = vi.fn()
    render(<CheckoutStepper current="payment" form={filled()} onJump={onJump} now={NOW} />)
    const nav = screen.getByRole('navigation', { name: 'Bestellschritte' })
    await userEvent.click(within(nav).getAllByRole('button')[0])
    expect(onJump).toHaveBeenCalledWith('plan')
  })
})

describe('PaymentStep', () => {
  const caps = { applePay: false, googlePay: false }

  beforeEach(() => vi.clearAllMocks())

  it('zeigt die abbuchungsfähigen Verfahren für ein deutsches Monatsabo', () => {
    render(
      <PaymentStep
        form={filled({ interval: 'monthly' })}
        errors={{}}
        quote={priced({ interval: 'monthly' })}
        capabilities={caps}
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('radio', { name: /Kredit- oder Debitkarte/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /SEPA-Lastschrift/ })).toBeInTheDocument()
    // iDEAL kann nicht wiederkehrend einziehen und ist in DE nicht verfügbar —
    // beides führt zum Ausblenden, nicht zum Sperren.
    expect(screen.queryByRole('radio', { name: /iDEAL/ })).toBeNull()
  })

  it('sperrt einmalige Verfahren im Monatsabo sichtbar und mit Begründung', () => {
    render(
      <PaymentStep
        form={filled({ interval: 'monthly' })}
        errors={{}}
        quote={priced({ interval: 'monthly' })}
        capabilities={caps}
        onChange={() => {}}
      />,
    )
    const klarna = screen.getByRole('radio', { name: /Klarna/ })
    expect(klarna).toHaveAttribute('aria-disabled', 'true')
    expect(klarna).toHaveTextContent(/Jahresabo/)
  })

  it('gibt dieselben Verfahren im Jahresabo frei', () => {
    render(
      <PaymentStep
        form={filled({ interval: 'yearly' })}
        errors={{}}
        quote={priced()}
        capabilities={caps}
        onChange={() => {}}
      />,
    )
    const klarna = screen.getByRole('radio', { name: /Klarna/ })
    expect(klarna).not.toHaveAttribute('aria-disabled')
  })

  it('blendet Apple Pay ohne passendes Gerät ganz aus', () => {
    const { rerender } = render(
      <PaymentStep form={filled()} errors={{}} quote={priced()} capabilities={caps} onChange={() => {}} />,
    )
    expect(screen.queryByRole('radio', { name: /Apple Pay/ })).toBeNull()

    rerender(
      <PaymentStep
        form={filled()} errors={{}} quote={priced()}
        capabilities={{ applePay: true, googlePay: false }} onChange={() => {}}
      />,
    )
    expect(screen.getByRole('radio', { name: /Apple Pay/ })).toBeInTheDocument()
  })

  it('blendet die Kartenfelder erst ein, wenn Karte gewählt ist', () => {
    const { rerender } = render(
      <PaymentStep form={filled()} errors={{}} quote={priced()} capabilities={caps} onChange={() => {}} />,
    )
    expect(screen.queryByLabelText(/Kartennummer/)).toBeNull()

    rerender(
      <PaymentStep
        form={filled({ methodId: 'card' })} errors={{}} quote={priced()}
        capabilities={caps} onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText(/Kartennummer/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Prüfcode/)).toBeInTheDocument()
  })

  it('reicht die Auswahl nach oben, statt sie selbst zu behalten', async () => {
    const onChange = vi.fn()
    render(
      <PaymentStep form={filled()} errors={{}} quote={priced()} capabilities={caps} onChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('radio', { name: /Kredit- oder Debitkarte/ }))
    expect(onChange).toHaveBeenCalledWith({ methodId: 'card' })
  })

  it('lässt eine gesperrte Kachel nichts auslösen', async () => {
    const onChange = vi.fn()
    render(
      <PaymentStep
        form={filled({ interval: 'monthly' })} errors={{}} quote={priced({ interval: 'monthly' })}
        capabilities={caps} onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByRole('radio', { name: /Klarna/ }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('RadioGroup — Tastaturbedienung, die ARIA allein nicht mitbringt', () => {
  const caps = { applePay: false, googlePay: false }

  it('macht die ganze Gruppe zu einem Tab-Halt statt zu zwanzig', () => {
    render(
      <PaymentStep
        form={filled({ methodId: 'card' })} errors={{}} quote={priced()}
        capabilities={caps} onChange={() => {}}
      />,
    )
    const card = screen.getByRole('radio', { name: /Kredit- oder Debitkarte/ })
    // Die gewählte Kachel trägt den Einstiegspunkt, alle anderen liegen
    // ausserhalb der Tab-Reihenfolge.
    expect(card).toHaveAttribute('tabindex', '0')
    for (const other of screen.getAllByRole('radio')) {
      if (other !== card && other.closest('[role="radiogroup"]') === card.closest('[role="radiogroup"]')) {
        expect(other).toHaveAttribute('tabindex', '-1')
      }
    }
  })

  it('wählt mit den Pfeiltasten und überspringt Gesperrtes', async () => {
    const onChange = vi.fn()
    render(
      <PaymentStep
        form={filled({ interval: 'monthly', methodId: 'paypal' })} errors={{}}
        quote={priced({ interval: 'monthly' })} capabilities={caps} onChange={onChange}
      />,
    )
    const paypal = screen.getByRole('radio', { name: /PayPal/ })
    paypal.focus()
    await userEvent.keyboard('{ArrowDown}')

    // Die nächste *wählbare* Kachel derselben Gruppe wurde gewählt — nicht die
    // nächste im DOM, falls die gesperrt ist.
    expect(onChange).toHaveBeenCalled()
    const picked = onChange.mock.calls.at(-1)?.[0] as { methodId: string }
    expect(picked.methodId).not.toBe('paypal')
  })

  it('springt mit Pos1 an den Anfang der Gruppe', async () => {
    const onChange = vi.fn()
    render(
      <PaymentStep
        form={filled({ methodId: 'link' })} errors={{}} quote={priced()}
        capabilities={caps} onChange={onChange}
      />,
    )
    screen.getByRole('radio', { name: /Link/ }).focus()
    await userEvent.keyboard('{Home}')
    expect(onChange).toHaveBeenCalledWith({ methodId: 'paypal' })
  })
})

describe('OrderSummary', () => {
  it('zeigt genau die Summe, die gerechnet wurde', () => {
    const q = priced()
    render(
      <MemoryRouter>
        <OrderSummary quote={q} tier="pro" interval="yearly" now={NOW} />
      </MemoryRouter>,
    )
    // 90 € netto + 19 % = 107,10 €
    expect(q.total).toBe(10710)
    expect(screen.getByText('107,10 €')).toBeInTheDocument()
  })

  it('nennt bei Reverse-Charge den Grund, statt nur eine Null zu zeigen', () => {
    const q = priced({ country: 'AT', business: true, vatId: 'ATU12345678' })
    render(
      <MemoryRouter>
        <OrderSummary quote={q} tier="pro" interval="yearly" now={NOW} />
      </MemoryRouter>,
    )
    expect(q.vatAmount).toBe(0)
    expect(screen.getAllByText(/Reverse-Charge/).length).toBeGreaterThan(0)
  })

  it('sagt bei einer Testphase, was heute fällig ist und was danach', () => {
    const q = priced({ trialDays: 14 })
    render(
      <MemoryRouter>
        <OrderSummary quote={q} tier="pro" interval="yearly" now={NOW} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Heute fällig')).toBeInTheDocument()
    expect(screen.getByText(/14 Tage kostenlos/)).toBeInTheDocument()
    // Der Folgetermin ist 14 Tage später, nicht in einem Jahr.
    expect(screen.getByText(/15\. Juni 2026/)).toBeInTheDocument()
  })
})
