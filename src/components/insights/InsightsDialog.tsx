import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Stethoscope, Zap, Wallet, Network, Lock, CheckCircle2, AlertTriangle,
  XCircle, Info, Download,
} from 'lucide-react'
import { Dialog } from '@/ui/Dialog'
import { Badge } from '@/ui/Badge'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { useTier } from '@/hooks/useTier'
import { DEVICES } from '@/data/devices'
import { FURNITURE } from '@/data/furniture'
import { checkPlanIntegrity, type IntegrityIssue } from '@/lib/planIntegrity'
import { estimateEnergy } from '@/lib/energy'
import { estimateCost, costReportToCsv } from '@/lib/costEstimate'
import { auditEcosystems, type AuditSeverity } from '@/lib/ecosystemAudit'
import type { FeatureKey } from '@/lib/entitlements'

const DEVICE_ENTRY = new Map(DEVICES.map((d) => [d.id, d] as const))
const entryOf = (id: string) => DEVICE_ENTRY.get(id)
const FURN_CAT = new Map(FURNITURE.map((f) => [f.id, f.category] as const))
const categoryOf = (id: string) => FURN_CAT.get(id)

const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur2 = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = (n: number, d = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d })

type TabKey = 'doctor' | 'energy' | 'cost' | 'ecosystem'
const TABS: { key: TabKey; label: string; icon: typeof Zap; feature: FeatureKey }[] = [
  { key: 'doctor', label: 'Plan-Doktor', icon: Stethoscope, feature: 'plan-doctor' },
  { key: 'energy', label: 'Energie', icon: Zap, feature: 'energy-report' },
  { key: 'cost', label: 'Kosten', icon: Wallet, feature: 'cost-report' },
  { key: 'ecosystem', label: 'Ökosystem', icon: Network, feature: 'ecosystem-audit' },
]

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--muted)]">{label}</div>
      <div className="mt-1 font-display text-xl tabular-nums text-[color:var(--fg)]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[color:var(--muted)]">{hint}</div>}
    </div>
  )
}

function Bar({ label, value, max, right }: { label: string; value: number; max: number; right: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-28 shrink-0 truncate text-[color:var(--muted)]">{label}</div>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-3)]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums text-[color:var(--fg)]">{right}</div>
    </div>
  )
}

function UpgradeGate({ feature }: { feature: FeatureKey }) {
  const navigate = useNavigate()
  const tierWord = feature === 'ecosystem-audit' ? 'Max' : 'Pro'
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-[color:var(--border)] px-6 py-12 text-center">
      <Lock size={22} className="text-[color:var(--accent-bright)]" />
      <div className="font-display text-lg">{tierWord}-Funktion</div>
      <p className="max-w-sm text-sm text-[color:var(--muted)]">
        Diese Insight ist Teil des {tierWord}-Plans. Schalte sie frei, um dein Zuhause in Zahlen zu sehen.
      </p>
      <button onClick={() => navigate('/#preise')} className="btn btn-primary btn-sm">Plan ansehen</button>
    </div>
  )
}

const SEV_STYLE: Record<AuditSeverity, { icon: typeof Info; tone: string }> = {
  error: { icon: XCircle, tone: 'var(--color-omega-danger)' },
  warning: { icon: AlertTriangle, tone: 'var(--color-omega-warn)' },
  info: { icon: Info, tone: 'var(--accent-bright)' },
}

const ISSUE_LABEL: Record<IntegrityIssue['kind'], string> = {
  'furniture-overlap': 'Möbel überlappen',
  'furniture-in-pool': 'Objekt im Pool',
  'opening-overflow': 'Öffnung zu breit',
  'furniture-out-of-bounds': 'Außerhalb des Grundrisses',
}

