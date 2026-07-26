/**
 * transport.ts — the Tuya Cloud wire transport.
 *
 * The ONLY place network logic lives, and it lives INSIDE the connector module.
 * The connector computes the signed headers (see `signing.ts`) and hands a raw
 * request to a `TuyaTransport`; in production that is an HTTPS call to a Tuya
 * data-centre, in the demo/tests it is an in-memory simulator. The connector
 * code is identical against both.
 */

/** Tuya's uniform response envelope. */
export interface TuyaApiResponse<T = unknown> {
  success: boolean
  result?: T
  code?: number
  msg?: string
  t?: number
}

export interface TuyaRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path incl. version + query, e.g. `/v1.0/token?grant_type=1`. */
  path: string
  headers: Record<string, string>
  body?: string
}

export interface TuyaTransport {
  request<T = unknown>(req: TuyaRequest): Promise<TuyaApiResponse<T>>
}

/** The regional Tuya data centres. The account's project decides which. */
export const TUYA_ENDPOINTS = {
  eu: 'https://openapi.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com',
  in: 'https://openapi.tuyain.com',
} as const
export type TuyaRegion = keyof typeof TUYA_ENDPOINTS

/**
 * The real transport: a thin pipe over `fetch`. It performs no protocol logic —
 * signing, token management and mapping all live in the connector. It only
 * adds the standard content-type and parses the JSON envelope.
 */
export class HttpTuyaTransport implements TuyaTransport {
  private readonly base: string
  constructor(regionOrUrl: TuyaRegion | string = 'eu') {
    this.base = regionOrUrl in TUYA_ENDPOINTS
      ? TUYA_ENDPOINTS[regionOrUrl as TuyaRegion]
      : regionOrUrl.replace(/\/$/, '')
  }

  async request<T = unknown>(req: TuyaRequest): Promise<TuyaApiResponse<T>> {
    const res = await fetch(this.base + req.path, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', ...req.headers },
      body: req.body,
    })
    if (!res.ok) {
      return { success: false, code: res.status, msg: `HTTP ${res.status}` }
    }
    return (await res.json()) as TuyaApiResponse<T>
  }
}
