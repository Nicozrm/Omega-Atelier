import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTier } from '@/hooks/useTier'
import { Chrome } from '@/components/layout/Chrome'
import { Topbar } from '@/components/layout/Topbar'
import { MobileNav } from '@/components/layout/MobileNav'
import { OmegaFloorCanvas } from '@/components/editor/Canvas'
import { CanvasDock } from '@/components/editor/CanvasDock'
import { CinematicLayer } from '@/components/editor/CinematicLayer'
import { LivingHome } from '@/components/editor/LivingHome'
import { SoundScape } from '@/components/editor/SoundScape'
import { RadioMesh } from '@/components/editor/RadioMesh'
import { EditorToolbar } from '@/components/editor/Toolbar'
import { FloorTabs } from '@/components/editor/FloorTabs'
import { LayerPanel } from '@/components/editor/LayerPanel'
import { PropertyPanel } from '@/components/editor/PropertyPanel'
import { ModesPanel } from '@/components/modes/ModesPanel'
import { WorkspaceRail, RailReopenTab, InspectorPanel, LibraryPanel } from '@/features/workspace'
import { OnboardingTour } from '@/components/ui/OnboardingTour'
import { ShortcutsHelp } from '@/components/ui/ShortcutsHelp'
import { usePlanStore, loadLocalPlan } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useGlobalHotkeys } from '@/hooks/useHotkeys'
import { useRealtimePlan } from '@/hooks/useRealtimePlan'
import { useAuthStore } from '@/store/useAuthStore'
import { supabase, supabaseReady } from '@/lib/supabase'
import type { PlanRow } from '@/types'
import { X } from 'lucide-react'
import { createDemoPlan } from '@/data/demoPlan'
import { coercePlan } from '@/lib/planSchema'
import { shouldAutoSave } from '@/lib/autoSave'

