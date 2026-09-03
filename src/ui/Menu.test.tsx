import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Menu } from './Menu'

afterEach(cleanup)

function Sample({ onSelect = () => {} }: { onSelect?: () => void }) {
  return (
    <Menu trigger={({ ref, ...p }) => <button ref={ref} {...p}>Konto</button>}>
      <Menu.Label>user@example.com</Menu.Label>
      <Menu.Item onSelect={onSelect}>Abmelden</Menu.Item>
      <Menu.Item disabled>Deaktiviert</Menu.Item>
    </Menu>
  )
}

describe('Menu — menu-button accessibility contract', () => {
  it('wires aria-haspopup and toggles aria-expanded', async () => {
    render(<Sample />)
    const trigger = screen.getByRole('button', { name: 'Konto' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('opens with ArrowDown and focuses the first enabled item', () => {
    render(<Sample />)
    const trigger = screen.getByRole('button', { name: 'Konto' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
  })

  it('rolls focus with ArrowDown/ArrowUp, skipping disabled items', () => {
    render(<Sample />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Konto' }), { key: 'ArrowDown' })
    const [first] = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(first)
    // Only one enabled item → wraps back to itself, never lands on the disabled one.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first)
    expect(document.activeElement).toHaveTextContent('Abmelden')
  })

  it('runs onSelect and closes when an item is chosen', async () => {
    const onSelect = vi.fn()
    render(<Sample onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Konto' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Abmelden' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('does not select or close for a disabled item', async () => {
    render(<Sample />)
    await userEvent.click(screen.getByRole('button', { name: 'Konto' }))
    const disabled = screen.getByRole('menuitem', { name: 'Deaktiviert' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(disabled)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Sample />)
    const trigger = screen.getByRole('button', { name: 'Konto' })
    trigger.focus()
    await userEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on outside pointer press', async () => {
    render(<><Sample /><button>außen</button></>)
    await userEvent.click(screen.getByRole('button', { name: 'Konto' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'außen' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })
})

describe('Menu — structure and toggles', () => {
  function Structured({ checked = true }: { checked?: boolean }) {
    return (
      <Menu trigger={({ ref, ...p }) => <button ref={ref} {...p}>Mehr</button>}>
        <Menu.Section title="Ansicht">
          <Menu.Item checked={checked} shortcut="⌥1">Bibliothek</Menu.Item>
          <Menu.Item icon={<span data-testid="icon" />}>Thema</Menu.Item>
        </Menu.Section>
        <Menu.Section title="Hilfe">
          <Menu.Item shortcut="?">Tastenkürzel</Menu.Item>
        </Menu.Section>
      </Menu>
    )
  }

  it('exposes a toggle row as a checkbox item carrying its state', async () => {
    render(<Structured />)
    await userEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    const toggle = screen.getByRole('menuitemcheckbox', { name: /Bibliothek/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('reports the unchecked state rather than dropping the attribute', async () => {
    render(<Structured checked={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    expect(screen.getByRole('menuitemcheckbox', { name: /Bibliothek/ }))
      .toHaveAttribute('aria-checked', 'false')
  })

  it('includes toggle rows in the arrow-key rotation', () => {
    // A checkbox row is a `menuitemcheckbox`, not a `menuitem`; keyboard
    // navigation that only looked for the latter would silently skip it.
    render(<Structured />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mehr' }), { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Bibliothek')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toHaveTextContent('Thema')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(document.activeElement).toHaveTextContent('Tastenkürzel')
  })

  it('groups items under their section headings', async () => {
    render(<Structured />)
    await userEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Ansicht', 'Hilfe'])
  })

  it('renders the shortcut hint alongside the label', async () => {
    render(<Structured />)
    await userEvent.click(screen.getByRole('button', { name: 'Mehr' }))
    expect(screen.getByRole('menuitem', { name: /Tastenkürzel/ })).toHaveTextContent('?')
  })
})
