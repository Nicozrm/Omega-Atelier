/**
 * diagnostics.ts — a shared, secret-safe trace for the live connectors.
 *
 * The bug reports that led to this module all had the same shape: "it says
 * connected and there are no devices". That sentence is unanswerable from the
 * outside, because the six places it can break — authentication, the HTTP call,
 * the vendor envelope, normalisation, the store, the UI — all look identical
 * from a card that only knows `connected === true`.
 *
 * So every live connector records the steps it actually took, and the UI can
 * show that trace. It is a ring buffer in memory, never persisted, and every
 * value passes through `redact()`: tokens, secrets, signatures and API keys are
 * replaced by their length, never by their content. A trace is safe to read out
 * loud in a support chat, which is the only reason it is worth having.
 */

export type TraceLevel = 'info' | 'warn' | 'error'

/**
 * The steps a live integration goes through, in order. Named rather than
 * free-form so the UI can render the chain and show where it stopped.
 */
export type TraceStep =
  | 'auth'        // credentials accepted / rejected
  | 'request'     // an HTTP call left and came back
  | 'parse'       // the vendor envelope was unwrapped
  | 'normalize'   // vendor devices became neutral domain devices
  | 'store'       // devices reached the twin
  | 'command'     // a command was delivered

export interface TraceEntry {
  at: string
  /** Connector id or vendor key, e.g. `switchbot`, `tuya`, `onvif`. */
  connector: string
  step: TraceStep
  level: TraceLevel
  message: string
  detail?: Record<string, string | number | boolean>
}

/** How many entries are kept. Enough for several connect cycles, bounded. */
const MAX_ENTRIES = 240

const entries: TraceEntry[] = []
const listeners = new Set<(entries: TraceEntry[]) => void>()

/** Header/field names whose *values* must never appear in a trace. */
const SECRET_KEYS = /^(authorization|token|secret|sign|nonce|access_?token|refresh_?token|client_?secret|api_?key|govee-api-key|password|ticket)$/i

/**
 * Strip anything that could be a credential out of a free-form string.
 *
 * Deliberately blunt: a long unbroken run of token characters is replaced by
 * its length. A vendor error message that happens to quote the key back at us
 * is exactly the case this exists for, and a slightly over-redacted message is
 * always better than a leaked token.
 */
export function redact(value: string): string {
  return value
    .replace(/\b[A-Za-z0-9_\-+/=]{24,}\b/g, (m) => `‹${m.length} Zeichen›`)
    .replace(/(bearer\s+)\S+/gi, '$1‹redacted›')
}

/** Redact a detail bag: secret-named keys lose their value entirely. */
function redactDetail(
  detail: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = typeof value === 'string' ? `‹${value.length} Zeichen›` : '‹gesetzt›'
      continue
    }
    out[key] = typeof value === 'string' ? redact(value) : value
  }
  return out
}

/** Record one step. Never throws — diagnostics must not break a connector. */
export function trace(
  connector: string,
  step: TraceStep,
  message: string,
  detail?: Record<string, string | number | boolean>,
  level: TraceLevel = 'info',
): void {
  const entry: TraceEntry = {
    at: new Date().toISOString(),
    connector,
    step,
    level,
    message: redact(message),
    ...(detail ? { detail: redactDetail(detail) } : {}),
  }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES)
  for (const listener of listeners) listener([...entries])
}

/** Shorthand for a failed step. */
export function traceError(
  connector: string,
  step: TraceStep,
  message: string,
  detail?: Record<string, string | number | boolean>,
): void {
  trace(connector, step, message, detail, 'error')
}

/** The recorded trace, newest last. Optionally filtered to one connector. */
export function readTrace(connector?: string): TraceEntry[] {
  return connector ? entries.filter((e) => e.connector === connector) : [...entries]
}

export function clearTrace(connector?: string): void {
  if (!connector) {
    entries.length = 0
  } else {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].connector === connector) entries.splice(i, 1)
    }
  }
  for (const listener of listeners) listener([...entries])
}

/** Observe the trace (the diagnostics panel). Fires immediately. */
export function subscribeTrace(listener: (entries: TraceEntry[]) => void): () => void {
  listeners.add(listener)
  listener([...entries])
  return () => { listeners.delete(listener) }
}
