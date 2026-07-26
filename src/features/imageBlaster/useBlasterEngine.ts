/**
 * useBlasterEngine — orchestrates the Image-Blaster-3D pipeline for the UI.
 *
 * Owns the source images (decoded off the DOM into plain PixelGrids), the
 * pipeline settings and the staged execution with live progress. Re-runs
 * automatically (debounced) whenever the active source or settings change;
 * stale runs are cancelled via a run counter.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { uuid } from '@/lib/utils'
import type { LibraryEntry } from './blasterLibrary'
import {
  DEFAULT_SETTINGS,
  analyseImage,
  buildBillboardMesh,
  buildExtrudeMesh,
  buildPointCloud,
  buildReliefMesh,
  downsample,
  estimateDepth,
  normalMapFromDepth,
  roughnessMapFromImage,
  segmentMask,
  type BlasterSettings,
  type ImageAnalysis,
  type MeshData,
  type PixelGrid,
  type PipelineStageKey,
  type PointCloudData,
  type ScalarField,
} from '@/lib/imageBlaster'

/** Longest edge kept for the albedo texture. */
const ALBEDO_MAX_EDGE = 1024
/** Longest edge of the working grid all estimation runs on. */
const WORK_MAX_EDGE = 288

export interface BlasterSource {
  id: string
  name: string
  /** Object URL of the original file — used for thumbnails. */
  url: string
  full: PixelGrid
  work: PixelGrid
}

export type StageStatus = 'idle' | 'running' | 'done'

export interface BlasterResult {
  analysis: ImageAnalysis
  mask: ScalarField
  depth: ScalarField
  /** Triangle geometry — null in points mode. */
  meshData: MeshData | null
  /** Colored point cloud — only set in points mode. */
  pointCloud: PointCloudData | null
  albedo: PixelGrid
  normalMap: PixelGrid
  roughnessMap: PixelGrid | null
}

/** Deep-partial settings patch. */
export interface SettingsPatch {
  depth?: Partial<BlasterSettings['depth']>
  mesh?: Partial<BlasterSettings['mesh']>
  material?: Partial<BlasterSettings['material']>
}

const IDLE_STAGES: Record<PipelineStageKey, StageStatus> = {
  analyse: 'idle', segment: 'idle', depth: 'idle', mesh: 'idle', texture: 'idle',
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Render a PixelGrid into a fresh canvas (UI thumbnails + three textures). */
export function pixelsToCanvas(p: PixelGrid): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = p.width
  canvas.height = p.height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    // PixelGrid is structurally an ImageData payload.
    ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0)
  }
  return canvas
}

