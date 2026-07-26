import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { RouteFallback } from './RouteFallback'

afterEach(cleanup)

describe('RouteFallback', () => {
  it('exposes an accessible, busy status region', () => {
    render(<RouteFallback />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('announces a loading label for screen readers', () => {
    render(<RouteFallback />)
    expect(screen.getByText('Wird geladen …')).toBeInTheDocument()
  })
})