function DoctorTab() {
  const doc = usePlanStore((s) => s.doc)
  const issues = useMemo(() => (doc ? checkPlanIntegrity(doc, { categoryOf }) : []), [doc])
  if (!doc) return null
  const byFloor = new Map<string, IntegrityIssue[]>()
  for (const i of issues) byFloor.set(i.floor, [...(byFloor.get(i.floor) ?? []), i])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Stockwerke" value={num(doc.floors.length)} />
        <Tile label="Befunde" value={num(issues.length)} />
        <Tile label="Status" value={issues.length === 0 ? '✓ Sauber' : 'Prüfen'} />
      </div>
      {issues.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-4 text-sm">
          <CheckCircle2 size={20} style={{ color: 'var(--color-omega-success)' }} />
          <span>Keine Konflikte gefunden — kein Möbelstacking, Öffnungen passen in ihre Wände, nichts ragt aus dem Grundriss.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {[...byFloor.entries()].map(([floor, list]) => (
            <div key={floor}>
              <div className="mb-1 text-xs uppercase tracking-wider text-[color:var(--muted)]">{floor} · {list.length}</div>
              <ul className="space-y-1.5">
                {list.map((i, k) => (
                  <li key={k} className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-sm">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--color-omega-warn)' }} />
                    <div className="min-w-0">
                      <div className="font-medium">{ISSUE_LABEL[i.kind]}{i.amount ? ` · ${i.amount.toFixed(0)} cm` : ''}</div>
                      <div className="break-words text-[12px] text-[color:var(--muted)]">{i.message}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[color:var(--muted)]">
        Der Plan-Doktor prüft Geometrie ohne Toleranz: echtes Stacking, zu breite Türen/Fenster, Objekte im Pool und Möbel außerhalb der Gebäudehülle.
      </p>
    </div>
  )
}

function EnergyTab() {
  const doc = usePlanStore((s) => s.doc)
  const r = useMemo(() => (doc ? estimateEnergy(doc, { entryOf }) : null), [doc])
  if (!r) return null
  const maxCat = Math.max(1, ...r.byCategory.map((c) => c.kwhPerMonth))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Verbrauch" value={`${num(r.kwhPerMonth)} kWh`} hint="pro Monat" />
        <Tile label="Stromkosten" value={eur(r.costPerMonth)} hint={`${num(r.pricePerKwh, 2)} €/kWh`} />
        <Tile label="pro Jahr" value={eur(r.costPerYear)} hint={`${num(r.kwhPerYear)} kWh`} />
        <Tile label="CO₂" value={`${num(r.co2PerYearKg)} kg`} hint="pro Jahr" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Grundlast (Standby)" value={`${num(r.standbyWatts)} W`} hint="Hubs, Sensoren, Kameras — 24/7" />
        <Tile label="Anschlussleistung" value={`${num(r.connectedWatts)} W`} hint={`${r.poweredCount} von ${r.deviceCount} Geräten`} />
      </div>
      {r.byCategory.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Verbrauch nach Kategorie</div>
          {r.byCategory.map((c) => (
            <Bar key={c.category} label={`${c.label} (${c.count})`} value={c.kwhPerMonth} max={maxCat} right={`${num(c.kwhPerMonth)} kWh`} />
          ))}
        </div>
      )}
      <p className="text-[11px] text-[color:var(--muted)]">
        Planungs-Schätzung: Nennleistung × typische Nutzungsdauer je Kategorie (Lampen ~5 h, Media ~4 h, Hubs/Sensoren 24 h).
      </p>
    </div>
  )
}

function CostTab() {
  const doc = usePlanStore((s) => s.doc)
  const r = useMemo(() => (doc ? estimateCost(doc, { entryOf }) : null), [doc])
  if (!r) return null
  const maxEco = Math.max(1, ...r.byEcosystem.map((e) => e.total))
  const download = () => {
    const blob = new Blob([costReportToCsv(r)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doc?.title ?? 'smart-home').replace(/[^\w-]+/g, '-').toLowerCase()}-materialliste.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Investition" value={eur(r.totalEur)} hint="Hardware gesamt" />
        <Tile label="Geräte" value={num(r.deviceCount)} />
        <Tile label="Ökosysteme" value={num(r.byEcosystem.length)} />
      </div>
      {r.byEcosystem.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Kosten nach Ökosystem</div>
          {r.byEcosystem.map((e) => (
            <Bar key={e.key} label={`${e.label} (${e.count})`} value={e.total} max={maxEco} right={eur(e.total)} />
          ))}
        </div>
      )}
      {r.items.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Materialliste</div>
            <button onClick={download} className="btn btn-ghost btn-sm" title="Als CSV exportieren">
              <Download size={13} /> CSV
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--border)]">
            <table className="w-full text-sm">
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.deviceId} className="border-b border-[color:var(--border)] last:border-0">
                    <td className="py-1.5 pl-3 pr-2 tabular-nums text-[color:var(--muted)]">{i.count}×</td>
                    <td className="py-1.5 pr-2">{i.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{eur2(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="text-[11px] text-[color:var(--muted)]">Katalogpreise (UVP) der platzierten Geräte. Möbel & Installation nicht enthalten.</p>
    </div>
  )
}

function EcosystemTab() {
  const doc = usePlanStore((s) => s.doc)
  const r = useMemo(() => (doc ? auditEcosystems(doc, { entryOf }) : null), [doc])
  if (!r) return null
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Ökosysteme" value={num(r.ecosystemCount)} />
        <Tile label="Matter-Geräte" value={num(r.matterCount)} />
        <Tile label="Protokolle" value={num(r.protocolMix.length)} />
      </div>
      {r.findings.length > 0 && (
        <ul className="space-y-1.5">
          {r.findings.map((f, k) => {
            const s = SEV_STYLE[f.severity]
            const Icon = s.icon
            return (
              <li key={k} className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2.5 text-sm">
                <Icon size={15} className="mt-0.5 shrink-0" style={{ color: s.tone }} />
                <div className="min-w-0">
                  <div className="font-medium">{f.title}</div>
                  <div className="text-[12px] text-[color:var(--muted)]">{f.detail}</div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {r.ecosystems.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-[color:var(--muted)]">Ökosysteme im Plan</div>
          <div className="flex flex-wrap gap-1.5">
            {r.ecosystems.map((e) => (
              <Badge key={e.ecosystem} tone={e.hubCount > 0 ? 'success' : 'neutral'} dot>
                {e.label} · {e.count}{e.hubCount > 0 ? ' · Hub' : ''}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {r.protocolMix.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.protocolMix.map((p) => (
            <span key={p.protocol} className="chip !py-0.5 text-[11px]">{p.protocol} · {p.count}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * InsightsDialog — the Smart-Home analysis suite. Four tier-gated tabs that turn
 * the current plan into numbers: Plan-Doktor (Pro, built on the plan-integrity
 * domain), Energie & Kosten reports (Pro) and an Ökosystem-Audit (Max). Mounted
 * globally and opened from the Topbar / command palette.
 */
export function InsightsDialog() {
  const open = useUIStore((s) => s.insightsOpen)
  const setOpen = useUIStore((s) => s.setInsightsOpen)
  const doc = usePlanStore((s) => s.doc)
  const { can } = useTier()
  const [tab, setTab] = useState<TabKey>('doctor')

  if (!open) return null
  const active = TABS.find((t) => t.key === tab)!
  const allowed = can(active.feature)

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Insights" size="lg">
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon
          const locked = !can(t.feature)
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                tab === t.key
                  ? 'border-[color:var(--border-accent)] bg-[rgba(199,162,78,0.12)] text-[color:var(--fg)]'
                  : 'border-[color:var(--border)] text-[color:var(--muted)] hover:text-[color:var(--fg)]'
              }`}
            >
              <Icon size={14} className={tab === t.key ? 'text-[color:var(--accent-bright)]' : undefined} />
              {t.label}
              {locked && <Lock size={11} className="text-[color:var(--muted)]" />}
            </button>
          )
        })}
      </div>

      {!doc ? (
        <div className="py-12 text-center text-sm text-[color:var(--muted)]">Kein Plan geladen.</div>
      ) : !allowed ? (
        <UpgradeGate feature={active.feature} />
      ) : tab === 'doctor' ? (
        <DoctorTab />
      ) : tab === 'energy' ? (
        <EnergyTab />
      ) : tab === 'cost' ? (
        <CostTab />
      ) : (
        <EcosystemTab />
      )}
    </Dialog>
  )
}
