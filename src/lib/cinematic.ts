import { play, type SoundName } from './sound'

/**
 * cinematic.ts — "Cinematic Mode": every action should feel like a AAA game,
 * without ever tipping into gimmick. One place decides *whether* the flourish
 * fires and broadcasts a single screen-space **pulse** that the UI layer turns
 * into a soft ring + a few particles, paired with a subtle sound. Renderer- and
 * DOM-neutral: pure preference + a tiny event bus, so the 2D editor (and later
 * the 3D view) react through the same channel.
 *
 * Off by preference → every call is a silent no-op, exactly like `sound.ts`.
 */

const PREF_KEY = 'omega.cinematic'

export function isCinematicEnabled(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== '0' } catch { return true }
}
export function setCinematicEnabled(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

export type CinematicPulseKind = 'place' | 'select' | 'delete'
export interface CinematicPulse {
  /** Viewport (client) coordinates, px. */
  x: number
  y: number
  kind: CinematicPulseKind
  /** Monotonic id — a stable React key for the transient element. */
  id: number
}

type PulseListener = (p: CinematicPulse) => void
const listeners = new Set<PulseListener>()
let seq = 0

/** Subscribe to cinematic pulses; returns an unsubscribe fn. */
export function onCinematicPulse(cb: PulseListener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Broadcast a pulse. Silent no-op when the mode is off or no one is listening. */
export function emitCinematicPulse(x: number, y: number, kind: CinematicPulseKind): CinematicPulse | null {
  if (!isCinematicEnabled()) return null
  const pulse: CinematicPulse = { x, y, kind, id: ++seq }
  for (const cb of listeners) cb(pulse)
  return pulse
}

/** Sound voice per interaction — subtle by design (see sound.ts). */
const KIND_SOUND: Record<CinematicPulseKind, SoundName> = { place: 'thud', select: 'click', delete: 'click' }

/**
 * The complete cinematic reaction to an interaction at a screen point: the
 * subtle sound *and* the visual pulse, together. The single call sites in the
 * editor use this so audio and motion never drift apart.
 */
export function cinematicReact(x: number, y: number, kind: CinematicPulseKind): void {
  if (!isCinematicEnabled()) return
  play(KIND_SOUND[kind])
  emitCinematicPulse(x, y, kind)
}
