/**
 * Error Boundary — Catches React crashes and shows a friendly error UI.
 * Prevents the white-screen-of-death.
 */

import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { isChunkLoadError, recoverFromStaleChunk } from '@/lib/chunkRecovery'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A crashed lazy route after a redeploy is a stale chunk, not a real bug —
    // reload once (guarded) to pull the fresh chunks instead of showing an error.
    if (isChunkLoadError(error) && recoverFromStaleChunk()) return
    console.error('OMEGA Error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center bg-[color:var(--bg)]">
          <div className="w-16 h-16 rounded-full bg-[color:var(--surface-2)] flex items-center justify-center">
            <AlertTriangle size={32} className="text-[color:var(--color-omega-danger)]" />
          </div>
          <h2 className="font-display text-xl">Etwas ist schiefgelaufen</h2>
          <p className="text-sm text-[color:var(--muted)] max-w-xs">
            Ein unerwarteter Fehler ist aufgetreten. Dein Plan ist nicht verloren — er wurde automatisch gespeichert.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary flex items-center gap-2"
            >
              <RefreshCw size={16} /> Neu laden
            </button>
            <button
              onClick={() => { window.location.href = import.meta.env.BASE_URL }}
              className="btn btn-outline flex items-center gap-2"
            >
              <Home size={16} /> Startseite
            </button>
          </div>
          {this.state.error && (
            <pre className="mt-4 p-3 rounded-lg bg-[color:var(--surface-2)] text-xs text-[color:var(--muted)] max-w-xs overflow-auto">
              {this.state.error.message}
            </pre>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
