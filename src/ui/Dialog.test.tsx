import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Dialog } from './Dialog'

afterEach(cleanup)

function Body() {
  return (
    <>
      <button>Erster</button>
      <input aria-label="Feld" />
      <button>Letzter</button>
    </>
  )
}

describe('Dialog — accessibility contract', () => {
  it('wires role, aria-modal and aria-labelledby to the title', () => {
    render(<Dialog open onClose={() => {}} title="Mein Titel"><Body /></Dialog>)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    const labelId = dlg.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId as string)).toHaveTextContent('Mein Titel')
  })

  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="X"><Body /></Dialog>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="T"><Body /></Dialog>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on backdrop click but not on panel click', () => {
    const onClose = vi.fn()
    const { container } = render(<Dialog open onClose={onClose} title="T"><Body /></Dialog>)
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    const backdrop = container.querySelector('.fixed.inset-0') as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves initial focus into the dialog', () => {
    render(<Dialog open onClose={() => {}} title="T"><Body /></Dialog>)
    const dlg = screen.getByRole('dialog')
    expect(dlg.contains(document.activeElement)).toBe(true)
  })

  it('traps Tab at the end and Shift+Tab at the start', () => {
    render(<Dialog open onClose={() => {}} title="T"><Body /></Dialog>)
    const closeBtn = screen.getByRole('button', { name: 'Schließen' })
    const last = screen.getByText('Letzter')

    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(closeBtn)

    closeBtn.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('locks body scroll while open and restores it on close', () => {
    const { rerender } = render(<Dialog open onClose={() => {}} title="T"><Body /></Dialog>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Dialog open={false} onClose={() => {}} title="T"><Body /></Dialog>)
    expect(document.body.style.overflow).toBe('')
  })

  it('returns focus to the trigger on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Öffnen</button>
          <Dialog open={open} onClose={() => setOpen(false)} title="T">
            <button>Inhalt</button>
          </Dialog>
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Öffnen' })
    trigger.focus()
    await userEvent.click(trigger)

    const dlg = screen.getByRole('dialog')
    expect(dlg.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})