// Heavy & seldom-needed → split out into their own chunks.
const ExportDialog = lazy(() =>
  import('@/components/export/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)
const ShareDialog = lazy(() =>
  import('@/components/plans/ShareDialog').then((m) => ({ default: m.ShareDialog })),
)
const ThreeDView = lazy(() =>
  import('@/components/3d/ThreeDView').then((m) => ({ default: m.ThreeDView })),
)
const DigitalTwinView = lazy(() =>
  import('@/components/twin/DigitalTwinView').then((m) => ({ default: m.DigitalTwinView })),
)
const DeviceInspector = lazy(() =>
  import('@/components/devices/DeviceInspector').then((m) => ({ default: m.DeviceInspector })),
)
const ConnectorManager = lazy(() =>
  import('@/components/connectors/ConnectorManager').then((m) => ({ default: m.ConnectorManager })),
)
const VacuumRobotView = lazy(() =>
  import('@/components/vacuum/VacuumRobotView').then((m) => ({ default: m.VacuumRobotView })),
)

import { MobilePlacement } from '@/components/editor/MobilePlacement'

export function EditorPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useTier()
  useGlobalHotkeys()

  const doc = usePlanStore((s) => s.doc)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)
  const user = useAuthStore((s) => s.user)
  const mobilePanel = useUIStore((s) => s.mobilePanel)
  const openMobilePanel = useUIStore((s) => s.openMobilePanel)
  const viewMode = useUIStore((s) => s.viewMode)
  const leftRailOpen = useUIStore((s) => s.leftRailOpen)
  const rightRailOpen = useUIStore((s) => s.rightRailOpen)
  const toggleLeftRail = useUIStore((s) => s.toggleLeftRail)
  const toggleRightRail = useUIStore((s) => s.toggleRightRail)

  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const [vacuumOpen, setVacuumOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const planRowId = id && id !== 'new' && id !== 'local' ? id : undefined

  // Realtime collaboration
  const { cursors, publishCursor } = useRealtimePlan(planRowId)

  // Load plan from DB
  useEffect(() => {
    if (!planRowId) return
    if (doc?.id && !supabaseReady) return
    if (!supabaseReady) return
    void (async () => {
      setLoading(true)
      const { data, error } = await supabase.from('plans').select('*').eq('id', planRowId).maybeSingle()
      if (error || !data) {
        setError('Plan konnte nicht geladen werden.')
      } else {
        const row = data as PlanRow
        const safe = coercePlan(row.doc)
        if (safe) {
          loadDocument(safe, true)
        } else {
          setError('Plan ist beschädigt oder hat ein inkompatibles Format.')
        }
      }
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRowId])

  /**
   * Seed the editor when the store is empty — which is every direct navigation
   * and every page reload, since the store lives in memory only.
   *
   * `/plan/local` **is** the local document, so it restores what was saved.
   * Previously both routes built a fresh demo plan, and because the store
   * debounce-writes every document back to `omega.plan.current`, that demo
   * then overwrote the saved one: a plain browser refresh silently replaced the
   * user's work with the demo flat. The same overwrite is why a plan's
   * real-world anchor never survived a reload, so the aerial-photo ground and
   * the cadastre neighbourhood were unreachable on this route.
   *
   * `/plan/new` keeps starting fresh — that is what it is for.
   */
  useEffect(() => {
    if (doc || planRowId) return
    const restored = id === 'local' ? loadLocalPlan() : null
    loadDocument(restored ?? createDemoPlan(), false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, planRowId, id])

  /*
   * Auto-save: debounce-save the doc 1.5 s after the last *edit*.
   *
   * The dependency list is deliberately narrow. `doc` itself must not appear
   * here: `saveToCloud` replaces the document object when it stamps the new
   * `docVersion`, so depending on its identity made every save re-arm the timer
   * that had just fired — a cloud write every 1.5 seconds, indefinitely, on a
   * plan nobody was editing. `updatedAt` is the value that tracks edits, and
   * `shouldAutoSave` re-checks it at fire time so a save can never chain into
   * the next one.
   */
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedUpdatedAt = useRef<string | null>(null)
  const pushToast = useUIStore((s) => s.pushToast)
  const docUpdatedAt = doc?.updatedAt
  useEffect(() => {
    if (!shouldAutoSave({
      updatedAt: docUpdatedAt,
      lastSavedUpdatedAt: lastSavedUpdatedAt.current,
      planRowId,
      cloudReady: supabaseReady,
      signedIn: !!user,
    })) return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(async () => {
      // Claim this revision before the write: a failed save leaves it claimed,
      // and the next real edit (a new `updatedAt`) retries. Without the claim a
      // save that races its own result can re-enter here.
      lastSavedUpdatedAt.current = docUpdatedAt ?? null
      const result = await saveToCloud(planRowId!)
      if (result && typeof result === 'object' && 'conflict' in result) {
        pushToast({
          kind: 'warning',
          title: 'Konflikt beim Speichern',
          description: 'Eine andere Sitzung war schneller. Klick „Neu laden", um den aktuellen Stand zu holen.',
          duration: 12000,
        })
      }
    }, 1500)
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [docUpdatedAt, planRowId, user, saveToCloud, pushToast])

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" />
        <p className="text-sm text-[color:var(--muted)] animate-pulse">Lade deinen Smart-Home Plan...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-[color:var(--color-omega-danger)]">{error}</p>
        <button onClick={() => navigate('/plans')} className="btn btn-outline">Zur Übersicht</button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <p className="text-sm text-[color:var(--muted)]">Kein Plan geladen.</p>
        <button onClick={() => navigate('/plans')} className="btn btn-outline">Zur Übersicht</button>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <MobilePlacement />
      <OnboardingTour />
      <ShortcutsHelp />
      <CinematicLayer />
      
      {/*
        One pane of glass, two strips: the document identity row, and the tool
        rail under it. The material lives on <Chrome/>; the strips inside carry
        nothing but the hairline between them.
      */}
      <Chrome>
        <Topbar
          showBack
          planRowId={planRowId}
          onOpenExport={() => setExportOpen(true)}
          onOpenShare={() => setShareOpen(true)}
          onOpenDevices={() => setDevicesOpen(true)}
          onOpenConnectors={() => { if (can('live-connectors')) setConnectorsOpen(true); else navigate('/#preise') }}
          onOpenVacuum={() => { if (can('robot-map')) setVacuumOpen(true); else navigate('/#preise') }}
        />
        <div className="chrome-row overflow-x-auto omega-scroll">
          <EditorToolbar />
          <div className="ml-auto flex items-center gap-2 pl-3">
            <FloorTabs />
          </div>
        </div>
      </Chrome>

      <div className="relative flex flex-1 overflow-hidden min-h-0">
        {/* LEFT RAIL — library (collapsible, desktop lg+) */}
        <div className="hidden lg:flex">
          <WorkspaceRail
            side="left"
            open={leftRailOpen}
            onToggle={toggleLeftRail}
            title="Bibliothek"
            width="var(--sidebar-width)"
          >
            <LibraryPanel />
          </WorkspaceRail>
        </div>

        {/* MAIN CANVAS — silent workspace. 2D floor plan, or the 3D scene
            embedded right here (framed by the rails) when viewMode is '3d'. */}
        <div className="relative flex-1 min-w-0">
          {viewMode === '2d' ? (
            <>
              {/*
                Two floating bars used to sit here over the plan, and both said
                what the tool rail above already says. The history pill was a
                second undo/redo (a third, counting ⌘Z) wrapped around a
                "3 / 7" step counter; the snap pill was a second grid toggle,
                a second magnet switch and the step buttons. Snapping now lives
                in one named menu in the rail, undo/redo in one place — and the
                plan gets the bottom of the canvas back.
              */}
              <OmegaFloorCanvas cursors={cursors} publishCursor={publishCursor} />
              {/* One anchored column for the plan overlays; each control below
                  contributes its chip or panel to it. */}
              <CanvasDock />
              <LivingHome />
              <SoundScape />
              <RadioMesh />
            </>
          ) : viewMode === 'twin' ? (
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--bg)]">
                <div className="w-12 h-12 rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" />
              </div>
            }>
              <DigitalTwinView />
            </Suspense>
          ) : (
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--bg)]">
                <div className="w-12 h-12 rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" />
              </div>
            }>
              <ThreeDView embedded />
            </Suspense>
          )}
          {/* Edge affordances when a rail is collapsed */}
          {!leftRailOpen && (
            <RailReopenTab side="left" onClick={toggleLeftRail} label="Bibliothek einblenden" className="hidden lg:flex" />
          )}
          {!rightRailOpen && (
            <RailReopenTab side="right" onClick={toggleRightRail} label="Inspector einblenden" className="hidden xl:flex" />
          )}
        </div>

        {/* RIGHT RAIL — inspector (collapsible, desktop xl+) */}
        <div className="hidden xl:flex">
          <WorkspaceRail
            side="right"
            open={rightRailOpen}
            onToggle={toggleRightRail}
            title="Inspector"
            width="var(--inspector-width)"
          >
            <InspectorPanel />
          </WorkspaceRail>
        </div>
      </div>

      <MobileNav />

      {/* Mobile bottom sheet — a grabber, a title, and the panel. The grabber is
          not decoration: it is the only thing on a phone that says the surface
          belongs to the bottom edge and can be dismissed downward. */}
      {mobilePanel && (
        <div
          className="lg:hidden fixed inset-0 z-40 scrim animate-fade-in"
          onClick={() => openMobilePanel(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={panelLabel(mobilePanel)}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-hidden rounded-t-[var(--radius-3xl)] border-t border-[color:var(--hairline)] bg-[color:var(--bg-elevated)] shadow-[0_-8px_40px_-8px_rgba(0,0,0,0.55)] animate-slide-up safe-bottom"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 70px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-grabber" aria-hidden />
            <div className="flex items-center justify-between px-4 pb-2.5 pt-1">
              <div className="font-display text-[0.95rem] font-semibold tracking-tight">{panelLabel(mobilePanel)}</div>
              <button
                onClick={() => openMobilePanel(null)}
                aria-label="Schließen"
                className="btn btn-ghost btn-icon touch-target"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto omega-scroll border-t border-[color:var(--hairline-soft)]">
              {mobilePanel === 'library' && (
                <div className="h-[60vh]"><LibraryPanel /></div>
              )}
              {mobilePanel === 'modes' && <div className="p-3"><ModesPanel /></div>}
              {mobilePanel === 'layers' && <div className="p-3"><LayerPanel /></div>}
              {mobilePanel === 'properties' && <div className="p-3"><PropertyPanel /></div>}
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {exportOpen && <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />}
        {shareOpen && <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} planRowId={planRowId} />}
        {devicesOpen && <DeviceInspector onClose={() => setDevicesOpen(false)} />}
        {/* Gated at the mount as well as at the opener: the opener is the
            courteous path (it explains itself by going to the pricing page),
            this is the one that actually holds if some other route ever sets
            the flag. */}
        {connectorsOpen && can('live-connectors') && <ConnectorManager onClose={() => setConnectorsOpen(false)} />}
        {vacuumOpen && can('robot-map') && (
          <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0d10]"><div className="w-12 h-12 rounded-full border-2 border-[color:var(--border)] border-t-[color:var(--accent)] animate-spin" /></div>}>
            <VacuumRobotView onClose={() => setVacuumOpen(false)} />
          </Suspense>
        )}
      </Suspense>
    </div>
  )
}

function panelLabel(p: string): string {
  switch (p) {
    case 'library':    return 'Bibliothek'
    case 'modes':      return 'Omega-Modi'
    case 'layers':     return 'Ebenen'
    case 'properties': return 'Eigenschaften'
    default:           return p
  }
}
