/**
 * vendorErrors.ts — what a failed brand-cloud call actually said.
 *
 * ## The shared cause
 *
 * Govee and SwitchBot are different APIs with the same two habits, and both
 * habits turn a rejection into silence:
 *
 *  1. **They answer HTTP 200 and put the real outcome in the body.** A rejected
 *     key comes back as `200 {"code": 401, …}` (Govee) or
 *     `200 {"statusCode": 401, …}` (SwitchBot). A client that reads the device
 *     array straight off that gets `undefined`, falls back to `[]`, and reports
 *     a perfectly healthy connection with no devices. That is indistinguishable
 *     from an empty account, and it is the reason both integrations could show
 *     "verbunden" over an empty list with nothing to act on.
 *
 *  2. **They are reached through the relay**, which has its own failure modes —
 *     a function deployed without `--no-verify-jwt`, a URL missing the function
 *     path, an unreachable vendor. All three arrive as non-2xx with a JSON body
 *     that names the cause, and all three used to be flattened into one
 *     "credentials?" message that sent the user to check the one thing that was
 *     fine.
 *
 * Keeping this in one module is deliberate: it is the same diagnosis for both
 * vendors, and a fix that only lands on one of them is how they drifted apart
 * in the first place.
 */

/** Read a failed response's body without letting a parse error mask the status. */
export async function errorBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    if (!text) return undefined
    try { return JSON.parse(text) } catch { return { error: text.slice(0, 200) } }
  } catch {
    return undefined
  }
}

/**
 * Turn a non-2xx answer into a message that names the layer that refused.
 *
 * `vendor` only shapes the wording; the diagnosis is identical for both.
 */
export function vendorHttpError(vendor: string, status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : undefined
  const relayError = typeof record?.error === 'string' ? record.error : undefined
  const detail = typeof record?.detail === 'string' ? record.detail : undefined

  if (relayError === 'upstream unreachable') {
    return `Das Relay erreicht die ${vendor}-Cloud nicht${detail ? ` (${detail})` : ''}`
  }
  if (relayError === 'unknown vendor') {
    return 'Die Relay-URL zeigt nicht auf die Relay-Funktion — sie muss auf '
      + '/functions/v1/vendor-relay enden (ohne Vendor-Segment).'
  }
  if (status === 401 || status === 403) {
    // Both vendors signal their own rejections as HTTP 200 with a code in the
    // body, never as a bare HTTP 401. So an HTTP 401 here is the gateway in
    // front of them, which in practice means the relay wants a Supabase JWT.
    const gateway = typeof record?.message === 'string' ? record.message : undefined
    if (gateway && /jwt|authorization/i.test(gateway)) {
      return 'Das Relay verlangt einen Supabase-JWT — die Function muss mit '
        + `\`--no-verify-jwt\` deployt werden, sonst erreicht keine Anfrage ${vendor}.`
    }
    return `Relay oder Gateway lehnt die Anfrage ab (${status})${gateway ? `: ${gateway}` : ''}`
  }
  if (status === 404) {
    return 'Relay-Route nicht gefunden (404) — Relay-URL prüfen und ob die Function deployt ist'
  }
  return `${vendor}-Anfrage fehlgeschlagen (HTTP ${status})${relayError ? `: ${relayError}` : ''}`
}
