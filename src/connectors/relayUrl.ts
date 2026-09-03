/**
 * relayUrl.ts — building the vendor-relay URL, for every vendor.
 *
 * ## The bug this exists for
 *
 * A relay URL pasted with a tracking query string —
 *
 *     https://<ref>.supabase.co/functions/v1/vendor-relay?utm_source=…
 *
 * — was turned into a request URL by appending the vendor segment to the raw
 * string:
 *
 *     `${relay.replace(/\/+$/, '')}/${vendor}`
 *     → …/vendor-relay?utm_source=…/govee
 *
 * The vendor segment lands *inside the query string*, so the path the relay
 * receives is bare `/functions/v1/vendor-relay`. That is the relay's own health
 * route, and it answers **HTTP 200** with a self-test envelope:
 *
 *     { ok: true, service: "vendor-relay", vendors: [...], … }
 *
 * No `data` (Govee), no `statusCode`/`body.deviceList` (SwitchBot) — so both
 * clients read zero devices from a perfectly successful request, and both cards
 * reported an empty account. The credentials were never the problem and the
 * vendor was never contacted.
 *
 * Tuya escaped it only because its own card already normalised the URL through
 * `relayBaseUrl`. That normalisation was never vendor-specific; it just lived in
 * the Tuya module. It lives here now, and all three vendors go through it.
 */

/** Vendor segments the relay itself understands — stripped if pasted in. */
const VENDOR_SEGMENT = /\/(?:govee|switchbot|tuya-(?:eu|us|cn|in))\/?$/i

/**
 * Base URL of the relay deployment, normalised.
 *
 * Accepts what a user actually pastes: with or without a scheme, with a
 * trailing slash, with a tracking query string, with a fragment, or with a
 * vendor segment still attached because they copied it out of a working `curl`.
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
  // Dropping the query is the whole point: whatever a share link appended is
  // not part of the address, and leaving it there silently redirects every
  // vendor call to the relay's health route.
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(VENDOR_SEGMENT, '')
  return url.toString().replace(/\/+$/, '')
}

/**
 * The URL a vendor client should talk to, or `undefined` when no relay is
 * configured (Govee can reach its cloud directly; the others cannot).
 */
export function vendorRelayUrl(relay: string, vendor: string): string | undefined {
  const base = relayBaseUrl(relay)
  return base ? `${base}/${vendor}` : undefined
}

/**
 * Does this answer look like the relay's own health self-test?
 *
 * Worth detecting explicitly. It arrives as HTTP 200 with valid JSON, so every
 * layer below reads it as a successful request that happened to contain no
 * devices — the single most confusing way this can fail, and the one that sent
 * a user hunting through their SwitchBot app for a cloud setting that was
 * already correct.
 */
export function isRelayHealthResponse(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const record = body as Record<string, unknown>
  return record.service === 'vendor-relay' && Array.isArray(record.vendors)
}

/** The message for that case — the same advice whichever vendor hit it. */
export const RELAY_HEALTH_MESSAGE =
  'Die Relay-URL erreicht nur den Selbsttest der Relay-Funktion, nicht den Hersteller. '
  + 'Meist hängt noch ein „?utm_source=…" oder ein anderer Query-Teil an der URL — '
  + 'sie muss auf /functions/v1/vendor-relay enden, ohne alles dahinter.'
