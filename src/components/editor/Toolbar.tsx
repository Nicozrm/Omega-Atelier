import {
  MousePointer2, Ruler, Scan, Wand2, Sofa, Type, Sparkles, Lock,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Grid3x3, Magnet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTier } from '@/hooks/useTier'
import { usePlanStore } from '@/store/usePlanStore'
import type { Tool } from '@/types'
import { Toolbar, ToolbarGroup, IconButton, Tooltip } from '@/ui'
import { useSlidingIndicator } from '@/hooks/useSlidingIndicator'
import { cn } from '@/lib/utils'
import { play as playSound } from '@/lib/sound'
import { cinematicReact } from '@/lib/cinematic'

// ── Architectural inline SVG icons (18×18) ────────────────────────────
function IconDoor() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 16V3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v13" />
      <path d="M1 16h16" />
      <path d="M8 2v11" />
      <path d="M8 13a6 6 0 0 0 6-6" strokeDasharray="2 1.5" />
      <circle cx="12.5" cy="8.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconWindow() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3" width="13" height="11" rx="1" fill="currentColor" fillOpacity="0.06" />
      <path d="M9 3v11M2.5 8.5h13" />
      <path d="M1.5 14.5h15" strokeWidth="2" />
    </svg>
  )
}
function IconTerrace() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2.5" width="14" height="13" rx="1.5" />
      <path d="M2 6.5h14M2 10h14M2 13.5h14" opacity="0.45" />
      <circle cx="5" cy="4.4" r="0.9" fill="currentColor" stroke="none" opacity="0.65" />
      <circle cx="13" cy="4.4" r="0.9" fill="currentColor" stroke="none" opacity="0.65" />
    </svg>
  )
}

interface ToolDef { key: Tool; icon: React.ReactNode; label: string; hotkey: string }

/**
 * ToolSegments — one cluster of mutually-exclusive tools sharing a single
 * accent pill that glides between them (magic move). When the active tool lives
 * in a sibling cluster the pill hides here and appears there, so the highlight
 * hands off cleanly across the structure / placement groups rather than every
 * button lighting its own box.
 */
