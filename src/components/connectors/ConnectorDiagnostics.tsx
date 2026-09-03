/**
 * ConnectorDiagnostics — the recorded chain, readable in the app.
 *
 * "Verbunden, aber keine Geräte" is unanswerable from the outside, because six
 * different failures produce that same sentence. The live connectors record the
 * steps they actually took (`connectors/diagnostics`), and this panel shows
 * them:
 *
 *   auth → request → parse → normalize → store
 *
 * so it is visible which step ran, what it returned, and where the chain
 * stopped. Every value passed through the trace's redaction, so the contents
 * are safe to share — that is the whole reason it is a UI surface and not a
 * console log.
 *
 * Collapsed by default: it is a diagnostic, not part of the normal flow.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Stethoscope, Trash2 } from 'lucide-react'
import { clearTrace, subscribeTrace, type TraceEntry } from '@/connectors/diagnostics'

const STEP_LABEL: Record<TraceEntry['step'], string> = {
  auth: 'Anmeldung',
  request: 'API-Anfrage',
  parse: 'Antwort gelesen',
  normalize: 'Normalisiert',
  store: 'Im Twin',
  command: 'Befehl',
}

const LEVEL_COLOR: Record<TraceEntry['level'], string> = {
  info: 'var(--muted)',
  warn: '#e0a23c',
  error: '#d8635f',
}

const time = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('de-DE', { hour12: false })
}

export function ConnectorDiagnostics() {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<TraceEntry[]>([])

  useEffect(() => subscribeTrace(setEntries), [])

  const failed = entries.filter((e) => e.level === 'error').length

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown size={14} className="text-[color:var(--muted)]" /> : <ChevronRight size={14} className="text-[color:var(--muted)]" />}
          <Stethoscope size={14} className="text-[color:var(--muted)]" />
          <span className="text-[12px] font-medium">Diagnose</span>
          <span className="text-[10px] text-[color:var(--muted)]">
            {entries.length === 0
              ? 'noch keine Schritte aufgezeichnet'
              : `${entries.length} Schritte${failed > 0 ? ` · ${failed} fehlgeschlagen` : ''}`}
          </span>
        </span>
        {failed > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#d8635f' }} />}
      </button>

      {open && (
        <div className="border-t border-[color:var(--border)] px-3.5 py-2.5">
          {entries.length === 0 ? (
            <div className="text-[11px] text-[color:var(--muted)]">
              Sobald eine Live-Verbindung aufgebaut wird, erscheint hier ihre Schrittkette —
              Anmeldung, API-Anfrage, gelesene Antwort, Normalisierung, Übergabe an den Twin.
              Zugangsdaten werden dabei nie aufgezeichnet.
            </div>
          ) : (
            <>
              <ol className="omega-scroll max-h-64 space-y-1 overflow-y-auto pr-1">
                {entries.map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="flex items-start gap-2 text-[11px] leading-snug">
                    <span className="shrink-0 tabular-nums text-[10px] text-[color:var(--muted)]">{time(entry.at)}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">{entry.connector}</span>
                    <span className="shrink-0 text-[10px]" style={{ color: LEVEL_COLOR[entry.level] }}>{STEP_LABEL[entry.step]}</span>
                    <span className="min-w-0" style={{ color: LEVEL_COLOR[entry.level] }}>
                      {entry.message}
                      {entry.detail && (
                        <span className="ml-1 text-[10px] text-[color:var(--muted)]">
                          {Object.entries(entry.detail).map(([k, v]) => `${k}=${v}`).join(' · ')}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-[color:var(--border)] pt-2">
                <span className="text-[10px] text-[color:var(--muted)]">Nur im Speicher, nie gespeichert, ohne Zugangsdaten.</span>
                <button onClick={() => clearTrace()} className="btn btn-sm btn-ghost inline-flex items-center gap-1.5 text-[10px]">
                  <Trash2 size={11} /> Leeren
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
