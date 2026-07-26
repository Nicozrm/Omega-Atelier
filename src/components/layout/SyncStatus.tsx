import type { ReactNode } from 'react'
import { Cloud, CloudOff, CloudUpload, CheckCircle2, AlertTriangle } from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useAuthStore } from '@/store/useAuthStore'
import { supabaseReady } from '@/lib/supabase'
import { timeAgo } from '@/lib/utils'
import { Tooltip } from '@/ui'
import { deriveSyncStatus, type SyncStatusKind } from '@/lib/syncStatus'

interface Meta {
  icon: ReactNode
  color: string
  tooltip: string
}

const ICON = 13

const META: Record<Exclude<SyncStatusKind, 'saved'>, Meta> = {
  saving: {
    icon: <CloudUpload size={ICON} className="animate-pulse-accent" />,
    color: 'var(--accent)',
    tooltip: 'Änderungen werden in der Cloud gespeichert …',
  },
  dirty: {
    icon: <Cloud size={ICON} />,
    color: 'var(--muted)',
    tooltip: 'Lokale Änderungen sind noch nicht in der Cloud gespeichert.',
  },
  'local-only': {
    icon: <CloudOff size={ICON} />,
    color: 'var(--muted)',
    tooltip: 'Wird nur auf diesem Gerät gespeichert. Melde dich an, um in der Cloud zu sichern.',
  },
  error: {
    icon: <AlertTriangle size={ICON} />,
    color: 'var(--danger)',
    tooltip: 'Die letzte Cloud-Synchronisierung ist fehlgeschlagen.',
  },
}

/**
 * SyncStatus — a compact, always-visible indicator of where the current plan
 * lives (cloud vs. this device) and whether local edits are persisted. Makes
 * the Offline-First model tangible and surfaces sync failures beyond a fleeting
 * toast. Pure state→status mapping lives in {@link deriveSyncStatus}.
 */
export function SyncStatus() {
  const isSaving = usePlanStore((s) => s.isSaving)
  const lastSavedAt = usePlanStore((s) => s.lastSavedAt)
  const lastSyncError = usePlanStore((s) => s.lastSyncError)
  const updatedAt = usePlanStore((s) => s.doc?.updatedAt ?? null)
  const user = useAuthStore((s) => s.user)

  const cloudEnabled = supabaseReady && !!user
  const { kind } = deriveSyncStatus({ isSaving, cloudEnabled, lastSavedAt, lastSyncError, updatedAt })

  let icon: ReactNode
  let label: string
  let color: string
  let tooltip: string

  if (kind === 'saved') {
    icon = <CheckCircle2 size={ICON} />
    label = lastSavedAt ? `Gespeichert ${timeAgo(new Date(lastSavedAt))}` : 'Gespeichert'
    color = 'var(--success)'
    tooltip = lastSavedAt
      ? `Mit der Cloud synchronisiert · ${new Date(lastSavedAt).toLocaleString('de-DE')}`
      : 'Mit der Cloud synchronisiert.'
  } else {
    const m = META[kind]
    icon = m.icon
    color = m.color
    tooltip = lastSyncError && kind === 'error' ? lastSyncError : m.tooltip
    label =
      kind === 'saving' ? 'Speichert …'
        : kind === 'dirty' ? 'Nicht gespeichert'
          : kind === 'local-only' ? 'Nur lokal'
            : 'Sync-Fehler'
  }

  return (
    <Tooltip label={tooltip} side="bottom">
      <span
        data-status={kind}
        className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium"
        style={{ color }}
      >
        {icon}
        <span>{label}</span>
      </span>
    </Tooltip>
  )
}
