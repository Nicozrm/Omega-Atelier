import { describe, it, expect } from 'vitest'
import { onvifBridgeBaseUrl } from './url'

describe('onvifBridgeBaseUrl', () => {
  it('strips an API route the user pasted as the base URL', () => {
    // The reported bug: the connector appends `/cameras/connect` itself, so a
    // stored full URL produced `…/cameras/connect/cameras/connect`.
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/cameras/connect')).toBe('http://127.0.0.1:8787')
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/cameras')).toBe('http://127.0.0.1:8787')
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/health')).toBe('http://127.0.0.1:8787')
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/cameras/arenti/ptz/move')).toBe('http://127.0.0.1:8787')
  })

  it('keeps a plain base URL untouched', () => {
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(onvifBridgeBaseUrl('http://192.168.0.20:8787')).toBe('http://192.168.0.20:8787')
  })

  it('trims whitespace and trailing slashes', () => {
    expect(onvifBridgeBaseUrl('  http://127.0.0.1:8787///  ')).toBe('http://127.0.0.1:8787')
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/health/')).toBe('http://127.0.0.1:8787')
  })

  it('adds the scheme when the user typed only host:port', () => {
    expect(onvifBridgeBaseUrl('127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
  })

  it('preserves a reverse-proxy sub-path that is not an API route', () => {
    expect(onvifBridgeBaseUrl('https://home.example/proxy/onvif')).toBe('https://home.example/proxy/onvif')
    expect(onvifBridgeBaseUrl('https://home.example/proxy/onvif/cameras/connect')).toBe('https://home.example/proxy/onvif')
  })

  it('drops query and fragment', () => {
    expect(onvifBridgeBaseUrl('http://127.0.0.1:8787/?token=abc#x')).toBe('http://127.0.0.1:8787')
  })

  it('returns empty for empty input', () => {
    expect(onvifBridgeBaseUrl('   ')).toBe('')
  })
})
