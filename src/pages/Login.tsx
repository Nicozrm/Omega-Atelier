import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/useAuthStore'
import { supabaseReady } from '@/lib/supabase'
import { AlertCircle, MailCheck } from 'lucide-react'

/** Google 'G' brand mark (official four-colour). */
function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

export function LoginPage() {
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const signIn = useAuthStore((s) => s.signInWithPassword)
  const signUp = useAuthStore((s) => s.signUpWithPassword)
  const oauth = useAuthStore((s) => s.signInWithOAuth)

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (user) return <Navigate to="/dashboard" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const r = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password, name)
    if (r.error) setErr(r.error)
    else if (mode === 'signup') setSentTo(email)
  }

  return (
    <div className="flex min-h-screen items-center justify-center omega-noise p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-2 font-display text-6xl text-gradient-gold">Ω</div>
          <h1 className="font-display text-3xl">OMEGA Atelier 2.0</h1>
          <div className="text-sm text-[color:var(--muted)] mt-1">
            Dein Smart-Home, sorgfältig entworfen.
          </div>
        </div>

        {!supabaseReady && (
          <div className="mb-4 surface p-3 flex gap-2 items-start text-xs" style={{ borderColor: 'rgba(208,100,100,0.4)' }}>
            <AlertCircle size={14} className="text-[color:var(--color-omega-danger)] mt-0.5" />
            <div>
              Supabase ist nicht konfiguriert. Bitte <code className="font-mono">VITE_SUPABASE_URL</code> und
              {' '}<code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in der <code className="font-mono">.env.local</code> setzen
              oder offline ohne Cloud fortfahren.
            </div>
          </div>
        )}

        <div className="surface p-6 shadow-[var(--shadow-soft)]">
          {sentTo ? (
            <div className="text-center py-4">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>
                <MailCheck size={26} />
              </div>
              <h2 className="font-display text-xl mb-1">Fast geschafft</h2>
              <p className="text-sm text-[color:var(--muted)] leading-relaxed">
                Wir haben dir eine Bestätigungsmail an<br />
                <span className="text-[color:var(--text)] font-medium">{sentTo}</span> gesendet.
                Öffne den Link darin, um dein Konto zu aktivieren.
              </p>
              <p className="mt-3 text-xs text-[color:var(--muted)]">
                Keine Mail erhalten? Prüfe den Spam-Ordner oder{' '}
                <button onClick={() => { setSentTo(null); setMode('signin') }} className="text-[color:var(--accent)] hover:underline">zurück zur Anmeldung</button>.
              </p>
            </div>
          ) : (
          <>
          <div className="mb-4 flex rounded-md bg-[color:var(--surface-2)] p-1 text-sm">
            <button
              onClick={() => setMode('signin')}
              className={`flex-1 rounded px-3 py-1.5 transition ${mode === 'signin' ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}
            >Anmelden</button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 rounded px-3 py-1.5 transition ${mode === 'signup' ? 'bg-[color:var(--accent)] text-white' : 'text-[color:var(--muted)]'}`}
            >Registrieren</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === 'signup' && (
              <label className="block">
                <span className="text-xs text-[color:var(--muted)]">Name</span>
                <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
            )}
            <label className="block">
              <span className="text-xs text-[color:var(--muted)]">E-Mail</span>
              <input className="input mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label className="block">
              <span className="text-xs text-[color:var(--muted)]">Passwort</span>
              <input className="input mt-1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            </label>

            {err && <div className="text-xs text-[color:var(--color-omega-danger)]">{err}</div>}

            <button type="submit" className="btn btn-primary w-full" disabled={loading || !supabaseReady}>
              {mode === 'signin' ? 'Anmelden' : 'Konto erstellen'}
            </button>
          </form>

          <div className="omega-divider my-4">&nbsp;</div>

          {/* Google ist der einzige OAuth-Anbieter. Apple ist entfernt: es
              setzt eine kostenpflichtige Developer-Mitgliedschaft und einen
              serverseitig signierten Client-Secret voraus, der alle sechs
              Monate neu erzeugt werden muss — Aufwand, der sich für einen
              zweiten Anbieter neben E-Mail und Google nicht rechnet. */}
          <button
            onClick={() => oauth('google')}
            disabled={!supabaseReady}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-white px-3 py-2.5 text-sm font-medium text-[#1f1f1f] transition hover:bg-[#f5f5f5] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon /> Mit Google anmelden
          </button>
          </>
          )}

          <div className="mt-4 text-center text-xs text-[color:var(--muted)]">
            Ohne Anmeldung weiter? <Link to="/plans" className="text-[color:var(--accent)] hover:underline">Lokal nutzen</Link>
          </div>

          <div className="mt-6 flex justify-center gap-4 text-[11px] text-[color:var(--muted)]">
            <Link to="/impressum" className="hover:text-[color:var(--fg)]">Impressum</Link>
            <Link to="/datenschutz" className="hover:text-[color:var(--fg)]">Datenschutz</Link>
            <Link to="/agb" className="hover:text-[color:var(--fg)]">AGB</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
