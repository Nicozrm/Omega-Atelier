/**
 * Share dialog — copy link, toggle public, invite collaborators.
 * Works only when the plan has been saved to the cloud (planRowId present).
 */

import { useEffect, useState } from 'react'
import { Link as LinkIcon, Globe, UserPlus, Trash2, Eye, Pencil } from 'lucide-react'
import { Dialog } from '@/ui'
import { supabase, supabaseReady } from '@/lib/supabase'
import { useUIStore } from '@/store/useUIStore'
import type { CollaboratorRole } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  planRowId: string | undefined
}

interface CollaboratorRow {
  user_id: string
  role: CollaboratorRole
  email?: string | null
  display_name?: string | null
}

export function ShareDialog({ open, onClose, planRowId }: Props) {
  const pushToast = useUIStore((s) => s.pushToast)
  const [isPublic, setIsPublic] = useState(false)
  const [collabs, setCollabs] = useState<CollaboratorRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<CollaboratorRole>('viewer')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !planRowId || !supabaseReady) return
    void (async () => {
      const { data: planRow } = await supabase.from('plans').select('is_public').eq('id', planRowId).maybeSingle()
      if (planRow) setIsPublic(!!planRow.is_public)
      const { data: crows } = await supabase
        .from('plan_collaborators')
        .select('user_id, role, profiles:user_id(email, display_name)')
        .eq('plan_id', planRowId)
      if (crows) {
        type ProfileRow = { email?: string; display_name?: string }
        type CollabRow = { user_id: string; role: CollaboratorRole; profiles?: ProfileRow | ProfileRow[] | null }
        setCollabs((crows as CollabRow[]).map((c) => ({
          user_id: c.user_id,
          role: c.role,
          email: Array.isArray(c.profiles) ? c.profiles[0]?.email : c.profiles?.email,
          display_name: Array.isArray(c.profiles) ? c.profiles[0]?.display_name : c.profiles?.display_name,
        })))
      }
    })()
  }, [open, planRowId])

  if (!open) return null

  const togglePublic = async () => {
    if (!planRowId) return
    const next = !isPublic
    setIsPublic(next)
    const { error } = await supabase.from('plans').update({ is_public: next }).eq('id', planRowId)
    if (error) pushToast({ kind: 'error', title: 'Fehler', description: error.message })
  }

  const copyLink = async () => {
    const link = `${window.location.origin}/plan/${planRowId}`
    await navigator.clipboard.writeText(link)
    pushToast({ kind: 'success', title: 'Link kopiert', description: link })
  }

  const invite = async () => {
    if (!inviteEmail || !planRowId) return
    setLoading(true)
    const address = inviteEmail.toLowerCase().trim()
    /*
     * Über `find_user_by_email` statt über ein SELECT auf `profiles`.
     *
     * Für die Suche nach E-Mail müsste die Profiltabelle für jeden angemeldeten
     * Nutzer lesbar sein — und damit auch `select email from profiles`, also
     * die Adressen aller Nutzer auf einen Griff. Die Funktion beantwortet
     * stattdessen genau diese eine Frage und gibt keine E-Mail zurück; der
     * Aufrufer kennt sie ohnehin, er hat sie gerade eingetippt.
     */
    const { data: found, error: lookupError } = await supabase
      .rpc('find_user_by_email', { p_email: address })
    if (lookupError) {
      pushToast({ kind: 'error', title: 'Fehler', description: lookupError.message })
      setLoading(false)
      return
    }
    const profile = (found as Array<{ id: string; display_name?: string }> | null)?.[0]
    if (!profile) {
      pushToast({ kind: 'error', title: 'Nicht gefunden', description: 'Kein Benutzer mit dieser E-Mail.' })
      setLoading(false)
      return
    }
    const { error } = await supabase
      .from('plan_collaborators')
      .upsert({ plan_id: planRowId, user_id: profile.id, role: inviteRole })
    if (error) {
      pushToast({ kind: 'error', title: 'Fehler', description: error.message })
    } else {
      // Die eingetippte Adresse, nicht eine aus der Datenbank gelesene — die
      // Funktion gibt bewusst keine zurück.
      pushToast({ kind: 'success', title: 'Eingeladen', description: address })
      setCollabs((prev) => {
        const other = prev.filter((c) => c.user_id !== profile.id)
        return [...other, {
          user_id: profile.id, role: inviteRole,
          email: address, display_name: profile.display_name,
        }]
      })
      setInviteEmail('')
    }
    setLoading(false)
  }

  const removeCollab = async (userId: string) => {
    if (!planRowId) return
    await supabase.from('plan_collaborators').delete().eq('plan_id', planRowId).eq('user_id', userId)
    setCollabs((prev) => prev.filter((c) => c.user_id !== userId))
  }

  if (!planRowId) {
    return (
      <Dialog open={open} onClose={onClose} title="Plan teilen" size="sm">
        <p className="text-sm">Speichere den Plan zuerst, um ihn teilen zu können.</p>
        <button onClick={onClose} className="btn btn-ghost mt-3">Schließen</button>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={onClose} title="Plan teilen" size="md">
      {/* Link */}
        <div className="surface p-3 mb-4">
          <div className="flex items-center gap-3">
            <LinkIcon size={16} className="text-[color:var(--accent)]" />
            <div className="flex-1">
              <div className="text-sm">Share-Link</div>
              <div className="font-mono text-xs text-[color:var(--muted)] truncate">
                {window.location.origin}/plan/{planRowId}
              </div>
            </div>
            <button onClick={copyLink} className="btn btn-outline btn-sm">Kopieren</button>
          </div>
        </div>

        {/* Public toggle */}
        <div className="surface p-3 mb-4 flex items-center gap-3">
          <Globe size={16} className="text-[color:var(--accent)]" />
          <div className="flex-1">
            <div className="text-sm">Öffentlich zugänglich</div>
            <div className="text-xs text-[color:var(--muted)]">
              Jeder mit dem Link kann ansehen (schreibgeschützt).
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" checked={isPublic} onChange={togglePublic} className="peer sr-only" />
            <span className="h-6 w-11 rounded-full bg-[color:var(--surface-2)] peer-checked:bg-[color:var(--accent)] transition" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition peer-checked:translate-x-5" />
          </label>
        </div>

        {/* Invite */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">
            <UserPlus size={12} /> Kollaborator einladen
          </div>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="E-Mail-Adresse"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              type="email"
            />
            <select
              className="input !w-32"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as CollaboratorRole)}
            >
              <option value="viewer">Ansehen</option>
              <option value="editor">Bearbeiten</option>
            </select>
            <button onClick={invite} disabled={loading} className="btn btn-primary btn-sm">
              +
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[color:var(--muted)]">
            Die Person muss bereits ein OMEGA-Atelier-Konto haben.
          </p>
        </div>

        {/* Collaborators list */}
        {collabs.length > 0 && (
          <div>
            <div className="mb-2 text-xs uppercase tracking-wider text-[color:var(--muted)]">
              Aktuelle Kollaboratoren
            </div>
            <div className="space-y-1">
              {collabs.map((c) => (
                <div key={c.user_id} className="flex items-center gap-3 rounded-md border border-[color:var(--border)] p-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{c.display_name ?? c.email ?? c.user_id.slice(0, 8)}</div>
                    {c.email && <div className="text-xs text-[color:var(--muted)] truncate">{c.email}</div>}
                  </div>
                  <span className="chip">
                    {c.role === 'editor' ? <><Pencil size={10} /> Editor</> : <><Eye size={10} /> Viewer</>}
                  </span>
                  <button
                    onClick={() => removeCollab(c.user_id)}
                    className="text-[color:var(--muted)] hover:text-[color:var(--color-omega-danger)]"
                    title="Entfernen"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
    </Dialog>
  )
}
