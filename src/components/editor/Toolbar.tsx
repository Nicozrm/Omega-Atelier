import {
  MousePointer2, Ruler, Scan, Wand2, Sofa, Type, Sparkles, Lock,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Grid3x3, Magnet,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTier } from '@/hooks/useTier'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import type { Tool } from '@/types'
import { Menu, Tooltip } from '@/ui'
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
 * ToolCluster — one group of mutually-exclusive tools inside a recessed well,
 * sharing a single accent pill that glides between them (magic move). When the
 * active tool lives in a sibling cluster the pill hides here and appears there,
 * so the highlight hands off cleanly rather than every button lighting its own
 * box.
 *
 * The well is what does the grouping work: four wells with real air between
 * them read as four decisions, where eighteen evenly-spaced buttons separated
 * by hairlines read as one undifferentiated wall.
 */
function ToolCluster({ tools, active, onSelect }: {
  tools: ToolDef[]
  active: Tool
  onSelect: (t: Tool) => void
}) {
  const { containerRef, indicatorStyle, ready } = useSlidingIndicator(active)
  return (
    <div ref={containerRef} role="group" className="tool-cluster relative">
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-[var(--radius-xs)] will-change-transform"
        style={{
          ...indicatorStyle,
          opacity: ready ? 1 : 0,
          background: 'var(--fill-active)',
          boxShadow: 'inset 0 0 0 1px var(--border-accent), 0 1px 2px rgba(0,0,0,0.28)',
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
              className={cn('tool-btn relative z-10', isActive && 'is-on')}
            >
              {t.icon}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** A cluster of independent (non-exclusive) controls. */
function ActionCluster({ children }: { children: React.ReactNode }) {
  return <div className="tool-cluster">{children}</div>
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
  const viewMode = useUIStore((s) => s.viewMode)
  const { can } = useTier()
  const navigate = useNavigate()
  const canAutoFurnish = can('auto-furnish')

  /*
   * Drawing on a floor plan is meaningless while the centre pane shows a
   * rendered scene — the wall tool has nothing to draw on, the zoom readout
   * reports a viewport nobody is looking at, and "Raster" toggles a grid that
   * isn't on screen. Those controls used to sit there anyway, greyed by nothing
   * and doing nothing when pressed. In 3D and Twin the rail keeps only what
   * still applies: the history, and which floor you are in (owned by FloorTabs,
   * next to this component).
   */
  const drawing = viewMode === '2d'

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
    <div role="toolbar" aria-label="Werkzeuge" className="flex flex-nowrap items-center gap-2">
      {drawing && (
        <>
          <ToolCluster tools={structureTools} active={tool} onSelect={setTool} />
          <ToolCluster tools={placeTools} active={tool} onSelect={setTool} />
        </>
      )}

      <ActionCluster>
        <Tooltip label="Rückgängig" hint="⌘Z" side="bottom">
          <button className="tool-btn" aria-label="Rückgängig" disabled={past.length === 0} onClick={undo}>
            <Undo2 size={17} />
          </button>
        </Tooltip>
        <Tooltip label="Wiederherstellen" hint="⌘⇧Z" side="bottom">
          <button className="tool-btn" aria-label="Wiederherstellen" disabled={future.length === 0} onClick={redo}>
            <Redo2 size={17} />
          </button>
        </Tooltip>
      </ActionCluster>

      {drawing && (
        <>
          <ActionCluster>
            <Tooltip
              label={canAutoFurnish ? 'Auto-Möblieren' : 'Auto-Möblieren — ab Pro'}
              hint={canAutoFurnish ? 'Leere Räume logisch füllen' : 'Plan upgraden'}
              side="bottom"
            >
              <button
                className="tool-btn"
                aria-label="Auto-Möblieren"
                disabled={!doc}
                onClick={(e) => {
                  if (!canAutoFurnish) { playSound('click'); navigate('/#preise'); return }
                  const n = autoFurnish()
                  if (n > 0) { playSound('swell'); cinematicReact(e.clientX, e.clientY, 'place') }
                  else playSound('click')
                }}
              >
                {canAutoFurnish ? <Sparkles size={17} /> : <Lock size={17} />}
              </button>
            </Tooltip>
          </ActionCluster>

          <ActionCluster>
            <Tooltip label="Verkleinern" hint="−" side="bottom">
              <button
                className="tool-btn"
                aria-label="Verkleinern"
                onClick={() => setViewport({ zoom: Math.max(0.1, viewport.zoom / 1.15) })}
              >
                <ZoomOut size={17} />
              </button>
            </Tooltip>
            <span className="tool-readout" aria-live="off">{(viewport.zoom * 100).toFixed(0)}%</span>
            <Tooltip label="Vergrößern" hint="+" side="bottom">
              <button
                className="tool-btn"
                aria-label="Vergrößern"
                onClick={() => setViewport({ zoom: Math.min(4, viewport.zoom * 1.15) })}
              >
                <ZoomIn size={17} />
              </button>
            </Tooltip>
            <Tooltip label="Ansicht einpassen" hint="0" side="bottom">
              <button
                className="tool-btn"
                aria-label="Ansicht einpassen"
                onClick={() => {
                  const cvs = document.querySelector('canvas') as HTMLCanvasElement | null
                  if (cvs) { const r = cvs.getBoundingClientRect(); fitToView(r.width, r.height, 60) }
                  else setViewport({ zoom: 0.5, offsetX: 100, offsetY: 80 })
                }}
              >
                <Maximize size={17} />
              </button>
            </Tooltip>
          </ActionCluster>

          <ActionCluster>
            <Tooltip label="Raster einblenden" side="bottom">
              <button
                className={cn('tool-btn', doc?.settings.showGrid && 'is-on')}
                aria-label="Raster umschalten"
                aria-pressed={doc?.settings.showGrid ?? false}
                onClick={() => updateDoc((d) => { d.settings.showGrid = !d.settings.showGrid }, { history: false })}
              >
                <Grid3x3 size={17} />
              </button>
            </Tooltip>
            <SnapControl />
          </ActionCluster>
        </>
      )}
    </div>
  )
}

/** Snap steps offered in the menu, in centimetres. */
const SNAP_STEPS: Array<{ label: string; cm: number }> = [
  { label: '0,25 m', cm: 25 },
  { label: '0,5 m',  cm: 50 },
  { label: '1 m',    cm: 100 },
]

/**
 * SnapControl — everything about snapping, in one place.
 *
 * These settings used to live in three: a magnet toggle in this rail, a
 * duplicate grid toggle plus the step buttons in a pill floating over the plan,
 * and the wall-magnet switch only in that pill. Two of the three controls were
 * the *same* switch rendered twice, so flipping one silently moved the other,
 * and the step — the only setting you actually tune — was the one you could not
 * reach from the toolbar.
 *
 * Now: one button that reads out the active step, and a menu that names every
 * option. The button still toggles nothing on its own; a control whose label is
 * a value should open the values, not flip a hidden boolean.
 */
function SnapControl() {
  const doc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  if (!doc) return null

  const st = doc.settings
  // Legacy plans may carry a step outside the offered set (10 cm, say) — show
  // the nearest one so the readout always matches what the canvas does.
  const activeCm = st.snap
    ? SNAP_STEPS.reduce((best, o) => (Math.abs(o.cm - st.snapStep) < Math.abs(best - st.snapStep) ? o.cm : best), SNAP_STEPS[0].cm)
    : null
  const stepLabel = activeCm === null ? 'Aus' : SNAP_STEPS.find((o) => o.cm === activeCm)!.label
  const patch = (fn: (s: typeof st) => void) => updateDoc((d) => fn(d.settings), { history: false })

  return (
    <Menu
      align="start"
      minWidth={228}
      trigger={({ ref, ...props }) => (
        <button
          ref={ref}
          {...props}
          aria-label={`Einrasten: ${stepLabel}`}
          title={`Einrasten: ${stepLabel}`}
          className={cn(
            'tool-btn w-auto gap-1.5 px-2 text-[0.6875rem] font-medium',
            st.snap && 'is-on',
          )}
        >
          <Magnet size={16} />
          <span className="tabular-nums">{stepLabel}</span>
        </button>
      )}
    >
      <Menu.Section title="Am Raster einrasten">
        <Menu.Item checked={!st.snap} onSelect={() => patch((s) => { s.snap = false })}>
          Aus
        </Menu.Item>
        {SNAP_STEPS.map(({ label, cm }) => (
          <Menu.Item
            key={cm}
            checked={activeCm === cm}
            onSelect={() => patch((s) => { s.snap = true; s.snapStep = cm })}
          >
            {label}
          </Menu.Item>
        ))}
      </Menu.Section>
      <Menu.Section title="Hilfslinien">
        <Menu.Item
          checked={st.magnet !== false}
          description="Zieht Objekte an Wandkanten"
          onSelect={() => patch((s) => { s.magnet = s.magnet === false })}
        >
          An Wänden ausrichten
        </Menu.Item>
      </Menu.Section>
    </Menu>
  )
}
