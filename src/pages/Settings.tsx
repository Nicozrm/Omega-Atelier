import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'

export function SettingsPage() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const resetOnboarding = useUIStore((s) => s.setOnboardingShown)

  const doc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  return (
    <div className="min-h-screen omega-noise">
      <header className="flex h-14 items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 safe-top">
        <Link to="/plans" className="btn btn-ghost btn-icon"><ArrowLeft size={16} /></Link>
        <div className="font-display text-lg">Einstellungen</div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <section className="surface p-4 space-y-3">
          <h2 className="font-display text-lg">Darstellung</h2>
          <div className="flex gap-2">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`btn flex-1 ${theme === t ? 'btn-primary' : 'btn-ghost'}`}
              >
                {t === 'dark' ? 'Dunkel' : 'Hell'}
              </button>
            ))}
          </div>
        </section>

        {doc && (
          <section className="surface p-4 space-y-3">
            <h2 className="font-display text-lg">Plan-Einstellungen</h2>
            <label className="block">
              <span className="text-xs text-[color:var(--muted)]">Einheiten</span>
              <select
                className="input mt-1"
                value={doc.settings.unit}
                onChange={(e) =>
                  updateDoc((d) => {
                    d.settings.unit = e.target.value as 'cm' | 'm'
                  }, { history: false })
                }
              >
                <option value="cm">Zentimeter</option>
                <option value="m">Meter</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-[color:var(--muted)]">Rastergröße (cm)</span>
              <input
                type="number"
                className="input mt-1"
                min={10}
                max={200}
                step={10}
                value={doc.settings.gridSize}
                onChange={(e) =>
                  updateDoc((d) => {
                    d.settings.gridSize = Math.max(10, Number(e.target.value) || 50)
                  }, { history: false })
                }
              />
            </label>

            <label className="block">
              <span className="text-xs text-[color:var(--muted)]">Snap-Schritt (cm)</span>
              <input
                type="number"
                className="input mt-1"
                min={1}
                max={100}
                step={1}
                value={doc.settings.snapStep}
                onChange={(e) =>
                  updateDoc((d) => {
                    d.settings.snapStep = Math.max(1, Number(e.target.value) || 10)
                  }, { history: false })
                }
              />
            </label>
          </section>
        )}

        <section className="surface p-4 space-y-3">
          <h2 className="font-display text-lg">Hilfe</h2>
          <button onClick={() => resetOnboarding(false)} className="btn btn-ghost w-full">
            Onboarding-Tour zurücksetzen
          </button>
        </section>

        <footer className="flex justify-center gap-4 pt-2 text-[11px] text-[color:var(--muted)]">
          <Link to="/impressum" className="hover:text-[color:var(--fg)]">Impressum</Link>
          <Link to="/datenschutz" className="hover:text-[color:var(--fg)]">Datenschutz</Link>
          <Link to="/agb" className="hover:text-[color:var(--fg)]">AGB</Link>
        </footer>
      </main>
    </div>
  )
}
