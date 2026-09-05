import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Sunrise, Ear, Radio, Box, ScanEye, Plug, Check, ArrowRight,
} from 'lucide-react'
import { OmegaMark } from '@/components/layout/OmegaMark'
import { useAuthStore } from '@/store/useAuthStore'
import { useReveal } from '@/hooks/useReveal'
import { PLANS, storePlanInterest, type PlanSpec } from '@/lib/entitlements'

/**
 * Landing — the public face of OMEGA Atelier.
 *
 * Deliberately quiet. There is exactly one signature element (a still of the
 * product that tilts subtly toward the pointer in 3D), one ambient motion
 * (blocks reveal once as they scroll into view), and a single static light
 * accent. No looping animation, no particles, no competing effects — the kind
 * of restraint a premium product earns.
 */

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ── The one signature element: a calm still of the product, rendered once ──
function drawStill(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const pad = 24
  const px = pad, py = pad, pw = W - pad * 2, ph = H - pad * 2
  ctx.clearRect(0, 0, W, H)

  // Warm evening floor.
  ctx.fillStyle = '#17140F'
  ctx.fillRect(px, py, pw, ph)

  // A single soft shaft of evening light through the top window.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createLinearGradient(px + pw * 0.34, py, px + pw * 0.54, py + ph * 0.72)
  g.addColorStop(0, 'rgba(230,204,134,0.22)')
  g.addColorStop(1, 'rgba(230,204,134,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(px + pw * 0.34, py)
  ctx.lineTo(px + pw * 0.50, py)
  ctx.lineTo(px + pw * 0.62, py + ph * 0.72)
  ctx.lineTo(px + pw * 0.46, py + ph * 0.72)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Crisp gold plan — outer walls + a three-room split.
  ctx.strokeStyle = 'rgba(199,162,78,0.5)'
  ctx.lineWidth = 2
  ctx.strokeRect(px, py, pw, ph)
  ctx.beginPath()
  ctx.moveTo(px + pw * 0.46, py); ctx.lineTo(px + pw * 0.46, py + ph * 0.55)
  ctx.moveTo(px, py + ph * 0.55); ctx.lineTo(px + pw * 0.72, py + ph * 0.55)
  ctx.moveTo(px + pw * 0.72, py + ph * 0.55); ctx.lineTo(px + pw * 0.72, py + ph)
  ctx.stroke()

  // The window opening.
  ctx.strokeStyle = 'rgba(230,204,134,0.85)'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(px + pw * 0.34, py); ctx.lineTo(px + pw * 0.50, py); ctx.stroke()

  // A few quiet device markers — content, not motion.
  ctx.fillStyle = 'rgba(199,162,78,0.75)'
  for (const [dx, dy] of [[0.24, 0.28], [0.60, 0.30], [0.30, 0.76], [0.83, 0.72]]) {
    ctx.beginPath(); ctx.arc(px + pw * dx, py + ph * dy, 3, 0, Math.PI * 2); ctx.fill()
  }
}

function HeroVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Draw once, and again on resize — never in a loop.
  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const render = () => {
      const W = cvs.clientWidth, H = cvs.clientHeight
      if (W === 0 || H === 0) return
      cvs.width = Math.round(W * dpr)
      cvs.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawStill(ctx, W, H)
    }
    render()
    const ro = new ResizeObserver(render)
    ro.observe(cvs)
    return () => ro.disconnect()
  }, [])

  // The single micro-interaction: a gentle 3D tilt toward the pointer. Pointer-
  // driven only — nothing moves on its own. Disabled under reduced motion.
  const onMove = (e: React.PointerEvent) => {
    const el = cardRef.current
    if (!el || reducedMotion()) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - r.left) / r.width - 0.5
    const dy = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `rotateX(${(-dy * 4).toFixed(2)}deg) rotateY(${(dx * 5).toFixed(2)}deg)`
  }
  const reset = () => {
    const el = cardRef.current
    if (el) el.style.transform = 'rotateX(0deg) rotateY(0deg)'
  }

  return (
    <div style={{ perspective: '1400px' }}>
      <div
        ref={cardRef}
        onPointerMove={onMove}
        onPointerLeave={reset}
        className="surface-glass overflow-hidden rounded-[var(--radius-2xl)] p-1.5"
        style={{
          transition: 'transform 0.6s var(--ease-out-quart)',
          transformStyle: 'preserve-3d',
          boxShadow: 'var(--shadow-4)',
        }}
      >
        <canvas
          ref={canvasRef}
          className="block h-[300px] w-full rounded-[calc(var(--radius-2xl)-6px)] sm:h-[400px]"
          aria-label="OMEGA Atelier — ein Grundriss im Abendlicht"
        />
      </div>
    </div>
  )
}

