/**
 * useComposerStore — the AnalysisStore for the AI Home Composer wizard.
 *
 * Owns the whole wizard flow: location search / GPS, the map view + pin +
 * optional parcel polygon, and the async, cancelable analysis that turns a tap
 * into an editable Omega project. Kept separate from `usePlanStore` so the
 * composer's transient state never touches the plan's undo history; the finished
 * project is handed off explicitly via {@link consumeProject}.
 *
 * The analysis runs through the offline-first `composer` domain — no network,
 * fully deterministic — and reports granular progress so the UI can play its
 * cinematic without ever blocking.
 */

import { create } from 'zustand'
import type { PlanDocument } from '@/types'
import {
  composeProject,
  defaultMapProvider,
  geocodeOffline,
  AnalysisCanceledError,
  type AnalysisProgress,
  type AnalysisStatus,
  type ComposeResult,
  type GeoPoint,
  type GeoResult,
  type MapProvider,
  type MapView,
  type PhaseId,
} from '@/lib/composer'

/** Default zoom the map opens at once a location is chosen. */
export const COMPOSER_ZOOM = 18
/** Cinematic pacing — ms each analysis phase dwells on screen. */
export const PHASE_DELAY_MS = 680

export type ComposerStep = 1 | 2 | 3 | 4

/** Module-scoped controller so the (serialisable) store never holds it. */
let currentAbort: AbortController | null = null

interface ComposerState {
  open: boolean
  step: ComposerStep

  provider: MapProvider

  // ── location ──
  query: string
  searching: boolean
  results: GeoResult[]
  locating: boolean
  locationError: string | null

  // ── map ──
  view: MapView | null
  pin: GeoPoint | null
  polygon: GeoPoint[]
  drawingPolygon: boolean

  // ── analysis ──
  status: AnalysisStatus
  progress: AnalysisProgress | null
  completedPhases: PhaseId[]
  result: ComposeResult | null
  error: string | null
  cinematic: boolean

  // ── actions ──
  openComposer: () => void
  closeComposer: () => void
  reset: () => void
  setStep: (step: ComposerStep) => void
  setProvider: (p: MapProvider) => void

  setQuery: (q: string) => void
  search: () => Promise<void>
  chooseResult: (r: GeoResult) => void
  locateMe: () => Promise<void>

  setView: (v: MapView) => void
  setPin: (p: GeoPoint) => void
  toggleDrawPolygon: () => void
  addPolygonPoint: (p: GeoPoint) => void
  clearPolygon: () => void

  startAnalysis: (opts?: { phaseDelayMs?: number }) => Promise<void>
  cancelAnalysis: () => void
  retryAnalysis: (opts?: { phaseDelayMs?: number }) => Promise<void>
  toggleCinematic: () => void

  /** Hand the finished project to the caller (and clear it from the store). */
  consumeProject: () => PlanDocument | null
}

const INITIAL = {
  step: 1 as ComposerStep,
  query: '',
  searching: false,
  results: [] as GeoResult[],
  locating: false,
  locationError: null as string | null,
  view: null as MapView | null,
  pin: null as GeoPoint | null,
  polygon: [] as GeoPoint[],
  drawingPolygon: false,
  status: 'idle' as AnalysisStatus,
  progress: null as AnalysisProgress | null,
  completedPhases: [] as PhaseId[],
  result: null as ComposeResult | null,
  error: null as string | null,
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  open: false,
  provider: defaultMapProvider,
  cinematic: true,
  ...INITIAL,

  openComposer: () => set({ open: true, ...INITIAL }),
  closeComposer: () => {
    currentAbort?.abort()
    currentAbort = null
    set({ open: false })
  },
  reset: () => {
    currentAbort?.abort()
    currentAbort = null
    set({ ...INITIAL })
  },
  setStep: (step) => set({ step }),
  setProvider: (provider) => set({ provider }),

  setQuery: (query) => set({ query }),

  search: async () => {
    const { query, provider } = get()
    const q = query.trim()
    if (!q) {
      set({ results: [] })
      return
    }
    set({ searching: true, locationError: null })
    try {
      const results = provider.online ? await provider.geocode(q) : geocodeOffline(q)
      set({ results })
    } catch {
      // Offline fallback should never throw, but stay defensive.
      set({ results: geocodeOffline(q) })
    } finally {
      set({ searching: false })
    }
  },

  chooseResult: (r) =>
    set({
      view: { center: r.point, zoom: COMPOSER_ZOOM },
      pin: null,
      results: [],
      polygon: [],
      step: 2,
    }),

  locateMe: async () => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined
    if (!geo) {
      set({ locationError: 'Standort wird auf diesem Gerät nicht unterstützt.' })
      return
    }
    set({ locating: true, locationError: null })
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        geo.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
      })
      const point: GeoPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      set({
        view: { center: point, zoom: COMPOSER_ZOOM },
        pin: point,
        results: [],
        polygon: [],
        step: 2,
        locating: false,
      })
    } catch {
      set({
        locating: false,
        locationError: 'Standort konnte nicht ermittelt werden. Bitte Adresse suchen.',
      })
    }
  },

  setView: (view) => set({ view }),
  setPin: (pin) => set({ pin }),
  toggleDrawPolygon: () => set((s) => ({ drawingPolygon: !s.drawingPolygon })),
  addPolygonPoint: (p) => set((s) => ({ polygon: [...s.polygon, p] })),
  clearPolygon: () => set({ polygon: [] }),

  startAnalysis: async (opts) => {
    const { view, pin, polygon } = get()
    if (!view) {
      set({ status: 'error', error: 'Kein Kartenausschnitt gewählt.' })
      return
    }
    const tap = pin ?? view.center
    currentAbort?.abort()
    const ac = new AbortController()
    currentAbort = ac

    set({
      step: 3,
      status: 'running',
      progress: null,
      completedPhases: [],
      result: null,
      error: null,
    })

    try {
      const result = await composeProject(
        { view, tap, polygon: polygon.length >= 3 ? polygon : undefined },
        {
          signal: ac.signal,
          phaseDelayMs: opts?.phaseDelayMs ?? PHASE_DELAY_MS,
          onProgress: (progress) =>
            set((s) => ({
              progress,
              completedPhases: s.completedPhases.includes(progress.phase)
                ? s.completedPhases
                : [...s.completedPhases, progress.phase],
            })),
        },
      )
      if (ac.signal.aborted) return
      set({ status: 'done', result, step: 4 })
    } catch (err) {
      if (err instanceof AnalysisCanceledError || ac.signal.aborted) {
        set({ status: 'canceled' })
      } else {
        set({ status: 'error', error: err instanceof Error ? err.message : 'Analyse fehlgeschlagen.' })
      }
    } finally {
      if (currentAbort === ac) currentAbort = null
    }
  },

  cancelAnalysis: () => {
    currentAbort?.abort()
    currentAbort = null
    set({ status: 'canceled' })
  },

  retryAnalysis: async (opts) => {
    set({ status: 'idle', progress: null, completedPhases: [], error: null, result: null })
    await get().startAnalysis(opts)
  },

  toggleCinematic: () => set((s) => ({ cinematic: !s.cinematic })),

  consumeProject: () => {
    const project = get().result?.project ?? null
    return project
  },
}))
