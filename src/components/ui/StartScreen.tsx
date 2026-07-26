/**
 * Start Screen — Omega Design Language v2 "Quiet Luxury".
 *
 * Principles:
 *   1. CUSTOM ASSETS ONLY. The logo is a hand-built geometric Ω mark on a
 *      deep indigo tile; action-card icons are inline architectural-line
 *      SVGs. No stock lucide icons in the visible hero.
 *   2. SEQUENCED REVEAL. Logo settles, title cascades, capability pills
 *      stagger in, the bento grid stages with depth, then the brand strip.
 *      All keyframes scoped locally.
 *   3. BENTO LAYOUT. A hero "Resume" card (when a saved plan exists), a
 *      featured "Demo" card with a mini-floorplan ornament, and two
 *      compact tiles. Mobile collapses to a single rhythmic column.
 *
 * The page is deliberately calm: one accent, lots of air, a single
 * memorable element — the workspace it opens into.
 */

import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { usePlanStore, loadLocalPlan } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { createDemoPlan } from '@/data/demoPlan'
import { createBlankPlan } from '@/data/templates'

// ─── Custom SVG icon set (architectural line style) ───────────────────

function IconResume({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v5h5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" opacity="0.5" />
    </svg>
  )
}
function IconDemo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 21 8v8l-9 5-9-5V8z" />
      <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconNew({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17" opacity="0.4" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
function IconQuick({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
    </svg>
  )
}
function IconArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

// Pill glyphs — line-drawn
function GlyphCube()    { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z M3 7l9 5 9-5 M12 12v10"/></svg> }
function GlyphLayers()  { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5z M3 12l9 5 9-5 M3 17l9 5 9-5"/></svg> }
function GlyphMove()    { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 9 2 12l3 3 M9 5l3-3 3 3 M15 19l-3 3-3-3 M19 9l3 3-3 3 M2 12h20 M12 2v20"/></svg> }
function GlyphSparkle() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18 M3 12h18 M5 5l3 3 M16 16l3 3 M19 5l-3 3 M5 19l3-3"/></svg> }
function GlyphPalette() { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".6" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".6" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".6" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".6" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.5-.8-.5-1.2 0-.8.7-1.5 1.6-1.5h1.7c2.7 0 5-2.2 5-5C21 6.4 17 2 12 2z"/></svg> }
function GlyphChip()    { return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg> }

// ─── Geometric Ω mark on an indigo tile ───────────────────────────────

function OmegaLogo({ size = 64, animate = true }: { size?: number; animate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="omega-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor="#E6CC86" />
          <stop offset="55%"  stopColor="#C7A24E" />
          <stop offset="100%" stopColor="#9A7B36" />
        </linearGradient>
        <linearGradient id="omega-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="rgba(255,255,255,0.45)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <radialGradient id="omega-glow" cx="0.5" cy="0.42" r="0.65">
          <stop offset="0%"   stopColor="rgba(199, 162, 78,0.55)" />
          <stop offset="100%" stopColor="rgba(199, 162, 78,0)" />
        </radialGradient>
      </defs>

      <circle cx="50" cy="50" r="48" fill="url(#omega-glow)" />

      <rect
        x="6" y="6" width="88" height="88" rx="22"
        fill="url(#omega-tile)"
        style={{
          filter: 'drop-shadow(0 10px 28px rgba(199, 162, 78,0.42))',
          ...(animate ? { opacity: 0, animation: 'logoPlate 0.7s 0.1s var(--ease-spring,cubic-bezier(0.34,1.4,0.5,1)) forwards' } : {}),
        }}
      />
      <rect x="6" y="6" width="88" height="88" rx="22" fill="url(#omega-sheen)" opacity="0.55"
        style={animate ? { opacity: 0, animation: 'logoSheen 0.8s 0.4s ease-out forwards' } : undefined} />

      <g
        stroke="rgba(255,255,255,0.96)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" fill="none"
        style={{
          filter: 'drop-shadow(0 1px 1px rgba(11,15,20,0.35))',
          ...(animate ? { strokeDasharray: 200, strokeDashoffset: 200, animation: 'logoStroke 1.2s 0.5s var(--ease-out-expo,cubic-bezier(0.16,1,0.3,1)) forwards' } : {}),
        }}
      >
        <path d="M22 70 L32 70" />
        <path d="M32 70 C 32 60, 28 56, 28 46 C 28 32, 40 24, 50 24" />
        <path d="M50 24 C 60 24, 72 32, 72 46 C 72 56, 68 60, 68 70" />
        <path d="M68 70 L78 70" />
      </g>

      <circle cx="50" cy="84" r="2.4" fill="rgba(255,255,255,0.9)"
        style={animate ? { opacity: 0, animation: 'logoDot 0.5s 1.4s ease-out forwards' } : undefined} />
    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────

export function StartScreen() {
  const navigate = useNavigate()
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showPromo, setShowPromo] = useState(false)
  const savedPlan = useMemo(() => loadLocalPlan(), [])
  // What the Demo actually contains — shown on the card so the choice is honest.
  const demoStats = useMemo(() => {
    const d = createDemoPlan()
    return {
      rooms: d.floors.reduce((n, f) => n + f.rooms.length, 0),
      devices: d.floors.reduce((n, f) => n + f.devices.length, 0),
      furniture: d.floors.reduce((n, f) => n + f.furniture.length, 0),
    }
  }, [])

  // Each card now does exactly what it says. The old "Neuer Plan" navigated to
  // /plan/new without setting a document, so the editor's demo-fallback silently
  // loaded the demo instead of a blank grid. We set the document explicitly.
  function startNew()   { loadDocument(createBlankPlan(), false); useUIStore.getState().setViewMode('2d'); navigate('/plan/local') }
  function startDemo()  { loadDocument(createDemoPlan(), false); useUIStore.getState().setViewMode('2d'); navigate('/plan/local') }
  function startBlank() { loadDocument(createDemoPlan(), false); useUIStore.getState().setViewMode('3d'); navigate('/plan/local') }
  function resumeSession() {
    if (!savedPlan) return
    loadDocument(savedPlan, false)
    navigate('/plan/local')
  }

  const featurePills = [
    { label: 'Photoreal 3D',   glyph: <GlyphCube /> },
    { label: 'PBR-Texturen',   glyph: <GlyphPalette /> },
    { label: 'Walk-Mode',      glyph: <GlyphMove /> },
    { label: 'Multi-Floor',    glyph: <GlyphLayers /> },
    { label: 'Live-Drag',      glyph: <GlyphMove /> },
    { label: 'Omega-Modi',     glyph: <GlyphSparkle /> },
    { label: '30+ Ökosysteme', glyph: <GlyphChip /> },
  ]

  const brands = [
    'Philips Hue', 'Apple Home', 'Google Home', 'Aqara', 'IKEA', 'Eve',
    'Sonos', 'Shelly', 'SwitchBot', 'Govee', 'Nuki', 'Lockin',
    'Bosch', 'Tuya', 'Smart Life', 'Osaio', 'Arenti',
    'FRITZ!Box', 'Netatmo', 'Home Assistant', 'Loxone', 'Homey', 'Matter',
  ]

  return (
    <div className="omega-start min-h-screen w-full relative overflow-hidden">
      <div className="omega-start-bg" aria-hidden>
        <div className="omega-blob omega-blob-indigo" />
        <div className="omega-blob omega-blob-cyan" />
        <div className="omega-blob omega-blob-deep" />
        <div className="omega-grid" />
        <div className="omega-vignette-top" />
        <div className="omega-vignette-bot" />
      </div>

      <div className="omega-start-content omega-scroll">
        {/* HERO */}
        <header className="omega-hero">
          <div className="omega-logo-wrap">
            <OmegaLogo size={82} animate />
            <div className="omega-logo-halo" aria-hidden />
          </div>
          <div className="omega-hero-text">
            <p className="omega-eyebrow">
              <span className="omega-eyebrow-line" />
              <span>Smart-Home Atelier</span>
              <span className="omega-eyebrow-version">2026</span>
            </p>
            <h1 className="omega-title">
              <span className="omega-title-row">OMEGA</span>
              <span className="omega-title-row omega-title-accent">Atelier</span>
            </h1>
            <p className="omega-subhead">
              Plane interaktive Grundrisse, platziere Geräte aus über{' '}
              <span className="omega-accent-text">30 Ökosystemen</span> und erlebe
              deine Räume in <span className="omega-accent-text">photoreal 3D</span>.
            </p>
            <button type="button" className="omega-promo-link" onClick={() => setShowPromo(true)}>
              <span className="omega-promo-play" aria-hidden>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </span>
              Demo-Video ansehen
              <span className="omega-promo-dur">0:50</span>
            </button>
          </div>
        </header>

        {/* PILLS */}
        <div className="omega-pills">
          {featurePills.map((p, i) => (
            <span key={p.label} className="omega-pill" style={{ animationDelay: `${1.2 + i * 0.05}s` }}>
              <span className="omega-pill-glyph">{p.glyph}</span>
              {p.label}
            </span>
          ))}
        </div>

        {/* BENTO */}
        <div className={`omega-bento ${savedPlan ? 'has-resume' : ''}`}>
          {savedPlan && (
            <button
              onClick={resumeSession}
              onMouseEnter={() => setHovered('resume')}
              onMouseLeave={() => setHovered(null)}
              className={`omega-card omega-card-hero ${hovered === 'resume' ? 'is-hovered' : ''}`}
              style={{ animationDelay: '1.55s' }}
            >
              <div className="omega-card-bg-grid" />
              <div className="omega-card-corner-arc" />
              <div className="omega-card-icon"><IconResume size={26} /></div>
              <div className="omega-card-tag">letzte Sitzung</div>
              <h3 className="omega-card-title">Fortsetzen</h3>
              <p className="omega-card-desc">
                „{savedPlan.title}" —{' '}
                {savedPlan.floors.reduce((n, f) => n + f.devices.length, 0)} Geräte,{' '}
                {savedPlan.floors.length} {savedPlan.floors.length === 1 ? 'Etage' : 'Etagen'}
              </p>
              <div className="omega-card-cta"><span>Weiter</span><IconArrowRight /></div>
            </button>
          )}

          <button
            onClick={startDemo}
            onMouseEnter={() => setHovered('demo')}
            onMouseLeave={() => setHovered(null)}
            className={`omega-card omega-card-feature ${hovered === 'demo' ? 'is-hovered' : ''}`}
            style={{ animationDelay: '1.65s' }}
          >
            <div className="omega-card-bg-grid" />
            <div className="omega-card-corner-arc" />
            <div className="omega-card-preview" aria-hidden>
              <svg viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="108" height="68" rx="2" />
                <path d="M48 6v40 M48 46h36 M48 46v28" opacity="0.7" />
                <path d="M84 46v28" opacity="0.7" />
                <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
                <circle cx="78" cy="24" r="2" fill="currentColor" stroke="none" />
                <circle cx="100" cy="60" r="2" fill="currentColor" stroke="none" />
                <circle cx="24" cy="60" r="2" fill="currentColor" stroke="none" />
                <circle cx="66" cy="60" r="2" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <div className="omega-card-icon"><IconDemo size={26} /></div>
            <div className="omega-card-tag">empfohlen</div>
            <h3 className="omega-card-title">Demo-Wohnung</h3>
            <p className="omega-card-desc">
              Vollständig eingerichteter Plan mit Geräten, Möbeln und allen Modi.
              Die beste Tour durch alle Funktionen.
            </p>
            <div className="omega-card-stats" aria-hidden>
              <span><b>{demoStats.rooms}</b> Räume</span>
              <span className="omega-stat-sep" />
              <span><b>{demoStats.devices}</b> Geräte</span>
              <span className="omega-stat-sep" />
              <span><b>{demoStats.furniture}</b> Möbel</span>
            </div>
            <div className="omega-card-cta"><span>Erkunden</span><IconArrowRight /></div>
          </button>

          <button
            onClick={startNew}
            onMouseEnter={() => setHovered('new')}
            onMouseLeave={() => setHovered(null)}
            className={`omega-card omega-card-compact ${hovered === 'new' ? 'is-hovered' : ''}`}
            style={{ animationDelay: '1.75s' }}
          >
            <div className="omega-card-bg-grid" />
            <div className="omega-card-icon"><IconNew size={22} /></div>
            <h3 className="omega-card-title">Neuer Plan</h3>
            <p className="omega-card-desc">Leerer Grundriss. Bauen ab Null.</p>
            <div className="omega-card-cta"><IconArrowRight /></div>
          </button>

          <button
            onClick={startBlank}
            onMouseEnter={() => setHovered('blank')}
            onMouseLeave={() => setHovered(null)}
            className={`omega-card omega-card-compact ${hovered === 'blank' ? 'is-hovered' : ''}`}
            style={{ animationDelay: '1.85s' }}
          >
            <div className="omega-card-bg-grid" />
            <div className="omega-card-icon"><IconQuick size={22} /></div>
            <h3 className="omega-card-title">Sofort in 3D</h3>
            <p className="omega-card-desc">Demo direkt im 3D-Rundgang.</p>
            <div className="omega-card-cta"><IconArrowRight /></div>
          </button>
        </div>

        {/* BRAND STRIP */}
        <section className="omega-brands">
          <div className="omega-brands-rule">
            <span className="omega-brands-rule-line" />
            <span className="omega-brands-rule-label">unterstützte Ökosysteme</span>
            <span className="omega-brands-rule-line" />
          </div>
          <div className="omega-brands-mask">
            <div className="omega-brands-row">
              {brands.map((b) => <span key={b} className="omega-brand-item">{b}</span>)}
            </div>
          </div>
        </section>

        <footer className="omega-foot">
          <span>v2.0 · 2026 Edition</span>
          <span className="omega-foot-dot" />
          <Link to="/impressum" className="omega-foot-link">Impressum</Link>
          <Link to="/datenschutz" className="omega-foot-link">Datenschutz</Link>
          <Link to="/agb" className="omega-foot-link">AGB</Link>
        </footer>
      </div>

      {showPromo && (
        <div className="omega-promo-overlay" role="dialog" aria-modal="true" aria-label="Omega Atelier Demo-Video" onClick={() => setShowPromo(false)}>
          <div className="omega-promo-frame" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="omega-promo-close" onClick={() => setShowPromo(false)} aria-label="Schließen">×</button>
            <video
              className="omega-promo-video"
              poster={`${import.meta.env.BASE_URL}omega-promo-poster.png`}
              autoPlay
              muted
              controls
              playsInline
              preload="metadata"
            >
              {/* MP4/H.264 first for Safari & iOS (no WebM/VP8 there), WebM fallback */}
              <source src={`${import.meta.env.BASE_URL}omega-promo.mp4`} type="video/mp4" />
              <source src={`${import.meta.env.BASE_URL}omega-promo.webm`} type="video/webm" />
            </video>
          </div>
        </div>
      )}

      <style>{styles}</style>
    </div>
  )
}

// ─── Scoped styles ────────────────────────────────────────────────────

const styles = /* css */ `
  .omega-start {
    --o-spring: cubic-bezier(0.34, 1.4, 0.5, 1);
    --o-out:    cubic-bezier(0.16, 1, 0.3, 1);
    --o-quart:  cubic-bezier(0.25, 1, 0.5, 1);
    /* Derive from the global theme so the hero follows light/dark instead of
       hardcoding a dark palette (which left the landing page black in light
       mode). Panel/border tokens carry per-theme overrides below. */
    --o-fg:     var(--fg);
    --o-muted:  var(--muted);
    --o-accent: var(--accent);
    --o-accent-bright: var(--accent-bright);
    --o-cyan:   var(--cyan);
    --o-bg-1:   var(--bg);
    --o-border: var(--border-strong);
    --o-panel:       rgba(22, 31, 43, 0.6);
    --o-panel-hover: rgba(28, 40, 54, 0.85);
    --o-panel-2:     rgba(17, 24, 35, 0.72);
    --o-panel-line:  rgba(255, 255, 255, 0.08);
    --o-promo-bg:    rgba(3, 4, 7, 0.82);
    --o-promo-frame: #050506;
    background: var(--o-bg-1);
    color: var(--o-fg);
    font-family: 'Inter', -apple-system, system-ui, sans-serif;
  }

  /* Light hero — warm paper panels instead of the dark-glass slabs. */
  :root.light .omega-start {
    --o-panel:       rgba(255, 255, 255, 0.78);
    --o-panel-hover: #ffffff;
    --o-panel-2:     rgba(255, 255, 255, 0.9);
    --o-panel-line:  rgba(15, 23, 34, 0.08);
    --o-promo-bg:    rgba(246, 243, 236, 0.86);
    --o-promo-frame: #ffffff;
  }

  /* Background atmosphere */
  .omega-start-bg { position: absolute; inset: 0; pointer-events: none; }
  .omega-blob { position: absolute; filter: blur(90px); border-radius: 50%; }
  .omega-blob-indigo {
    width: 58vw; height: 58vw; top: -20%; left: -14%;
    background: radial-gradient(circle, rgba(199, 162, 78,0.28) 0%, rgba(199, 162, 78,0) 70%);
    animation: omegaBlob1 24s ease-in-out infinite;
  }
  .omega-blob-cyan {
    width: 52vw; height: 52vw; bottom: -22%; right: -12%;
    background: radial-gradient(circle, rgba(232, 200, 121,0.16) 0%, rgba(232, 200, 121,0) 70%);
    animation: omegaBlob2 30s ease-in-out infinite;
  }
  .omega-blob-deep {
    width: 38vw; height: 38vw; top: 36%; left: 52%;
    background: radial-gradient(circle, rgba(154, 123, 54,0.18) 0%, rgba(154, 123, 54,0) 70%);
    animation: omegaBlob3 26s ease-in-out infinite;
  }
  .omega-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(200, 182, 142,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(200, 182, 142,0.05) 1px, transparent 1px);
    background-size: 52px 52px;
    mask-image: radial-gradient(ellipse at center, black 28%, transparent 78%);
    -webkit-mask-image: radial-gradient(ellipse at center, black 28%, transparent 78%);
  }
  .omega-vignette-top, .omega-vignette-bot { position: absolute; left: 0; right: 0; height: 16vh; }
  .omega-vignette-top { top: 0; background: linear-gradient(180deg, var(--o-bg-1), transparent); }
  .omega-vignette-bot { bottom: 0; background: linear-gradient(0deg, var(--o-bg-1), transparent); }

  /* Layout */
  .omega-start-content {
    position: relative; z-index: 1;
    max-width: 1080px; margin: 0 auto;
    padding: clamp(1.5rem, 4vw, 5rem) clamp(1rem, 4vw, 3rem);
    padding-top: max(clamp(1.5rem, 4vw, 5rem), env(safe-area-inset-top));
    padding-bottom: max(clamp(1.5rem, 4vw, 5rem), env(safe-area-inset-bottom));
    display: flex; flex-direction: column; align-items: center;
    gap: clamp(1.25rem, 4vh, 3rem);
    /* Fill the viewport and center vertically — but 'safe' falls back to
       flex-start when the content is taller than the screen, so the top
       (the OMEGA wordmark) is never clipped/unreachable on short/landscape
       displays. dvh tracks the iOS status bar / dynamic browser chrome. */
    min-height: 100vh; min-height: 100dvh;
    max-height: 100vh; max-height: 100dvh;
    justify-content: safe center;
    overflow-y: auto; overscroll-behavior: contain;
  }

  /* Short / landscape viewports (tablets, phones sideways, installed PWA):
     scale the hero down so the whole start screen fits with little scrolling. */
  @media (max-height: 860px) {
    .omega-start-content { gap: clamp(1rem, 2.4vh, 1.7rem); }
    .omega-hero { gap: 0.9rem; }
    .omega-logo-wrap { width: 58px; height: 58px; }
    .omega-hero-text { gap: 0.5rem; }
    .omega-title-row { font-size: clamp(1.8rem, 4.6vh, 3.1rem); }
    .omega-subhead { font-size: 0.9rem; line-height: 1.5; }
    .omega-pills { gap: 0.35rem; }
    .omega-pill { padding: 0.26rem 0.62rem; font-size: 0.72rem; }
  }

  /* Hero */
  .omega-hero { display: flex; flex-direction: column; align-items: center; gap: 1.5rem; text-align: center; }
  .omega-logo-wrap { position: relative; width: 82px; height: 82px; opacity: 0; animation: omegaFadeUp 0.6s 0.1s var(--o-out) forwards; }
  .omega-logo-halo {
    position: absolute; inset: -8px; border-radius: 28px;
    animation: omegaHalo 4s 1.6s ease-in-out infinite;
  }
  .omega-hero-text { display: flex; flex-direction: column; align-items: center; gap: 0.85rem; }

  .omega-eyebrow {
    display: inline-flex; align-items: center; gap: 0.6rem;
    font-size: 0.66rem; letter-spacing: 0.30em; text-transform: uppercase;
    color: var(--o-muted); font-weight: 600;
    opacity: 0; animation: omegaFadeUp 0.6s 0.7s var(--o-out) forwards;
  }
  .omega-eyebrow-line { width: 22px; height: 1px; background: var(--o-accent); }
  .omega-eyebrow-version {
    font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
    color: var(--o-accent-bright); border: 1px solid rgba(199, 162, 78,0.4);
    border-radius: 999px; padding: 0.05rem 0.45rem; letter-spacing: 0.05em;
  }

  .omega-title {
    font-family: 'Inter', sans-serif; font-weight: 600;
    line-height: 0.96; letter-spacing: -0.04em; margin: 0;
    display: flex; flex-direction: column; align-items: center;
  }
  .omega-title-row {
    display: block; font-size: clamp(2.2rem, 6.5vw, 4.4rem);
    color: var(--o-fg);
    opacity: 0; animation: omegaFadeUp 0.7s 0.85s var(--o-out) forwards;
  }
  .omega-title-accent {
    font-weight: 500;
    background: linear-gradient(135deg, var(--o-accent-bright) 0%, var(--o-accent) 50%, var(--o-cyan) 120%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    margin-top: 0.02em; animation-delay: 0.95s;
  }

  .omega-subhead {
    max-width: 540px; font-size: clamp(0.92rem, 1.4vw, 1.05rem);
    line-height: 1.65; color: var(--o-muted); margin: 0;
    opacity: 0; animation: omegaFadeUp 0.6s 1.05s var(--o-out) forwards;
  }
  .omega-accent-text { color: var(--o-accent-bright); font-weight: 500; }

  /* Pills */
  .omega-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem; }
  .omega-pill {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.32rem 0.72rem; font-size: 0.74rem; font-weight: 500;
    color: var(--o-fg);
    border: 1px solid var(--o-panel-line);
    background: var(--o-panel);
    border-radius: 999px; backdrop-filter: blur(8px);
    opacity: 0; transform: translateY(6px);
    animation: omegaFadeUp 0.4s var(--o-out) forwards;
    transition: transform 0.2s var(--o-quart), border-color 0.2s var(--o-quart), background 0.2s var(--o-quart);
  }
  .omega-pill:hover { transform: translateY(-2px); border-color: rgba(199, 162, 78,0.4); background: var(--o-panel-hover); }
  .omega-pill-glyph { color: var(--o-accent); display: inline-flex; align-items: center; }

  /* Bento */
  .omega-bento { width: 100%; display: grid; gap: 0.85rem; grid-template-columns: 1fr 1fr; grid-auto-rows: auto; }
  .omega-bento.has-resume {
    grid-template-columns: 1fr 1fr;
    grid-template-areas: "resume resume" "demo demo" "new blank";
  }
  .omega-bento:not(.has-resume) { grid-template-areas: "demo demo" "new blank"; }
  @media (min-width: 800px) {
    .omega-bento.has-resume {
      grid-template-columns: 1.4fr 1fr 1fr;
      grid-template-areas: "resume demo demo" "resume new blank";
    }
    .omega-bento:not(.has-resume) {
      grid-template-columns: 1.6fr 1fr 1fr;
      grid-template-areas: "demo demo new" "demo demo blank";
    }
  }
  .omega-card-hero    { grid-area: resume; }
  .omega-card-feature { grid-area: demo; }
  @supports (selector(:nth-of-type(1 of .x))) {
    .omega-bento .omega-card-compact:nth-of-type(1 of .omega-card-compact) { grid-area: new; }
    .omega-bento .omega-card-compact:nth-of-type(2 of .omega-card-compact) { grid-area: blank; }
  }
  @supports not (selector(:nth-of-type(1 of .x))) {
    .omega-bento .omega-card-compact:first-of-type { grid-area: new; }
    .omega-bento .omega-card-compact:last-of-type  { grid-area: blank; }
  }

  /* Card */
  .omega-card {
    position: relative; display: flex; flex-direction: column; align-items: flex-start;
    text-align: left; padding: 1.2rem 1.3rem; border-radius: 18px;
    background: var(--o-panel-2);
    backdrop-filter: blur(14px);
    border: 1px solid var(--o-panel-line);
    box-shadow: 0 2px 4px rgba(0,0,0,0.3), 0 12px 32px rgba(0,0,0,0.32);
    cursor: pointer; overflow: hidden; color: var(--o-fg); font-family: inherit;
    opacity: 0; transform: translateY(14px);
    animation: omegaCardIn 0.6s var(--o-out) forwards;
    transition: transform 0.32s var(--o-quart), box-shadow 0.32s var(--o-quart), border-color 0.32s var(--o-quart);
  }
  .omega-card.is-hovered, .omega-card:hover {
    transform: translateY(-4px);
    border-color: rgba(199, 162, 78,0.4);
    box-shadow: 0 4px 8px rgba(0,0,0,0.32), 0 18px 44px rgba(0,0,0,0.42), 0 0 24px rgba(199, 162, 78,0.16);
  }
  .omega-card-bg-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(200, 182, 142,0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(200, 182, 142,0.05) 1px, transparent 1px);
    background-size: 22px 22px; opacity: 0.6;
    mask-image: linear-gradient(180deg, transparent, black 40%, black 80%, transparent);
    -webkit-mask-image: linear-gradient(180deg, transparent, black 40%, black 80%, transparent);
    pointer-events: none;
  }
  .omega-card-corner-arc {
    position: absolute; top: -50px; right: -50px; width: 140px; height: 140px;
    border-radius: 50%; border: 1px solid rgba(199, 162, 78,0.28);
    pointer-events: none; opacity: 0;
    transition: opacity 0.4s var(--o-quart), transform 0.4s var(--o-quart);
  }
  .omega-card.is-hovered .omega-card-corner-arc { opacity: 1; transform: scale(1.08); }

  .omega-card-icon {
    position: relative; width: 44px; height: 44px; border-radius: 12px;
    display: inline-flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, #E6CC86, #C7A24E); color: #fff;
    margin-bottom: 0.85rem;
    box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 4px 16px rgba(199, 162, 78,0.36);
    transition: transform 0.32s var(--o-spring);
  }
  .omega-card.is-hovered .omega-card-icon { transform: scale(1.08) rotate(-4deg); }
  .omega-card-compact .omega-card-icon { width: 36px; height: 36px; border-radius: 10px; }

  .omega-card-tag {
    position: absolute; top: 1rem; right: 1rem;
    font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--o-accent-bright); border: 1px solid rgba(199, 162, 78,0.35);
    border-radius: 999px; padding: 0.12rem 0.5rem;
    background: rgba(199, 162, 78,0.08); font-weight: 600;
  }
  .omega-card-title {
    font-family: 'Inter', sans-serif; font-size: 1.2rem; font-weight: 600;
    line-height: 1.15; letter-spacing: -0.025em; margin: 0 0 0.4rem 0;
  }
  .omega-card-feature .omega-card-title, .omega-card-hero .omega-card-title { font-size: 1.45rem; }
  .omega-card-desc { font-size: 0.83rem; line-height: 1.55; color: var(--o-muted); margin: 0; }

  /* Demo stats — fills the feature card's body with what you actually get. */
  .omega-card-stats {
    display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap;
    margin-top: 1rem; flex: 1; align-content: flex-start;
    font-size: 0.8rem; color: var(--o-muted);
  }
  .omega-card-stats b {
    font-size: 1.15rem; font-weight: 600; color: var(--o-fg);
    letter-spacing: -0.02em; margin-right: 0.28rem;
    font-variant-numeric: tabular-nums;
  }
  .omega-card-stats span { display: inline-flex; align-items: baseline; }
  .omega-stat-sep { width: 3px; height: 3px; border-radius: 50%; background: color-mix(in srgb, var(--o-muted) 55%, transparent); align-self: center; }
  /* Cards without a stats filler keep the CTA pinned to the bottom. */
  .omega-card-hero .omega-card-desc, .omega-card-compact .omega-card-desc { flex: 1; }
  .omega-card-cta {
    display: inline-flex; align-items: center; gap: 0.35rem; margin-top: 1rem;
    font-size: 0.78rem; font-weight: 600; color: var(--o-accent-bright);
    opacity: 0; transform: translateX(-4px);
    transition: opacity 0.24s var(--o-quart), transform 0.24s var(--o-quart);
  }
  .omega-card.is-hovered .omega-card-cta { opacity: 1; transform: translateX(0); }
  .omega-card-compact .omega-card-cta { opacity: 0.5; }
  .omega-card-compact.is-hovered .omega-card-cta { opacity: 1; }

  .omega-card-preview {
    position: absolute; bottom: -10px; right: -10px; width: 180px; height: 110px;
    color: rgba(199, 162, 78,0.4); opacity: 0.55; pointer-events: none;
    transition: opacity 0.32s var(--o-quart), transform 0.4s var(--o-quart);
  }
  .omega-card.is-hovered .omega-card-preview { opacity: 0.9; transform: translate(-4px, -4px); }
  .omega-card-preview svg { width: 100%; height: 100%; }

  /* Brands */
  .omega-brands { width: 100%; max-width: 720px; opacity: 0; animation: omegaFadeUp 0.6s 2.0s var(--o-out) forwards; }
  .omega-brands-rule { display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.9rem; }
  .omega-brands-rule-line { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(200, 182, 142,0.22), transparent); }
  .omega-brands-rule-label { font-size: 0.62rem; letter-spacing: 0.30em; text-transform: uppercase; color: var(--o-muted); font-weight: 600; }
  .omega-brands-mask {
    overflow: hidden;
    mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
    -webkit-mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
  }
  .omega-brands-row {
    display: flex; flex-wrap: wrap; justify-content: center; gap: 0.4rem 1.4rem;
    font-size: 0.78rem; font-weight: 500; color: var(--o-muted);
  }
  .omega-brand-item { transition: color 0.2s var(--o-quart), transform 0.2s var(--o-quart); cursor: default; }
  .omega-brand-item:hover { color: var(--o-accent-bright); transform: translateY(-1px); }

  /* Footer */
  .omega-foot {
    display: inline-flex; align-items: center; gap: 0.8rem;
    font-size: 0.66rem; letter-spacing: 0.20em; text-transform: uppercase;
    color: var(--o-muted); opacity: 0;
    animation: omegaFadeUp 0.6s 2.3s var(--o-out) forwards;
  }
  .omega-foot-dot { width: 3px; height: 3px; border-radius: 50%; background: rgba(200, 182, 142,0.5); }
  .omega-foot-link { color: var(--o-muted); text-decoration: none; transition: color 0.2s var(--o-quart); }
  .omega-foot-link:hover { color: var(--o-accent-bright); }

  /* Demo-video entry — deliberately quiet: a slim ghost link under the subhead */
  .omega-promo-link {
    display: inline-flex; align-items: center; gap: 0.55rem; margin-top: 1.2rem;
    padding: 0.5rem 0.9rem 0.5rem 0.5rem; border-radius: 999px;
    background: color-mix(in srgb, var(--o-fg) 3%, transparent); border: 1px solid var(--o-border);
    color: var(--o-muted); font-size: 0.8rem; font-weight: 500; letter-spacing: 0.01em;
    cursor: pointer; opacity: 0; backdrop-filter: blur(4px);
    transition: color 0.25s var(--o-quart), border-color 0.25s var(--o-quart), background 0.25s var(--o-quart), transform 0.25s var(--o-quart);
    animation: omegaFadeUp 0.6s 1.05s var(--o-out) forwards;
  }
  .omega-promo-link:hover { color: var(--o-fg); border-color: rgba(199,162,78,0.4); background: rgba(199,162,78,0.06); transform: translateY(-1px); }
  .omega-promo-play {
    display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 50%; color: var(--o-accent-bright);
    background: rgba(199,162,78,0.14); border: 1px solid rgba(199,162,78,0.3);
  }
  .omega-promo-dur { margin-left: 0.15rem; font-size: 0.68rem; color: var(--o-muted); font-variant-numeric: tabular-nums; }

  /* Modal */
  .omega-promo-overlay {
    position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center;
    padding: 4vmin; background: var(--o-promo-bg); backdrop-filter: blur(10px);
    animation: omegaFadeUp 0.3s var(--o-out) forwards;
  }
  .omega-promo-frame {
    position: relative; width: min(1000px, 94vw); border-radius: 16px; overflow: hidden;
    border: 1px solid var(--o-border); box-shadow: var(--shadow-4, 0 30px 90px rgba(0,0,0,0.6));
    background: var(--o-promo-frame);
  }
  .omega-promo-video { display: block; width: 100%; height: auto; }
  .omega-promo-close {
    position: absolute; top: 10px; right: 12px; z-index: 2; width: 34px; height: 34px;
    border-radius: 50%; border: 1px solid var(--o-border); background: rgba(5,5,6,0.7);
    color: var(--o-fg); font-size: 1.3rem; line-height: 1; cursor: pointer; backdrop-filter: blur(6px);
    transition: background 0.2s var(--o-quart), transform 0.2s var(--o-quart);
  }
  .omega-promo-close:hover { background: rgba(199,162,78,0.18); transform: scale(1.05); }

  /* Keyframes */
  @keyframes omegaFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes omegaCardIn { 0% { opacity: 0; transform: translateY(14px) scale(0.985); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes omegaBlob1 { 0%,100% { transform: translate(0,0) scale(1); } 33% { transform: translate(8vw,5vh) scale(1.1); } 66% { transform: translate(-4vw,9vh) scale(0.95); } }
  @keyframes omegaBlob2 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(-7vw,-8vh) scale(1.08); } }
  @keyframes omegaBlob3 { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(5vw,-7vh) scale(1.12); } }
  @keyframes omegaHalo {
    0%,100% { box-shadow: 0 0 0 1px rgba(199, 162, 78,0.2), 0 0 0 6px rgba(199, 162, 78,0); }
    50%     { box-shadow: 0 0 0 1px rgba(199, 162, 78,0.4), 0 0 0 16px rgba(199, 162, 78,0.05); }
  }
  @keyframes logoPlate { 0% { opacity: 0; transform: scale(0.7) rotate(-6deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
  @keyframes logoSheen { from { opacity: 0; } to { opacity: 0.55; } }
  @keyframes logoStroke { from { stroke-dashoffset: 200; } to { stroke-dashoffset: 0; } }
  @keyframes logoDot { 0% { opacity: 0; transform: scale(0); } 60% { opacity: 1; transform: scale(1.3); } 100% { opacity: 0.9; transform: scale(1); } }

  @media (prefers-reduced-motion: reduce) {
    .omega-blob, .omega-logo-halo { animation: none !important; }
    .omega-card, .omega-pill, .omega-logo-wrap, .omega-eyebrow,
    .omega-title-row, .omega-subhead, .omega-brands, .omega-foot {
      animation: none !important; opacity: 1 !important; transform: none !important;
    }
  }
`
