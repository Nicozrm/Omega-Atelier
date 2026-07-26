import { describe, it, expect } from 'vitest'
import { sha256Hex, hmacSha256Hex, buildStringToSign, signRequest, makeNonce } from './signing'

describe('Tuya crypto primitives', () => {
  it('SHA-256 of the empty string is the canonical empty-body hash', async () => {
    // Tuya uses this exact value as the content hash for GET requests.
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('SHA-256 matches a known vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('HMAC-SHA256 matches RFC 4231 test case 1 (upper-cased)', async () => {
    // key = 20×0x0b, data = "Hi There". RFC 4231 §4.2.
    const key = '\x0b'.repeat(20)
    const out = await hmacSha256Hex('Hi There', key)
    expect(out).toBe('B0344C61D8DB38535CA8AFCEAF0BF12B881DC200C9833DA726E9376C2E32CFF7')
  })
})

describe('buildStringToSign', () => {
  it('assembles METHOD, content-hash, empty header line and url', async () => {
    const s = await buildStringToSign('GET', '/v1.0/token?grant_type=1', '')
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(s).toBe(`GET\n${emptyHash}\n\n/v1.0/token?grant_type=1`)
  })

  it('hashes the body for POST requests', async () => {
    const body = '{"commands":[{"code":"switch_1","value":true}]}'
    const s = await buildStringToSign('POST', '/v1.0/devices/x/commands', body)
    expect(s.split('\n')[1]).toBe(await (await import('./signing')).sha256Hex(body))
  })
})

describe('signRequest', () => {
  const base = {
    clientId: 'abc123', secret: 'topsecret', method: 'GET' as const,
    path: '/v1.0/token?grant_type=1', t: '1700000000000', nonce: 'n0nce',
  }

  it('produces a 64-char uppercase-hex signature and the required headers', async () => {
    const h = await signRequest(base)
    expect(h.sign).toMatch(/^[0-9A-F]{64}$/)
    expect(h).toMatchObject({ client_id: 'abc123', t: '1700000000000', sign_method: 'HMAC-SHA256', nonce: 'n0nce' })
    expect(h.access_token).toBeUndefined() // token request carries no access_token
  })

  it('is deterministic for identical input', async () => {
    expect((await signRequest(base)).sign).toBe((await signRequest(base)).sign)
  })

  it('token vs business requests differ, and business carries the access_token', async () => {
    const token = await signRequest(base)
    const business = await signRequest({ ...base, accessToken: 'AT-xyz' })
    expect(business.access_token).toBe('AT-xyz')
    // Folding the access token into the signed prefix must change the signature.
    expect(business.sign).not.toBe(token.sign)
  })

  it('any change to the secret or the request changes the signature', async () => {
    const ref = (await signRequest(base)).sign
    expect((await signRequest({ ...base, secret: 'other' })).sign).not.toBe(ref)
    expect((await signRequest({ ...base, path: base.path + '&x=1' })).sign).not.toBe(ref)
    expect((await signRequest({ ...base, nonce: 'different' })).sign).not.toBe(ref)
  })
})

describe('makeNonce', () => {
  it('returns a non-empty hex-ish string, unique per call', () => {
    const a = makeNonce(), b = makeNonce()
    expect(a.length).toBeGreaterThanOrEqual(16)
    expect(a).not.toBe(b)
  })
})
