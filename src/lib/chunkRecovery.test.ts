import { describe, it, expect } from 'vitest'
import { isChunkLoadError } from './chunkRecovery'

describe('isChunkLoadError', () => {
  it('matches Chrome/Vite dynamic-import failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/Editor-abc.js'))).toBe(true)
  })
  it('matches Safari module-script failures', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
  })
  it('matches Firefox dynamic-import errors', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })
  it('matches webpack-style loading chunk failures', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true)
  })
  it('accepts a plain string message', () => {
    expect(isChunkLoadError('Loading CSS chunk 3 failed')).toBe(true)
  })
  it('ignores unrelated runtime errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })
  it('ignores non-error values', () => {
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})