// ── Pricing card ────────────────────────────────────────────────────────
function PricingCard({ plan, featured, onChoose, chosen }: {
  plan: PlanSpec
  featured?: boolean
  chosen: boolean
  onChoose: (p: PlanSpec) => void
}) {
  return (
    <button
      onClick={() => onChoose(plan)}
      className={`group relative flex h-full w-full flex-col rounded-[var(--radius-2xl)] border p-6 text-left transition-[transform,border-color] duration-300 hover:-translate-y-1 ${
        featured
          ? 'border-[color:var(--border-accent)] bg-[color:var(--surface-2)] md:-mt-2'
          : 'border-[color:var(--border)] bg-[color:var(--surface)] hover:border-[color:var(--border-strong)]'
      }`}
    >
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[linear-gradient(180deg,var(--accent-bright),var(--accent))] px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[color:var(--accent-contrast)]">
          Beliebt
        </span>
      )}
      <div className="font-display text-lg font-semibold">{plan.name}</div>
      <div className="mt-0.5 text-xs text-[color:var(--muted)]">{plan.tagline}</div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-semibold tabular-nums">{plan.price === 0 ? '0' : plan.price}</span>
        <span className="text-sm text-[color:var(--muted)]">€ / Monat</span>
      </div>
      <ul className="mt-5 flex-1 space-y-2.5">
        {plan.points.map((pt) => (
          <li key={pt} className="flex items-start gap-2 text-[13px] leading-snug">
            <Check size={14} className="mt-0.5 shrink-0 text-[color:var(--accent-bright)]" />
            <span className={pt.startsWith('Alles aus') ? 'text-[color:var(--muted)]' : ''}>{pt}</span>
          </li>
        ))}
      </ul>
      <span className={`mt-6 inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold transition-colors ${
        featured
          ? 'bg-[linear-gradient(180deg,var(--accent-bright),var(--accent))] text-[color:var(--accent-contrast)] group-hover:brightness-[1.06]'
          : 'border border-[color:var(--border-accent)] text-[color:var(--accent-bright)] group-hover:bg-[rgba(199,162,78,0.10)]'
      }`}>
        {chosen
          ? <><Check size={15} /> {plan.celebrate}</>
          : <>{plan.price === 0 ? 'Kostenlos starten' : `${plan.name} wählen`} <ArrowRight size={14} /></>}
      </span>
    </button>
  )
}

// ── Page ────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: Sunrise, title: 'Sonnenstudie', text: 'Echte Solargeometrie: Sonnenlicht fällt durch deine Fenster und wandert mit langen Möbelschatten über das Parkett.' },
  { icon: Box, title: 'Fotoreales 3D', text: 'ACES-Tonemapping, weiche Schatten, Kamera mit Feder-Physik — deine Wohnung wie aus dem Archviz-Studio.' },
  { icon: Ear, title: 'SoundScape', text: 'Zieh ein Ohr durch den Plan: Musik aus den Lautsprechern, physikalisch von deinen echten Wänden gedämpft.' },
  { icon: Radio, title: 'Funknetz-Röntgen', text: 'Zigbee, Thread, WLAN — das unsichtbare Nervensystem deines Zuhauses als klare, ruhige Karte.' },
  { icon: ScanEye, title: 'Digital Twin', text: 'Jedes Gerät als neutraler Zwilling — Modi, Sensoren und Szenen laufen live, simuliert oder real.' },
  { icon: Plug, title: 'Live-Connectoren', text: 'Philips Hue, Tuya, Home Assistant: der Plan wird zur Fernbedienung deiner echten Geräte.' },
]

