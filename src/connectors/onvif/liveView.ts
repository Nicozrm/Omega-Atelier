/**
 * liveView.ts — the fallback ladder for a camera picture, as pure data.
 *
 * The bridge proposes a mode; the browser may still fail on it (no WebRTC
 * stack, a media server that is not running, an MJPEG stream that dies). What
 * must never happen is the thing that prompted this: a black rectangle with no
 * explanation. So every downgrade carries a reason, and the bottom of the
 * ladder is an explicit "not available" — not an empty <video>.
 */

import type { OnvifBridgeHealth, OnvifStreamInfo } from './transport'

export type LiveViewMode = OnvifStreamInfo['mode']

export interface LiveViewState {
  mode: LiveViewMode
  /** Why we are not on a better rung. Shown verbatim to the user. */
  reason?: string
}

/**
 * One step down the ladder: WebRTC → MJPEG → Snapshot → none.
 *
 * A rung is skipped when the bridge said it is not on offer — degrading from
 * WebRTC to MJPEG is pointless if there is no ffmpeg behind it.
 */
export function degradeLiveView(current: LiveViewMode, info: OnvifStreamInfo, reason: string): LiveViewState {
  const hasMjpeg = Boolean(info.mjpegPath)
  const hasSnapshot = Boolean(info.snapshotPath ?? info.snapshot)

  if (current === 'webrtc') {
    if (hasMjpeg) return { mode: 'mjpeg', reason }
    if (hasSnapshot) return { mode: 'snapshot', reason }
    return { mode: 'none', reason }
  }
  if (current === 'mjpeg') {
    if (hasSnapshot) return { mode: 'snapshot', reason }
    return { mode: 'none', reason }
  }
  return { mode: 'none', reason }
}

/** How to restart the bridge — quoted verbatim in the message. */
const RESTART_HINT = 'cd tools/onvif-bridge && npm install && node server.mjs'

/**
 * Why the stream descriptor could not be fetched, in terms the user can act on.
 *
 * The case worth naming: the bridge is a process started by hand and left
 * running, so it is routinely older than the app. A build predating the
 * live-view routes still answers `/cameras` perfectly — the camera connects,
 * its profiles and resolution appear, PTZ works — and then 404s on `/stream`
 * with its own "ONVIF-Route nicht gefunden". Printed raw over the video area,
 * that tells the user nothing at all, and certainly not that the fix is to
 * restart the bridge.
 *
 * `health` is what settles it: a current bridge reports `features.stream`, an
 * old one answers `/health` with no `version` and no `features` at all.
 */
export function diagnoseStreamFailure(
  error: { message: string; status?: number },
  health: OnvifBridgeHealth | null,
): string {
  const outdated = health !== null && health.features?.stream !== true

  if (error.status === 404 && outdated) {
    return 'Die ONVIF-Bridge läuft in einer älteren Version als die App und kennt die '
      + `Stream-Route noch nicht. Bridge neu starten: ${RESTART_HINT}`
  }
  if (error.status === 404) {
    return `Die Bridge kennt diese Route nicht (${error.message}). `
      + `Läuft dort eine aktuelle Version? ${RESTART_HINT}`
  }
  if (error.status === 401 || error.status === 403) {
    return 'Die Bridge lehnt die Anmeldung ab — Bridge-Token in der Karte und in '
      + 'OMEGA_ONVIF_BRIDGE_TOKEN müssen übereinstimmen.'
  }
  if (health === null) {
    return `Die Bridge antwortet nicht (${error.message}) — läuft sie noch, und stimmt die Bridge-URL?`
  }
  return error.message
}

/**
 * Can this bridge deliver a still image?
 *
 * Offering "Snapshot laden" on a bridge whose `/snapshot` route does not exist
 * produces a second dead end from the same cause.
 */
export function bridgeCanSnapshot(health: OnvifBridgeHealth | null): boolean {
  return health?.features?.snapshot === true
}

/** The line under the picture — or instead of it. */
export function liveViewMessage(state: LiveViewState): string {
  switch (state.mode) {
    case 'webrtc': return 'WebRTC · niedrige Latenz'
    case 'mjpeg': return 'MJPEG über die lokale Bridge'
    case 'snapshot':
      return state.reason
        ? `Live-Stream nicht verfügbar — ${state.reason}`
        : 'Live-Stream nicht verfügbar — Snapshot wird angezeigt'
    case 'none':
      return state.reason
        ? `Live-Stream nicht verfügbar — ${state.reason}`
        : 'Live-Stream nicht verfügbar'
  }
}
