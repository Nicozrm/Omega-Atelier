import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Clock, Cloud, CloudOff, Settings, Layers, Sparkles, MapPin, ArrowRight } from 'lucide-react'
import { useTier } from '@/hooks/useTier'
import { supabase, supabaseReady } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { usePlanStore, loadLocalPlan } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useComposerStore } from '@/store/useComposerStore'
import { Chrome } from '@/components/layout/Chrome'
import { Topbar } from '@/components/layout/Topbar'
import { TEMPLATES, createBlankPlan } from '@/data/templates'
import { timeAgo } from '@/lib/utils'
import type { Floor, PlanRow } from '@/types'

/**
 * Miniature floor-plan rendering — walls and rooms of the first floor drawn
 * as a warm architectural line sketch. Replaces the empty template boxes and
 * the Ω placeholder on cloud cards with a real preview of the layout.
 */
function FloorThumb({ floor, floorCount = 1 }: { floor: Floor; floorCount?: number }) {
  const { width: w, height: h } = floor.extent
  const pad = Math.max(w, h) * 0.08
  const vb = `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`
  const grid = Math.max(w, h) / 6
  const gridLines: React.ReactNode[] = []
  for (let x = grid; x < w; x += grid) gridLines.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={h} />)
  for (let y = grid; y < h; y += grid) gridLines.push(<line key={`gy${y}`} x1={0} y1={y} x2={w} y2={y} />)
  return (
    <div className="relative h-full w-full">
      <svg viewBox={vb} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {/* Floor slab */}
        <rect x={0} y={0} width={w} height={h} rx={Math.max(w, h) * 0.01}
          className="fill-[color:var(--surface-2)]" />
        {/* Grid whisper */}
        <g className="stroke-[color:var(--border)]" strokeWidth={Math.max(w, h) * 0.004} opacity={0.5}>{gridLines}</g>
        {/* Rooms as soft fills */}
        {floor.rooms.map((r) => (
          <polygon key={r.id} points={r.polygon.map((pt) => `${pt.x},${pt.y}`).join(' ')}
            className="fill-[color:var(--accent)]" opacity={0.07} />
        ))}
        {/* Walls — the architectural ink lines */}
        <g strokeLinecap="round" className="stroke-[color:var(--muted)] transition-colors group-hover:stroke-[color:var(--accent)]">
          {floor.walls.map((wl) => (
            <line key={wl.id} x1={wl.a.x} y1={wl.a.y} x2={wl.b.x} y2={wl.b.y} strokeWidth={wl.thickness * 1.4} />
          ))}
        </g>
      </svg>
      {floorCount > 1 && (
        <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)]/85 px-1.5 py-0.5 text-[10px] text-[color:var(--muted)] backdrop-blur-sm">
          <Layers size={10} /> {floorCount}
        </span>
      )}
    </div>
  )
}

