import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ComposerWizard } from './ComposerWizard'
import { useComposerStore } from '@/store/useComposerStore'

// jsdom lacks ResizeObserver (MapCanvas uses it) and a canvas backend — stub both.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class RO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: RO })
  }
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']
})

function renderWizard() {
  return render(
    <MemoryRouter>
      <ComposerWizard />
    </MemoryRouter>,
  )
}

describe('ComposerWizard', () => {
  beforeEach(() => {
    cleanup()
    useComposerStore.getState().closeComposer()
  })

  it('renders nothing while closed', () => {
    const { container } = renderWizard()
    expect(container.firstChild).toBeNull()
  })

  it('opens on the location step', () => {
    useComposerStore.getState().openComposer()
    renderWizard()
    expect(screen.getByRole('heading', { name: 'Standort wählen' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Musterstraße/)).toBeInTheDocument()
  })

  it('searches and advances to the map step on choosing a result', async () => {
    useComposerStore.getState().openComposer()
    renderWizard()

    fireEvent.change(screen.getByPlaceholderText(/Musterstraße/), { target: { value: 'Berlin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Suchen' }))

    const result = await screen.findByText('Berlin')
    fireEvent.click(result)

    // Step 2 mounts the map with its controls.
    await waitFor(() => expect(screen.getByLabelText('Vergrößern')).toBeInTheDocument())
    expect(useComposerStore.getState().step).toBe(2)
  })

  it('closes via the close button', () => {
    useComposerStore.getState().openComposer()
    renderWizard()
    fireEvent.click(screen.getByLabelText('Schließen'))
    expect(useComposerStore.getState().open).toBe(false)
  })
})
