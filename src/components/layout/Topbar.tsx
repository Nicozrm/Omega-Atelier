import { Link, useNavigate } from 'react-router-dom'
import {
  Sun, Moon, User, LogOut, Save,
  Download, Share2, ArrowLeft, Search, Box, HelpCircle, Cpu, Radio,
  SquarePen, ScanEye,
} from 'lucide-react'
import type { ViewMode } from '@/store/useUIStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useUIStore } from '@/store/useUIStore'
import { supabaseReady } from '@/lib/supabase'
import { useEffect, useState } from 'react'
import { OmegaMark } from './OmegaMark'
import { SyncStatus } from './SyncStatus'
import { Button, IconButton, Tooltip, Divider } from '@/ui'

interface TopbarProps {
  showBack?: boolean
  planRowId?: string
  onOpenExport?: () => void
  onOpenShare?: () => void
  onOpenDevices?: () => void
  onOpenConnectors?: () => void
}

export function Topbar({ showBack, planRowId, onOpenExport, onOpenShare, onOpenDevices, onOpenConnectors }: TopbarProps) {
  const navigate = useNavigate()
  const doc = usePlanStore((s) => s.doc)
  const isSaving = usePlanStore((s) => s.isSaving)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)

  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const viewMode = useUIStore((s) => s.viewMode)
  const setViewMode = useUIStore((s) => s.setViewMode)
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)
  const pushToast = useUIStore((s) => s.pushToast)

  const [editingTitle, setEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(doc?.title ?? '')

  useEffect(() => { setLocalTitle(doc?.title ?? '') }, [doc?.title])

  const reloadFromCloud = usePlanStore((s) => s.reloadFromCloud)

  const handleSave = async () => {
    const result = await saveToCloud(planRowId)
    if (result && typeof result === 'object' && 'conflict' in result) {
      pushToast({
        kind: 'warning',
        title: 'Konflikt beim Speichern',
        description: 'Eine andere Sitzung hat den Plan in der Zwischenzeit geändert.',
        duration: 12000,
      })
      if (planRowId) setTimeout(() => { void reloadFromCloud(planRowId) }, 1200)
      return
    }
    if (typeof result === 'string') {
      pushToast({ kind: 'success', title: 'Gespeichert', description: 'In der Cloud verfügbar.' })
      if (!planRowId) navigate(`/plan/${result}`, { replace: true })
    } else {
      pushToast({
        kind: 'error',
        title: 'Speichern fehlgeschlagen',
        description: supabaseReady ? 'Bitte prüfe deine Anmeldung.' : 'Supabase nicht konfiguriert.',
      })
    }
  }

  return (
    <header className="flex h-[var(--topbar-height)] items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--glass-bg)] backdrop-blur-[18px] px-3 md:px-5 safe-top relative z-10">
      <div className="flex items-center gap-2">
        {showBack && (
          <IconButton label="Zurück zur Übersicht" onClick={() => navigate('/dashboard')} size="sm">
            <ArrowLeft size={18} />
          </IconButton>
        )}
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <span className="block transition-transform duration-200 group-hover:scale-105 rounded-[10px] overflow-hidden shadow-[0_2px_10px_rgba(199, 162, 78,0.32)]">
            <OmegaMark size={30} />
          </span>
          <span className="hidden md:inline-block font-display text-[0.95rem] font-semibold leading-none tracking-tight text-[color:var(--fg)]">
            OMEGA <span className="text-[color:var(--accent-bright)]">Atelier</span>
          </span>
        </Link>
      </div>

      <Divider orientation="vertical" className="mx-1 hidden h-6 md:block" />

      {/* Workspace tabs — the reference's Editor | 3D Ansicht | Digital Twin
          trio, shown whenever a plan is open. */}
      {doc && (
        <nav className="hidden md:flex items-center gap-1">
          {([
            ['2d', 'Editor', SquarePen],
            ['3d', '3D Ansicht', Box],
            ['twin', 'Digital Twin', ScanEye],
          ] as Array<[ViewMode, string, typeof Box]>).map(([mode, label, Icon]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={label}
              className={`flex items-center gap-1.5 rounded-lg px-2 lg:px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === mode
                  ? 'bg-[color:var(--surface-2)] text-[color:var(--fg)] border border-[color:var(--border)]'
                  : 'text-[color:var(--muted)] hover:text-[color:var(--fg)] border border-transparent'
              }`}
            >
              <Icon size={13} /> <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </nav>
      )}

      {doc && (
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={() => {
                setEditingTitle(false)
                if (localTitle && localTitle !== doc.title) {
                  updateDoc((d) => { d.title = localTitle }, { history: false })
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="input max-w-sm"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="truncate rounded-[var(--radius-sm)] px-2 py-1 text-left font-display text-[0.95rem] font-medium text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
              title="Zum Umbenennen klicken"
            >
              {doc.title}
            </button>
          )}
          <div className="ml-2"><SyncStatus /></div>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        <Tooltip label="Befehle & Suche" hint="⌘K" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommandOpen(true)}
            className="hidden lg:inline-flex"
            leading={<Search size={14} />}
          >
            <span className="text-[color:var(--muted)] font-mono text-xs">⌘K</span>
          </Button>
        </Tooltip>

        {onOpenShare && (
          <Button variant="ghost" size="sm" onClick={onOpenShare} title="Teilen" className="hidden md:inline-flex" leading={<Share2 size={14} />}>
            <span className="hidden lg:inline">Teilen</span>
          </Button>
        )}
        {onOpenDevices && (
          <Button variant="ghost" size="sm" onClick={onOpenDevices} title="Geräte" className="hidden md:inline-flex" leading={<Cpu size={14} />}>
            <span className="hidden lg:inline">Geräte</span>
          </Button>
        )}
        {onOpenConnectors && (
          <Button variant="ghost" size="sm" onClick={onOpenConnectors} title="Connectors" className="hidden md:inline-flex" leading={<Radio size={14} />}>
            <span className="hidden lg:inline">Connectors</span>
          </Button>
        )}
        {onOpenExport && (
          <Button variant="ghost" size="sm" onClick={onOpenExport} title="Export" className="hidden md:inline-flex" leading={<Download size={14} />}>
            <span className="hidden lg:inline">Export</span>
          </Button>
        )}
        {doc && (
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving} leading={<Save size={14} />}>
            <span className="hidden md:inline">Speichern</span>
          </Button>
        )}

        <IconButton
          label="Tastenkürzel anzeigen"
          size="sm"
          className="hidden md:inline-flex"
          onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))}
        >
          <HelpCircle size={16} />
        </IconButton>

        <IconButton label="Theme umschalten" size="sm" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>

        {user ? (
          <div className="relative group">
            <IconButton label="Konto" size="sm"><User size={16} /></IconButton>
            <div className="absolute right-0 top-full mt-1 hidden w-48 surface-elevated p-1 group-hover:block animate-fade-in z-50">
              <div className="px-3 py-2 text-xs text-[color:var(--muted)] truncate border-b border-[color:var(--border)]">
                {user.email}
              </div>
              <button onClick={() => signOut()} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm hover:bg-[color:var(--surface-2)] transition-colors">
                <LogOut size={14} /> Abmelden
              </button>
            </div>
          </div>
        ) : (
          <Link to="/login" className="btn btn-outline btn-sm">Anmelden</Link>
        )}
      </div>
    </header>
  )
}
