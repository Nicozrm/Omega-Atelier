/**
 * Normalise whatever the user pasted into the bridge *base* URL.
 *
 * The connector appends its own API routes (`/cameras/connect`,
 * `/cameras/:id/ptz/move`, …). If the stored value already ends in one of
 * them, every request goes to `…/cameras/connect/cameras/connect` and the
 * bridge answers 404 — with an error message that points at the camera rather
 * than at the URL. Copying the URL out of a `curl` example or out of the
 * browser's address bar after a manual test does exactly that, so the base URL
 * is derived here instead of trusted.
 *
 *   http://127.0.0.1:8787/cameras/connect   → http://127.0.0.1:8787
 *   http://127.0.0.1:8787/health/           → http://127.0.0.1:8787
 *   127.0.0.1:8787                          → http://127.0.0.1:8787
 *   http://host/proxy/onvif/cameras         → http://host/proxy/onvif
 *
 * A path that is not one of ours is left alone — the bridge may well sit
 * behind a reverse proxy on a sub-path.
 */

/** Trailing segments that belong to the bridge API, not to its base URL. */
const API_TAIL = /\/(?:health|cameras(?:\/[^?#]*)?)$/i

export function onvifBridgeBaseUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return ''

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `http://${raw.replace(/^\/+/, '')}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return raw.replace(/\/+$/, '')
  }

  // Query and fragment never belong to a base URL.
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(API_TAIL, '')

  return url.toString().replace(/\/+$/, '')
}
