import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Der Store spricht mit Supabase, also wird Supabase ersetzt. Geprüft wird
 * nicht, ob Postgres rechnet — das tut es —, sondern ob der Store bei jeder
 * denkbaren Antwort die *vorsichtige* Entscheidung trifft. Eine Abrechnung, die
 * bei einem Netzfehler aufrundet, verschenkt bezahlte Funktionen; eine, die
 * beim Abmelden nichts vergisst, verschenkt sie an den Nächsten am Gerät.
 */

const rpc = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  get supabaseReady() { return ready },
}))

let ready = true

const { useBillingStore } = await import('./useBillingStore')

const reset = () => {
  useBillingStore.setState({ tier: null, subscription: null, loading: false, loaded: false })
  rpc.mockReset()
  ready = true
}

/** Antwortet je nach gerufener Funktion. */
function mockRpc(tier: unknown, sub: unknown, tierError: unknown = null) {
  rpc.mockImplementation((fn: string) => {
    if (fn === 'current_tier') return Promise.resolve({ data: tier, error: tierError })
    if (fn === 'my_subscription') return Promise.resolve({ data: sub, error: null })
    return Promise.resolve({ data: null, error: null })
  })
}

describe('useBillingStore', () => {
  beforeEach(reset)

  it('startet ohne Aussage — nicht mit „free"', () => {
    const s = useBillingStore.getState()
    expect(s.tier).toBeNull()
    expect(s.loaded).toBe(false)
  })

  it('übernimmt den Tarif des Servers', async () => {
    mockRpc('max', [{
      tier: 'max', status: 'active', interval: 'yearly', seats: 3, currency: 'EUR',
      current_period_end: '2027-01-01T00:00:00Z', cancel_at_period_end: false, trial_ends_at: null,
    }])
    await useBillingStore.getState().refresh()

    const s = useBillingStore.getState()
    expect(s.tier).toBe('max')
    expect(s.loaded).toBe(true)
    expect(s.subscription).toMatchObject({ tier: 'max', seats: 3, interval: 'yearly' })
  })

  it('macht aus einer unbekannten Antwort „free", nicht aus Versehen etwas Bezahltes', async () => {
    mockRpc('platinum', null)
    await useBillingStore.getState().refresh()
    expect(useBillingStore.getState().tier).toBe('free')
  })

  it('stuft bei einem Fehler niemanden hoch — und einen bekannten Tarif auch nicht herunter', async () => {
    mockRpc('pro', null)
    await useBillingStore.getState().refresh()
    expect(useBillingStore.getState().tier).toBe('pro')

    // Zweiter Aufruf scheitert: der zuletzt bestätigte Tarif bleibt stehen.
    mockRpc(null, null, { message: 'network' })
    await useBillingStore.getState().refresh()
    const s = useBillingStore.getState()
    expect(s.tier).toBe('pro')
    expect(s.loading).toBe(false)
  })

  it('antwortet ohne Cloud sofort mit „free" — und weiss, dass das feststeht', async () => {
    ready = false
    await useBillingStore.getState().refresh()
    const s = useBillingStore.getState()
    expect(s.tier).toBe('free')
    expect(s.loaded).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('vergisst beim Abmelden alles', async () => {
    mockRpc('max', null)
    await useBillingStore.getState().refresh()
    expect(useBillingStore.getState().tier).toBe('max')

    useBillingStore.getState().clear()
    const s = useBillingStore.getState()
    expect(s.tier).toBeNull()
    expect(s.subscription).toBeNull()
    expect(s.loaded).toBe(false)
  })

  it('kommt mit einem Abo ohne laufende Zeile klar', async () => {
    mockRpc('free', [])
    await useBillingStore.getState().refresh()
    const s = useBillingStore.getState()
    expect(s.tier).toBe('free')
    expect(s.subscription).toBeNull()
  })

  it('meldet einen Fehler beim Kündigen zurück, statt ihn zu schlucken', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
    const result = await useBillingStore.getState().setCancelAtPeriodEnd(true)
    expect(result.error).toBe('nope')
  })
})
