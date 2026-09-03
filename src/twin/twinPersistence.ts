/**
 * twinPersistence.ts — the connected devices, kept across sessions.
 *
 * Until now the Digital Twin lived entirely in memory: connect a source, assign
 * its devices to rooms, reload the page — and everything was gone, for a
 * signed-in user as much as for a visitor. The plan document persisted; the
 * devices did not.
 *
 * Two rules shape this module.
 *
 * **One save, not a stream of them.** A connected fleet emits capability
 * updates continuously (Govee and SwitchBot poll, the simulated ecosystems tick
 * every couple of seconds, an ONVIF camera re-reports every five). Persisting
 * "the twin" on change would mean a write every second or two, forever. So what
 * is saved is the *identity* of the twin — which devices exist, what they are,
 * which room they belong to, which sources were connected — and a fingerprint
 * over exactly that decides whether a write is warranted. A lamp turning on is
 * not a reason to write; a lamp appearing is.
 *
 * **No secrets.** Connectors are remembered by id, kind and label only. No
 * token, no API secret, no camera password is written anywhere — reconnecting a
 * live source still asks for its credentials.
 */

import type { Device } from '@/domain'

export const TWIN_STATE_VERSION = 1

/** A source that was connected, remembered well enough to offer it again. */
export interface SavedConnector {
  id: string
  kind: string
  label: string
}

export interface TwinPersistedState {
  version: number
  savedAt: string
  /** device id → room id (the manual overrides). */
  bindings: Record<string, string>
  connectors: SavedConnector[]
  devices: Device[]
}

/**
 * The fingerprint that decides whether a save is warranted.
 *
 * Deliberately blind to capability *values* and to `lastSeen`: those change on
 * every poll and mean nothing for what has to survive a reload. It covers what
 * does — which devices exist, what they are called, what they can do, where
 * they live, and which sources were connected.
 */
export function persistableSignature(state: TwinPersistedState): string {
  const devices = state.devices
    .map((d) => [
      d.id,
      d.connectorId,
      d.name,
      d.category,
      // Kinds, not values: "this is dimmable" persists, "it is at 40 %" does not.
      d.capabilities.map((c) => c.kind).sort().join(','),
      JSON.stringify(d.metadata ?? {}),
      state.bindings[d.id] ?? '',
    ].join('|'))
    .sort()
  const connectors = state.connectors.map((c) => `${c.id}:${c.kind}:${c.label}`).sort()
  return JSON.stringify({ v: state.version, devices, connectors })
}

/**
 * Devices come back as they were, but not as *live*: nothing has spoken to them
 * since the last session, and claiming otherwise would put a green dot on a
 * lamp that may have been unplugged since.
 */
export function restoredDevices(state: TwinPersistedState): Device[] {
  return state.devices.map((d) => ({
    ...d,
    health: { ...d.health, reachability: 'unknown' as const },
  }))
}

/** Reject anything that is not a state this build understands. */
export function coerceTwinState(raw: unknown): TwinPersistedState | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<TwinPersistedState>
  if (value.version !== TWIN_STATE_VERSION) return null
  if (!Array.isArray(value.devices) || !Array.isArray(value.connectors)) return null
  const devices = value.devices.filter(
    (d): d is Device =>
      Boolean(d) && typeof d.id === 'string' && typeof d.connectorId === 'string'
      && Array.isArray(d.capabilities) && typeof d.name === 'string',
  )
  const connectors = value.connectors.filter(
    (c): c is SavedConnector => Boolean(c) && typeof c.id === 'string' && typeof c.kind === 'string',
  )
  const bindings: Record<string, string> = {}
  for (const [k, v] of Object.entries(value.bindings ?? {})) {
    if (typeof v === 'string') bindings[k] = v
  }
  return {
    version: TWIN_STATE_VERSION,
    savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date(0).toISOString(),
    bindings,
    connectors,
    devices,
  }
}

/** Where a twin state is kept. Implementations: browser-local, or the account. */
export interface TwinStateStore {
  load(): Promise<TwinPersistedState | null>
  save(state: TwinPersistedState): Promise<void>
}

const LOCAL_KEY = 'omega:twin-state'

/** Fallback for visitors who are not signed in. Same shape, smaller promise. */
export class LocalTwinStateStore implements TwinStateStore {
  constructor(private readonly key = LOCAL_KEY) {}

  async load(): Promise<TwinPersistedState | null> {
    try {
      const raw = localStorage.getItem(this.key)
      return raw ? coerceTwinState(JSON.parse(raw)) : null
    } catch {
      return null
    }
  }

  async save(state: TwinPersistedState): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(state))
    } catch {
      /* quota — non-fatal, the twin still works for this session */
    }
  }
}

export interface TwinPersistenceOptions {
  store: TwinStateStore
  /** Quiet period before a warranted write goes out. */
  debounceMs?: number
  /** Floor between two writes, whatever happens in between. */
  minIntervalMs?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  onError?: (error: unknown) => void
}

export interface TwinPersistence {
  /** Offer the current state. Writes only if its fingerprint actually changed. */
  schedule(state: TwinPersistedState): void
  /** Write a pending change now — what the Save button reaches. */
  flush(): Promise<void>
  /** Adopt a fingerprint without writing (after a load). */
  prime(state: TwinPersistedState): void
  dispose(): void
}

/**
 * A coalescing writer.
 *
 * Three things collapse into one write: repeated identical states (fingerprint),
 * a burst of real changes (debounce), and changes arriving while a write is
 * already in flight (single pending slot, never a queue).
 */
export function createTwinPersistence(options: TwinPersistenceOptions): TwinPersistence {
  const {
    store,
    debounceMs = 3000,
    minIntervalMs = 10_000,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onError = () => {},
  } = options

  let lastSignature: string | undefined
  let pending: TwinPersistedState | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> | undefined
  let lastWriteAt = 0
  let disposed = false

  const cancelTimer = () => {
    if (timer !== undefined) { clearTimer(timer); timer = undefined }
  }

  const write = async (): Promise<void> => {
    if (!pending || disposed) return
    const state = { ...pending, savedAt: new Date(now()).toISOString() }
    const signature = persistableSignature(state)
    pending = undefined
    lastWriteAt = now()
    try {
      await store.save(state)
      lastSignature = signature
    } catch (error) {
      // Keep the old fingerprint so the next change retries instead of
      // concluding that the state is already safely stored.
      onError(error)
    }
  }

  const run = async (): Promise<void> => {
    cancelTimer()
    if (writing) { await writing; if (pending) await run(); return }
    writing = write().finally(() => { writing = undefined })
    await writing
  }

  const arm = () => {
    cancelTimer()
    const sinceLast = now() - lastWriteAt
    const wait = Math.max(debounceMs, minIntervalMs - sinceLast)
    timer = setTimer(() => { void run() }, wait)
  }

  return {
    schedule(state) {
      if (disposed) return
      const signature = persistableSignature(state)
      if (signature === lastSignature) return
      // A pending state with the same fingerprint is already queued.
      if (pending && persistableSignature(pending) === signature) return
      pending = state
      arm()
    },

    async flush() {
      if (disposed) return
      if (!pending && !writing) return
      await run()
    },

    prime(state) {
      lastSignature = persistableSignature(state)
      lastWriteAt = now()
    },

    dispose() {
      disposed = true
      cancelTimer()
      pending = undefined
    },
  }
}