// ── Plan comparison — every paid advantage, explained at a glance ──────
// Apple-quiet: one calm surface, grouped rows, three tier columns. A gold dot
// means "included"; the muted dash means "not in this plan". Data mirrors
// FEATURE_TIER so the graphic can never drift from the real gates.
const COMPARE: { group: string; rows: { label: string; hint: string; tier: 'free' | 'pro' | 'max' }[] }[] = [
  {
    group: 'Planen',
    rows: [
      { label: '2D-Editor & fotoreales 3D', hint: 'Licht-Physik, ACES, weiche Schatten', tier: 'free' },
      { label: 'Digital Twin', hint: 'Jedes Gerät als lebendiger Zwilling', tier: 'free' },
      { label: '✨ Auto-Möblieren', hint: 'Leere Räume füllen sich selbst — kollisionsfrei', tier: 'pro' },
      { label: 'Etagen-Stack', hint: 'Das ganze Haus als Explosionsansicht', tier: 'pro' },
    ],
  },
  {
    group: 'Erleben',
    rows: [
      { label: 'Sonnenstudie & Living Home', hint: 'Echte Sonne, 24h-Tageszyklus', tier: 'pro' },
      { label: 'SoundScape & Funknetz-Röntgen', hint: 'Hören und Funk sehen', tier: 'pro' },
      { label: 'Insights-Suite', hint: 'Plan-Doktor, Energie- & Kostenreport', tier: 'pro' },
    ],
  },
  {
    group: 'Verbinden & Erschaffen',
    rows: [
      { label: 'AI Composer', hint: 'Vom Kartenpunkt zum fertigen Grundriss', tier: 'max' },
      { label: 'Bau-Studio', hint: 'Klinker · Putz · Naturstein · Holz, Dachform & Farben', tier: 'max' },
      { label: 'Live-Connectoren & Sprachsteuerung', hint: 'Hue, Tuya, Home Assistant — real', tier: 'max' },
      { label: 'Image Blaster 3D & Ökosystem-Audit', hint: 'Bilder zu 3D, Setup-Check', tier: 'max' },
    ],
  },
]
const TIER_RANK = { free: 0, pro: 1, max: 2 } as const

function CompareDot({ included }: { included: boolean }) {
  return included
    ? <span className="mx-auto block h-[7px] w-[7px] rounded-full bg-[color:var(--accent-bright)] shadow-[0_0_8px_rgba(199,162,78,0.55)]" aria-label="enthalten" />
    : <span className="mx-auto block h-px w-3 bg-[color:var(--border-strong)]" aria-label="nicht enthalten" />
}

function CompareMatrix() {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)]">
      <div className="min-w-[560px]">
        {/* Column heads */}
        <div className="grid grid-cols-[1fr_72px_72px_72px] items-center gap-2 border-b border-[color:var(--border)] px-5 py-3.5 md:grid-cols-[1fr_96px_96px_96px]">
          <span className="label-xs">Alles im Vergleich</span>
          {(['Free', 'Pro', 'Max'] as const).map((n) => (
            <span key={n} className={`text-center text-[12px] font-semibold tracking-wide ${n === 'Max' ? 'text-[color:var(--accent-bright)]' : 'text-[color:var(--muted)]'}`}>{n}</span>
          ))}
        </div>
        {COMPARE.map(({ group, rows }) => (
          <div key={group}>
            <div className="px-5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">{group}</div>
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[1fr_72px_72px_72px] items-center gap-2 px-5 py-2.5 transition-colors hover:bg-[color:var(--surface-2)] md:grid-cols-[1fr_96px_96px_96px]">
                <div>
                  <div className="text-[13.5px] font-medium leading-tight">{r.label}</div>
                  <div className="mt-0.5 text-[12px] leading-tight text-[color:var(--muted)]">{r.hint}</div>
                </div>
                {(['free', 'pro', 'max'] as const).map((t) => (
                  <CompareDot key={t} included={TIER_RANK[t] >= TIER_RANK[r.tier]} />
                ))}
              </div>
            ))}
          </div>
        ))}
        <div className="h-3" />
      </div>
    </div>
  )
}