export function PlansPage() {
  const navigate = useNavigate()
  // Template preview docs — built once; the builders are cheap (walls only).
  const templatePreviews = useMemo(
    () => Object.fromEntries(TEMPLATES.map((t) => { const d = t.build(); return [t.id, d.floors] as const })),
    [],
  )
  const user = useAuthStore((s) => s.user)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const pushToast = useUIStore((s) => s.pushToast)
  const openComposerRaw = useComposerStore((s) => s.openComposer)
  const { can } = useTier()
  // AI Composer is a Max feature — locked plans route to the pricing section.
  const openComposer = () => { if (can('ai-composer')) openComposerRaw(); else navigate('/#preise') }

  const [rows, setRows] = useState<PlanRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseReady || !user) { setLoading(false); return }
    void (async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .order('updated_at', { ascending: false })
      if (!error && data) setRows(data as PlanRow[])
      setLoading(false)
    })()
  }, [user])

  const createFromTemplate = (templateId: string | null) => {
    const doc = templateId
      ? TEMPLATES.find((t) => t.id === templateId)?.build() ?? createBlankPlan()
      : createBlankPlan()
    loadDocument(doc, false)
    navigate('/plan/new')
  }

  const openLocal = () => {
    const local = loadLocalPlan()
    if (local) {
      loadDocument(local, false)
      navigate('/plan/local')
    } else {
      pushToast({ kind: 'info', title: 'Kein lokaler Plan', description: 'Erstelle einen neuen Plan.' })
    }
  }

  const openRow = (row: PlanRow) => {
    loadDocument(row.doc, true)
    navigate(`/plan/${row.id}`)
  }

  const deleteRow = async (row: PlanRow) => {
    if (!confirm(`Plan "${row.title}" wirklich löschen?`)) return
    const { error } = await supabase.from('plans').delete().eq('id', row.id)
    if (error) {
      pushToast({ kind: 'error', title: 'Fehler', description: error.message })
    } else {
      setRows(rows.filter((r) => r.id !== row.id))
      pushToast({ kind: 'success', title: 'Gelöscht' })
    }
  }

  return (
    <div className="omega-noise omega-scroll h-screen overflow-y-auto">
      <Chrome><Topbar /></Chrome>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="chip mb-2">Pläne</div>
            <h1 className="font-display text-3xl md:text-5xl">Deine Grundrisse</h1>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Starte mit einer Vorlage oder einem leeren Plan.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={openLocal} className="btn btn-ghost">
              <CloudOff size={14} /> Lokalen Plan öffnen
            </button>
            <button onClick={openComposer} className="btn btn-outline">
              <Sparkles size={14} className="text-[color:var(--accent-bright)]" /> AI Home Composer
            </button>
            <button onClick={() => createFromTemplate(null)} className="btn btn-primary">
              <Plus size={14} /> Neuer Plan
            </button>
          </div>
        </div>

        {/* AI Home Composer — the satellite-to-twin entry point */}
        <button
          onClick={openComposer}
          className="group relative mb-8 flex w-full items-center gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-left transition-colors hover:border-[color:var(--border-accent)] md:p-5"
        >
          <span
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{ background: 'radial-gradient(120% 140% at 88% 0%, rgba(199,162,78,0.16), transparent 60%)' }}
            aria-hidden
          />
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[rgba(199,162,78,0.16)]">
            <MapPin size={22} className="text-[color:var(--accent-bright)]" />
          </span>
          <span className="relative min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="font-display text-lg">AI Home Composer</span>
              <span className="chip !py-0 text-[10px]">Neu</span>
            </span>
            <span className="mt-0.5 block text-sm text-[color:var(--muted)]">
              Adresse suchen oder GPS · auf dein Grundstück tippen · Omega erzeugt in Sekunden einen editierbaren Digital Twin.
            </span>
          </span>
          <span className="relative hidden shrink-0 items-center gap-1.5 text-sm text-[color:var(--accent-bright)] sm:flex">
            Starten <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>

        {/* Cloud plans */}
        {supabaseReady && user && (
          <section className="mb-10">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">
              <Cloud size={12} /> Cloud · {rows.length}
            </div>
            {loading ? (
              <div className="text-sm text-[color:var(--muted)]">Lädt…</div>
            ) : rows.length === 0 ? (
              <div className="surface p-6 text-center text-sm text-[color:var(--muted)]">
                Noch keine Pläne. Erstelle deinen ersten weiter unten.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <div key={r.id} className="surface group p-4 hover:border-[color:var(--accent)] transition">
                    <button onClick={() => openRow(r)} className="text-left w-full">
                      <div className="mb-2 aspect-video overflow-hidden rounded-md bg-[color:var(--surface-2)] p-2">
                        {r.doc?.floors?.[0] ? (
                          <FloorThumb floor={r.doc.floors[0]} floorCount={r.doc.floors.length} />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <span className="font-display text-5xl text-gradient-gold">Ω</span>
                          </div>
                        )}
                      </div>
                      <div className="font-display text-lg">{r.title}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-[color:var(--muted)]">
                        <Clock size={12} /> {timeAgo(r.updated_at)}
                      </div>
                    </button>
                    <button
                      onClick={() => deleteRow(r)}
                      className="mt-2 btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 size={12} /> Löschen
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Templates */}
        <section>
          <div className="mb-3 text-xs uppercase tracking-wider text-[color:var(--muted)]">
            Vorlagen
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <button
              onClick={() => createFromTemplate(null)}
              className="surface flex aspect-[4/3] flex-col items-center justify-center gap-2 border-dashed transition hover:-translate-y-0.5 hover:border-[color:var(--accent)]"
            >
              <Plus size={20} className="text-[color:var(--accent)]" />
              <div className="font-display">Leerer Plan</div>
              <div className="text-xs text-[color:var(--muted)]">Eine Etage · frei</div>
            </button>

            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => createFromTemplate(t.id)}
                className="surface group flex aspect-[4/3] flex-col p-3 text-left transition hover:-translate-y-0.5 hover:border-[color:var(--accent)] hover:shadow-lg"
              >
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
                  {templatePreviews[t.id]?.[0] && (
                    <FloorThumb floor={templatePreviews[t.id][0]} floorCount={templatePreviews[t.id].length} />
                  )}
                  {/* Tags live on the preview so the title below never truncates */}
                  <div className="absolute bottom-1.5 left-1.5 flex gap-1">
                    {t.tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="chip !py-0 text-[9px]">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="mt-2 min-w-0">
                  <div className="font-display text-base leading-tight">{t.name}</div>
                  <div className="text-xs text-[color:var(--muted)]">{t.subtitle}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <footer className="mt-12 flex items-center justify-center gap-5 border-t border-[color:var(--border)] pt-5 text-xs text-[color:var(--muted)]">
          <Link to="/settings" className="flex items-center gap-1.5 transition-colors hover:text-[color:var(--fg)]">
            <Settings size={12} /> Einstellungen
          </Link>
          <span aria-hidden="true" className="h-3 w-px bg-[color:var(--border)]" />
          <Link to="/impressum" className="transition-colors hover:text-[color:var(--fg)]">Impressum</Link>
          <Link to="/datenschutz" className="transition-colors hover:text-[color:var(--fg)]">Datenschutz</Link>
          <Link to="/agb" className="transition-colors hover:text-[color:var(--fg)]">AGB</Link>
        </footer>
      </main>
    </div>
  )
}
