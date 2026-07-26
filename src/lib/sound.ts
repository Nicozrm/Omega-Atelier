/**
 * sound.ts — micro-auditory feedback (the fourth dimension of the interface).
 *
 * A tiny, fully synthesized WebAudio engine: no samples, no assets, no
 * network. Three voices, deliberately subtle — the ear should *feel* the
 * Noir-&-Gold design, never notice a "sound effect":
 *
 *  - thud:  a deep, saturated tap when a piece snaps into the grid
 *  - click: a warm, analog tick for OMEGA mode / theme switches
 *  - swell: a barely audible rising breath when the dramatic scene ignites
 *
 * Everything is asynchronous on the audio thread (zero main-thread work per
 * frame) and defensive: without user gesture (autoplay policy), without
 * AudioContext support, or with sound disabled every call is a silent no-op.
 * `installSound()` arms a one-time gesture unlock; the preference persists
 * in localStorage and is exposed to the settings UI.
 */

export type SoundName = 'thud' | 'click' | 'swell'

const PREF_KEY = 'omega.sound'
/** Master level — subtlety is the whole point. */
const MASTER_LEVEL = 0.22

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null

export function isSoundEnabled(): boolean {
  try { return localStorage.getItem(PREF_KEY) !== '0' } catch { return true }
}

export function setSoundEnabled(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

/** Lazily create the context; only ever succeeds after a user gesture. */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = MASTER_LEVEL
    master.connect(ctx.destination)
    // 1.5 s of white noise, shared by every noise-based voice.
    noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.5), ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/**
 * Arm the autoplay unlock: the first pointer/key gesture silently creates and
 * resumes the context so later feedback plays without latency. Call once at
 * startup; safe everywhere.
 */
export function installSound(): void {
  if (typeof document === 'undefined') return
  const unlock = () => {
    ensureContext()
    if (ctx && ctx.state === 'running') {
      document.removeEventListener('pointerdown', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }
  document.addEventListener('pointerdown', unlock, { passive: true })
  document.addEventListener('keydown', unlock, { passive: true })
}

function noiseVoice(c: AudioContext, out: AudioNode, opts: {
  at: number; duration: number; filterType: BiquadFilterType; from: number; to?: number; q?: number
  attack: number; peak: number; release: number
}): void {
  if (!noiseBuffer) return
  const src = c.createBufferSource()
  src.buffer = noiseBuffer
  const filter = c.createBiquadFilter()
  filter.type = opts.filterType
  filter.frequency.setValueAtTime(opts.from, opts.at)
  if (opts.to !== undefined) filter.frequency.exponentialRampToValueAtTime(opts.to, opts.at + opts.duration)
  filter.Q.value = opts.q ?? 1
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, opts.at)
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.at + opts.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.attack + opts.release)
  src.connect(filter).connect(gain).connect(out)
  src.start(opts.at, Math.random(), opts.duration + 0.05)
}

function toneVoice(c: AudioContext, out: AudioNode, opts: {
  at: number; type: OscillatorType; from: number; to?: number; glide?: number
  attack: number; peak: number; release: number
}): void {
  const osc = c.createOscillator()
  osc.type = opts.type
  osc.frequency.setValueAtTime(opts.from, opts.at)
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.to, opts.at + (opts.glide ?? 0.09))
  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, opts.at)
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.at + opts.attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.attack + opts.release)
  osc.connect(gain).connect(out)
  osc.start(opts.at)
  osc.stop(opts.at + opts.attack + opts.release + 0.1)
}

/** Play one of the interface voices. Silent no-op when locked or disabled. */
export function play(name: SoundName): void {
  if (!isSoundEnabled()) return
  const c = ensureContext()
  if (!c || !master || c.state !== 'running') return
  const t = c.currentTime + 0.005

  switch (name) {
    case 'thud':
      // Deep body: a sine dropping 150 → 52 Hz, plus a soft low tap of noise.
      toneVoice(c, master, { at: t, type: 'sine', from: 150, to: 52, glide: 0.08, attack: 0.004, peak: 0.9, release: 0.16 })
      noiseVoice(c, master, { at: t, duration: 0.05, filterType: 'lowpass', from: 420, attack: 0.002, peak: 0.22, release: 0.05 })
      break
    case 'click':
      // Analog switch: a tight band of noise + a tiny mid tick underneath.
      noiseVoice(c, master, { at: t, duration: 0.02, filterType: 'bandpass', from: 2300, q: 5, attack: 0.001, peak: 0.5, release: 0.025 })
      toneVoice(c, master, { at: t + 0.002, type: 'triangle', from: 940, attack: 0.002, peak: 0.16, release: 0.035 })
      break
    case 'swell':
      // A breath of filtered noise opening up — the dramatic light igniting.
      noiseVoice(c, master, { at: t, duration: 1.5, filterType: 'lowpass', from: 240, to: 1350, q: 0.7, attack: 0.85, peak: 0.15, release: 0.65 })
      break
  }
}