async function decodeImageUrl(url: string, name: string): Promise<BlasterSource> {
  const img = new Image()
  img.src = url
  await img.decode()
  const scale = Math.min(1, ALBEDO_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D nicht verfügbar')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  const full: PixelGrid = { data: data.data, width: w, height: h }
  return { id: uuid(), name, url, full, work: downsample(full, WORK_MAX_EDGE) }
}

function decodeFile(file: File): Promise<BlasterSource> {
  return decodeImageUrl(URL.createObjectURL(file), file.name)
}

export function useBlasterEngine() {
  const [sources, setSources] = useState<BlasterSource[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [settings, setSettings] = useState<BlasterSettings>(DEFAULT_SETTINGS)
  const [stages, setStages] = useState<Record<PipelineStageKey, StageStatus>>(IDLE_STAGES)
  const [result, setResult] = useState<BlasterResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runIdRef = useRef(0)
  const autoTunedRef = useRef<Set<string>>(new Set())

  const active = sources.find((s) => s.id === activeId) ?? null

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (list.length === 0) return
    setError(null)
    try {
      const decoded = await Promise.all(list.map(decodeFile))
      setSources((prev) => [...prev, ...decoded])
      setActiveId((prev) => prev ?? decoded[0]?.id ?? null)
      if (decoded.length > 0 && !activeId) setActiveId(decoded[0].id)
    } catch {
      setError('Bild konnte nicht gelesen werden — bitte PNG/JPG/WebP verwenden.')
    }
  }, [activeId])

  const removeSource = useCallback((id: string) => {
    setSources((prev) => {
      const gone = prev.find((s) => s.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      const next = prev.filter((s) => s.id !== id)
      setActiveId((cur) => (cur === id ? next[0]?.id ?? null : cur))
      if (next.length === 0) {
        setResult(null)
        setStages(IDLE_STAGES)
      }
      return next
    })
  }, [])

  /** Snapshot of the active source + settings as a library entry (≤512px). */
  const buildLibraryEntry = useCallback((): LibraryEntry | null => {
    if (!active) return null
    const thumb = downsample(active.full, 512)
    let hasAlpha = false
    for (let i = 3; i < thumb.data.length; i += 4) {
      if (thumb.data[i] < 250) { hasAlpha = true; break }
    }
    const canvas = pixelsToCanvas(thumb)
    // PNG keeps the alpha channel (cutout sources); JPEG keeps photos small.
    const image = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
    return { id: uuid(), name: active.name, savedAt: new Date().toISOString(), image, settings }
  }, [active, settings])

  /** Restore a saved asset: decode its image and adopt its settings as-is. */
  const loadLibraryEntry = useCallback(async (entry: LibraryEntry) => {
    setError(null)
    try {
      const src = await decodeImageUrl(entry.image, entry.name)
      autoTunedRef.current.add(src.id) // saved settings win over auto-suggestions
      setSources((prev) => [...prev, src])
      setActiveId(src.id)
      setSettings(entry.settings)
    } catch {
      setError('Bibliothekseintrag konnte nicht geladen werden.')
    }
  }, [])

  const updateSettings = useCallback((patch: SettingsPatch) => {
    setSettings((prev) => ({
      depth: { ...prev.depth, ...patch.depth },
      mesh: { ...prev.mesh, ...patch.mesh },
      material: { ...prev.material, ...patch.material },
    }))
  }, [])

  // The pipeline itself. Stage pacing is deliberate: each stage yields to the
  // event loop so the stage list animates and the main thread never janks.
  useEffect(() => {
    if (!active) return
    const runId = ++runIdRef.current
    const isStale = () => runIdRef.current !== runId
    const timer = setTimeout(async () => {
      setRunning(true)
      setError(null)
      const mark = (key: PipelineStageKey, status: StageStatus) =>
        setStages((prev) => ({ ...prev, [key]: status }))
      setStages({ analyse: 'running', segment: 'idle', depth: 'idle', mesh: 'idle', texture: 'idle' })
      try {
        // 1 — analyse
        const analysis = analyseImage(active.work)
        mark('analyse', 'done')

        // First contact with a new image: adopt the analysis' suggestions once.
        let effective = settings
        if (!autoTunedRef.current.has(active.id)) {
          autoTunedRef.current.add(active.id)
          effective = {
            ...settings,
            mesh: { ...settings.mesh, mode: analysis.suggestedMode, segmentSource: analysis.suggestedSegment },
          }
          setSettings(effective)
        }
        await sleep(50)
        if (isStale()) return

        // 2 — segment
        mark('segment', 'running')
        const mask = segmentMask(active.work, effective.mesh.segmentSource, effective.mesh.threshold)
        await sleep(50)
        if (isStale()) return
        mark('segment', 'done')

        // 3 — depth
        mark('depth', 'running')
        const depth = estimateDepth(active.work, effective.depth)
        await sleep(50)
        if (isStale()) return
        mark('depth', 'done')

        // 4 — mesh / point cloud
        mark('mesh', 'running')
        let meshData: MeshData | null = null
        let pointCloud: PointCloudData | null = null
        if (effective.mesh.mode === 'relief') {
          meshData = buildReliefMesh(depth, effective.mesh)
        } else if (effective.mesh.mode === 'extrude') {
          meshData = buildExtrudeMesh(mask, effective.mesh)
            ?? buildReliefMesh(depth, effective.mesh) // empty mask → graceful fallback
        } else if (effective.mesh.mode === 'points') {
          pointCloud = buildPointCloud(depth, active.work, effective.mesh)
        } else {
          meshData = buildBillboardMesh(active.work.width, active.work.height)
        }
        await sleep(50)
        if (isStale()) return
        mark('mesh', 'done')

        // 5 — texture (PBR maps)
        mark('texture', 'running')
        const normalMap = normalMapFromDepth(depth, effective.material.normalStrength)
        const roughnessMap = effective.material.roughnessFromImage
          ? roughnessMapFromImage(active.work, effective.material.roughness)
          : null
        await sleep(40)
        if (isStale()) return
        mark('texture', 'done')

        setResult({ analysis, mask, depth, meshData, pointCloud, albedo: active.full, normalMap, roughnessMap })
      } catch (e) {
        if (!isStale()) {
          setError(e instanceof Error ? e.message : 'Pipeline-Fehler')
        }
      } finally {
        if (!isStale()) setRunning(false)
      }
    }, 160) // debounce slider scrubbing
    return () => clearTimeout(timer)
  }, [active, settings])

  // Track the live source list so the unmount cleanup below sees the latest.
  const sourcesRef = useRef<BlasterSource[]>([])
  useEffect(() => { sourcesRef.current = sources }, [sources])

  // On unmount: cancel any in-flight run and release all object URLs.
  useEffect(() => {
    const runIds = runIdRef
    const liveSources = sourcesRef
    return () => {
      runIds.current++
      for (const s of liveSources.current) URL.revokeObjectURL(s.url)
    }
  }, [])

  return {
    sources,
    active,
    setActiveId,
    addFiles,
    removeSource,
    settings,
    updateSettings,
    buildLibraryEntry,
    loadLibraryEntry,
    stages,
    result,
    running,
    error,
  }
}
