/**
 * Global test setup.
 * Extends Vitest's `expect` with jest-dom matchers and clears mocks between
 * tests so suites stay isolated.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  vi.clearAllMocks()
})
