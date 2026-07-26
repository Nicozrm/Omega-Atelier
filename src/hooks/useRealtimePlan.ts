/**
 * useRealtimePlan — live collaboration primitives.
 *
 * Two Supabase realtime channels per open plan:
 *
 *   1. Postgres changes on `plans` row  → incoming doc updates from others
 *   2. Broadcast channel (`plan:cursor:<id>`) for live cursors + presence
 *
 * v13 conflict resolution:
 *  - Each PlanDocument carries a `clientId` stamped by the originating tab.
 *  - Incoming changes whose `clientId === our session id` are silent echoes
 *    of our own writes and are ignored.
 *  - Otherwise: if local user has unsaved changes from the last 4 seconds,
 *    we show a toast offering to apply or discard the remote update. If
 *    local is idle, we apply silently (typical realtime "live cursor" feel).
 *
 * Current-user cursor position is throttled-broadcasted on pointer move.
 */

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase, supabaseReady } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'
import { usePlanStore, getSessionClientId } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { stableHue } from '@/lib/utils'
import { coercePlan } from '@/lib/planSchema'
import type { RemoteCursor, PlanRow } from '@/types'

const CURSOR_THROTTLE_MS = 50
/** Window during which an incoming remote write is considered to "conflict"
 *  with local edits. Outside this window we apply silently. */
const CONFLICT_WINDOW_MS = 4000

export function useRealtimePlan(planRowId: string | undefined) {
  const user = useAuthStore((s) => s.user)
  const loadDocument = usePlanStore((s) => s.loadDocument)
  const pushToast = useUIStore((s) => s.pushToast)
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({})
  const chanRef = useRef<RealtimeChannel | null>(null)
  const postgresChanRef = useRef<RealtimeChannel | null>(null)
  const lastBroadcastRef = useRef<number>(0)
  /** Keep a pending remote update so the toast button can apply it later. */
  const pendingRemoteRef = useRef<PlanRow['doc'] | null>(null)

  useEffect(() => {
    if (!supabaseReady || !planRowId) return

    // ─── Postgres changes (incoming doc updates) ───
    const pgChan = supabase
      .channel(`plan:${planRowId}:rows`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'plans', filter: `id=eq.${planRowId}` },
        (payload) => {
          const row = payload.new as PlanRow
          const incomingDoc = coercePlan(row.doc)
          if (!incomingDoc) return // ignore malformed/incompatible remote payloads
          const ourClientId = getSessionClientId()

          // Ignore echo of OUR OWN write (reliable: clientId is unique per tab).
          if (incomingDoc.clientId && incomingDoc.clientId === ourClientId) {
            return
          }

          // Conflict check: did the local user touch anything in the last
          // CONFLICT_WINDOW_MS? If so, do NOT silently overwrite — ask first.
          const { lastLocalChangeAt } = usePlanStore.getState()
          const hasFreshLocalEdits =
            lastLocalChangeAt !== null && Date.now() - lastLocalChangeAt < CONFLICT_WINDOW_MS

          if (hasFreshLocalEdits) {
            pendingRemoteRef.current = incomingDoc
            pushToast({
              kind: 'warning',
              title: 'Andere Änderungen empfangen',
              description:
                'Ein:e Mitbearbeiter:in hat den Plan gleichzeitig editiert. ' +
                'Klicke hier, um die Remote-Version zu übernehmen — sonst ' +
                'bleibt deine Version erhalten.',
              duration: 12000,
              onClick: () => {
                if (pendingRemoteRef.current) {
                  loadDocument(pendingRemoteRef.current, true)
                  pendingRemoteRef.current = null
                  pushToast({ kind: 'success', title: 'Remote-Version übernommen' })
                }
              },
            })
            return
          }

          // No conflict → apply silently.
          loadDocument(incomingDoc, true)
        },
      )
      .subscribe()
    postgresChanRef.current = pgChan

    // ─── Broadcast: cursors / presence ───
    const cursorChan = supabase.channel(`plan:cursor:${planRowId}`, {
      config: { broadcast: { self: false }, presence: { key: user?.id ?? 'anon' } },
    })

    cursorChan
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        const c = payload as RemoteCursor
        setCursors((prev) => ({ ...prev, [c.userId]: c }))
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        setCursors((prev) => {
          const next = { ...prev }
          for (const p of leftPresences) {
            if (p.presence_ref) delete next[p.presence_ref]
          }
          return next
        })
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && user) {
          await cursorChan.track({
            user_id: user.id,
            name: user.email ?? 'Gast',
            hue: stableHue(user.id),
          })
        }
      })

    chanRef.current = cursorChan

    return () => {
      void supabase.removeChannel(pgChan)
      void supabase.removeChannel(cursorChan)
      chanRef.current = null
      postgresChanRef.current = null
      pendingRemoteRef.current = null
    }
  }, [planRowId, user, loadDocument, pushToast])

  /** Publish this user's cursor. Throttled. */
  const publishCursor = (
    worldX: number,
    worldY: number,
    floorId: string,
    tool: RemoteCursor['tool'],
  ) => {
    if (!chanRef.current || !user) return
    const now = performance.now()
    if (now - lastBroadcastRef.current < CURSOR_THROTTLE_MS) return
    lastBroadcastRef.current = now
    const payload: RemoteCursor = {
      userId: user.id,
      name: user.email ?? 'Gast',
      color: `hsl(${stableHue(user.id)} 70% 60%)`,
      x: worldX,
      y: worldY,
      floorId,
      tool,
      ts: Date.now(),
    }
    void chanRef.current.send({ type: 'broadcast', event: 'cursor', payload })
  }

  return { cursors, publishCursor }
}
