/**
 * ImageBlasterStudio — the full-screen Image-→-3D workbench.
 *
 * Composition: source intake + pipeline monitor (left), live 3D viewport
 * (center), parameter inspector + multi-format export (right). All heavy
 * lifting lives in `useBlasterEngine` / `@/lib/imageBlaster`; this file is
 * pure composition in the OMEGA design language.
 */

import { useMemo, useRef, useState, useCallback, useId, type ReactNode } from 'react'
import {
  Wand2, X, Check, Loader2, ImagePlus, Trash2, RotateCw, LayoutGrid,
  ImageDown, Maximize2, Download, Box, Layers, Palette, SlidersHorizontal,
  Bookmark, FolderOpen, Home, Eye, EyeOff, Repeat,
} from 'lucide-react'
import { Badge, IconButton, InspectorSection, SegmentedControl, Tooltip, useModalA11y } from '@/ui'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { cn, downloadBlob, timeAgo, uuid } from '@/lib/utils'
import type { BlasterMount } from '@/types'
import {
  PIPELINE_STAGES,
  fieldToPixels,
  pointCloudToPLY,
  largestRoom,
  wallArtPlacement,
  floorObjectPlacement,
  nextWallPlacement,
  type MeshMode,
  type SegmentSource,
} from '@/lib/imageBlaster'
import { EXPORT_FORMATS, type ExportFormat } from '@/lib/imageBlaster/formats'
import { useBlasterEngine, pixelsToCanvas } from './useBlasterEngine'
import { BlasterPreview, type BlasterPreviewApi } from './BlasterPreview'
import { loadLibrary, saveToLibrary, removeFromLibrary, type LibraryEntry } from './blasterLibrary'

interface Props {
  open: boolean
  onClose: () => void
}

