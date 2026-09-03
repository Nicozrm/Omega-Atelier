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
    const direct = regionOrUrl in TUYA_ENDPOINTS
    this.base = direct
      ? TUYA_ENDPOINTS[regionOrUrl as TuyaRegion]
      : regionOrUrl.replace(/\/$/, '')
    this.relayed = !direct
  }

  /** True when this instance talks to the relay rather than a data centre. */
  private readonly relayed: boolean

  async request<T = unknown>(req: TuyaRequest): Promise<TuyaApiResponse<T>> {
    let res: Response
    try {
      res = await fetch(this.base + req.path, {
        method: req.method,
        headers: { 'Content-Type': 'application/json', ...req.headers },
        body: req.body,
      })
    } catch (e) {
      /*
       * A browser reports a blocked cross-origin request as a bare `TypeError`
       * ("Load failed" / "Failed to fetch") — indistinguishable from the server
       * being down, and useless to someone staring at valid credentials. Since
       * Tuya's signed headers guarantee a preflight and the data centre answers
       * none, the missing relay is by far the likeliest cause and the one worth
       * naming.
       */
      if (e instanceof TypeError) {
        return {
          success: false,
          msg: this.relayed
            ? 'Relay nicht erreichbar — URL prüfen und ob die Function mit --no-verify-jwt deployt ist'
            : 'Tuya ist ohne Relay nicht aus dem Browser erreichbar (CORS) — Relay-URL eintragen',
        }
      }
      return { success: false, msg: e instanceof Error ? e.message : 'Tuya-Anfrage fehlgeschlagen' }
    }
    if (!res.ok) {
      return { success: false, code: res.status, msg: `HTTP ${res.status}` }
    }
    return (await res.json()) as TuyaApiResponse<T>
  }
}