function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const { ref, shown } = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`reveal ${shown ? 'is-in' : ''} ${className ?? ''}`}>
      {children}
    </div>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [chosenTier, setChosenTier] = useState<string | null>(null)

  // Deep link «/#preise» (also used by locked features in the app).
  useEffect(() => {
    if (window.location.hash === '#preise') {
      document.getElementById('preise')?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  const choose = useCallback((plan: PlanSpec) => {
    // Hält fest, wofür jemand gekommen ist; freigeschaltet wird dadurch nichts.
    // Der Anspruch kommt aus dem Konto, nie von hier — siehe `resolveTier`.
    storePlanInterest(plan.tier)
    setChosenTier(plan.tier)
    // Free braucht keine Kasse: dort ist der nächste sinnvolle Schritt die App
    // selbst. Für Pro und Max geht es direkt in den Checkout, mit dem
    // gewählten Tarif und dem Intervall im Link — wer hier klickt, hat die
    // Entscheidung getroffen und soll sie nicht noch einmal treffen müssen.
    const target = plan.tier === 'free'
      ? (user ? '/start' : '/login')
      : `/checkout?plan=${plan.tier}&interval=yearly`
    window.setTimeout(() => navigate(target), 650)
  }, [navigate, user])

  return (
    // Own scroll context (the app shell pins html/body to overflow:hidden), and
    // one static light accent over the flat void — no ambient background.
    <div
      className="omega-scroll h-screen overflow-y-auto overflow-x-hidden"
      style={{ background: 'radial-gradient(120% 70% at 50% -10%, rgba(199,162,78,0.05), transparent 55%), var(--bg)' }}
    >
      {/* Nav */}
      <header className="glass sticky top-0 z-40 border-x-0 border-t-0">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="overflow-hidden rounded-[10px] shadow-[0_2px_10px_rgba(199,162,78,0.32)]"><OmegaMark size={30} /></span>
            <span className="font-display text-[0.95rem] font-semibold tracking-tight">OMEGA <span className="text-[color:var(--accent-bright)]">Atelier</span></span>
          </Link>
          <nav className="ml-6 hidden items-center gap-5 text-sm text-[color:var(--muted)] md:flex">
            <a href="#funktionen" className="transition-colors hover:text-[color:var(--fg)]">Funktionen</a>
            <a href="#vergleich" className="transition-colors hover:text-[color:var(--fg)]">Vergleich</a>
            <a href="#preise" className="transition-colors hover:text-[color:var(--fg)]">Preise</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">Anmelden</Link>
            <Link to={user ? '/start' : '/login'} className="btn btn-primary btn-sm">Kostenlos starten</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5">
        {/* Hero */}
        <Reveal>
          <section className="pt-16 text-center md:pt-24">
            <div className="chip mx-auto">Das Smart-Home-Atelier</div>
            <h1 className="mx-auto mt-5 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight md:text-6xl" style={{ textWrap: 'balance' }}>
              Dein Zuhause.<br /><span className="text-gradient-accent">Zum Leben erweckt.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-[color:var(--muted)] md:text-lg">
              Plane deine Wohnung, sieh sie fotoreal in 3D, hör sie, beleuchte sie mit echter
              Sonne — und verbinde am Ende deine realen Geräte. Alles in einem Werkzeug.
            </p>

            <p className="mx-auto mt-3 max-w-md text-sm text-[color:var(--muted)]">
              Ich arbeite eng mit einem kleinen, erfahrenen Kreativ‑ und Entwicklerteam zusammen — Projekte werden gemeinsam umgesetzt.
            </p>

            <div className="mt-6 flex items-center justify-center gap-4">
              <div className="flex -space-x-2">
                <div className="h-10 w-10 rounded-full bg-[color:var(--surface-3)] flex items-center justify-center text-sm font-semibold">N</div>
                <div className="h-10 w-10 rounded-full bg-[color:var(--surface-3)] flex items-center justify-center text-sm font-semibold">T</div>
              </div>
              <div className="text-sm text-[color:var(--muted)]">Nico &amp; kleines Team — Design &amp; Entwicklung</div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link to={user ? '/start' : '/login'} className="btn btn-primary">Projekt besprechen <ArrowRight size={15} /></Link>
              <Link to={user ? '/start' : '/login'} className="btn btn-outline">Kostenlos starten</Link>
            </div>
          </section>
        </Reveal>

        {/* The one signature visual */}
        <Reveal className="mt-14 block md:mt-20">
          <HeroVisual />
        </Reveal>

        {/* Features */}
        <section id="funktionen" className="mt-24 scroll-mt-24 md:mt-32">
          <Reveal>
            <div className="label-xs text-center">Was drinsteckt</div>
            <h2 className="mt-2 text-center font-display text-2xl font-semibold md:text-3xl">Physik statt Deko.</h2>
          </Reveal>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Reveal key={title}>
                <div className="h-full rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] p-5 transition-colors duration-300 hover:border-[color:var(--border-strong)]">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[rgba(199,162,78,0.12)] text-[color:var(--accent-bright)]">
                    <Icon size={17} />
                  </span>
                  <div className="mt-3.5 font-display text-[15px] font-semibold">{title}</div>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--muted)]">{text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Plan comparison — the paid advantages, graphically */}
        <section id="vergleich" className="mt-24 scroll-mt-24 md:mt-32">
          <Reveal>
            <div className="label-xs text-center">Dein Plan, dein Vorsprung</div>
            <h2 className="mt-2 text-center font-display text-2xl font-semibold md:text-3xl">Was Pro und Max freischalten.</h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-[color:var(--muted)]">
              Jede Zeile ist ein echtes Werkzeug im Atelier — kein Marketing, dieselben Schalter wie in der App.
            </p>
          </Reveal>
          <Reveal className="mt-10 block">
            <CompareMatrix />
          </Reveal>
        </section>

        {/* Pricing */}
        <section id="preise" className="mt-24 scroll-mt-24 md:mt-32">
          <Reveal>
            <div className="label-xs text-center">Preise</div>
            <h2 className="mt-2 text-center font-display text-2xl font-semibold md:text-3xl">Jeder Plan fühlt sich richtig an.</h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-[color:var(--muted)]">
              Starte kostenlos. Wechsle, wenn dein Zuhause mehr kann als geplant.
            </p>
          </Reveal>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {PLANS.map((p) => (
              <Reveal key={p.tier}>
                <PricingCard
                  plan={p}
                  featured={p.tier === 'pro'}
                  chosen={chosenTier === p.tier}
                  onChoose={choose}
                />
              </Reveal>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-28 flex flex-wrap items-center justify-center gap-5 border-t border-[color:var(--border)] py-8 text-xs text-[color:var(--muted)]">
          <span className="flex items-center gap-2"><OmegaMark size={18} /> OMEGA Atelier</span>
          <span aria-hidden className="h-3 w-px bg-[color:var(--border)]" />
          <Link to="/impressum" className="transition-colors hover:text-[color:var(--fg)]">Impressum</Link>
          <Link to="/datenschutz" className="transition-colors hover:text-[color:var(--fg)]">Datenschutz</Link>
          <Link to="/agb" className="transition-colors hover:text-[color:var(--fg)]">AGB</Link>
        </footer>
      </main>
    </div>
  )
}
