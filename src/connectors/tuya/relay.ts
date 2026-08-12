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

/** Vendor segments the relay itself understands — stripped if pasted in. */
const VENDOR_SEGMENT = /\/(?:govee|switchbot|tuya-(?:eu|us|cn|in))\/?$/i

/**
 * Base URL of the relay deployment, normalised.
 *
 * Accepts what a user actually pastes: with or without a scheme, with a
 * trailing slash, or with a vendor segment still attached because they copied
 * it out of a working `curl`.
 */
export function relayBaseUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  // Relays are hosted, so https is the right default for a bare host.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return raw.replace(/\/+$/, '')
  }
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(VENDOR_SEGMENT, '')
  return url.toString().replace(/\/+$/, '')
}

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
