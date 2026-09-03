import { Link, useNavigate } from 'react-router-dom'
import {
  Sun, Moon, User, LogIn, LogOut, Save, MoreHorizontal, Search,
  Download, Share2, ArrowLeft, HelpCircle, Cpu, Radio, Bot,
  Wand2, BarChart3, CreditCard, Keyboard,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useUIStore } from '@/store/useUIStore'
import { useTier } from '@/hooks/useTier'
import { supabaseReady } from '@/lib/supabase'
import { flushTwinState } from '@/twin/useTwinPersistence'
import { useEffect, useState } from 'react'
import { OmegaMark } from './OmegaMark'
import { PlanBadge } from './PlanBadge'
import { SyncStatus } from './SyncStatus'
import { ViewSwitcher } from './ViewSwitcher'
import { Button, IconButton, Tooltip, Menu, Badge, SearchField } from '@/ui'

interface TopbarProps {
  showBack?: boolean
  planRowId?: string
  onOpenExport?: () => void
  onOpenShare?: () => void
  onOpenDevices?: () => void
  onOpenConnectors?: () => void
  onOpenVacuum?: () => void
}

/**
 * Topbar — the workspace chrome.
 *
 * ## Three zones, not one row of glyphs
 *
 * The bar used to carry a dozen unlabelled icon buttons in a single trailing
 * run: search, studio, insights, share, devices, connectors, vacuum, export,
 * help, theme, plan, account. Every one of them needed a hover to identify, and
 * the two that people actually reach for — save, and switching view — sat in
 * the same undifferentiated line as the ones they open once a month.
 *
 * So the bar is now read left to right as three answers:
 *   · **leading** — *which document am I in?* (title + floor + sync state)
 *   · **centre**  — *what am I looking at?* (Editor · 3D · Twin)
 *   · **trailing** — *what can I do now?* (find, studio, save) with everything
 *     rarer named, grouped and shortcut-hinted inside one overflow menu.
 *
 * The rule for what stays visible: an action earns a button only if it is used
 * in most sessions. Everything else is more discoverable as a word in a titled
 * menu than as a glyph in a row — a menu can say "Saugroboter-Karte · Max",
 * which no icon can.
 */
