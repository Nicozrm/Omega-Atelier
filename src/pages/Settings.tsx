import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Sun, Moon, Palette, SlidersHorizontal, LifeBuoy, Info, Volume2, VolumeX, Sparkles } from 'lucide-react'
import { useUIStore } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { isSoundEnabled, setSoundEnabled, play as playSound } from '@/lib/sound'
import { isCinematicEnabled, setCinematicEnabled, cinematicReact } from '@/lib/cinematic'

export function SettingsPage() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const resetOnboarding = useUIStore((s) => s.setOnboardingShown)
  const [sound, setSound] = useState(isSoundEnabled())
  const [cinematic, setCinematic] = useState(isCinematicEnabled())

  const doc = usePlanStore((s) => s.doc)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  return (
    <div className="omega-noise omega-scroll h-screen overflow-y-auto">
      <header className="flex h-14 items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 safe-top">
        <Link to="/plans" className="btn btn-ghost btn-icon"><ArrowLeft size={16} /></Link>
        <div className="font-display text-lg">Einstellungen</div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <section className="surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Palette size={15} className="icon-optical text-[color:var(--accent)]" />
            <h2 className="font-display text-lg">Darstellung</h2>
          </div>
          <p className="text-xs text-[color:var(--muted)]">Thema der Oberfläche — der 3D-Renderer bleibt davon unberührt.</p>
          <div className="flex gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { playSound('click'); setTheme(t) }}
                className={`spring-press flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  theme === t
                    ? 'bg-[color:var(--accent)] text-black shadow-sm'
                    : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
                }`}
              >
                {t === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                {t === 'dark' ? 'Dunkel' : 'Hell'}
              </button>
            ))}
          </div>
          <p className="pt-1 text-xs text-[color:var(--muted)]">Dezente Interface-Töne — Einrasten, Modus-Wechsel, Szenen.</p>
          <div className="flex gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                onClick={() => {
                  setSoundEnabled(on)
                  setSound(on)
                  if (on) playSound('click') // instant proof it works
                }}
                className={`spring-press flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  sound === on
                    ? 'bg-[color:var(--accent)] text-black shadow-sm'
                    : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
                }`}
              >
                {on ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {on ? 'Töne an' : 'Stumm'}
              </button>
            ))}
          </div>

          <p className="pt-1 text-xs text-[color:var(--muted)]">Cinematic Mode — beim Platzieren ein sanfter Puls, feine Partikel und ein leiser Ton. Hochwertig, nie aufdringlich.</p>
          <div className="flex gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-1">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                onClick={() => {
                  setCinematicEnabled(on)
                  setCinematic(on)
                  if (on) { const r = document.body.getBoundingClientRect(); cinematicReact(r.width / 2, 180, 'place') } // instant proof
                }}
                className={`spring-press flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  cinematic === on
                    ? 'bg-[color:var(--accent)] text-black shadow-sm'
                    : 'text-[color:var(--muted)] hover:text-[color:var(--fg)]'
                }`}
              >
                <Sparkles size={14} />
                {on ? 'Cinematic an' : 'Cinematic aus'}
              </button>
            ))}
          </div>
        </section>

        {!doc && (
          <section className="surface flex items-center gap-3 border-dashed p-4 text-sm text-[color:var(--muted)]">
            <SlidersHorizontal size={15} className="shrink-0 text-[color:var(--accent)]" />
            Plan-Einstellungen (Einheiten, Raster, Snap) erscheinen hier, sobald ein Plan geöffnet ist.
          </section>
        )}
        {doc && (
          <section className="surface space-y-3 p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="icon-optical text-[color:var(--accent)]" />
              <h2 className="font-display text-lg">Plan-Einstellungen</h2>
            </div>
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

        <section className="surface space-y-3 p-4">
          <div className="flex items-center gap-2">
            <LifeBuoy size={15} className="icon-optical text-[color:var(--accent)]" />
            <h2 className="font-display text-lg">Hilfe</h2>
          </div>
          <p className="text-xs text-[color:var(--muted)]">Die geführte Tour startet beim nächsten Öffnen des Editors erneut.</p>
          <button
            onClick={() => resetOnboarding(false)}
            className="btn btn-outline w-full hover:border-[color:var(--accent)]"
          >
            Onboarding-Tour zurücksetzen
          </button>
        </section>

        <section className="surface flex items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2">
            <Info size={15} className="icon-optical text-[color:var(--accent)]" />
            <div>
              <div className="font-display">OMEGA Atelier</div>
              <div className="text-xs text-[color:var(--muted)]">Smart-Home Planungstool</div>
            </div>
          </div>
          <span className="chip">v2.0</span>
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
