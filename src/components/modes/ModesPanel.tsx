/**
 * Modes panel. Shows all 9 OMEGA modes, the active mode, and a readiness score
 * per mode (how well the current plan covers each mode's required categories).
 *
 * Bug #2 fix (2025-01-xx):
 * - Dual-score calculation: both category-based AND modeTags-based.
 * - Category-score: which requiredCategories are covered by placed devices' categories.
 * - ModeTags-score: which requiredCategories are covered by devices that explicitly
 *   declare support for this mode in their modeTags array.
 * - The HIGHER of the two scores is displayed, giving a more accurate readiness picture.
 * - modeTags field added to DeviceCatalogEntry and populated for all 50+ devices.
 */

import { useMemo } from 'react'
import {
  Circle, Zap, Sunrise, Sun, Clapperboard, Moon,
  Coffee, LogOut, PartyPopper, AlertTriangle, Wand2,
  type LucideIcon,
} from 'lucide-react'
import { usePlanStore } from '@/store/usePlanStore'
import { useUIStore } from '@/store/useUIStore'
import { OMEGA_MODES } from '@/lib/constants'
import type { ModeKey, PlacedDevice } from '@/types'
import { DEVICES } from '@/data/devices'
import { modeReadiness, type DeviceLookupEntry } from '@/lib/readiness'
import { cn } from '@/lib/utils'

/** Map mode-icon names from constants.ts to actual components.
 *  Adding a new mode requires extending this map. */
const MODE_ICONS: Record<string, LucideIcon> = {
  Zap, Sunrise, Sun, Clapperboard, Moon,
  Coffee, LogOut, PartyPopper, AlertTriangle, Wand2,
}

const DEVICE_MAP = new Map(DEVICES.map((d) => [d.id, d] as const))

/** Catalogue lookup injected into the readiness scorer. */
const lookup = (deviceId: string): DeviceLookupEntry | undefined => DEVICE_MAP.get(deviceId)

export function ModesPanel() {
  const doc = usePlanStore((s) => s.doc)
  const setActiveMode = usePlanStore((s) => s.setActiveMode)
  const applyMode = usePlanStore((s) => s.applyMode)
  const pushToast = useUIStore((s) => s.pushToast)

  /* ---- collect placed devices & their categories ---- */
  const placedDevices = useMemo<PlacedDevice[]>(() => {
    const list: PlacedDevice[] = []
    if (!doc) return list
    for (const floor of doc.floors) {
      for (const dev of floor.devices) list.push(dev)
    }
    return list
  }, [doc])

  if (!doc) return null

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {OMEGA_MODES.map((m) => {
          const { score, missing, tagsDominant } = modeReadiness(m, placedDevices, lookup)

          const active = doc.activeModeKey === m.key
          const Icon = MODE_ICONS[m.icon] ?? Circle
          return (
            <button
              key={m.key}
              onClick={() => setActiveMode(m.key as ModeKey)}
              title={
                missing.length
                  ? `Fehlt fuer vollstaendige Deckung: ${missing.join(', ')}`
                  : 'Alle Kategorien vorhanden'
              }
              className={cn(
                'group relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border p-2',
                'transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                'hover:-translate-y-0.5',
                active
                  ? 'border-[color:var(--accent)] bg-[rgba(199, 162, 78,0.12)] scale-[1.02]'
                  : 'border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-2)]',
              )}
              style={active ? { boxShadow: `0 0 22px ${m.accent}33, 0 4px 14px ${m.accent}1f` } : undefined}
            >
              <Icon size={20} style={{ color: m.accent }} />
              <div className="text-[11px] font-medium leading-tight text-center">{m.name}</div>
              <div
                className={cn(
                  'font-mono text-[10px]',
                  score >= 80 ? 'text-[color:var(--color-omega-success)]' :
                  score >= 40 ? 'text-[color:var(--accent)]' :
                                'text-[color:var(--color-omega-danger)]',
                )}
              >
                {score}%
              </div>
              {/* small indicator dot when modeTags-score is driving the result */}
              {tagsDominant && (
                <div
                  className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: m.accent }}
                  title="Modus-Spezifische Geraete erkannt"
                />
              )}
            </button>
          )
        })}
      </div>

      <div className="omega-divider my-3" />

      {/* Apply current mode to all matching devices */}
      <button
        onClick={() => {
          const result = applyMode()
          pushToast({
            kind: 'success',
            title: `Modus angewendet: ${OMEGA_MODES.find((m) => m.key === doc.activeModeKey)?.name ?? doc.activeModeKey}`,
            description: `${result.applied} Geräte konfiguriert${result.skipped ? `, ${result.skipped} übersprungen` : ''}.`,
          })
        }}
        className="w-full mb-3 btn btn-outline btn-sm"
        title="Schreibt für jedes passende Gerät den Soll-Zustand für den aktiven Modus."
      >
        <Wand2 size={14} /> Aktiven Modus anwenden
      </button>

      <div className="text-[11px] leading-relaxed text-[color:var(--muted)]">
        Jeder Modus braucht bestimmte Gerätekategorien. Der Readiness-Score zeigt, wie
        gut dein aktueller Plan diesen Modus abdeckt. Ein farbiger Punkt markiert
        modus-spezifisch erkannte Geräte.
      </div>
    </div>
  )
}
