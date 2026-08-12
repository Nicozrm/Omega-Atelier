/**
 * liveView.ts — the fallback ladder for a camera picture, as pure data.
 *
 * The bridge proposes a mode; the browser may still fail on it (no WebRTC
 * stack, a media server that is not running, an MJPEG stream that dies). What
 * must never happen is the thing that prompted this: a black rectangle with no
 * explanation. So every downgrade carries a reason, and the bottom of the
 * ladder is an explicit "not available" — not an empty <video>.
 */

import type { OnvifStreamInfo } from './transport'

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
