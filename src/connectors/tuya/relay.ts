/**
 * relay.ts — routing Tuya through the CORS relay.
 *
 * ## Why Tuya needs this at all
 *
 * Every Tuya OpenAPI request carries `client_id`, `sign`, `t`, `sign_method`,
 * `nonce` and `access_token`. None of those is a CORS-safelisted header, so the
 * browser always sends a preflight first — and `openapi.tuya*.com` answers
 * neither the preflight nor the real request with an `access-control-allow-origin`
 * header. The request therefore never completes, exactly as with SwitchBot, and
 * for exactly the same reason: the missing CORS layer, not the signature.
 *
 * ## Why this module exists now
 *
 * The relay function has understood `tuya-eu` / `tuya-us` / `tuya-cn` /
 * `tuya-in` since it was written, and its own header allowlist already carries
 * Tuya's signed set. The connector UI simply never offered the field: Govee and
 * SwitchBot got a relay input, Tuya was wired straight to the data centre. So
 * the one vendor the relay documented as *requiring* it was the one that could
 * not use it.
 *
 * Pure string work, so the routing rule is testable without a network.
 */

import { TUYA_ENDPOINTS, type TuyaRegion } from './transport'
import { relayBaseUrl } from '../relayUrl'

/**
 * Re-exported from `connectors/relayUrl`, where it now lives.
 *
 * The normalisation was never Tuya-specific — it just happened to be written
 * here, which is why Govee and SwitchBot went on building their relay URLs by
 * string concatenation and quietly addressed the relay's health route whenever
 * the pasted URL carried a query string. All three share it now.
 */
export { relayBaseUrl }

/**
 * The base URL the Tuya transport should talk to.
 *
 * Returns `undefined` when no relay is configured, which is the signal to keep
 * the previous behaviour and address the data centre directly — worth keeping
 * for a desktop build, an extension host, or any context that is not a browser
 * page and therefore has no CORS to satisfy.
 */
export function tuyaRelayUrl(relay: string, region: TuyaRegion): string | undefined {
  const base = relayBaseUrl(relay)
  if (!base) return undefined
  return `${base}/tuya-${region}`
}

/** The direct data-centre URL for a region — what `tuyaRelayUrl` replaces. */
export function tuyaDirectUrl(region: TuyaRegion): string {
  return TUYA_ENDPOINTS[region]
}