export function ImageBlasterStudio({ open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useModalA11y({ open, onClose, containerRef: panelRef })

  const engine = useBlasterEngine()
  const pushToast = useUIStore((s) => s.pushToast)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const doc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  const apiRef = useRef<BlasterPreviewApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [turntable, setTurntable] = useState(true)
  const [busyExport, setBusyExport] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[]>(() => loadLibrary())
  const [planRoomId, setPlanRoomId] = useState<string>('')
  const [planMount, setPlanMount] = useState<BlasterMount>('wall')
  const [planWidth, setPlanWidth] = useState(120)

  const activeFloor = doc?.floors.find((f) => f.id === doc.activeFloorId) ?? null

  const { settings, updateSettings, result, stages, running, error } = engine

  // Map thumbnails — regenerated only when the underlying fields change.
  const mapThumbs = useMemo(() => {
    if (!result) return null
    return {
      depth: pixelsToCanvas(fieldToPixels(result.depth)).toDataURL(),
      normal: pixelsToCanvas(result.normalMap).toDataURL(),
    }
  }, [result])

  const statsLabel = useMemo(() => {
    if (!result) return null
    if (result.pointCloud) {
      return `${result.pointCloud.count.toLocaleString('de-DE')} Punkte`
    }
    if (result.meshData) {
      const tris = (result.meshData.indices.length / 3).toLocaleString('de-DE')
      const verts = (result.meshData.positions.length / 3).toLocaleString('de-DE')
      return `${tris} Dreiecke · ${verts} Vertices`
    }
    return null
  }, [result])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) void engine.addFiles(e.dataTransfer.files)
  }, [engine])

  const handleExport = async (format: ExportFormat) => {
    if (!engine.active || !result) return
    setBusyExport(format)
    try {
      const stem = engine.active.name.replace(/\.[a-z0-9]+$/i, '') || 'omega-asset'
      if (format === 'ply' && result.pointCloud) {
        // Point clouds have their own pure PLY writer — no three.js needed.
        const filename = `${stem}.ply`
        downloadBlob(new Blob([pointCloudToPLY(result.pointCloud)], { type: 'application/octet-stream' }), filename)
        pushToast({ kind: 'success', title: 'PLY exportiert', description: filename })
        return
      }
      const object = apiRef.current?.getObject()
      if (!object) return
      const { exportMesh } = await import('@/lib/imageBlaster/exporters')
      const { blob, filename } = await exportMesh(object, format, engine.active.name)
      downloadBlob(blob, filename)
      pushToast({ kind: 'success', title: `${format.toUpperCase()} exportiert`, description: filename })
    } catch (e) {
      pushToast({
        kind: 'error',
        title: 'Export fehlgeschlagen',
        description: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusyExport(null)
    }
  }

  const handlePlaceInPlan = () => {
    const entry = engine.buildLibraryEntry() // same recipe snapshot the library uses
    if (!entry || !engine.active || !activeFloor) return
    const room =
      activeFloor.rooms.find((r) => r.id === planRoomId) ?? largestRoom(activeFloor.rooms)
    const placement = room
      ? planMount === 'wall' ? wallArtPlacement(room) : floorObjectPlacement(room)
      : { position: { x: activeFloor.extent.width / 2, y: activeFloor.extent.height / 2 }, rotation: 180 }
    // Physical height of the asset (cm) from the source aspect ratio; floor
    // objects stand on the ground, wall art hangs at gallery height.
    const { width: iw, height: ih } = engine.active.full
    const heightCm = planWidth * (ih / Math.max(iw, ih))
    const elevation = planMount === 'wall' ? 140 : Math.max(heightCm / 2, 10)
    const assetId = uuid()
    updateDoc((d) => {
      const fl = d.floors.find((f) => f.id === d.activeFloorId)
      if (!fl) return
      if (!fl.blasterAssets) fl.blasterAssets = []
      fl.blasterAssets.push({
        id: assetId,
        name: entry.name,
        image: entry.image,
        settings: entry.settings as unknown as Record<string, unknown>,
        position: placement.position,
        rotation: placement.rotation,
        width: planWidth,
        elevation,
        mount: planMount,
        roomId: room?.id,
      })
    })
    pushToast({
      kind: 'success',
      title: 'Im Plan platziert',
      description: `${entry.name} → ${room?.name ?? 'Etage'} — antippen für die 3D-Ansicht`,
      duration: 8000,
      onClick: () => { onClose(); setViewMode('3d') },
    })
  }

  const toggleAssetHidden = (assetId: string) => {
    updateDoc((d) => {
      const a = d.floors.find((f) => f.id === d.activeFloorId)?.blasterAssets?.find((x) => x.id === assetId)
      if (a) a.hidden = !a.hidden
    })
  }

  const removeAsset = (assetId: string) => {
    updateDoc((d) => {
      const fl = d.floors.find((f) => f.id === d.activeFloorId)
      if (fl?.blasterAssets) fl.blasterAssets = fl.blasterAssets.filter((x) => x.id !== assetId)
    })
  }

  const cycleAssetWall = (assetId: string) => {
    updateDoc((d) => {
      const fl = d.floors.find((f) => f.id === d.activeFloorId)
      const a = fl?.blasterAssets?.find((x) => x.id === assetId)
      if (!fl || !a) return
      const room = fl.rooms.find((r) => r.id === a.roomId) ?? largestRoom(fl.rooms)
      if (!room) return
      const next = nextWallPlacement(room, a.position)
      a.position = next.position
      a.rotation = next.rotation
    })
  }

  const handleSaveToLibrary = () => {
    const entry = engine.buildLibraryEntry()
    if (!entry) return
    const next = saveToLibrary(entry)
    if (next) {
      setLibrary(next)
      pushToast({ kind: 'success', title: 'In Bibliothek gesichert', description: entry.name })
    } else {
      pushToast({ kind: 'error', title: 'Speicher voll', description: 'Bibliothek konnte nicht gesichert werden.' })
    }
  }

  const downloadMap = (kind: 'depth' | 'normal') => {
    if (!mapThumbs || !engine.active) return
    const a = document.createElement('a')
    a.href = kind === 'depth' ? mapThumbs.depth : mapThumbs.normal
    a.download = `${engine.active.name.replace(/\.[a-z0-9]+$/i, '')}.${kind}.png`
    a.click()
  }

  const takeSnapshot = () => {
    const url = apiRef.current?.snapshot()
    if (!url || !engine.active) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${engine.active.name.replace(/\.[a-z0-9]+$/i, '')}.render.png`
    a.click()
    pushToast({ kind: 'success', title: 'Render gespeichert' })
  }

  if (!open) return null

  const mode = settings.mesh.mode

  return (
    <div className="fixed inset-0 z-50 scrim animate-fade-in" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-2 md:inset-4 xl:inset-6 surface-glass !p-0 flex flex-col overflow-hidden animate-pop-in outline-none"
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-[color:var(--border)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[color:var(--accent-bright)] to-[#9A7B36] text-white shadow-[0_2px_12px_rgba(230,204,134,0.35)]">
            <Wand2 size={18} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg leading-tight flex items-center gap-2">
              Image Blaster 3D
              <Badge tone="accent">Skill-Pipeline</Badge>
            </h2>
            <p className="hidden md:block text-xs text-[color:var(--muted)]">
              Bild → Tiefenschätzung → Mesh → PBR-Material → glTF / USDZ / OBJ / PLY / STL
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label="Studio schließen" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </header>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto omega-scroll lg:grid lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:overflow-hidden">

          {/* LEFT — source intake + pipeline monitor */}
          <aside className="shrink-0 border-b lg:border-b-0 lg:border-r border-[color:var(--border)] lg:overflow-y-auto omega-scroll p-3 space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) void engine.addFiles(e.target.files); e.target.value = '' }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'w-full rounded-[var(--radius-md)] border-2 border-dashed p-4 text-center transition-all duration-200',
                dragging
                  ? 'border-[color:var(--accent-bright)] bg-[color:var(--surface-2)] scale-[1.02]'
                  : 'border-[color:var(--border-strong)] hover:border-[color:var(--accent-bright)] hover:bg-[color:var(--surface-2)]',
              )}
            >
              <ImagePlus size={22} className="mx-auto mb-1.5 text-[color:var(--accent-bright)]" />
              <div className="text-sm font-medium">Bilder hierher ziehen</div>
              <div className="text-xs text-[color:var(--muted)]">oder klicken — PNG · JPG · WebP</div>
            </button>

            {error && (
              <p className="text-xs text-[color:var(--color-omega-danger)]">{error}</p>
            )}

            {engine.sources.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="label-xs">Quellen ({engine.sources.length})</span>
                  <button
                    onClick={handleSaveToLibrary}
                    disabled={!engine.active}
                    className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[color:var(--muted)] transition-colors hover:text-[color:var(--accent-bright)] disabled:opacity-40"
                    title="Aktives Bild + Einstellungen in der Bibliothek sichern"
                  >
                    <Bookmark size={11} /> Sichern
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {engine.sources.map((s) => (
                    <div key={s.id} className="relative group">
                      <button
                        onClick={() => engine.setActiveId(s.id)}
                        className={cn(
                          'block w-full h-16 rounded-[var(--radius-sm)] overflow-hidden border transition-all',
                          s.id === engine.active?.id
                            ? 'border-[color:var(--accent-bright)] shadow-[0_0_0_1px_var(--accent-bright)]'
                            : 'border-[color:var(--border)] opacity-70 hover:opacity-100',
                        )}
                        title={s.name}
                      >
                        <img src={s.url} alt={s.name} className="h-full w-full object-cover" />
                      </button>
                      <button
                        onClick={() => engine.removeSource(s.id)}
                        aria-label={`${s.name} entfernen`}
                        className="absolute -right-1.5 -top-1.5 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--surface-3)] border border-[color:var(--border-strong)] text-[color:var(--muted)] hover:text-[color:var(--color-omega-danger)]"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Persistent library — survives reloads via localStorage */}
            {library.length > 0 && (
              <div>
                <div className="label-xs mb-2 flex items-center gap-1.5">
                  <FolderOpen size={11} /> Bibliothek ({library.length})
                </div>
                <div className="space-y-1">
                  {library.map((entry) => (
                    <div key={entry.id} className="group flex items-center gap-2">
                      <button
                        onClick={() => void engine.loadLibraryEntry(entry)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] p-1 text-left transition-colors hover:border-[color:var(--accent-bright)] hover:bg-[color:var(--surface-2)]"
                        title={`${entry.name} laden`}
                      >
                        <img src={entry.image} alt={entry.name} className="h-8 w-8 shrink-0 rounded object-cover" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs">{entry.name}</span>
                          <span className="block text-[10px] text-[color:var(--muted)]">{timeAgo(entry.savedAt)}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => setLibrary(removeFromLibrary(entry.id))}
                        aria-label={`${entry.name} aus Bibliothek löschen`}
                        className="hidden shrink-0 text-[color:var(--muted)] hover:text-[color:var(--color-omega-danger)] group-hover:block"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pipeline monitor */}
            <div>
              <div className="label-xs mb-2">Pipeline</div>
              <ol className="space-y-1">
                {PIPELINE_STAGES.map((stage, i) => {
                  const st = stages[stage.key]
                  return (
                    <li
                      key={stage.key}
                      className={cn(
                        'flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm transition-colors',
                        st === 'running' && 'bg-[color:var(--surface-2)]',
                        st === 'idle' && 'text-[color:var(--muted)]',
                      )}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {st === 'done' ? (
                          <Check size={14} className="text-[color:var(--color-omega-success)]" />
                        ) : st === 'running' ? (
                          <Loader2 size={14} className="animate-spin text-[color:var(--accent-bright)]" />
                        ) : (
                          <span className="font-mono text-[10px] text-[color:var(--muted)]">{i + 1}</span>
                        )}
                      </span>
                      {stage.label}
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* Analysis readout */}
            {result && (
              <div>
                <div className="label-xs mb-2">Analyse</div>
                <div className="space-y-1.5 text-xs text-[color:var(--muted)]">
                  {engine.active && (
                    <div className="flex justify-between">
                      <span>Auflösung</span>
                      <span className="font-mono">{engine.active.full.width} × {engine.active.full.height}px</span>
                    </div>
                  )}
                  <div className="flex justify-between"><span>Kontrast</span><span className="font-mono">{Math.round(result.analysis.contrast * 100)} %</span></div>
                  <div className="flex justify-between"><span>Kantendichte</span><span className="font-mono">{Math.round(result.analysis.edgeDensity * 100)} %</span></div>
                  <div className="flex justify-between">
                    <span>Alphakanal</span>
                    <span className="font-mono">{result.analysis.transparentRatio > 0.02 ? 'ja' : 'nein'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Farbwelt</span>
                    <span className="flex gap-1">
                      {result.analysis.dominantColors.map((c) => (
                        <span key={c} title={c} className="h-3.5 w-3.5 rounded-full border border-[color:var(--border-strong)]" style={{ background: c }} />
                      ))}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Generated maps */}
            {result && mapThumbs && engine.active && (
              <div>
                <div className="label-xs mb-2">PBR-Maps</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['Albedo', engine.active.url],
                    ['Tiefe', mapThumbs.depth],
                    ['Normal', mapThumbs.normal],
                  ] as const).map(([label, src]) => (
                    <figure key={label}>
                      <img src={src} alt={`${label}-Map`} className="h-14 w-full rounded-[var(--radius-sm)] border border-[color:var(--border)] object-cover" />
                      <figcaption className="mt-0.5 text-center text-[10px] text-[color:var(--muted)]">{label}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* CENTER — viewport */}
          <main className="relative min-h-[340px] lg:min-h-0 bg-[radial-gradient(120%_90%_at_50%_10%,color-mix(in_srgb,var(--accent)_7%,transparent),transparent_60%),radial-gradient(100%_100%_at_50%_100%,rgba(0,0,0,0.35),transparent_55%)]">
            {result ? (
              <>
                <BlasterPreview
                  result={result}
                  material={settings.material}
                  mode={mode}
                  pointSize={settings.mesh.pointSize}
                  wireframe={wireframe}
                  turntable={turntable}
                  apiRef={apiRef}
                />
                {statsLabel && (
                  <div className="pointer-events-none absolute left-3 top-3 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-2.5 py-1 font-mono text-[10px] text-[color:var(--muted)] backdrop-blur-md">
                    {statsLabel}
                  </div>
                )}
                {running && (
                  <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-2.5 py-1 text-[10px] text-[color:var(--accent-bright)] backdrop-blur-md">
                    <Loader2 size={11} className="animate-spin" /> Pipeline läuft
                  </div>
                )}
                {/* Viewport controls */}
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--glass-bg)] px-2 py-1 backdrop-blur-md">
                  <Tooltip label={turntable ? 'Drehteller stoppen' : 'Drehteller starten'} side="top">
                    <IconButton
                      label="Drehteller"
                      size="sm"
                      onClick={() => setTurntable((v) => !v)}
                      className={turntable ? 'text-[color:var(--accent-bright)]' : ''}
                    >
                      <RotateCw size={15} />
                    </IconButton>
                  </Tooltip>
                  {mode !== 'points' && (
                    <Tooltip label="Drahtgitter" side="top">
                      <IconButton
                        label="Drahtgitter"
                        size="sm"
                        onClick={() => setWireframe((v) => !v)}
                        className={wireframe ? 'text-[color:var(--accent-bright)]' : ''}
                      >
                        <LayoutGrid size={15} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip label="Ansicht zurücksetzen" side="top">
                    <IconButton label="Ansicht zurücksetzen" size="sm" onClick={() => apiRef.current?.resetView()}>
                      <Maximize2 size={15} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip label="Render als PNG" side="top">
                    <IconButton label="Render als PNG speichern" size="sm" onClick={takeSnapshot}>
                      <ImageDown size={15} />
                    </IconButton>
                  </Tooltip>
                </div>
              </>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
              >
                {running ? (
                  <Loader2 size={32} className="animate-spin text-[color:var(--accent-bright)]" />
                ) : (
                  <>
                    <span className={cn(
                      'flex h-20 w-20 items-center justify-center rounded-3xl border-2 border-dashed transition-all duration-300',
                      dragging
                        ? 'border-[color:var(--accent-bright)] scale-110 bg-[color:var(--surface-2)]'
                        : 'border-[color:var(--border-strong)]',
                    )}>
                      <Wand2 size={30} className="text-[color:var(--accent-bright)]" />
                    </span>
                    <div>
                      <div className="font-display text-lg">Wirf ein Bild hinein</div>
                      <p className="mt-1 max-w-xs text-sm text-[color:var(--muted)]">
                        Die Pipeline analysiert es, schätzt Tiefe und baut daraus ein
                        texturiertes 3D-Asset — direkt im Browser.
                      </p>
                    </div>
                  </>
                )}
              </button>
            )}
          </main>

          {/* RIGHT — inspector + export */}
          <aside className="shrink-0 border-t lg:border-t-0 lg:border-l border-[color:var(--border)] lg:overflow-y-auto omega-scroll">
            <InspectorSection title="Geometrie" icon={<Box size={13} />}>
              <div className="space-y-3">
                <SegmentedControl<MeshMode>
                  block
                  size="sm"
                  value={mode}
                  onChange={(m) => updateSettings({ mesh: { mode: m } })}
                  options={[
                    { value: 'relief', label: 'Relief' },
                    { value: 'extrude', label: 'Extrusion' },
                    { value: 'billboard', label: 'Fläche' },
                    { value: 'points', label: 'Punkte' },
                  ]}
                />
                {(mode === 'relief' || mode === 'points') && (
                  <>
                    <SliderRow
                      label={mode === 'points' ? 'Dichte' : 'Auflösung'}
                      value={settings.mesh.resolution} min={24} max={256} step={8}
                      onChange={(v) => updateSettings({ mesh: { resolution: v } })}
                      display={(v) => `${v}²`}
                    />
                    <SliderRow
                      label="Tiefe" value={settings.mesh.depthScale} min={0.02} max={0.6} step={0.01}
                      onChange={(v) => updateSettings({ mesh: { depthScale: v } })}
                      display={(v) => v.toFixed(2)}
                    />
                  </>
                )}
                {mode === 'relief' && (
                  <ToggleRow
                    label="Geschlossene Rückseite"
                    checked={settings.mesh.solidBack}
                    onChange={(v) => updateSettings({ mesh: { solidBack: v } })}
                  />
                )}
                {mode === 'points' && (
                  <SliderRow
                    label="Punktgröße" value={settings.mesh.pointSize} min={0.002} max={0.02} step={0.001}
                    onChange={(v) => updateSettings({ mesh: { pointSize: v } })}
                    display={(v) => `${(v * 1000).toFixed(0)} ‰`}
                  />
                )}
                {(mode === 'extrude' || mode === 'billboard') && (
                  <>
                    {mode === 'extrude' && (
                      <SliderRow
                        label="Dicke" value={settings.mesh.thickness} min={0.02} max={0.5} step={0.01}
                        onChange={(v) => updateSettings({ mesh: { thickness: v } })}
                        display={(v) => v.toFixed(2)}
                      />
                    )}
                    <SliderRow
                      label="Schwellwert" value={settings.mesh.threshold} min={0.05} max={0.95} step={0.01}
                      onChange={(v) => updateSettings({ mesh: { threshold: v } })}
                      display={(v) => `${Math.round(v * 100)} %`}
                    />
                    <div>
                      <div className="mb-1 text-xs text-[color:var(--muted)]">Silhouette aus</div>
                      <SegmentedControl<SegmentSource>
                        block
                        size="sm"
                        value={settings.mesh.segmentSource}
                        onChange={(s) => updateSettings({ mesh: { segmentSource: s } })}
                        options={[
                          { value: 'alpha', label: 'Alpha' },
                          { value: 'luminance', label: 'Helligkeit' },
                          { value: 'chroma', label: 'Farbe' },
                        ]}
                      />
                    </div>
                  </>
                )}
              </div>
            </InspectorSection>

            <InspectorSection title="Tiefenschätzung" icon={<Layers size={13} />} defaultOpen={mode === 'relief'}>
              <div className="space-y-3">
                <SliderRow
                  label="Licht → nah" value={settings.depth.luminanceWeight} min={0} max={1} step={0.05}
                  onChange={(v) => updateSettings({ depth: { luminanceWeight: v } })}
                  display={(v) => `${Math.round(v * 100)} %`}
                />
                <SliderRow
                  label="Farbe → nah" value={settings.depth.saturationWeight} min={0} max={1} step={0.05}
                  onChange={(v) => updateSettings({ depth: { saturationWeight: v } })}
                  display={(v) => `${Math.round(v * 100)} %`}
                />
                <SliderRow
                  label="Boden → nah" value={settings.depth.verticalWeight} min={0} max={1} step={0.05}
                  onChange={(v) => updateSettings({ depth: { verticalWeight: v } })}
                  display={(v) => `${Math.round(v * 100)} %`}
                />
                <SliderRow
                  label="Glättung" value={settings.depth.smoothing} min={0} max={8} step={1}
                  onChange={(v) => updateSettings({ depth: { smoothing: v } })}
                  display={(v) => `${v}×`}
                />
                <SliderRow
                  label="Gamma" value={settings.depth.gamma} min={0.3} max={2.5} step={0.05}
                  onChange={(v) => updateSettings({ depth: { gamma: v } })}
                  display={(v) => v.toFixed(2)}
                />
                <ToggleRow
                  label="Tiefe invertieren"
                  checked={settings.depth.invert}
                  onChange={(v) => updateSettings({ depth: { invert: v } })}
                />
              </div>
            </InspectorSection>

            {mode !== 'points' && (
            <InspectorSection title="Material (PBR)" icon={<Palette size={13} />}>
              <div className="space-y-3">
                <SliderRow
                  label="Metalness" value={settings.material.metalness} min={0} max={1} step={0.05}
                  onChange={(v) => updateSettings({ material: { metalness: v } })}
                  display={(v) => v.toFixed(2)}
                />
                <SliderRow
                  label="Roughness" value={settings.material.roughness} min={0} max={1} step={0.05}
                  onChange={(v) => updateSettings({ material: { roughness: v } })}
                  display={(v) => v.toFixed(2)}
                />
                <SliderRow
                  label="Normal-Stärke" value={settings.material.normalStrength} min={0} max={3} step={0.1}
                  onChange={(v) => updateSettings({ material: { normalStrength: v } })}
                  display={(v) => v.toFixed(1)}
                />
                <ToggleRow
                  label="Roughness aus Bild"
                  checked={settings.material.roughnessFromImage}
                  onChange={(v) => updateSettings({ material: { roughnessFromImage: v } })}
                />
                <ToggleRow
                  label="Beidseitig rendern"
                  checked={settings.material.doubleSided}
                  onChange={(v) => updateSettings({ material: { doubleSided: v } })}
                />
              </div>
            </InspectorSection>
            )}

            {doc && activeFloor && (
              <InspectorSection title="In den Plan" icon={<Home size={13} />}>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs text-[color:var(--muted)]">Raum</div>
                    <select
                      className="input w-full text-sm"
                      value={planRoomId || (largestRoom(activeFloor.rooms)?.id ?? '')}
                      onChange={(e) => setPlanRoomId(e.target.value)}
                      aria-label="Zielraum"
                    >
                      {activeFloor.rooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                      {activeFloor.rooms.length === 0 && <option value="">Etagenmitte</option>}
                    </select>
                  </div>
                  <SegmentedControl<BlasterMount>
                    block
                    size="sm"
                    value={planMount}
                    onChange={setPlanMount}
                    options={[
                      { value: 'wall', label: 'Wandbild' },
                      { value: 'floor', label: 'Objekt' },
                    ]}
                  />
                  <SliderRow
                    label="Breite" value={planWidth} min={40} max={300} step={10}
                    onChange={setPlanWidth}
                    display={(v) => `${v} cm`}
                  />
                  <button
                    disabled={!result || running}
                    onClick={handlePlaceInPlan}
                    className="btn btn-primary btn-sm w-full"
                  >
                    <Home size={13} /> Platzieren
                  </button>
                  <p className="text-[10px] leading-relaxed text-[color:var(--muted)]">
                    Wandbilder hängen an der längsten Raumwand, Objekte stehen in der
                    Raummitte — sichtbar in der 3D-Ansicht, gespeichert im Plan.
                  </p>

                  {/* Placed assets on the active floor — manage without leaving the studio */}
                  {(activeFloor.blasterAssets ?? []).length > 0 && (
                    <div className="space-y-1 border-t border-[color:var(--border)] pt-2">
                      <div className="label-xs mb-1">Platziert ({(activeFloor.blasterAssets ?? []).length})</div>
                      {(activeFloor.blasterAssets ?? []).map((a) => {
                        const roomName = activeFloor.rooms.find((r) => r.id === a.roomId)?.name ?? 'Etage'
                        return (
                          <div key={a.id} className={cn('flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] p-1', a.hidden && 'opacity-50')}>
                            <img src={a.image} alt={a.name} className="h-7 w-7 shrink-0 rounded object-cover" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs">{a.name}</span>
                              <span className="block text-[10px] text-[color:var(--muted)]">
                                {roomName} · {a.mount === 'wall' ? 'Wand' : 'Boden'} · {a.width} cm
                              </span>
                            </span>
                            {a.mount === 'wall' && (
                              <IconButton label="Nächste Wand" size="sm" onClick={() => cycleAssetWall(a.id)}>
                                <Repeat size={12} />
                              </IconButton>
                            )}
                            <IconButton label={a.hidden ? 'Einblenden' : 'Ausblenden'} size="sm" onClick={() => toggleAssetHidden(a.id)}>
                              {a.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                            </IconButton>
                            <IconButton label="Aus dem Plan entfernen" size="sm" onClick={() => removeAsset(a.id)}>
                              <Trash2 size={12} />
                            </IconButton>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </InspectorSection>
            )}

            <InspectorSection title="Export" icon={<SlidersHorizontal size={13} />} static>
              <div className="space-y-1.5">
                {EXPORT_FORMATS.map(({ format, label, hint, supportsPoints }) => (
                  <button
                    key={format}
                    disabled={!result || busyExport !== null || (mode === 'points' && !supportsPoints)}
                    onClick={() => void handleExport(format)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[color:var(--border)] px-3 py-2 text-left transition-all',
                      'hover:border-[color:var(--accent-bright)] hover:bg-[color:var(--surface-2)]',
                      'disabled:opacity-40 disabled:pointer-events-none',
                    )}
                  >
                    {busyExport === format
                      ? <Loader2 size={14} className="animate-spin text-[color:var(--accent-bright)]" />
                      : <Download size={14} className="text-[color:var(--accent-bright)]" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{label}</span>
                      <span className="block truncate text-[10px] text-[color:var(--muted)]">{hint}</span>
                    </span>
                  </button>
                ))}
                <div className="flex gap-1.5 pt-1">
                  <MapButton label="Tiefe (PNG)" disabled={!result} onClick={() => downloadMap('depth')} />
                  <MapButton label="Normal (PNG)" disabled={!result} onClick={() => downloadMap('normal')} />
                </div>
              </div>
            </InspectorSection>
          </aside>
        </div>
      </div>
    </div>
  )
}

// ── Local micro-controls (studio-only, kept out of /ui until reused) ──

function SliderRow({
  label, value, min, max, step, onChange, display,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display: (v: number) => ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-[color:var(--muted)]">{label}</span>
        <span className="font-mono text-[color:var(--fg)]">{display(value)}</span>
      </div>
      <input
        type="range"
        className="blaster-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-0.5 text-xs"
    >
      <span className="text-[color:var(--muted)]">{label}</span>
      <span
        className={cn(
          'relative h-4.5 w-8 shrink-0 rounded-full border transition-colors duration-200',
          checked
            ? 'border-[color:var(--accent-bright)] bg-[color:var(--accent-bright)]'
            : 'border-[color:var(--border-strong)] bg-[color:var(--surface-3)]',
        )}
        style={{ height: 18, width: 32 }}
      >
        <span
          className="absolute top-[2px] h-3 w-3 rounded-full bg-[color:var(--fg-strong)] transition-all duration-200"
          style={{ left: checked ? 16 : 3 }}
        />
      </span>
    </button>
  )
}

function MapButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="flex-1 rounded-[var(--radius-sm)] border border-[color:var(--border)] px-2 py-1.5 text-[11px] text-[color:var(--muted)] transition-colors hover:border-[color:var(--accent-bright)] hover:text-[color:var(--fg)] disabled:opacity-40 disabled:pointer-events-none"
    >
      {label}
    </button>
  )
}