function ToolSegments({ tools, active, onSelect }: {
  tools: ToolDef[]
  active: Tool
  onSelect: (t: Tool) => void
}) {
  const { containerRef, indicatorStyle, ready } = useSlidingIndicator(active)
  return (
    <div
      ref={containerRef}
      role="group"
      className={cn(
        'relative flex items-center gap-0.5',
        '[&:not(:first-child)]:before:mx-1 [&:not(:first-child)]:before:h-5 [&:not(:first-child)]:before:w-px [&:not(:first-child)]:before:bg-[color:var(--border)] [&:not(:first-child)]:before:content-[""]',
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[var(--radius-xs)] will-change-transform"
        style={{
          ...indicatorStyle,
          opacity: ready ? 1 : 0,
          background: 'rgba(199,162,78,0.14)',
          boxShadow: 'inset 0 0 0 1px var(--border-accent), var(--glow-accent-soft)',
        }}
      />
      {tools.map((t) => {
        const isActive = active === t.key
        return (
          <Tooltip key={t.key} label={t.label} hint={t.hotkey} side="bottom">
            <button
              data-seg={t.key}
              aria-label={t.label}
              aria-pressed={isActive}
              onClick={() => onSelect(t.key)}
              className={cn(
                'btn btn-icon btn-ghost relative z-10',
                isActive ? 'text-[color:var(--accent-bright)]' : 'text-[color:var(--fg)]',
              )}
            >
              {t.icon}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function EditorToolbar() {
  const tool = usePlanStore((s) => s.tool)
  const setTool = usePlanStore((s) => s.setTool)
  const doc = usePlanStore((s) => s.doc)
  const viewport = usePlanStore((s) => s.viewport)
  const setViewport = usePlanStore((s) => s.setViewport)
  const fitToView = usePlanStore((s) => s.fitToView)
  const undo = usePlanStore((s) => s.undo)
  const redo = usePlanStore((s) => s.redo)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  const autoFurnish = usePlanStore((s) => s.autoFurnishActiveFloor)
  const past = usePlanStore((s) => s.past)
  const future = usePlanStore((s) => s.future)
  const { can } = useTier()
  const navigate = useNavigate()
  const canAutoFurnish = can('auto-furnish')

  const structureTools: ToolDef[] = [
    { key: 'select',  icon: <MousePointer2 size={17} />, label: 'Auswahl',  hotkey: 'V' },
    { key: 'wall',    icon: <Scan size={17} />,          label: 'Wand',     hotkey: 'W' },
    { key: 'door',    icon: <IconDoor />,                label: 'Tür',      hotkey: 'O' },
    { key: 'window',  icon: <IconWindow />,              label: 'Fenster',  hotkey: 'E' },
    { key: 'terrace', icon: <IconTerrace />,             label: 'Terrasse', hotkey: 'R' },
  ]
  const placeTools: ToolDef[] = [
    { key: 'device',    icon: <Wand2 size={17} />, label: 'Gerät',        hotkey: 'D' },
    { key: 'furniture', icon: <Sofa size={17} />,  label: 'Möbel',        hotkey: 'F' },
    { key: 'label',     icon: <Type size={17} />,  label: 'Beschriftung', hotkey: 'T' },
    { key: 'measure',   icon: <Ruler size={17} />, label: 'Messen',       hotkey: 'M' },
  ]

  return (
    // Single row that scrolls horizontally inside the toolbar's overflow-x
    // container — on mobile the old flex-wrap stacked into ~5 rows and ate half
    // the screen height, squashing the canvas.
    <Toolbar className="flex-nowrap">
      <ToolSegments tools={structureTools} active={tool} onSelect={setTool} />
      <ToolSegments tools={placeTools} active={tool} onSelect={setTool} />

      <ToolbarGroup>
        <Tooltip label="Rückgängig" hint="⌘Z" side="bottom">
          <IconButton label="Rückgängig" disabled={past.length === 0} onClick={undo}><Undo2 size={17} /></IconButton>
        </Tooltip>
        <Tooltip label="Wiederherstellen" hint="⌘⇧Z" side="bottom">
          <IconButton label="Wiederherstellen" disabled={future.length === 0} onClick={redo}><Redo2 size={17} /></IconButton>
        </Tooltip>
      </ToolbarGroup>

      <ToolbarGroup>
        <Tooltip label={canAutoFurnish ? 'Auto-Möblieren' : 'Auto-Möblieren — ab Pro'} hint={canAutoFurnish ? 'Leere Räume logisch füllen' : 'Plan upgraden'} side="bottom">
          <IconButton
            label="Auto-Möblieren"
            disabled={!doc}
            onClick={(e) => {
              if (!canAutoFurnish) { playSound('click'); navigate('/#preise'); return }
              const n = autoFurnish()
              if (n > 0) { playSound('swell'); cinematicReact(e.clientX, e.clientY, 'place') }
              else playSound('click')
            }}
          >
            {canAutoFurnish ? <Sparkles size={17} /> : <Lock size={17} />}
          </IconButton>
        </Tooltip>
      </ToolbarGroup>

      <ToolbarGroup>
        <Tooltip label="Vergrößern" hint="+" side="bottom">
          <IconButton label="Vergrößern" onClick={() => setViewport({ zoom: Math.min(4, viewport.zoom * 1.15) })}><ZoomIn size={17} /></IconButton>
        </Tooltip>
        <div className="min-w-[42px] text-center font-mono text-xs text-[color:var(--muted)]">
          {(viewport.zoom * 100).toFixed(0)}%
        </div>
        <Tooltip label="Verkleinern" hint="−" side="bottom">
          <IconButton label="Verkleinern" onClick={() => setViewport({ zoom: Math.max(0.1, viewport.zoom / 1.15) })}><ZoomOut size={17} /></IconButton>
        </Tooltip>
        <Tooltip label="Ansicht einpassen" hint="0" side="bottom">
          <IconButton
            label="Ansicht einpassen"
            onClick={() => {
              const cvs = document.querySelector('canvas') as HTMLCanvasElement | null
              if (cvs) { const r = cvs.getBoundingClientRect(); fitToView(r.width, r.height, 60) }
              else setViewport({ zoom: 0.5, offsetX: 100, offsetY: 80 })
            }}
          >
            <Maximize size={17} />
          </IconButton>
        </Tooltip>
      </ToolbarGroup>

      <ToolbarGroup>
        <Tooltip label="Raster" side="bottom">
          <IconButton
            label="Raster umschalten"
            active={doc?.settings.showGrid ?? false}
            onClick={() => updateDoc((d) => { d.settings.showGrid = !d.settings.showGrid }, { history: false })}
          >
            <Grid3x3 size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Einrasten" side="bottom">
          <IconButton
            label="Einrasten umschalten"
            active={doc?.settings.snap ?? false}
            onClick={() => updateDoc((d) => { d.settings.snap = !d.settings.snap }, { history: false })}
          >
            <Magnet size={17} />
          </IconButton>
        </Tooltip>
      </ToolbarGroup>
    </Toolbar>
  )
}
