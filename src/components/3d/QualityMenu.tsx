import { useEffect, useRef, useState } from 'react'
import { Gauge, Sparkles } from 'lucide-react'
import {
  RENDER_PROFILES, RENDER_PROFILE_ORDER, deviceProbe, setRenderProfileChoice,
  type RenderProfileChoice,
} from '@/lib/render/quality'
import { useRenderProfile, useRenderStats } from '@/hooks/useRenderProfile'

/**
 * QualityMenu — the render budget, exposed.
 *
 * The auto-detected profile is right most of the time, but "most of the time"
 * is not good enough for the two cases that matter: someone on a laptop who
 * wants every frame smooth while presenting, and someone with a workstation GPU
 * who wants the maximum the machine can give for a screenshot. Both need a
 * switch, and both need to *see* what the switch did — hence the live frame
 * read-out beside it.
 *
 * The panel is the glassmorphic surface used throughout the 3D HUD: a frosted
 * pane over the render, with a light hairline on the top edge where a real
 * bevel would catch light, and a warm accent bloom behind the active row.
 */

const CHOICES: RenderProfileChoice[] = ['auto', ...RENDER_PROFILE_ORDER].reverse() as RenderProfileChoice[]

export function QualityMenu() {
  const [open, setOpen] = useState(false)
  const { profile, choice, detected } = useRenderProfile()
  const stats = useRenderStats()
  const rootRef = useRef<HTMLDivElement>(null)

  // Click-outside + Escape, so the panel behaves like every other popover here.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const gpu = deviceProbe().renderer
  // Renderer strings are long and full of driver noise
  // ("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)").
  // Pull out the part a human recognises.
  const gpuLabel = (gpu.match(/\(([^,]+,\s*)?([^,()]+?)(\s+direct3d| vs_| \(|\))/i)?.[2] ?? gpu)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42)

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Render-Qualität — ${profile.label} · ${stats.fps} fps`}
        aria-expanded={open}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors md:h-8 md:w-8 ${
          open
            ? 'bg-[color:var(--accent)] text-white'
            : 'text-[color:var(--muted)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--fg)]'
        }`}
      >
        <Gauge size={15} />
      </button>

      {open && (
        <div className="glass-hud absolute right-full top-0 z-30 mr-2 w-64 origin-top-right animate-scale-in space-y-2.5 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
              Render-Qualität
            </span>
            <span className="font-mono text-[10px] tabular-nums text-[color:var(--accent)]">
              {stats.fps} fps
            </span>
          </div>

          <div className="space-y-1">
            {CHOICES.map((c) => {
              const isAuto = c === 'auto'
              const p = isAuto ? RENDER_PROFILES[detected] : RENDER_PROFILES[c]
              const active = choice === c
              return (
                <button
                  key={c}
                  onClick={() => setRenderProfileChoice(c)}
                  className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-[color:var(--border-accent)] bg-[color:var(--accent)]/15'
                      : 'border-transparent hover:bg-[color:var(--surface-2)]/60'
                  }`}
                >
                  <span className="mt-[3px] flex h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-[color:var(--border-strong)]"
                    style={{ background: active ? 'var(--accent)' : 'transparent' }}
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--fg)]">
                      {isAuto ? 'Automatisch' : p.label}
                      {isAuto && (
                        <span className="rounded px-1 py-px text-[9px] uppercase tracking-wider text-[color:var(--muted)] ring-1 ring-[color:var(--border)]">
                          {p.label}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-snug text-[color:var(--muted)]">
                      {isAuto ? 'Nach erkannter GPU-Leistung' : p.hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="space-y-1 border-t border-[color:var(--border)] pt-2 text-[10px] text-[color:var(--muted)]">
            <div className="flex items-center justify-between gap-2">
              <span>Auflösung</span>
              <span className="flex items-center gap-1 font-mono tabular-nums text-[color:var(--fg)]">
                {stats.refining && <Sparkles size={9} className="text-[color:var(--accent)] animate-pulse" />}
                {stats.dpr.toFixed(2)}×
                <span className="text-[color:var(--muted)]">/ {stats.ceiling.toFixed(2)}×</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Standbild-Supersampling</span>
              <span className="font-mono tabular-nums text-[color:var(--fg)]">{profile.dprStill.toFixed(2)}×</span>
            </div>
            {gpuLabel && (
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0">GPU</span>
                <span className="truncate text-right text-[color:var(--fg)]" title={gpu}>{gpuLabel}</span>
              </div>
            )}
          </div>

          <p className="text-[9px] leading-snug text-[color:var(--muted)]/80">
            Bewegung rendert bewusst niedriger aufgelöst; sobald die Kamera steht,
            schärft die Ansicht schrittweise bis zum Limit nach.
          </p>
        </div>
      )}
    </div>
  )
}
