import { describe, it, expect } from 'vitest'
import { haWebsocketUrl } from './url'

describe('haWebsocketUrl', () => {
  it('upgrades https to wss and appends the API path', () => {
    expect(haWebsocketUrl('https://ha.example.com')).toBe('wss://ha.example.com/api/websocket')
  })

  it('maps http to ws (localhost dev)', () => {
    expect(haWebsocketUrl('http://localhost:8123')).toBe('ws://localhost:8123/api/websocket')
  })

  it('defaults a scheme-less host to wss', () => {
    expect(haWebsocketUrl('ha.ui.nabu.casa')).toBe('wss://ha.ui.nabu.casa/api/websocket')
  })

  it('strips trailing slashes before appending the API path', () => {
    expect(haWebsocketUrl('https://ha.example.com/')).toBe('wss://ha.example.com/api/websocket')
  })

  it('does not double-append when the API path is already present', () => {
    expect(haWebsocketUrl('wss://ha.example.com/api/websocket')).toBe('wss://ha.example.com/api/websocket')
  })

  it('preserves an explicit ws:// scheme', () => {
    expect(haWebsocketUrl('ws://10.0.0.5:8123')).toBe('ws://10.0.0.5:8123/api/websocket')
  })

  it('returns empty string untouched', () => {
    expect(haWebsocketUrl('   ')).toBe('')
  })
})