export function Topbar({ showBack, planRowId, onOpenExport, onOpenShare, onOpenDevices, onOpenConnectors, onOpenVacuum }: TopbarProps) {
  const navigate = useNavigate()
  const doc = usePlanStore((s) => s.doc)
  const isSaving = usePlanStore((s) => s.isSaving)
  const saveToCloud = usePlanStore((s) => s.saveToCloud)
  const updateDoc = usePlanStore((s) => s.updateDoc)

  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const { tier, label: tierName, admin, can } = useTier()

  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const setCommandOpen = useUIStore((s) => s.setCommandOpen)
  const setBlasterOpen = useUIStore((s) => s.setBlasterOpen)
  const setInsightsOpen = useUIStore((s) => s.setInsightsOpen)
  const pushToast = useUIStore((s) => s.pushToast)
  const leftRailOpen = useUIStore((s) => s.leftRailOpen)
  const rightRailOpen = useUIStore((s) => s.rightRailOpen)
  const toggleLeftRail = useUIStore((s) => s.toggleLeftRail)
  const toggleRightRail = useUIStore((s) => s.toggleRightRail)

  const [editingTitle, setEditingTitle] = useState(false)
  const [localTitle, setLocalTitle] = useState(doc?.title ?? '')

  useEffect(() => { setLocalTitle(doc?.title ?? '') }, [doc?.title])

  const reloadFromCloud = usePlanStore((s) => s.reloadFromCloud)

  const activeFloor = doc?.floors.find((f) => f.id === doc.activeFloorId) ?? doc?.floors[0]

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

  /**
   * A locked feature keeps its menu row and gains the plan it needs as a badge.
   * Hiding it would leave a hole nobody can ask about; a lock glyph says only
   * "no". The row still works — it goes to the pricing page, which is the one
   * useful thing it can do.
   */
  const planTag = (needed: 'pro' | 'max', unlocked: boolean) =>
    unlocked ? undefined : <Badge tone={needed === 'max' ? 'cyan' : 'accent'}>{needed === 'max' ? 'Max' : 'Pro'}</Badge>

  return (
    <header className="chrome-row relative">
      {/* ── Leading: identity ──────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {showBack && (
          <Tooltip label="Zur Übersicht" side="bottom" className="shrink-0">
            <IconButton label="Zurück zur Übersicht" onClick={() => navigate('/dashboard')} size="sm">
              <ArrowLeft size={17} />
            </IconButton>
          </Tooltip>
        )}
        <Link to="/dashboard" className="hidden shrink-0 items-center gap-2.5 rounded-[var(--radius-sm)] px-1 py-1 group sm:flex">
          <span className="block overflow-hidden rounded-[9px] shadow-[0_2px_10px_rgba(199,162,78,0.30)] transition-transform duration-200 group-hover:scale-105">
            <OmegaMark size={26} />
          </span>
          <span className="hidden font-display text-[0.9rem] font-semibold leading-none tracking-tight text-[color:var(--fg)] 2xl:inline-block">
            OMEGA <span className="text-[color:var(--accent-bright)]">Atelier</span>
          </span>
        </Link>

        {/* The title block is the one thing in the bar allowed to give up
            width. Everything else here is a fixed control, so it has to be
            explicitly flexible *and* explicitly allowed below its content
            width — `nowrap` text reports its full length as its minimum, which
            is what stops a plain `min-w-0` parent from ever shrinking it. */}
        {doc && (
          <div className="ml-1 min-w-0 flex-1">
            {editingTitle ? (
              <input
                autoFocus
                value={localTitle}
                aria-label="Plantitel"
                onChange={(e) => setLocalTitle(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false)
                  if (localTitle && localTitle !== doc.title) {
                    updateDoc((d) => { d.title = localTitle }, { history: false })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setLocalTitle(doc.title); setEditingTitle(false) }
                }}
                className="input max-w-[16rem] py-1 text-sm"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="doc-identity group/title"
                title="Zum Umbenennen klicken"
              >
                <span className="doc-title">{doc.title}</span>
                <span className="doc-meta">
                  {/* The floor is already named in the tool rail below; on a
                      phone this line is better spent on the sync state, which
                      is nowhere else. */}
                  {activeFloor && <span className="hidden truncate sm:inline">{activeFloor.name}</span>}
                  {activeFloor && <span aria-hidden className="hidden opacity-40 sm:inline">·</span>}
                  <SyncStatus className="inline-flex items-center gap-1" />
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Centre: what am I looking at ───────────────────────────────── */}
      {doc && <ViewSwitcher />}

      {/* ── Trailing: what can I do ────────────────────────────────────── */}
      {/*
        Below md the centre zone is not rendered, so the trailing group takes its
        natural width and the identity block absorbs whatever is left — which is
        the only arrangement in which a 390px bar cannot overlap itself. From md
        up both sides share the line equally, which is what actually centres the
        view switcher.
      */}
      <div className="flex shrink-0 items-center justify-end gap-1.5 md:min-w-0 md:flex-1">
        <SearchField
          placeholder="Geräte, Möbel, Modi …"
          shortcut="⌘K"
          onClick={() => setCommandOpen(true)}
          aria-label="Befehle & Suche öffnen (⌘K)"
          className="hidden xl:inline-flex"
        />
        <Tooltip label="Befehle & Suche" hint="⌘K" side="bottom">
          <IconButton
            label="Befehle & Suche öffnen"
            size="sm"
            className="hidden md:inline-flex xl:hidden"
            onClick={() => setCommandOpen(true)}
          >
            <Search size={16} />
          </IconButton>
        </Tooltip>

        {/* The studio's signature feature keeps a button wherever the bar has
            room for one; on a phone it is a named row in the menu instead. */}
        <Tooltip label="Image Blaster 3D — ein Bild in ein 3D-Asset verwandeln" side="bottom">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setBlasterOpen(true)}
            aria-label="Image Blaster 3D Studio öffnen"
            className="hidden md:inline-flex"
            leading={<Wand2 size={15} className="text-[color:var(--accent-bright)]" />}
          >
            <span className="hidden 2xl:inline">3D Studio</span>
          </Button>
        </Tooltip>

        {doc && (
          <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving} leading={<Save size={14} />}>
            <span className="hidden md:inline">Speichern</span>
          </Button>
        )}

        <Menu
          align="end"
          minWidth={272}
          trigger={({ ref, ...props }) => (
            <IconButton ref={ref} label="Weitere Aktionen" size="sm" {...props}>
              <MoreHorizontal size={17} />
            </IconButton>
          )}
        >
          <Menu.Section title="Arbeitsbereich">
            <Menu.Item
              icon={<Search size={15} />}
              shortcut="⌘K"
              onSelect={() => setCommandOpen(true)}
              className="md:hidden"
            >
              Suchen …
            </Menu.Item>
            <Menu.Item
              icon={<Wand2 size={15} />}
              onSelect={() => setBlasterOpen(true)}
              className="md:hidden"
            >
              Image Blaster 3D
            </Menu.Item>
            {doc && (
              <Menu.Item icon={<BarChart3 size={15} />} onSelect={() => setInsightsOpen(true)}>
                Insights
              </Menu.Item>
            )}
            {doc && onOpenDevices && (
              <Menu.Item icon={<Cpu size={15} />} onSelect={onOpenDevices}>
                Geräte verwalten
              </Menu.Item>
            )}
            {doc && onOpenConnectors && (
              <Menu.Item
                icon={<Radio size={15} />}
                onSelect={onOpenConnectors}
                trailing={planTag('max', can('live-connectors'))}
              >
                Connectors
              </Menu.Item>
            )}
            {doc && onOpenVacuum && (
              <Menu.Item
                icon={<Bot size={15} />}
                onSelect={onOpenVacuum}
                trailing={planTag('max', can('robot-map'))}
              >
                Saugroboter-Karte
              </Menu.Item>
            )}
          </Menu.Section>

          {(onOpenShare || onOpenExport) && (
            <Menu.Section title="Plan">
              {onOpenShare && (
                <Menu.Item icon={<Share2 size={15} />} onSelect={onOpenShare}>Teilen …</Menu.Item>
              )}
              {onOpenExport && (
                <Menu.Item icon={<Download size={15} />} onSelect={onOpenExport}>Exportieren …</Menu.Item>
              )}
            </Menu.Section>
          )}

          <Menu.Section title="Ansicht">
            <Menu.Item checked={leftRailOpen} onSelect={toggleLeftRail} shortcut="⌥1">
              Bibliothek
            </Menu.Item>
            <Menu.Item checked={rightRailOpen} onSelect={toggleRightRail} shortcut="⌥2">
              Inspector
            </Menu.Item>
            <Menu.Item
              icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              onSelect={toggleTheme}
            >
              {theme === 'dark' ? 'Helles Erscheinungsbild' : 'Dunkles Erscheinungsbild'}
            </Menu.Item>
          </Menu.Section>

          <Menu.Section title="Hilfe">
            <Menu.Item
              icon={<Keyboard size={15} />}
              shortcut="?"
              onSelect={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))}
            >
              Tastenkürzel
            </Menu.Item>
            <Menu.Item icon={<HelpCircle size={15} />} onSelect={() => navigate('/#funktionen')}>
              Was OMEGA kann
            </Menu.Item>
          </Menu.Section>
        </Menu>

        {/* The plan stays visible where there is room; inside the account menu
            it is visible on every screen size. */}
        <PlanBadge className="ml-0.5 hidden 2xl:flex" />

        {user ? (
          <Menu
            align="end"
            minWidth={260}
            trigger={({ ref, ...props }) => (
              <IconButton ref={ref} label="Konto" size="sm" {...props}><User size={16} /></IconButton>
            )}
          >
            <Menu.Label>
              <span className="block truncate text-[color:var(--fg)]">{user.email}</span>
            </Menu.Label>
            <Menu.Section>
              <Menu.Item
                icon={<CreditCard size={15} />}
                onSelect={() => navigate('/#preise')}
                trailing={<Badge tone={tier === 'max' ? 'cyan' : tier === 'pro' ? 'accent' : 'neutral'}>{tierName}</Badge>}
              >
                Plan
              </Menu.Item>
              {admin && <Menu.Item disabled trailing={<Badge tone="warn">Admin</Badge>}>Rolle</Menu.Item>}
            </Menu.Section>
            <Menu.Separator />
            <Menu.Item icon={<LogOut size={15} />} tone="danger" onSelect={() => signOut()}>Abmelden</Menu.Item>
          </Menu>
        ) : (
          <>
            <Link to="/login" className="btn btn-outline btn-sm hidden sm:inline-flex">Anmelden</Link>
            {/* 60px of a 390px bar is a lot to spend on one word when the
                icon and its label say the same thing. */}
            <Link
              to="/login"
              aria-label="Anmelden"
              title="Anmelden"
              className="btn btn-outline btn-sm btn-icon sm:hidden"
            >
              <LogIn size={16} />
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
