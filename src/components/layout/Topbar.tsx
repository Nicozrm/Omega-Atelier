import { Link, useNavigate } from 'react-router-dom'
import {
  Sun, Moon, User, LogOut, Save,
  Download, Share2, ArrowLeft, Search, HelpCircle, Cpu, Radio, Bot,
  Wand2, BarChart3,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useUIStore } from '@/store/useUIStore'
import { supabaseReady } from '@/lib/supabase'
import { flushTwinState } from '@/twin/useTwinPersistence'
import { useEffect, useState } from 'react'
import { OmegaMark } from './OmegaMark'
import { PlanBadge } from './PlanBadge'
import { SyncStatus } from './SyncStatus'
import { ViewSwitcher } from './ViewSwitcher'
import { Button, IconButton, Tooltip, Divider, Menu } from '@/ui'

interface TopbarProps {
  showBack?: boolean
  planRowId?: string
  onOpenExport?: () => void
  onOpenShare?: () => void
  onOpenDevices?: () => void
  onOpenConnectors?: () => void
  onOpenVacuum?: () => void
}

export function Topbar({ showBack, planRowId, onOpenExport, onOpenShare, onOpenDevices, onOpenConnectors, onOpenVacuum }: TopbarProps) {
  const navigate = useNavigate()
  const doc = usePlanStore((s) => s.doc)
  const isSaving = usePlanStore((s) => s.isSaving)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)

  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)
  const setBlasterOpen = useUIStore((s) => s.setBlasterOpen)
  const setInsightsOpen = useUIStore((s) => s.setInsightsOpen)
  const pushToast = useUIStore((s) => s.pushToast)

  const [editingTitle, setEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(doc?.title ?? '')

  useEffect(() => { setLocalTitle(doc?.title ?? '') }, [doc?.title])

  const reloadFromCloud = usePlanStore((s) => s.reloadFromCloud)

  const handleSave = async () => {
    // One explicit save covers both halves of the project: the plan document
    // and the connected devices. The twin otherwise writes on its own slow
    // schedule; this is the "now" path.
    void flushTwinState()
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
          <span className="block transition-transform duration-200 group-hover:scale-105 rounded-[10px] overflow-hidden shadow-[0_2px_10px_rgba(199,162,78,0.32)]">
            <OmegaMark size={30} />
          </span>
          <span className="hidden md:inline-block font-display text-[0.95rem] font-semibold leading-none tracking-tight text-[color:var(--fg)]">
            OMEGA <span className="text-[color:var(--accent-bright)]">Atelier</span>
          </span>
        </Link>
      </div>

      <Divider orientation="vertical" className="mx-1 hidden h-6 md:block" />

      {/* Workspace tabs — the reference's Editor | 3D Ansicht | Digital Twin
          trio, shown whenever a plan is open. Magic-move pill in ViewSwitcher. */}
      {doc && <ViewSwitcher />}

      {doc && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
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
              className="min-w-0 truncate rounded-[var(--radius-sm)] px-2 py-1 text-left font-display text-[0.95rem] font-medium text-[color:var(--fg)] hover:bg-[color:var(--surface-2)] transition-colors"
              title="Zum Umbenennen klicken"
            >
              {doc.title}
            </button>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {/* Workspace tools — icon row (reference style), labels live in tooltips. */}
        <Tooltip label="Befehle & Suche" hint="⌘K" side="bottom">
          <IconButton
            label="Befehle & Suche (⌘K)"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={16} />
          </IconButton>
        </Tooltip>

        {/* Visible on every breakpoint — on phones this is the only entry
            point into the studio (the ⌘K palette needs a keyboard). */}
        <Tooltip label="Image Blaster 3D — Bild in ein 3D-Asset verwandeln" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setBlasterOpen(true)}
            aria-label="Image Blaster 3D Studio öffnen"
            leading={<Wand2 size={14} className="text-[color:var(--accent-bright)]" />}
          >
            <span className="hidden lg:inline">3D Studio</span>
          </Button>
        </Tooltip>
        {doc && (
          <Tooltip label="Insights — Plan-Doktor, Energie, Kosten, Ökosystem" side="bottom">
            <IconButton label="Insights öffnen" size="sm" onClick={() => setInsightsOpen(true)}>
              <BarChart3 size={16} />
            </IconButton>
          </Tooltip>
        )}
        {onOpenShare && (
          <Tooltip label="Teilen" side="bottom">
            <IconButton label="Teilen" size="sm" className="hidden md:inline-flex" onClick={onOpenShare}>
              <Share2 size={16} />
            </IconButton>
          </Tooltip>
        )}
        {onOpenDevices && (
          <Tooltip label="Geräte" side="bottom">
            <IconButton label="Geräte" size="sm" className="hidden md:inline-flex" onClick={onOpenDevices}>
              <Cpu size={16} />
            </IconButton>
          </Tooltip>
        )}
        {onOpenConnectors && (
          <Tooltip label="Connectors" side="bottom">
            <IconButton label="Connectors" size="sm" className="hidden md:inline-flex" onClick={onOpenConnectors}>
              <Radio size={16} />
            </IconButton>
          </Tooltip>
        )}
        {onOpenVacuum && (
          <Tooltip label="Saugroboter-Karte" side="bottom">
            <IconButton label="Saugroboter-Karte" size="sm" className="hidden md:inline-flex" onClick={onOpenVacuum}>
              <Bot size={16} />
            </IconButton>
          </Tooltip>
        )}
        {onOpenExport && (
          <Tooltip label="Export" side="bottom">
            <IconButton label="Export" size="sm" className="hidden md:inline-flex" onClick={onOpenExport}>
              <Download size={16} />
            </IconButton>
          </Tooltip>
        )}

        {doc && <div className="hidden xl:block px-1"><SyncStatus /></div>}
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

        {/* Always-visible plan (Zahlplan) + Admin badge. */}
        <PlanBadge className="ml-1 hidden sm:flex" />

        {user ? (
          <Menu
            align="end"
            trigger={({ ref, ...props }) => (
              <IconButton ref={ref} label="Konto" size="sm" {...props}><User size={16} /></IconButton>
            )}
          >
            <Menu.Label>{user.email}</Menu.Label>
            <Menu.Item icon={<LogOut size={14} />} onSelect={() => signOut()}>Abmelden</Menu.Item>
          </Menu>
        ) : (
          <Link to="/login" className="btn btn-outline btn-sm">Anmelden</Link>
        )}
      </div>
    </header>
  )
}
