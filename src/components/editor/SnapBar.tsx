import { Grid3X3 } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'

const SNAP_STEPS: Array<{ label: string; cm: number }> = [
  { label: '0.25m', cm: 25 },
  { label: '0.5m',  cm: 50 },
  { label: '1.0m',  cm: 100 },
]

/**
 * SnapBar — the reference's workspace bar at the bottom of the 2D canvas:
 * Snap [Aus | 0.25m | 0.5m | 1.0m] · Raster · Magnet-switch.
 * Settings changes skip undo history (workspace state, not plan edits).
 */
export function SnapBar() {
  const doc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)
  if (!doc) return null
  const s = doc.settings
  const patch = (fn: (st: typeof s) => void) => updateDoc((d) => fn(d.settings), { history: false })

  const seg = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
      active ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
    }`
  // Legacy plans may carry a step outside the segments (e.g. 10 cm) — light
  // up the nearest one so the bar always shows the effective state.
  const activeCm = s.snap
    ? SNAP_STEPS.reduce((best, o) => (Math.abs(o.cm - s.snapStep) < Math.abs(best - s.snapStep) ? o.cm : best), SNAP_STEPS[0].cm)
    : null

  return (
    <div className="absolute bottom-[4.4rem] left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-1.5 py-1 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)]/85 backdrop-blur-md shadow-lg">
      <span className="pl-1.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--muted)]">Snap</span>
      <button className={seg(!s.snap)} onClick={() => patch((st) => { st.snap = false })}>Aus</button>
      {SNAP_STEPS.map(({ label, cm }) => (
        <button
          key={cm}
          className={seg(activeCm === cm)}
          onClick={() => patch((st) => { st.snap = true; st.snapStep = cm })}
        >{label}</button>
      ))}
      <span className="mx-1 h-4 w-px bg-[color:var(--border)]" />
      <button
        onClick={() => patch((st) => { st.showGrid = !st.showGrid })}
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          s.showGrid ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
        }`}
        title={`Raster ${s.gridSize} cm anzeigen`}
      >
        <Grid3X3 size={12} /> Raster
      </button>
      <span className="mx-1 h-4 w-px bg-[color:var(--border)]" />
      <label className="flex items-center gap-2 pr-1.5 cursor-pointer" title="An Wänden ausrichten">
        <span className="text-[11px] font-medium text-[color:var(--muted)]">Magnet</span>
        <button
          role="switch"
          aria-checked={s.magnet !== false}
          onClick={() => patch((st) => { st.magnet = st.magnet === false })}
          className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${s.magnet !== false ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--surface-3)]'}`}
        >
          <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${s.magnet !== false ? 'left-[16px]' : 'left-[2px]'}`} />
        </button>
      </label>
    </div>
  )
}
