/**
 * signing.ts — Tuya OpenAPI v2 request signing.
 *
 * The security-critical heart of the real Tuya Cloud connector. Tuya rejects
 * any request whose HMAC-SHA256 signature does not match to the byte, so this
 * is implemented strictly to spec and tested against known vectors. Pure and
 * transport-free: it computes signatures and headers, it never touches the
 * network. Web Crypto (`crypto.subtle`) provides the primitives.
 *
 * Signature (Tuya v2):
 *   token request:    str = client_id + t + nonce + stringToSign
 *   business request: str = client_id + access_token + t + nonce + stringToSign
 *   sign = HMAC_SHA256(str, secret) → hex, UPPERCASE
 *
 *   stringToSign = METHOD \n SHA256(body) \n signHeaders \n url
 */

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0')
  return s
}

/** SHA-256 of a UTF-8 string → lowercase hex. SHA256("") is the empty-body hash. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return toHex(digest)
}

/** HMAC-SHA256(message, secret) → UPPERCASE hex (Tuya requires upper case). */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return toHex(sig).toUpperCase()
}

export interface SignInput {
  clientId: string
  secret: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path incl. version and query, e.g. `/v1.0/iot-03/devices?page_no=1`. */
  path: string
  /** Raw request body (empty for GET). */
  body?: string
  /** Unix epoch millis as string. */
  t: string
  nonce: string
  /** Present ⇒ a business request; absent ⇒ a token request. */
  accessToken?: string
}

export interface SignedHeaders {
  client_id: string
  sign: string
  t: string
  sign_method: 'HMAC-SHA256'
  nonce: string
  access_token?: string
}

/**
 * Assemble Tuya's `stringToSign`. No signature headers are used (the common
 * case), so that segment is an empty line.
 */
export async function buildStringToSign(method: string, path: string, body: string): Promise<string> {
  const contentHash = await sha256Hex(body)
  return `${method}\n${contentHash}\n\n${path}`
}

/** Compute the full signed header set for one Tuya request. */
export async function signRequest(input: SignInput): Promise<SignedHeaders> {
  const stringToSign = await buildStringToSign(input.method, input.path, input.body ?? '')
  const prefix = input.accessToken
    ? input.clientId + input.accessToken + input.t + input.nonce
    : input.clientId + input.t + input.nonce
  const sign = await hmacSha256Hex(prefix + stringToSign, input.secret)
  const headers: SignedHeaders = {
    client_id: input.clientId,
    sign,
    t: input.t,
    sign_method: 'HMAC-SHA256',
    nonce: input.nonce,
  }
  if (input.accessToken) headers.access_token = input.accessToken
  return headers
}

/** A random nonce (uuid when available, else a random hex string). */
export function makeNonce(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID().replace(/-/g, '')
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
}
