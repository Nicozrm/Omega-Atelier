/**
 * discovery.ts — how a Tuya Cloud account's devices are actually enumerated.
 *
 * ## Why this module exists
 *
 * The connector authenticated fine and then listed nothing, and the reason was
 * the endpoint, not the credentials:
 *
 *   • With a linked app account, `GET /v1.0/users/{uid}/devices` returns that
 *     user's devices as a plain array. Correct — but only reachable when a UID
 *     is configured, and the setup UI has always called the UID *optional*.
 *
 *   • Without a UID the connector fell back to `GET /v1.0/devices`. That is not
 *     an account listing at all: Tuya's `/v1.0/devices` requires a `device_ids`
 *     or `schema` query and answers an error otherwise. So every project
 *     without a hand-entered UID authenticated successfully and discovered
 *     nothing, for the entire lifetime of the connector.
 *
 * The correct no-UID endpoint is `GET /v1.0/iot-01/associated-users/devices`,
 * which lists every device associated with the *project* — and answers with a
 * nested, paginated envelope (`{ devices, has_more, last_row_key }`) rather
 * than a bare array, which is the second half of the same bug: even a correct
 * call would have been rejected by an `Array.isArray(result)` check.
 *
 * Both shapes are handled here, and the module is pure so the routing and the
 * parsing can be tested without a network or credentials.
 */

/** One page of a device listing, whichever shape Tuya answered with. */
export interface TuyaDevicePage<T> {
  devices: T[]
  /** Cursor for the next page — absent when this was the last one. */
  nextCursor?: string
}

/** The nested envelope `/v1.0/iot-01/associated-users/devices` answers with. */
interface AssociatedEnvelope<T> {
  devices?: T[]
  has_more?: boolean
  last_row_key?: string
  total?: number
}

/**
 * Which path lists this account's devices.
 *
 * A configured UID is the more precise answer (exactly that app account's
 * devices), so it wins. Without one, the project-wide association list is the
 * only endpoint that enumerates anything at all.
 */
export function deviceListPath(uid: string | undefined, cursor?: string): string {
  if (uid) {
    // The per-user endpoint is not paginated; a cursor is meaningless here.
    return `/v1.0/users/${encodeURIComponent(uid)}/devices`
  }
  const base = '/v1.0/iot-01/associated-users/devices'
  const query = new URLSearchParams({ size: '100' })
  if (cursor) query.set('last_row_key', cursor)
  return `${base}?${query.toString()}`
}

/** True when this listing endpoint can return more than one page. */
export function isPaginated(uid: string | undefined): boolean {
  return !uid
}

/**
 * Unwrap one page of results.
 *
 * Returns `null` when the payload is neither shape — the caller turns that into
 * an explicit error rather than an empty list, because "Tuya answered something
 * we do not understand" and "your account has no devices" must never render as
 * the same thing.
 */
export function parseDevicePage<T>(result: unknown): TuyaDevicePage<T> | null {
  if (Array.isArray(result)) return { devices: result as T[] }
  if (result && typeof result === 'object') {
    const envelope = result as AssociatedEnvelope<T>
    if (Array.isArray(envelope.devices)) {
      return {
        devices: envelope.devices,
        ...(envelope.has_more && envelope.last_row_key ? { nextCursor: envelope.last_row_key } : {}),
      }
    }
  }
  return null
}

/**
 * Turn a Tuya error code into something the user can act on.
 *
 * Tuya's own `msg` is usually a bare English phrase like "permission deny",
 * which describes the HTTP outcome and not the setup step that is missing. The
 * codes below are the ones a first-time Cloud project actually hits.
 */
export function tuyaErrorMessage(code: number | undefined, msg: string | undefined): string {
  const detail = msg ? ` (${msg})` : ''
  switch (code) {
    case 1004:
      return `Tuya lehnt die Signatur ab — Access ID und Access Secret prüfen${detail}`
    case 1010:
    case 1011:
    case 1012:
      return `Tuya-Token ungültig oder abgelaufen — Verbindung neu aufbauen${detail}`
    case 1013:
      return 'Tuya meldet einen Zeitstempel-Fehler — die Systemuhr weicht zu stark ab'
    case 1100:
      return `Tuya vermisst einen Pflichtparameter${detail}`
    case 1106:
      return 'Tuya verweigert den Zugriff (permission deny) — im IoT-Projekt unter '
        + '„Service API" muss „IoT Core" abonniert sein, und der App-Account muss '
        + 'unter „Devices → Link App Account" verknüpft sein'
    case 1108:
      return `Tuya kennt diesen Endpunkt für dein Projekt nicht${detail}`
    case 2406:
      return 'Tuya meldet: Projekt ohne gültige Service-API-Berechtigung (2406) — '
        + '„IoT Core" im Cloud-Projekt abonnieren und die Region prüfen'
    case 28841002:
      return 'Tuya meldet: Token abgelaufen (28841002)'
    case 28841105:
      return 'Tuya meldet: keine API-Berechtigung (28841105) — „IoT Core" abonnieren'
    default:
      return msg
        ? `Tuya-Fehler${code !== undefined ? ` ${code}` : ''}: ${msg}`
        : `Tuya-Fehler${code !== undefined ? ` ${code}` : ''}`
  }
}

/**
 * The hint shown when discovery succeeded but the account is empty.
 *
 * Which advice is right depends on how we asked: with a UID the listing is
 * scoped to one app account, without one it is scoped to the project.
 */
export function emptyAccountHint(uid: string | undefined): string {
  return uid
    ? 'Tuya antwortet, aber dieser Nutzer-ID sind keine Geräte zugeordnet — '
      + 'UID prüfen (Tuya IoT → Devices → Link App Account) oder das UID-Feld leer lassen, '
      + 'dann werden alle Geräte des Projekts gelistet.'
    : 'Tuya antwortet, aber dem Cloud-Projekt sind keine Geräte zugeordnet — '
      + 'unter „Devices → Link App Account" den Smart-Life-Account verknüpfen und '
      + 'prüfen, ob die gewählte Region zum Konto passt.'
}
