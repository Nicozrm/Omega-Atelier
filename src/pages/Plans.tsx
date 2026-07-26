import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Clock, Cloud, CloudOff } from 'lucide-react'
import { supabase, supabaseReady } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { usePlanStore, loadLocalPlan } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { Topbar } from '@/components/layout/Topbar'
import { TEMPLATES, createBlankPlan } from '@/data/templates'
import { timeAgo } from '@/lib/utils'
import type { PlanRow } from '@/types'

export function PlansPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const pushToast = useUIStore((s) => s.pushToast)

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
    <div className="min-h-screen omega-noise">
      <Topbar />

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
            <button onClick={() => createFromTemplate(null)} className="btn btn-primary">
              <Plus size={14} /> Neuer Plan
            </button>
          </div>
        </div>

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
                      <div className="mb-2 aspect-video rounded-md bg-[color:var(--surface-2)] flex items-center justify-center">
                        <span className="font-display text-5xl text-gradient-gold">Ω</span>
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
              className="surface flex aspect-[4/3] flex-col items-center justify-center gap-2 hover:border-[color:var(--accent)] transition"
            >
              <Plus size={20} className="text-[color:var(--accent)]" />
              <div className="font-display">Leerer Plan</div>
              <div className="text-xs text-[color:var(--muted)]">Eine Etage · frei</div>
            </button>

            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => createFromTemplate(t.id)}
                className="surface flex aspect-[4/3] flex-col items-start justify-between p-4 text-left hover:border-[color:var(--accent)] transition"
              >
                <div>
                  <div className="font-display text-lg">{t.name}</div>
                  <div className="text-xs text-[color:var(--muted)]">{t.subtitle}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="chip">{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-10 text-center text-xs text-[color:var(--muted)]">
          <Link to="/settings" className="hover:text-[color:var(--fg)]">Einstellungen</Link>
        </div>
      </main>
    </div>
  )
}
