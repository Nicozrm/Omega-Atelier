import { describe, it, expect } from 'vitest'
import { isPlaceholder } from './supabase'

/**
 * Der Fehler, den diese Datei festhält: `index.html` liefert
 * `window.__OMEGA_RUNTIME__` mit den wörtlichen Platzhaltern aus, und nur der
 * Container-Entrypoint ersetzt sie. Auf GitHub Pages — dem dokumentierten Host
 * — tut das niemand. Weil ein unersetzter Platzhalter ein truthy String ist,
 * galt er als gültige Konfiguration: `supabaseReady` wurde `true` und jeder
 * Aufruf ging an `__OMEGA_SUPABASE_URL__`, statt auf die Vite-Variablen
 * zurückzufallen. Sichtbar war davon nur, dass Login und Cloud-Sync live
 * nicht funktionierten.
 */
describe('isPlaceholder — unersetzte Deploy-Platzhalter', () => {
  it('erkennt die Platzhalter aus index.html', () => {
    expect(isPlaceholder('__OMEGA_SUPABASE_URL__')).toBe(true)
    expect(isPlaceholder('__OMEGA_SUPABASE_ANON_KEY__')).toBe(true)
  })

  it('behandelt fehlende Werte wie Platzhalter', () => {
    expect(isPlaceholder(undefined)).toBe(true)
    expect(isPlaceholder('')).toBe(true)
  })

  it('lässt echte Werte durch', () => {
    expect(isPlaceholder('https://abcdefgh.supabase.co')).toBe(false)
    expect(isPlaceholder('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.x')).toBe(false)
  })

  it('greift nicht bei Werten, die nur zufällig Unterstriche tragen', () => {
    expect(isPlaceholder('__omega_supabase_url__')).toBe(false)
    expect(isPlaceholder('my__OMEGA_URL__key')).toBe(false)
  })
})
